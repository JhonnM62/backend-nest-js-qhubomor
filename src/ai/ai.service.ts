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
          maxOutputTokens: configIA.maxTokens,
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          // SDK types for advanced configs
          mediaResolution: "MEDIA_RESOLUTION_HIGH" as any,
          thinkingConfig: {
            thinkingLevel: "HIGH" as any
          }
        }
      });

      if (!response.text) {
        throw new BadRequestException('La IA no pudo procesar el audio o devolvió una respuesta vacía.');
      }

      return JSON.parse(response.text);

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
}
