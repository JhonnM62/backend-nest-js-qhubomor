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

  // Función robusta para reparar y parsear JSON devuelto por Gemini
  private repairAndParseJSON(text: string) {
    // 1. Limpiar wrappers de markdown si existen dentro del bloque
    let cleanedText = text.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();

    // Intentar un parseo limpio inmediato antes de aplicar regex destructivos
    try {
      return JSON.parse(cleanedText);
    } catch (cleanParseError) {
      this.logger.warn(`Parseo limpio falló. Intentando reparación agresiva...`);
    }

    // 2. Extraer solo la parte JSON (ignorar saludos o texto extra de Gemini)
    let startIndex = cleanedText.indexOf('{');
    const startBracket = cleanedText.indexOf('[');
    if (startIndex === -1 || (startBracket !== -1 && startBracket < startIndex)) {
      startIndex = startBracket;
    }

    let endIndex = cleanedText.lastIndexOf('}');
    const endBracket = cleanedText.lastIndexOf(']');
    if (endIndex === -1 || (endBracket !== -1 && endBracket > endIndex)) {
      endIndex = endBracket;
    }

    let cleaned = cleanedText;
    if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
      cleaned = cleanedText.substring(startIndex, endIndex + 1);
    }
    
    // 3. Reemplazar saltos de línea y tabulaciones problemáticas
    // PRECAUCIÓN: Esto puede romper strings con espacios si no se hace bien
    cleaned = cleaned.replace(/\n/g, ' ').replace(/\r/g, '').replace(/\t/g, ' ');

    // 4. Intentar limpiar comillas dobles no escapadas dentro de strings
    cleaned = cleaned.replace(/(?<![:\{\[\s,])"(?![\s,\}\]:])/g, '\\"');

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      // 5. Intento de reparación por truncamiento
      let repaired = cleaned;
      
      if (repaired.endsWith(',')) repaired = repaired.slice(0, -1);
      
      const openBraces = (repaired.match(/{/g) || []).length;
      const closeBraces = (repaired.match(/}/g) || []).length;
      const openBrackets = (repaired.match(/\[/g) || []).length;
      const closeBrackets = (repaired.match(/\]/g) || []).length;
      
      const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
      if (quoteCount % 2 !== 0) repaired += '"';
      
      for (let i = 0; i < (openBrackets - closeBrackets); i++) repaired += ']';
      for (let i = 0; i < (openBraces - closeBraces); i++) repaired += '}';
      
      try {
        return JSON.parse(repaired);
      } catch (finalError: any) {
         this.logger.error(`Error final de parseo: ${finalError.message}. Texto reparado: ${repaired}`);
         throw finalError; // Rethrow to let the caller handle it
      }
    }
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

      try {
        return this.repairAndParseJSON(responseText);
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
      } else if (context === 'inventario') {
        const insumosDb = await this.prisma.insumos.findMany({
          select: { IDalimentos: true, nombre: true, unidades: true, precio: true, nombreCategoria: true }
        });
        
        systemInstruction = `
          Eres un asistente experto en inventario. Tu tarea es extraer la lista de productos de una factura o texto, y mapearlos con la base de datos local.
          
          BASE DE DATOS DE INSUMOS LOCALES:
          ${JSON.stringify(insumosDb)}
          
          Reglas CRÍTICAS:
          1. OBLIGATORIO: Debes extraer ABSOLUTAMENTE TODOS LOS ÍTEMS presentes en la factura. No agrupes, no resumas, no omitas ninguno.
          2. MAPEO INTELIGENTE: Para cada ítem, encuentra el 'insumoId' en la BASE DE DATOS LOCAL. Sé MUY flexible con los nombres (las facturas usan abreviaturas o marcas como 'Mix Premium'). Si una o dos palabras clave coinciden (ej. 'Ojo de diablo' con 'Ojo de diablo alcohol') y el 'precio' es igual o muy cercano, considéralo un match válido y asígnale el ID. Usa tu razonamiento avanzado para deducir el insumo correcto.
          3. Solo si es un ítem completamente irreconocible que no se parece a nada en la base de datos, deja 'insumoId' como null.
          4. 'nombreExtraido' debe ser el nombre literal que aparece en la factura.
          5. 'cantidad' es un número (ej. 5).
          6. 'precioUnitario' es el precio por unidad como número (sin símbolos de moneda). Si solo hay precio total, calcula el unitario si puedes.
          7. 'observacion' puede estar vacío, o contener información relevante.
          8. RESPONDE ÚNICA Y EXCLUSIVAMENTE CON EL JSON VÁLIDO. Tu tarea no termina hasta procesar el último ítem de la imagen.
        `;

        responseSchema = {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              insumoId: { type: Type.STRING, nullable: true, description: "El IDalimentos de la base de datos, o null si no se encuentra coincidencia clara." },
              nombreExtraido: { type: Type.STRING, description: "El nombre del producto tal como aparece en la imagen/texto." },
              cantidad: { type: Type.NUMBER },
              precioUnitario: { type: Type.NUMBER },
              observacion: { type: Type.STRING }
            },
            required: ["nombreExtraido", "cantidad", "precioUnitario"]
          }
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
          maxOutputTokens: 8192, // FORZADO a 8192 para evitar cortes
          responseMimeType: "application/json",
          responseSchema: responseSchema,
        }
      });

      if (!response.text) {
        throw new BadRequestException('La IA no pudo procesar la imagen o devolvió una respuesta vacía.');
      }

      // Parseamos el JSON devuelto usando la función robusta
      const parsedData = this.repairAndParseJSON(response.text);
      return parsedData;

    } catch (error: any) {
      this.logger.error(`Error en extractDataFromImage: ${error.message}`);
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Error al procesar con IA: ${error.message}`);
    }
  }

  async extractDataFromText(text: string, context: string) {
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

      if (context === 'inventario') {
        const insumosDb = await this.prisma.insumos.findMany({
          select: { IDalimentos: true, nombre: true, unidades: true, precio: true, nombreCategoria: true }
        });
        
        systemInstruction = `
          Eres un asistente experto en inventario. Tu tarea es extraer la lista COMPLETA de productos de un mensaje de texto (ej. un chat de WhatsApp con el proveedor) y mapearlos con la base de datos local.
          
          BASE DE DATOS DE INSUMOS LOCALES:
          ${JSON.stringify(insumosDb)}
          
          Reglas CRÍTICAS:
          1. OBLIGATORIO: Debes extraer ABSOLUTAMENTE TODOS LOS ÍTEMS presentes en el texto, línea por línea. No agrupes, no resumas, no omitas ninguno. Si el texto tiene 50 líneas de productos, el array resultante DEBE tener 50 objetos.
          2. MAPEO INTELIGENTE: Para cada ítem, encuentra el 'insumoId' en la BASE DE DATOS LOCAL. Sé MUY flexible con los nombres (las facturas usan abreviaturas o marcas como 'Mix Premium'). Si una o dos palabras clave coinciden (ej. 'Ojo de diablo' con 'Ojo de diablo alcohol') y el 'precio' es igual o muy cercano, considéralo un match válido y asígnale el ID. Usa tu razonamiento avanzado para deducir el insumo correcto.
          3. Solo si es un ítem completamente irreconocible que no se parece a nada en la base de datos, deja 'insumoId' como null.
          4. 'nombreExtraido' debe ser el nombre literal completo que aparece en el texto. IMPORTANTE: No uses comillas dobles (") dentro del nombre.
          5. 'cantidad' es un número (ej. 5). Extrae bien las cantidades numéricas (ej. 'X36' -> 36, 'x20' -> 20).
          6. 'precioUnitario' es el precio por unidad como número entero (sin símbolos de moneda ni decimales extra). OJO: Si el texto da un precio total enorme y una cantidad, divide el precio total entre la cantidad para obtener el 'precioUnitario' real.
          7. 'observacion' puede estar vacío, o contener notas relevantes. Evita usar comillas dobles (").
          8. RESPONDE ÚNICA Y EXCLUSIVAMENTE CON EL JSON VÁLIDO. Tu tarea no termina hasta procesar la última letra del texto.
        `;

        responseSchema = {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              insumoId: { type: Type.STRING, nullable: true, description: "El IDalimentos de la base de datos, o null si no se encuentra coincidencia clara." },
              nombreExtraido: { type: Type.STRING, description: "El nombre del producto tal como aparece en el texto." },
              cantidad: { type: Type.NUMBER },
              precioUnitario: { type: Type.NUMBER },
              observacion: { type: Type.STRING }
            },
            required: ["nombreExtraido", "cantidad", "precioUnitario"]
          }
        };
      } else {
        throw new BadRequestException(`Contexto de extracción '${context}' no soportado para texto.`);
      }

      const response = await ai.models.generateContent({
        model: configIA.modeloDefecto,
        contents: [
          { role: 'user', parts: [{ text: `Extrae los datos de este texto:\n\n${text}` }] }
        ],
        config: {
          systemInstruction: systemInstruction,
          temperature: configIA.temperatura,
          topP: configIA.topP,
          maxOutputTokens: 8192, // FORZADO a 8192 para evitar que se corte la lista de JSON
          responseMimeType: "application/json",
          responseSchema: responseSchema,
        }
      });

      if (!response.text) {
        throw new BadRequestException('La IA no devolvió respuesta.');
      }

      console.log('[AiService] Respuesta RAW de Gemini (Text):', response.text);
      return this.repairAndParseJSON(response.text);

    } catch (error: any) {
      this.logger.error(`Error en extractDataFromText: ${error.message}`);
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Error al procesar con IA: ${error.message}`);
    }
  }

  async refineExtraction(previousData: any, correctionPrompt: string, context: string) {
    const configIA = await this.configService.getConfiguracionIA();

    if (!configIA.isActive || !configIA.apiKey) {
      throw new BadRequestException('El módulo de IA no está configurado.');
    }

    try {
      const ai = new GoogleGenAI({ apiKey: configIA.apiKey });
      let systemInstruction = '';
      let responseSchema: Schema | undefined = undefined;

      if (context === 'inventario') {
        const insumosDb = await this.prisma.insumos.findMany({
          select: { IDalimentos: true, nombre: true, unidades: true, precio: true }
        });
        
        systemInstruction = `
          Eres un asistente experto en inventario. El usuario previamente extrajo una lista de insumos de una factura, pero encontró errores y te ha enviado una instrucción de corrección.
          
          BASE DE DATOS DE INSUMOS LOCALES:
          ${JSON.stringify(insumosDb)}
          
          Tu tarea:
          Lee la lista "Datos Anteriores" y aplica las correciones solicitadas en "Instrucción de Corrección".
          Devuelve la lista final de insumos corregida, manteniendo el esquema.
          Asegúrate de re-mapear correctamente el 'insumoId' si el usuario corrigió un nombre o indicó un nuevo mapeo.
        `;

        responseSchema = {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              insumoId: { type: Type.STRING, nullable: true },
              nombreExtraido: { type: Type.STRING },
              cantidad: { type: Type.NUMBER },
              precioUnitario: { type: Type.NUMBER },
              observacion: { type: Type.STRING }
            },
            required: ["nombreExtraido", "cantidad", "precioUnitario"]
          }
        };
      } else {
        throw new BadRequestException(`Contexto de refinamiento '${context}' no soportado.`);
      }

      const promptData = `
      Datos Anteriores (JSON):
      ${JSON.stringify(previousData, null, 2)}
      
      Instrucción de Corrección del Usuario:
      "${correctionPrompt}"
      
      Genera el JSON corregido.
      `;

      const response = await ai.models.generateContent({
        model: configIA.modeloDefecto,
        contents: [
          { role: 'user', parts: [{ text: promptData }] }
        ],
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.2, // Un poco más creativo para interpretar la corrección
          maxOutputTokens: configIA.maxTokens,
          responseMimeType: "application/json",
          responseSchema: responseSchema,
        }
      });

      if (!response.text) {
        throw new BadRequestException('La IA no devolvió respuesta de corrección.');
      }

      return this.repairAndParseJSON(response.text);

    } catch (error: any) {
      this.logger.error(`Error en refineExtraction: ${error.message}`);
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Error al refinar extracción con IA: ${error.message}`);
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
Tu tarea es ajustar los pedidos existentes para cuadrar el inventario y el dinero.
Se te proporciona:
1. Insumos Descuadrados: Una lista de diferencias físicas.
   - Si "diferencia" es NEGATIVA (ej: -5), el sistema registró más ventas de las que físicamente ocurrieron. Usa "remove_product" para eliminar esa cantidad de unidades.
   - Si "diferencia" es POSITIVA (ej: +5), el sistema registró menos ventas de las que físicamente ocurrieron. Usa "add_product" para añadir esa cantidad de unidades a cualquier venta elegible.
   - IMPORTANTE: Fíjate en el campo "productoAsociado".
2. Ventas Elegibles: Una lista de pedidos que puedes alterar.
3. Descuadre Monetario actual: Cuánto Faltante o Excedente de Efectivo y Transferencias hay.
4. Observaciones (campo "observaciones"): Notas manuales dejadas por el cajero (ej: "vasos dañados", "sacamos 10000").
   - REGLA DE ORO: Si una observación explica clara y directamente un faltante físico de inventario (ej. "vasos dañados", "botamos", "regalamos") o una diferencia de dinero (ej. "prestamos a caja", "pago a proveedor"), **JUSTIFICA** ese descuadre.
   - Si el descuadre está justificado, usa la acción "ignore" para esa cantidad específica (ej. cantidadAIgnorar = 2). NO intentes ajustar el sistema si la diferencia es legítima según la observación.

REGLAS CRÍTICAS DE CUADRE DE DINERO:
A. El monto contado de TRANSFERENCIAS (banco) es ABSOLUTAMENTE FIJO Y SEGURO. Tu PRIMER paso es usar "change_payment" para cambiar métodos de pago de EFECTIVO a TRANSFERENCIA (o viceversa) hasta que el monto esperado de Transferencias cuadre EXACTAMENTE con el monto de Transferencias contado en la app del banco.
B. Intercala y compensa: Si sobran $100.000 en Efectivo y faltan $100.000 en Transferencias, significa que ventas marcadas como Transferencia realmente se pagaron en Efectivo. Haz los "change_payment" correspondientes.
C. Después de cuadrar las Transferencias a la perfección y realizar ajustes de inventario, analiza el Efectivo restante. Si el Total Esperado en Efectivo sigue teniendo un sobrante o excedente (y no hay más diferencias físicas de inventario que lo justifiquen), se concluye que la caja está descuadrada físicamente en Efectivo. NO debes inventar más cambios ni alterar ventas simplemente para forzar un cuadre perfecto si no está sustentado en datos.

REGLAS DE FORMATO:
1. Debes devolver UNICAMENTE un JSON válido con las acciones a tomar.
2. Usa la acción "remove_product" para eliminar unidades de un producto de un pedido existente.
3. Usa la acción "add_product" para añadir unidades de un producto a un pedido existente. Toma en cuenta que esto aumentará el valor total de la venta.
4. Usa la acción "change_payment" para cambiar el método de pago de EFECTIVO a TRANSFERENCIA o viceversa. TAMBIÉN puedes cambiarlo a "EFECTIVO Y OTROS" si necesitas cuadrar faltantes parciales exactos (ej. 1000). Al usar "EFECTIVO Y OTROS", es OBLIGATORIO que envíes "efectivoRecibido" y "transferenciaRecibida" sumando exactamente el total de la venta original.
5. Usa la acción "ignore" si una diferencia física o monetaria está justificada por las observaciones.
6. Explica brevemente el motivo en cada acción (campo "motivo").
7. OBLIGATORIO: Debes incluir el campo "justificacionGeneral" en la raíz del JSON.
8. OBLIGATORIO: Para "remove_product", "add_product", y "ignore", incluye "nombreProducto" con el nombre del producto.`;

      const responseSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          justificacionGeneral: { type: Type.STRING, description: "Resumen general de las acciones tomadas y por qué." },
          acciones: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                action: { type: Type.STRING, description: "remove_product, add_product, change_payment, o ignore" },
                ventaId: { type: Type.STRING },
                ordenId: { type: Type.STRING, description: "Solo aplicable para remove_product" },
                productoId: { type: Type.STRING, description: "Aplicable para remove_product, add_product y ignore" },
                nombreProducto: { type: Type.STRING, description: "Nombre del producto" },
                cantidadARemover: { type: Type.INTEGER, description: "Cantidad a quitar (solo remove_product)" },
                cantidadAAnadir: { type: Type.INTEGER, description: "Cantidad a añadir (solo add_product)" },
                cantidadAIgnorar: { type: Type.INTEGER, description: "Cantidad que se ignora por estar justificada (solo ignore)" },
                method: { type: Type.STRING, description: "EFECTIVO, TRANSFERENCIA, o 'EFECTIVO Y OTROS'. Solo para change_payment." },
                efectivoRecibido: { type: Type.NUMBER, description: "Monto a asignar a efectivo (solo si method es 'EFECTIVO Y OTROS')" },
                transferenciaRecibida: { type: Type.NUMBER, description: "Monto a asignar a transferencia (solo si method es 'EFECTIVO Y OTROS')" },
                motivo: { type: Type.STRING, description: "Motivo por el que se escogió este cambio o se ignoró la diferencia." },
              },
              required: ["action", "motivo"]
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
      const parsedData = this.repairAndParseJSON(response.text);
      return parsedData;

    } catch (error: any) {
      this.logger.error(`Error en autoCuadrePreview: ${error.message}`);
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Error al procesar Auto-Cuadre con IA: ${error.message}`);
    }
  }
}
