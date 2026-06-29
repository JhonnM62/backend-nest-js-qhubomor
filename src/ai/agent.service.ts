import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { AgentToolsService } from './agent.tools';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { StateGraph, StateSchema, START, END, MemorySaver, interrupt, Command, MessagesValue } from '@langchain/langgraph';
import { InMemoryStore } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { Pool } from 'pg';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { PrismaService } from '../prisma/prisma.service';

const AgentState = new StateSchema({
  messages: MessagesValue,
});

@Injectable()
export class AgentService implements OnModuleInit {
  private graph: any;
  private checkpointer: PostgresSaver | MemorySaver;
  private store: InMemoryStore;
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private agentTools: AgentToolsService,
    private configuracionService: ConfiguracionService,
    private prisma: PrismaService
  ) {}

  async onModuleInit() {
    // Configurar Store (Memoria a largo plazo)
    this.store = new InMemoryStore();

    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl) {
      try {
        const pool = new Pool({ connectionString: dbUrl });
        this.checkpointer = new PostgresSaver(pool);
        await this.checkpointer.setup(); 
        this.logger.log('PostgresSaver checkpointer configurado con éxito.');
      } catch (e) {
        this.logger.error('Error configurando PostgresSaver', e);
        this.checkpointer = new MemorySaver();
      }
    } else {
      this.checkpointer = new MemorySaver();
      this.logger.warn('DATABASE_URL no definida. Usando MemorySaver.');
    }

    const tools = this.agentTools.getTools();
    const toolNode = new ToolNode(tools);

    const callModel = async (state: typeof AgentState.State) => {
      const configIA = await this.configuracionService.getConfiguracionIA();
      const apiKey = configIA?.apiKey || process.env.GEMINI_API_KEY;
      const modeloDefecto = configIA?.modeloDefecto || 'gemini-3.5-flash';

      const llm = new ChatGoogleGenerativeAI({
        model: modeloDefecto,
        apiKey: apiKey,
        temperature: 0,
        ...(configIA?.usarRazonamiento ? {
          thinkingConfig: {
            thinkingLevel: 'HIGH'
          }
        } : {})
      });
      
      const llmWithTools = llm.bindTools(tools);
      
      const { SystemMessage } = await import('@langchain/core/messages');
      const reglasDb = await this.prisma.instruccionesAgente.findMany();
      const reglasTexto = reglasDb.length > 0 
        ? '\n\nREGLAS Y RETROALIMENTACIÓN APRENDIDAS DEL USUARIO:\n' + reglasDb.map(r => `🔹 [${r.contexto}]: ${r.instruccion}`).join('\n')
        : '';

      const systemMessage = new SystemMessage(`Eres el asistente de IA avanzado de Q'hubo Mor POS. 
Hoy es: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}.
Usa esta fecha para resolver cualquier consulta que mencione "hoy", "ayer" o fechas relativas. No supongas otra fecha.
IMPORTANTE: NUNCA uses formato Markdown (asteriscos para negritas, cursivas o viñetas). La app móvil no renderiza Markdown y muestra los asteriscos literalmente. En lugar de eso, usa emojis (🔹, 💰, 📅, 🟢, 🔴, etc.) para resaltar puntos clave, hacer viñetas y estructurar tus respuestas en texto plano de forma atractiva y fácil de leer.
CONTEXTO DE CAJA: Si el usuario te pide analizar cierres de caja, ten en cuenta que el dinero físico real que quedó en la caja se suele reportar en el campo 'plata guardada', 'efectivo de cierre' o en la observación del cierre. Si encuentras herramientas de caja, revisa cuidadosamente la sección de observaciones o notas para encontrar esta información.
REGLA DE ORO PARA HERRAMIENTAS: Si llamas a una herramienta y esta devuelve "[]", "No se encontraron", o un texto que empiece con "Error", NO la vuelvas a llamar ciegamente. Lee el error, asume que falló, y explícale amigablemente al usuario lo que sucedió.${reglasTexto}`);

      const response = await llmWithTools.invoke([systemMessage, ...state.messages]);
      if (response.tool_calls && response.tool_calls.length > 0) {
        this.logger.debug(`[AgentService] LLM is calling tools: ${response.tool_calls.map((t: any) => t.name).join(', ')} | Args: ${JSON.stringify(response.tool_calls.map(t=>t.args))}`);
      }
      return { messages: [response] };
    };

    const checkInterrupt = async (state: typeof AgentState.State) => {
      const lastMessage = state.messages[state.messages.length - 1];
      
      if (lastMessage instanceof AIMessage && (lastMessage.tool_calls?.length ?? 0) > 0) {
        for (const call of lastMessage.tool_calls || []) {
          const dangerousTools = [
            'registrar_gasto', 
            'registro_masivo_insumos', 
            'modificar_cuenta', 
            'liquidar_empleado', 
            'cerrar_caja'
          ];
          
          if (dangerousTools.includes(call.name)) {
             const humanDecision = interrupt({
               action: call.name,
               args: call.args,
               message: `Acción crítica detectada: ${call.name}. ¿Deseas aprobarla?`,
               tool_call_id: call.id
             }) as any;

             if (!humanDecision?.approved) {
                return new Command({
                   update: {
                      messages: [new ToolMessage({
                         tool_call_id: call.id as string,
                         name: call.name,
                         content: "Acción cancelada por el usuario. Infórmale que no se realizó."
                      })]
                   },
                   goto: "call_model" 
                });
             }
          }
        }
      }
      return new Command({ goto: "tools" });
    };

    const route = (state: typeof AgentState.State) => {
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage instanceof AIMessage && (lastMessage.tool_calls?.length ?? 0) > 0) {
         return "check_interrupt";
      }
      return END;
    };

    const workflow = new StateGraph(AgentState)
      .addNode("call_model", callModel)
      .addNode("check_interrupt", checkInterrupt)
      .addNode("tools", toolNode)
      .addEdge(START, "call_model")
      .addConditionalEdges("call_model", route)
      .addEdge("tools", "call_model");

    this.graph = workflow.compile({ checkpointer: this.checkpointer, store: this.store });
  }

  async invokeAgent(message: string, threadId: string, resumeCommand?: any, file?: Express.Multer.File) {
    const config = { configurable: { thread_id: threadId } };
    
    let result;
    try {
      if (resumeCommand) {
         result = await this.graph.invoke(new Command({ resume: resumeCommand }), config);
      } else {
         let messageContent: any = message;
         if (file) {
             const base64Img = file.buffer.toString('base64');
             messageContent = [
                 { type: 'text', text: message || "Describe esta imagen." },
                 { type: 'image_url', image_url: `data:${file.mimetype};base64,${base64Img}` }
             ];
         }
         result = await this.graph.invoke({ messages: [new HumanMessage({ content: messageContent })] }, config);
      }
    } catch (error: any) {
      this.logger.error('Error invoking graph:', error);
      if (error.name === 'GraphRecursionError' || (error.message && error.message.includes('Recursion limit'))) {
          // Graceful degradation for recursion
          return {
             status: 'completed',
             message: '🤖 Lo siento, tuve un problema interno de límite de herramientas (GraphRecursionError) y no pude terminar. La herramienta no respondió como esperaba. Por favor intenta reformular tu solicitud.'
          };
      }
      throw error;
    }

    const state = await this.graph.getState(config);
    const isPaused = state.tasks && state.tasks.length > 0 && state.tasks[0].interrupts?.length > 0;

    if (isPaused) {
        return {
           status: 'interrupted',
           interruptData: state.tasks[0].interrupts[0].value
        };
    }

    const lastMessage = state.values.messages[state.values.messages.length - 1];
    
    return {
       status: 'completed',
       message: lastMessage.content
    };
  }
}
