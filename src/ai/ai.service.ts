import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleGenAI, Type, Schema } from '@google/genai';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  // In-memory cache for catalogs to prevent DB queries on every voice request
  private catalogCache: { productos: any[], comentarios: any[], timestamp: number } | null = null;
  private readonly CACHE_TTL = 1000 * 60 * 5; // 5 minutes cache

  constructor(
    private readonly configService: ConfiguracionService,
    private readonly prisma: PrismaService,
  ) {}

  private async getCatalogs() {
    const now = Date.now();
    if (this.catalogCache && (now - this.catalogCache.timestamp) < this.CACHE_TTL) {
      return this.catalogCache;
    }

    const [productosRaw, comentariosRaw] = await Promise.all([
      this.prisma.productos.findMany({
        select: { IDproductos: true, nombre: true },
      }),
      this.prisma.comentarios.findMany({
        select: { ID: true, comentarios: true },
      }),
    ]);

    // Optimize payload size for faster TTFT (Time to First Token)
    const productos = productosRaw.map(p => ({ i: p.IDproductos, n: p.nombre }));
    const comentarios = comentariosRaw.map(c => ({ i: c.ID, n: c.comentarios }));

    this.catalogCache = { productos, comentarios, timestamp: now };
    return this.catalogCache;
  }

  async processVoiceOrder(audioBuffer: Buffer, mimeType: string) {
    const configIA = await this.configService.getConfiguracionIA();

    if (!configIA.isActive) {
      throw new BadRequestException('El módulo de IA está desactivado en la configuración del sistema.');
    }

    if (!configIA.apiKey) {
      throw new BadRequestException('No se ha configurado una API Key válida para Gemini.');
    }

    try {
      // 1. Obtener catálogo desde Cache en memoria (0ms DB trip)
      const { productos: catalogProductos, comentarios: catalogComentarios } = await this.getCatalogs();

      // Ultra-concise prompt to save input tokens parsing time
      const systemInstruction = `P:${JSON.stringify(catalogProductos)}
C:${JSON.stringify(catalogComentarios)}
Map audio to IDs.
Rules:
1. productoId=ID in P
2. comentariosIds=IDs in C
3. If modifier not in C (e.g. "carro rojo"), put raw text in 'notasAdicionales'
4. cantidad=number`;

      const responseSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                productoId: { type: Type.STRING },
                cantidad: { type: Type.INTEGER },
                comentariosIds: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                notasAdicionales: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Modificadores o notas que no se encontraron en el catálogo C",
                },
              },
              required: ["productoId", "cantidad"],
            },
          },
        },
        required: ["items"],
      };

      const ai = new GoogleGenAI({ apiKey: configIA.apiKey });
      const base64Audio = audioBuffer.toString('base64');

      // Always use gemini-3-flash-preview or a reasoning-capable model for multimodal audio
      // We will force it if not set, or just use the default configured, but the user requested gemini-3-flash-preview.
      // Wait, in the plan: "Utilizar exclusivamente el modelo configurado dinámicamente o forzar capacidades de razonamiento si se usa gemini-3-flash-preview."
      const modelToUse = configIA.modeloDefecto === 'gemini-3-flash-preview' ? 'gemini-3-flash-preview' : configIA.modeloDefecto;

      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: [
          {
            role: 'user',
            parts: [
              { text: "Procesa este pedido de voz." },
              {
                inlineData: {
                  data: base64Audio,
                  mimeType: mimeType,
                }
              }
            ]
          }
        ],
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.1, // low temperature for precise mapping
          topP: configIA.topP,
          maxOutputTokens: 8192, // FORCE MAX TOKENS! Thinking models require large output limits or the JSON gets cut off.
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          // SDK types for advanced configs
          mediaResolution: "MEDIA_RESOLUTION_HIGH" as any,
          thinkingConfig: {
            thinkingLevel: "HIGH" as any
          }
        }
      });

      let responseText = response.text;
      if (!responseText) {
        throw new BadRequestException('La IA no pudo procesar el audio o devolvió una respuesta vacía.');
      }

      // Función robusta para reparar y parsear JSON
      const repairAndParseJSON = (text: string) => {
        // 1. Limpiar wrappers de markdown
        let cleaned = text.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
        
        // 2. Reemplazar saltos de línea reales (ASCII 10) por espacios. 
        // Esto soluciona el error "Unterminated string in JSON" si Gemini incluye saltos de línea literales dentro de un string.
        cleaned = cleaned.replace(/\n/g, ' ').replace(/\r/g, '');

        try {
          return JSON.parse(cleaned);
        } catch (e) {
          // 3. Intento de reparación por truncamiento (si la IA se corta por límite de tokens)
          let repaired = cleaned;
          
          // Si el último caracter es una coma, la quitamos
          if (repaired.endsWith(',')) {
            repaired = repaired.slice(0, -1);
          }
          
          // Contar llaves y corchetes
          const openBraces = (repaired.match(/{/g) || []).length;
          const closeBraces = (repaired.match(/}/g) || []).length;
          const openBrackets = (repaired.match(/\[/g) || []).length;
          const closeBrackets = (repaired.match(/\]/g) || []).length;
          
          // Si hay un número impar de comillas, cerrar el string actual
          const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
          if (quoteCount % 2 !== 0) {
            repaired += '"';
          }
          
          // Cerrar corchetes y llaves pendientes
          for (let i = 0; i < (openBrackets - closeBrackets); i++) {
            repaired += ']';
          }
          for (let i = 0; i < (openBraces - closeBraces); i++) {
            repaired += '}';
          }
          
          return JSON.parse(repaired);
        }
      };

      try {
        return repairAndParseJSON(responseText);
      } catch (parseError: any) {
        this.logger.error(`JSON Parse Error. Raw text: ${response.text}`);
        throw new BadRequestException(`La IA devolvió un formato incompleto o inválido. Intenta de nuevo.`);
      }

    } catch (error: any) {
      this.logger.error(`Error en processVoiceOrder: ${error.message}`);
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Error al procesar audio con IA: ${error.message}`);
    }
  }

  async extractDataFromImage(imageBuffer: Buffer, mimeType: string, context: string) {
    const configIA = await this.configService.getConfiguracionIA();

    if (!configIA.isActive) {
      throw new BadRequestException('El módulo de IA está desactivado en la configuración del sistema.');
    }

    if (!configIA.apiKey) {
      throw new BadRequestException('No se ha configurado una API Key válida para Gemini.');
    }

    try {
      const ai = new GoogleGenAI({ apiKey: configIA.apiKey });

      let systemInstruction = '';
      let responseSchema: Schema | undefined = undefined;

      // Según el contexto, definimos el prompt y el esquema de respuesta
      if (context === 'gastos') {
        systemInstruction = `
          Eres un asistente experto en contabilidad. Tu tarea es analizar imágenes de recibos o comprobantes de pago.
          Debes extraer:
          - concepto: Un texto breve y claro que describa de qué trata el gasto.
          - valor: El monto total del recibo como un número (ej. 45000). Si no encuentras valor, devuelve 0.
          - tipo: Clasifícalo como "NEGOCIO" si parece algo comercial/insumos, o "PERSONAL" si parece un gasto personal del dueño.
          - medioDePago: Identifica si fue "Efectivo", "Nequi", "Bancolombia", "Transferencia", etc.
        `;
        
        responseSchema = {
          type: Type.OBJECT,
          properties: {
            concepto: { type: Type.STRING },
            valor: { type: Type.NUMBER },
            tipo: { type: Type.STRING },
            medioDePago: { type: Type.STRING },
          },
          required: ["concepto", "valor", "tipo", "medioDePago"],
        };
      } else {
        throw new BadRequestException(`Contexto de extracción '${context}' no soportado.`);
      }

      // Convertir el buffer a base64 para el SDK de Google GenAI
      const base64Image = imageBuffer.toString('base64');

      const response = await ai.models.generateContent({
        model: configIA.modeloDefecto,
        contents: [
          {
            role: 'user',
            parts: [
              { text: "Extrae los datos de esta imagen." },
              {
                inlineData: {
                  data: base64Image,
                  mimeType: mimeType,
                }
              }
            ]
          }
        ],
        config: {
          systemInstruction: systemInstruction,
          temperature: configIA.temperatura,
          topP: configIA.topP,
          maxOutputTokens: configIA.maxTokens,
          responseMimeType: "application/json",
          responseSchema: responseSchema,
        }
      });

      if (!response.text) {
        throw new BadRequestException('La IA no pudo procesar la imagen o devolvió una respuesta vacía.');
      }

      // Parseamos el JSON devuelto
      const parsedData = JSON.parse(response.text);
      return parsedData;

    } catch (error: any) {
      this.logger.error(`Error en extractDataFromImage: ${error.message}`);
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Error al procesar con IA: ${error.message}`);
    }
  }

  async autoCuadrePreview(datosRequeridos: any) {
    console.log('[AiService] Solicitando configuración de IA a DB...');
    const configIA = await this.configService.getConfiguracionIA();
    console.log('[AiService] Configuración de IA obtenida:', { 
      isActive: configIA.isActive, 
      hasApiKey: !!configIA.apiKey, 
      apiKeyPreview: configIA.apiKey ? `${configIA.apiKey.substring(0, 5)}...` : 'N/A' 
    });

    if (!configIA.isActive) {
      throw new BadRequestException('El módulo de IA está desactivado.');
    }
    if (!configIA.apiKey) {
      throw new BadRequestException('No se ha configurado una API Key válida para Gemini.');
    }

    try {
      const ai = new GoogleGenAI({ apiKey: configIA.apiKey as string });
      const modelToUse = 'gemini-3.5-flash';

      const systemInstruction = `Eres un sistema experto en auditoría matemática de cajas registradoras.
Tu tarea es ajustar los pedidos existentes para cuadrar el inventario y el dinero exactamente.
Se te proporciona:
1. Insumos Descuadrados: cantidad exacta que sobra o falta en el sistema físico frente al sistema. Si falta (DIF < 0), significa que el sistema registró ventas que no ocurrieron físicamente, debes QUITAR productos de los pedidos. Si DIF > 0, debes AÑADIR. Pero por ahora, prioriza eliminar (DIF < 0).
2. Ventas Elegibles: Una lista de pedidos (sólo EFECTIVO, sin comentarios) que puedes alterar.
3. Descuadre Monetario actual: Cuánto Faltante o Excedente de efectivo hay.

REGLAS:
1. Debes devolver UNICAMENTE un JSON válido con las acciones a tomar.
2. Usa la acción "remove_product" para eliminar unidades de un producto de un pedido.
3. Usa la acción "change_payment" para cambiar el método de pago de EFECTIVO a TRANSFERENCIA si necesitas reducir el monto en efectivo, o viceversa, para que Faltante y Excedente queden lo más cercano a 0 posible.
4. Explica brevemente el motivo en cada acción (campo "motivo").
5. OBLIGATORIO: Debes incluir el campo "justificacionGeneral" en la raíz del JSON con un resumen de lo que vas a hacer.
6. OBLIGATORIO: Para "remove_product", incluye "nombreProducto" con el nombre del producto que vas a remover.`;

      const responseSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          justificacionGeneral: { type: Type.STRING, description: "Resumen general de las acciones tomadas y por qué." },
          acciones: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                action: { type: Type.STRING, description: "remove_product o change_payment" },
                ventaId: { type: Type.STRING },
                ordenId: { type: Type.STRING, description: "Solo aplicable para remove_product" },
                productoId: { type: Type.STRING, description: "Solo aplicable para remove_product" },
                nombreProducto: { type: Type.STRING, description: "Nombre del producto (solo para remove_product)" },
                cantidadARemover: { type: Type.INTEGER, description: "Cantidad a quitar. Positivo." },
                method: { type: Type.STRING, description: "EFECTIVO o TRANSFERENCIA. Solo para change_payment." },
                motivo: { type: Type.STRING, description: "Motivo por el que se escogió este cambio." },
              },
              required: ["action", "ventaId", "motivo"]
            }
          }
        },
        required: ["acciones", "justificacionGeneral"]
      };

      const promptData = JSON.stringify(datosRequeridos, null, 2);

      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: [
          {
            role: 'user',
            parts: [
              { text: `Genera el plan de cuadre matemático para los siguientes datos:\n${promptData}` }
            ]
          }
        ],
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          thinkingConfig: {
            thinkingLevel: "HIGH" as any
          }
        }
      });

      if (!response.text) {
        throw new BadRequestException('La IA no pudo procesar la solicitud o devolvió respuesta vacía.');
      }

      console.log('[AiService] Respuesta RAW de Gemini:', response.text);
      const parsedData = JSON.parse(response.text);
      return parsedData;

    } catch (error: any) {
      this.logger.error(`Error en autoCuadrePreview: ${error.message}`);
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Error al procesar Auto-Cuadre con IA: ${error.message}`);
    }
  }
}
