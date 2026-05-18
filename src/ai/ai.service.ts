import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { GoogleGenAI, Type, Schema } from '@google/genai';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly configService: ConfiguracionService) {}

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
