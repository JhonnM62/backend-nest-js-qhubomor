import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleGenAI, Type, Schema } from '@google/genai';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  // In-memory cache for catalogs to prevent DB queries on every voice request
  private catalogCache: { productos: any[], comentarios: any[], mesas: any[], timestamp: number } | null = null;
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

    const [productosRaw, comentariosRaw, mesasRaw] = await Promise.all([
      this.prisma.productos.findMany({
        select: { IDproductos: true, nombre: true },
      }),
      this.prisma.comentarios.findMany({
        select: { ID: true, comentarios: true },
      }),
      this.prisma.mesas.findMany({
        select: { IdMesas: true, nombre: true },
      }),
    ]);

    // Optimize payload size for faster TTFT (Time to First Token)
    const productos = productosRaw.map(p => ({ i: p.IDproductos, n: p.nombre }));
    const comentarios = comentariosRaw.map(c => ({ i: c.ID, n: c.comentarios }));
    const mesas = mesasRaw.map(m => ({ i: m.IdMesas, n: m.nombre }));

    this.catalogCache = { productos, comentarios, mesas, timestamp: now };
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
      const { productos: catalogProductos, comentarios: catalogComentarios, mesas: catalogMesas } = await this.getCatalogs();

      // Ultra-concise prompt to save input tokens parsing time
      const systemInstruction = `P:${JSON.stringify(catalogProductos)}
C:${JSON.stringify(catalogComentarios)}
M:${JSON.stringify(catalogMesas)}
Map audio to IDs.
Rules:
1. productoId=ID in P
2. comentariosIds=IDs in C
3. CRITICAL: If the user requests ANY modifier or note (e.g. "carro rojo", "sin licor", "Santorini") that is NOT found in C, you MUST put the raw text in 'notasAdicionales'. Do not ignore ANY specification.
4. cantidad=integer representing the EXACT amount requested (e.g. "dos jugos" -> 2, "tres" -> 3). Default to 1 ONLY if unspecified.
5. If the user mentions a table/mesa (e.g. "para la mesa 2", "mesa 2A"), return the corresponding ID from M in 'mesaId'.`;

      const responseSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          mesaId: { type: Type.STRING, description: "ID of the mesa mentioned, if any" },
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
          ...(configIA.usarRazonamiento ? { thinkingConfig: { thinkingLevel: "HIGH" as any } } : {})
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
          ...(configIA.usarRazonamiento ? { thinkingConfig: { thinkingLevel: "HIGH" as any } } : {})
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

  async validarFotoFacial(imageBuffer: Buffer, mimeType: string = 'image/jpeg') {
    const configIA = await this.configService.getConfiguracionIA();

    // Si la IA está inactiva, o la validación facial está desactivada, o no hay API Key, se omite y aprueba
    if (!configIA.isActive || !configIA.validarFacialAsistencia || !configIA.apiKey?.trim()) {
      return {
        valido: true,
        motivo: '',
        omitido: true,
      };
    }

    try {
      const ai = new GoogleGenAI({ apiKey: configIA.apiKey });
      const modelToUse = configIA.modeloDefecto || 'gemini-1.5-flash';

      const prompt = `
Eres un verificador biométrico ULTRA ESTRICTO de control de asistencia laboral para un restaurante/empresa.
Tu función es auditar con el máximo rigor las fotos tomadas por empleados en sus registros de asistencia (entrada, salida de turno, inicio de descanso y fin de descanso).

OBJETIVO CRÍTICO:
Evitar fraudes y malas prácticas donde los empleados evaden el registro biométrico inclinando el celular hacia arriba para enfocar el techo, el cielo, el techo de un automóvil/vehículo o paredes vacías, dejando su rostro oculto, cortado o asomado únicamente en el borde inferior o lateral de la imagen.

REGLAS DE EVALUACIÓN (TODAS son obligatorias para responder con valido = true):

1. ROSTRO COMPLETO Y TOTALMENTE DENTRO DEL CUADRO:
   - Deben verse con nitidez y de forma completa TODAS las partes anatómicas del rostro: frente completa, cejas, ambos ojos, nariz, mejillas, boca completa y mentón/barbilla.
   - RECHAZO OBLIGATORIO si la boca o el mentón quedan cortados por el borde inferior de la imagen.
   - RECHAZO OBLIGATORIO si la persona solo asoma la parte superior de la cabeza, la frente o los ojos por la parte inferior o lateral.
   - RECHAZO OBLIGATORIO si el rostro está cortado por cualquier margen (inferior, superior o lateral).

2. PROHIBIDO ENFOCAR AL TECHO, CIELO O FONDOS PREDOMINANTES:
   - La cámara debe estar sostenida DE FRENTE al empleado, a la altura de sus ojos o de su cara.
   - RECHAZO OBLIGATORIO si la toma es en contrapicado apuntando hacia arriba hacia el techo de una habitación, el techo/tapicería de un vehículo, el cielo o lámparas, haciendo que ese techo o cielo ocupe la mayor parte de la fotografía (más del 40-50%) mientras el rostro queda arrinconado abajo o cortado.

3. ENCUADRE CENTRADO Y TAMAÑO DE SELFIE BIOMÉTRICO:
   - El rostro debe estar ubicado en el CENTRO de la imagen (dentro del área central de la silueta biométrica).
   - El rostro debe tener un tamaño prominente: debe ocupar entre el 30% y el 70% de la altura de la imagen.
   - RECHAZO OBLIGATORIO si el rostro está alejado o diminuto en una esquina o al fondo.

4. POSTURA, NITIDEZ Y AUTENTICIDAD:
   - El empleado debe estar mirando directamente de frente al lente de la cámara.
   - No se aceptan fotos con el rostro tapado por manos, mascarillas, capotas o viseras que tapen los ojos o la frente.
   - Debe ser una persona viva en tiempo real (no una foto de una pantalla de computador/celular ni foto impresa en papel).
   - La imagen no debe ser excesivamente oscura o borrosa.

GUÍA DE MOTIVOS DE RECHAZO (en "motivo", sé claro, directo e instructivo en español):
- Si la cámara apunta al techo, cielo o techo de auto: "La cámara está apuntando al techo o al cielo. Sostén el celular de frente a la altura de tu rostro."
- Si el rostro está cortado en la parte inferior o solo asoma la frente/ojos: "Rostro incompleto. Muestra tu rostro entero desde la frente hasta la barbilla dentro de la silueta."
- Si el rostro no está centrado: "Centra tu rostro en la pantalla. Coloca tu cara en el centro de la silueta."
- Si el rostro está muy lejos o pequeño: "Acércate más a la cámara para que tu rostro ocupe el centro de la silueta."
- Si está cubierto o no mira de frente: "Rostro cubierto o no visible. Descubre tu rostro y mira de frente a la cámara."
- Si no hay rostro o es un objeto/pantalla: "No se detecta un rostro humano claro mirando de frente a la cámara."

Responde ÚNICA Y EXCLUSIVAMENTE con el siguiente JSON:
{
  "valido": boolean,
  "motivo": string
}
Si valido es false, "motivo" debe contener la instrucción correctiva exacta en español. Si valido es true, "motivo" debe ser una cadena vacía "".
`;

      const responseSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          valido: { type: Type.BOOLEAN },
          motivo: { type: Type.STRING },
        },
        required: ["valido", "motivo"],
      };

      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  data: imageBuffer.toString('base64'),
                  mimeType: mimeType || 'image/jpeg',
                },
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: responseSchema,
          temperature: 0.1,
        },
      });

      const responseText = response.text?.trim() || '{}';
      const parsed = this.repairAndParseJSON(responseText);

      return {
        valido: typeof parsed.valido === 'boolean' ? parsed.valido : true,
        motivo: parsed.motivo || '',
        omitido: false,
      };
    } catch (error: any) {
      this.logger.error(`Error al validar foto facial con IA (${error.message}). Aplicando fallback permisivo.`);
      // En caso de fallo de red o cuota en Gemini, no bloquear al empleado
      return {
        valido: true,
        motivo: '',
        omitido: true,
      };
    }
  }

  async validarFotoFacialString(imageDataUrlOrBase64: string) {
    if (!imageDataUrlOrBase64) {
      return { valido: true, motivo: '', omitido: true };
    }

    let mimeType = 'image/jpeg';
    let base64Data = imageDataUrlOrBase64;

    const match = imageDataUrlOrBase64.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      base64Data = match[2];
    }

    const buffer = Buffer.from(base64Data, 'base64');
    return this.validarFotoFacial(buffer, mimeType);
  }

  /**
   * Determina si un pedido contiene platos o ítems de comida rápida / restaurante.
   */
  public pedidoTieneComida(
    detalleTexto?: string,
    itemsPropios?: any[],
    itemsExternos?: any[],
  ): boolean {
    const FOOD_REGEX =
      /\b(hamburguesa|hamburguesas|burger|burgers|alita|alitas|wings|perro|perros|hot\s*dog|hotdogs|choriperro|choriperros|chorizo|chorizos|salchipapa|salchipapas|sandwich|sandwiches|sanduche|sanduches|sánduche|sánduches|sándwich|sándwiches|carne|carnes|asado|asados|costilla|costillas|parrilla|porcion|porción|papas|papa\s*francesa|papas\s*francesas|francesa|rustica|rústica|desgranado|desgranados|patacon|patacón|patacones|arepa|arepas|taco|tacos|burrito|burritos|quesadilla|quesadillas|mazorca|mazorcas|pincho|pinchos|crispy|parcera|fogata|combo|pollo|pechuga|nugget|nuggets|fundido|fundidos)\b/i;

    const checkName = (name?: string): boolean => {
      if (!name || typeof name !== 'string') return false;
      return FOOD_REGEX.test(name.trim());
    };

    if (Array.isArray(itemsPropios) && itemsPropios.length > 0) {
      for (const it of itemsPropios) {
        if (checkName(it.nombre || it.name)) return true;
      }
    }

    if (Array.isArray(itemsExternos) && itemsExternos.length > 0) {
      for (const it of itemsExternos) {
        if (checkName(it.nombre || it.name || it.observacion)) return true;
      }
    }

    if (detalleTexto && typeof detalleTexto === 'string') {
      if (FOOD_REGEX.test(detalleTexto)) return true;
    }

    return false;
  }

  /**
   * Mapea el texto de un pedido de domicilio WhatsApp contra el catálogo de productos
   * y promociones configurados en el POS mediante Gemini AI.
   */
  async mapearPedidoDomicilio(
    textoDetalle: string,
    totalWA?: string,
    promptPersonalizado?: string,
    reglasEmpaque?: any,
  ): Promise<{
    itemsPropios: Array<{
      productoId?: string;
      nombre: string;
      cantidad: number;
      precioUnitario?: number;
      precioTotal?: number;
      descuento?: number;
      comentarios?: string;
      encontradoEnCatalogo: boolean;
    }>;
    itemsExternos: Array<{
      nombre: string;
      cantidad: number;
      observacion?: string;
    }>;
    totalCalculado: number;
    notasGenerales?: string;
    isComidaBusiness?: boolean;
    isGranizadosBusiness?: boolean;
    tieneComida?: boolean;
  }> {
    if (!textoDetalle || !textoDetalle.trim()) {
      return { itemsPropios: [], itemsExternos: [], totalCalculado: 0, isComidaBusiness: false, isGranizadosBusiness: false, tieneComida: false };
    }

    let parsedReglas: Array<{
      id: string;
      tipoDestino: 'CATEGORIA' | 'PRODUCTO';
      categoriaNombre?: string;
      productoId?: string;
      productoNombre?: string;
      empaqueProductoId: string;
      empaqueProductoNombre: string;
      cantidadPorPlato: number;
      cobrarAlCliente: boolean;
    }> = [];

    if (Array.isArray(reglasEmpaque)) {
      parsedReglas = reglasEmpaque;
    } else if (typeof reglasEmpaque === 'string') {
      try {
        const p = JSON.parse(reglasEmpaque);
        if (Array.isArray(p)) parsedReglas = p;
      } catch {
        parsedReglas = [];
      }
    }

    const parseMontoCOP = (val: any): number => {
      if (typeof val === 'number') {
        if (val > 0 && val < 100) return val * 1000;
        return val;
      }
      if (!val) return 0;
      const rawStr = String(val).trim();
      let str = rawStr.replace(/[^0-9.,]/g, '');
      if (!str) return 0;
      if (str.includes('.')) {
        const parts = str.split('.');
        if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
          str = str.replace(/\./g, '');
        }
      }
      if (str.includes(',')) {
        const parts = str.split(',');
        if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
          str = str.replace(/,/g, '');
        } else {
          str = str.replace(',', '.');
        }
      }
      let num = parseFloat(str) || 0;
      if (num > 0 && num < 100) {
        num = num * 1000;
      }
      return num;
    };

    // 1. Obtener catálogo de productos y adicionales/comentarios locales
    const [productosRaw, comentariosRaw] = await Promise.all([
      this.prisma.productos.findMany({
        select: {
          IDproductos: true,
          nombre: true,
          precioUnitario: true,
          categoriaNombre: true,
          combo: true,
        },
      }),
      this.prisma.comentarios.findMany({
        select: {
          ID: true,
          comentarios: true,
          tipo: true,
          precio: true,
        },
      }).catch(() => []),
    ]);

    // Determinar el giro del negocio a partir de los productos con precio > 0
    const productosConPrecio = productosRaw.filter((p) => Number(p.precioUnitario || 0) > 0);
    const categoriasConPrecio = Array.from(
      new Set(productosConPrecio.map((p) => p.categoriaNombre?.trim()).filter(Boolean)),
    );

    const isGranizadosBusiness =
      categoriasConPrecio.some((c) => /granizado|cremoso|coctel|bebida/i.test(c || '')) &&
      !categoriasConPrecio.some((c) => /hamburguesa|alitas|salchipapa|carne|perro|sandwich|sanduche|fundido|parrilla|asado/i.test(c || ''));

    const isComidaBusiness = categoriasConPrecio.some((c) =>
      /hamburguesa|alitas|salchipapa|carne|perro|sandwich|sanduche|fundido|queso|parrilla|asado|costilla|platos|cocina/i.test(c || ''),
    );

    // IDs y nombres de productos referenciados explícitamente en las reglas de empaque configuradas por este local
    const reglasProductIds = new Set(
      parsedReglas
        .flatMap((r) => [r.productoId, r.empaqueProductoId])
        .filter(Boolean)
        .map((id) => String(id).trim()),
    );
    const reglasProductNames = new Set(
      parsedReglas
        .flatMap((r) => [r.productoNombre, r.empaqueProductoNombre])
        .filter(Boolean)
        .map((n) => String(n).trim().toLowerCase()),
    );

    // Filtrar productos válidos de este local:
    // - Productos con precio > 0 propios del giro del negocio.
    // - Productos con precio 0 ÚNICAMENTE si están configurados en las reglas de empaque del local (ej. "8 onz PROMO")
    //   o son productos promocionales explícitos ("PROMO", "GRATIS") de este giro de negocio.
    const productosValidos = productosRaw.filter((p) => {
      const price = Number(p.precioUnitario || 0);
      const nombreNorm = (p.nombre || '').trim().toLowerCase();
      const catNorm = (p.categoriaNombre || '').trim().toLowerCase();

      if (
        isGranizadosBusiness &&
        /hamburguesa|alita|salchipapa|perro|choriperro|sandwich|sanduche|costilla|parrilla|asado/i.test(`${nombreNorm} ${catNorm}`)
      ) {
        return false;
      }
      if (
        isComidaBusiness &&
        /granizado|coctel|cremoso|smirnoff|four loko|mojito/i.test(`${nombreNorm} ${catNorm}`)
      ) {
        return false;
      }

      if (price > 0) return true;

      if (reglasProductIds.has(p.IDproductos) || reglasProductNames.has(nombreNorm)) {
        return true;
      }
      if (/\b(promo|promoci[oó]n|gratis|obsequio|cortes[ií]a)\b/i.test(nombreNorm)) {
        return true;
      }
      return false;
    });

    const catalogMini = productosValidos.map((p) => ({
      id: p.IDproductos,
      nombre: p.nombre,
      precio: Number(p.precioUnitario || 0),
      categoria: p.categoriaNombre || '',
      esCombo: p.combo === 'SI' || p.combo === 'true',
    }));

    const catalogComentarios = comentariosRaw.map((c) => ({
      id: c.ID,
      nombre: c.comentarios,
      tipo: c.tipo || 'Adicional',
      precio: Number(c.precio || 0),
    }));

    const categoriasLocales = Array.from(
      new Set(productosValidos.map((p) => p.categoriaNombre?.trim()).filter(Boolean)),
    );

    // 2. Intentar parseo con Gemini si la API Key está disponible
    try {
      const configIA = await this.configService.getConfiguracionIA();
      const apiKey = process.env.GEMINI_API_KEY || configIA.apiKey;

      if (configIA.isActive && apiKey) {
        const ai = new GoogleGenAI({ apiKey });
        let modelo = configIA.modeloDefecto || 'gemini-2.5-flash';
        if (modelo.includes('3.5') || modelo === 'gemini-3-flash-preview') {
          modelo = 'gemini-2.5-flash';
        }

        const customPromptText = promptPersonalizado
          ? `\nCONTEXTO ADICIONAL DEL USUARIO (NOTA: Las Reglas de Oro de Clasificación y las Reglas de Empaques Configuradas abajo tienen PRIORIDAD ABSOLUTA sobre este texto):\n${promptPersonalizado}\n`
          : '';

        let dynamicPackagingInstructions = '';
        if (parsedReglas.length > 0) {
          dynamicPackagingInstructions =
            `\n   - REGLAS DE EMPAQUES Y DESECHABLES CONFIGURADAS POR EL NEGOCIO (OBLIGATORIAS Y EXCLUSIVAS):\n` +
            `     * ⚠️ PRIORIDAD DE REGLA ESPECÍFICA SOBRE CATEGORÍA: Si un plato tiene una regla específica de PRODUCTO (ej. "Sal La Rechimba Especial" -> "Des P1"), APLICA ÚNICAMENTE esa regla de PRODUCTO y NO apliques además la regla general de su CATEGORÍA (ej. NO agregues "Des J1" a la Rechimba Especial).\n` +
            `     * ⚠️ PROHIBIDO AGREGAR EMPAQUES POR PRODUCTOS DE OTRO COMERCIO: NUNCA agregues desechables ("Des J1", "Des P1") ni tapas en 'itemsPropios' por productos que van en 'itemsExternos' (por ejemplo, en el local de Comidas Rápidas JAMÁS agregues "Des J1" por los granizados o tapas de granizados).\n` +
            parsedReglas
              .map((r, i) => {
                const target =
                  r.tipoDestino === 'CATEGORIA'
                    ? `[REGLA GENERAL DE CATEGORÍA - Solo si el plato NO tiene regla específica de producto] A cualquier plato/producto de la categoría "${r.categoriaNombre}"`
                    : `[REGLA ESPECÍFICA DE PRODUCTO - PRIORIDAD MÁXIMA] Al plato específico "${r.productoNombre || r.productoId}"`;
                const cant = r.cantidadPorPlato || 1;
                const cobro = r.cobrarAlCliente
                  ? `DEBES agregar el producto de empaque "${r.empaqueProductoNombre}" (productoId: "${r.empaqueProductoId}") como un item independiente en 'itemsPropios', con cantidad = (${cant} * cantidad de este plato pedidos) y su precio de catálogo.`
                  : `El empaque viene INCLUIDO en el valor del plato: NO agregues un item cobrado; únicamente agrega en 'comentarios' del plato la referencia de empaque "${r.empaqueProductoNombre}" con precio 0 (ej. [{"name": "Empaque ${r.empaqueProductoNombre}", "price": 0}]).`;
                return `     * Regla ${i + 1}: ${target}: Requiere ${cant}x "${r.empaqueProductoNombre}". ${cobro}`;
              })
              .join('\n');
        } else {
          dynamicPackagingInstructions =
            `\n   - REGLAS DE EMPAQUES Y DESECHABLES:\n` +
            `     * Si en el catálogo existen productos para empaque o desechables (ej. 'Desechable', 'Empaque', 'Caja') y el texto menciona cobro o los requiere expresamente para platos de ESTE local, agrégalos como items propios con su 'productoId'.\n` +
            `     * Si el empaque ya está incluido en el valor del plato o no se cobra por separado, especifícalo en 'comentarios' del plato con precio 0.\n`;
        }

        const systemInstruction = `Eres un asistente experto de restaurante y POS ERP multi-tenant.
Tu tarea es analizar el texto de un pedido de WhatsApp y clasificar sus productos de forma rigurosa.

INFORMACIÓN DEL LOCAL ACTUAL:
- Tipo de local detectado: ${isGranizadosBusiness ? 'GRANIZADOS Y BEBIDAS' : isComidaBusiness ? 'COMIDAS RÁPIDAS' : 'GENERAL'}
- Categorías locales: ${JSON.stringify(categoriasLocales)}
- Catálogo de productos disponibles de este local:
${JSON.stringify(catalogMini)}
- Catálogo de adicionales / notas disponibles:
${JSON.stringify(catalogComentarios)}
${customPromptText}

REGLAS DE ORO DE CLASIFICACIÓN (ESTRICTAS):
1. SEPARACIÓN DE COMERCIOS (CRÍTICO):
   - Si este local es de GRANIZADOS/BEBIDAS: Platos de comida como alitas, hamburguesas, salchipapas, perros, sánduches NO SON DE ESTE LOCAL. DEBEN IR EN 'itemsExternos' (y sus desechables de comida NUNCA se cobran aquí).
   - Si este local es de COMIDAS: Granizados (incluyendo granizados gratis/promo de 8oz y granizados de 12oz/24oz), cócteles o bebidas de otro comercio NO SON DE ESTE LOCAL. TODOS los granizados DEBEN IR EN 'itemsExternos'. NUNCA conviertas el cobro de tapas de granizados ($1.000 / $4.000) en desechables de comida ("Des J1" o "Des P1") dentro del local de comidas.
   - NUNCA pongas un producto de otro comercio en 'itemsPropios'.

2. 'itemsPropios': Solo productos que pertenecen a NUESTRO catálogo local disponible arriba.
   - Solo puedes asignar productos que aparezcan explícitamente en el catálogo disponible arriba.
   - Si un producto solicitado en el texto NO está en el catálogo disponible o no pertenece a este local, DEBE ir obligatoriamente en 'itemsExternos'.
   - 🍧 REGLA ESPECIAL PARA GRANIZADOS DE PROMOCIÓN / GRATIS (8 ONZ / 8 OZ) EN LOCAL DE GRANIZADOS:
     * Si este local es de GRANIZADOS y el pedido menciona "Granizado gratis 8oz", "Granizado 8oz sin licor", "Granizado promo 8oz" o similar, DEBES mapear el granizado al producto promocional del catálogo (ej. "8 onz PROMO", cuyo precio base en catálogo es 0) con la cantidad solicitada, 'precioUnitario: 0' y 'precioTotal: 0', colocando los sabores detallados (ej. "3x Sabor Mango biche", "1x Sabor Lulo") en su campo 'comentarios' con price 0.
     * NO reemplaces el producto "8 onz PROMO" por "Tapa 8 onz": "8 onz PROMO" es el plato/bebida principal (que debe aparecer en cocina/barra con sus sabores) y "Tapa 8 onz" es su empaque adicional que se agrega como otro item separado según la Regla de Empaque configurada.
   - 🚫 REGLA ESTRICTA DE PRECIOS: PROHIBIDO MODIFICAR EL PRECIO UNITARIO BASE DE LOS PRODUCTOS. NUNCA sumes desechables, empaques, tapas ni propinas al 'precioUnitario' de un producto de catálogo. Todos los productos ya tienen sus 'Reglas de Empaques y Desechables' configuradas que se agregan como items independientes. El 'precioUnitario' de cada producto en 'itemsPropios' DEBE coincidir EXACTAMENTE con su precio en el catálogo local. El 'precioTotal' es cantidad * precioUnitario (menos descuento si aplica).
   - Asigna 'productoId' exacto del catálogo local buscando la mejor coincidencia semántica aunque el nombre varíe ligeramente (por ejemplo, 'Salchipapa La Re-Chimba' corresponde a 'Sal La Rechimba Especial', 'Alitas Parche Pequeño' a 'ALITAS X5 peq', 'Alitas Parche Mediano' a 'ALITAS X10 med', 'Alitas Parche Familiar' a 'ALITAS X15 Fami', 'Hamburguesa Clásica' a 'H. La Parcera Clasica', 'Granizado gratis 8oz sin licor' a '8 onz PROMO', 'Granizado 12oz sin licor' a 'Normal 12 Onz Sin licor', etc.). Si coincide, asigna su 'productoId' exacto del catálogo y marca 'encontradoEnCatalogo: true'.
   - Extrae cantidad exacta.
   - ADICIONALES Y PRODUCTOS EXTRA (ESTRICTO - NUNCA CREAR ADICIONALES CON PRECIO EN COMENTARIOS):
     * Los adicionales NO se inventan ni se colocan como comentarios con precio. Son PRODUCTOS EXISTENTES en la base de datos (revisar categoría ADICCIONALES / ADICIONALES o catálogo: ej. tocineta, queso, carnes, papas, gomas, fruta, shot, etc.).
     * Si el cliente pide un adicional que existe en catálogo, DEBE mapearse como un item independiente en 'itemsPropios' con su 'productoId' del catálogo.
     * En 'comentarios' NUNCA coloques modificadores con precio para adicionales que existen como producto en el catálogo.
${dynamicPackagingInstructions}
   - 'comentarios' SIEMPRE debe ser un JSON string válido con formato de modificadores: [{"name": string, "price": number, "quantity"?: number}]. Solo lleva precio si es una adición puramente personalizada no existente en catálogo.

3. 'itemsExternos': Productos del pedido que pertenecen a otro comercio o no están en nuestro catálogo vendible.
   - 'nombre': Nombre del producto externo.
   - 'cantidad': Cantidad numérica.
   - 'observacion': Detalle de precios, notas, sabores o pertenencia (ej. "Comida rápida / Alitas", "Granizado 12 onz sin licor").

4. 'totalCalculado': Suma exacta de 'precioTotal' de los 'itemsPropios'.`;

        const responseSchema: Schema = {
          type: Type.OBJECT,
          properties: {
            itemsPropios: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  productoId: { type: Type.STRING },
                  nombre: { type: Type.STRING },
                  cantidad: { type: Type.INTEGER },
                  precioUnitario: { type: Type.NUMBER },
                  precioTotal: { type: Type.NUMBER },
                  descuento: { type: Type.NUMBER },
                  comentarios: { type: Type.STRING },
                  encontradoEnCatalogo: { type: Type.BOOLEAN },
                },
                required: ["productoId", "nombre", "cantidad", "precioUnitario", "precioTotal", "encontradoEnCatalogo"],
              },
            },
            itemsExternos: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  nombre: { type: Type.STRING },
                  cantidad: { type: Type.INTEGER },
                  observacion: { type: Type.STRING },
                },
                required: ["nombre", "cantidad"],
              },
            },
            totalCalculado: { type: Type.NUMBER },
            notasGenerales: { type: Type.STRING },
          },
          required: ["itemsPropios", "itemsExternos", "totalCalculado"],
        };

        const response = await ai.models.generateContent({
          model: modelo,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Texto del pedido de WhatsApp a mapear:\n${textoDetalle}\n\nTotal reportado en WhatsApp: ${totalWA || 'No especificado'}`,
                },
              ],
            },
          ],
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema,
            temperature: 0.1,
          },
        });

        const parsed = this.repairAndParseJSON(response.text?.trim() || '{}');
        if (parsed && Array.isArray(parsed.itemsPropios)) {
          let finalItemsPropios: any[] = [];
          const finalItemsExternos: any[] = Array.isArray(parsed.itemsExternos) ? [...parsed.itemsExternos] : [];

          for (const it of parsed.itemsPropios) {
            const prodValido = productosValidos.find(
              (p) => p.IDproductos === it.productoId || p.nombre.toLowerCase().trim() === (it.nombre || '').toLowerCase().trim(),
            );

            // Si el producto no existe en productosValidos de este local, MOVER a itemsExternos
            if (!prodValido) {
              this.logger.warn(`Item '${it.nombre}' (id: ${it.productoId}) no pertenece al catálogo válido de este local. Moviendo a itemsExternos.`);
              finalItemsExternos.push({
                nombre: it.nombre,
                cantidad: it.cantidad || 1,
                observacion: it.comentarios ? `${it.comentarios}` : `Producto no perteneciente a este local ($${it.precioTotal || it.precioUnitario || 0})`,
              });
            } else {
              const precioCatalogo = Number(prodValido.precioUnitario || 0);
              const cant = it.cantidad || 1;
              const desc = Number(it.descuento || 0);
              // REGLA ESTRICTA: El precio unitario siempre proviene del catálogo base, sin inflarse por desechables
              finalItemsPropios.push({
                ...it,
                productoId: prodValido.IDproductos,
                nombre: prodValido.nombre || it.nombre,
                precioUnitario: precioCatalogo,
                precioTotal: Math.max(0, (precioCatalogo * cant) - desc),
                encontradoEnCatalogo: true,
              });
            }
          }

          // Reconciliación determinista de productos promo ($0), externos omitidos y reglas de empaque
          const reconciled = this.reconciliarMapeoConReglas({
            textoDetalle,
            itemsPropios: finalItemsPropios,
            itemsExternos: finalItemsExternos,
            productosValidos,
            productosRaw,
            parsedReglas,
            isComidaBusiness,
            isGranizadosBusiness,
          });
          finalItemsPropios = reconciled.itemsPropios;
          const reconciledExternos = reconciled.itemsExternos;

          const totalCalc = finalItemsPropios.reduce((sum: number, it: any) => sum + Number(it.precioTotal || 0), 0);
          const tieneComida = this.pedidoTieneComida(textoDetalle, finalItemsPropios, reconciledExternos);

          return {
            itemsPropios: finalItemsPropios,
            itemsExternos: reconciledExternos,
            totalCalculado: totalCalc,
            notasGenerales: parsed.notasGenerales || '',
            isComidaBusiness,
            isGranizadosBusiness,
            tieneComida,
          };
        }
      }
    } catch (e: any) {
      this.logger.warn(`Mapeo con Gemini falló (${e.message}). Aplicando fallback determinista.`);
    }

    // 3. Fallback determinista inteligente
    const lineas = textoDetalle
      .split('\n')
      .map((l) => l.replace(/^[👉•\-\*\s]+/, '').trim())
      .filter(Boolean);

    const itemsPropios: any[] = [];
    const itemsExternos: any[] = [];
    let totalCalculado = 0;

    for (const linea of lineas) {
      let cantidad = 1;
      let textoSinCant = linea;
      const cantMatch = linea.match(/^(\d+)\s*[xX]?\s*(.*)$/);
      if (cantMatch) {
        cantidad = parseInt(cantMatch[1], 10) || 1;
        textoSinCant = cantMatch[2].trim();
      }

      // Extraer notas entre paréntesis
      const parentesisMatches = Array.from(textoSinCant.matchAll(/\(([^)]+)\)/g)).map((m) => m[1].trim());
      let parentesisPrecio = 0;
      let tieneTapas = false;
      let valorTapas = 0;

      for (const p of parentesisMatches) {
        if (/tapa/i.test(p)) {
          tieneTapas = true;
          const pMonto = parseMontoCOP(p);
          if (pMonto > 0) valorTapas = pMonto;
        } else if (/\$|\d{2,}/.test(p)) {
          const pMonto = parseMontoCOP(p);
          if (pMonto > 0) parentesisPrecio = pMonto;
        }
      }

      // Nombre base sin paréntesis
      const nombreLimpio = textoSinCant.replace(/\([^)]*\)/g, '').trim();
      const lower = nombreLimpio.toLowerCase();

      // Clasificación de comercio
      const isComidaLine = /alita|hamburguesa|perro|choriperro|sandwich|sanduche|salchipapa|carne|asado|costilla|papa/i.test(lower);
      const isBebidaLine = /granizado|coctel|cremoso|smirnoff|loko|mojito|mora azul/i.test(lower);

      if (isGranizadosBusiness && isComidaLine) {
        itemsExternos.push({
          nombre: nombreLimpio,
          cantidad,
          observacion: parentesisPrecio ? `$${parentesisPrecio.toLocaleString('es-CO')} - Comida Rápida` : 'Comida Rápida',
        });
        continue;
      }

      if (isComidaBusiness && isBebidaLine) {
        itemsExternos.push({
          nombre: nombreLimpio,
          cantidad,
          observacion: tieneTapas ? `Granizado (${valorTapas > 0 ? `$${valorTapas.toLocaleString('es-CO')} tapas` : 'tapas'})` : 'Granizado',
        });
        continue;
      }

      // Buscar coincidencia en catálogo local
      const palabras = lower.split(/\s+/).filter((w) => w.length > 2);
      let match = catalogMini.find(
        (p) => lower.includes(p.nombre.toLowerCase()) || p.nombre.toLowerCase().includes(lower),
      );

      // Búsqueda difusa por palabras clave si no hubo match directo
      if (!match) {
        match = catalogMini.find((p) => {
          const pLower = p.nombre.toLowerCase();
          const matches = palabras.filter((w) => pLower.includes(w));
          return matches.length >= Math.min(2, palabras.length) && matches.length > 0;
        });
      }

      // Variantes de alitas: pequeño -> peq, mediano -> med, etc.
      if (!match && /alita/i.test(lower)) {
        if (/peque/i.test(lower)) {
          match = catalogMini.find((p) => /alita.*peq/i.test(p.nombre));
        } else if (/med/i.test(lower)) {
          match = catalogMini.find((p) => /alita.*med/i.test(p.nombre));
        } else if (/fami|gran/i.test(lower)) {
          match = catalogMini.find((p) => /alita.*fami/i.test(p.nombre));
        }
      }

      // Variantes de granizados: sin licor / promo 8oz
      if (!match && /granizado/i.test(lower)) {
        if (/gratis|promo|8\s*oz|8\s*onz/i.test(lower)) {
          match =
            catalogMini.find((p) => /8\s*(onz|oz).*promo|promo.*8\s*(onz|oz)/i.test(p.nombre)) ||
            catalogMini.find((p) => /sin licor/i.test(p.nombre)) ||
            catalogMini.find((p) => /granizado/i.test(p.nombre));
        } else if (/sin licor/i.test(lower)) {
          match = catalogMini.find((p) => /sin licor/i.test(p.nombre)) || catalogMini.find((p) => /granizado/i.test(p.nombre));
        } else if (/con licor/i.test(lower)) {
          match = catalogMini.find((p) => /con licor/i.test(p.nombre) || /12 onz/i.test(p.nombre));
        }
      }

      if (match) {
        const modifiers: Array<{ name: string; price: number; quantity?: number }> = [];

        // Reglas dinámicas de empaque y desechables configuradas por el negocio
        // Prioridad absoluta: regla específica de PRODUCTO sobre regla general de CATEGORIA
        const reglasProductoMatch = parsedReglas.filter(
          (regla) =>
            regla.tipoDestino === 'PRODUCTO' &&
            (match.id === regla.productoId ||
              (regla.productoNombre && match.nombre.trim().toLowerCase() === regla.productoNombre.trim().toLowerCase())),
        );
        const reglasAplicables =
          reglasProductoMatch.length > 0
            ? reglasProductoMatch
            : parsedReglas.filter(
                (regla) =>
                  regla.tipoDestino === 'CATEGORIA' &&
                  match.categoria &&
                  regla.categoriaNombre &&
                  match.categoria.trim().toLowerCase() === regla.categoriaNombre.trim().toLowerCase(),
              );

        for (const regla of reglasAplicables) {
          const cantEmpaque = (regla.cantidadPorPlato || 1) * cantidad;
          if (regla.cobrarAlCliente) {
            const prodEmpaque = catalogMini.find((p) => p.id === regla.empaqueProductoId);
            const precioEmpaque = prodEmpaque?.precio || 0;
            itemsPropios.push({
              productoId: regla.empaqueProductoId,
              nombre: regla.empaqueProductoNombre || prodEmpaque?.nombre || 'Empaque',
              cantidad: cantEmpaque,
              precioUnitario: precioEmpaque,
              precioTotal: precioEmpaque * cantEmpaque,
              descuento: 0,
              comentarios: '',
              encontradoEnCatalogo: !!prodEmpaque,
            });
            totalCalculado += precioEmpaque * cantEmpaque;
          } else {
            modifiers.push({
              name: `Empaque ${regla.empaqueProductoNombre}`,
              price: 0,
              quantity: regla.cantidadPorPlato || 1,
            });
          }
        }

        // Sabor / Nota detectada
        const saboresConocidos = ['lulo', 'mora azul', 'fresa', 'maracuya', 'mango', 'santorini', 'venom', 'bonbombon'];
        for (const sab of saboresConocidos) {
          if (lower.includes(sab)) {
            modifiers.push({ name: `${sab.charAt(0).toUpperCase() + sab.slice(1)} sin licor`, price: 0, quantity: 1 });
            break;
          }
        }

        // Si es gratis / promoción
        const esGratis = /gratis/i.test(textoSinCant);
        let precioUnit = match.precio;
        if (esGratis) {
          precioUnit = 0;
        }

        const modifiersTotal = modifiers.reduce((acc, m) => acc + (m.price || 0) * (m.quantity || 1), 0);
        let precioTotal = (precioUnit + modifiersTotal) * cantidad;

        // Si el texto traía un precio explícito, respetarlo si coincide aproximadamente
        if (parentesisPrecio > 0 && Math.abs(parentesisPrecio - precioTotal) <= 2000) {
          precioTotal = parentesisPrecio;
        }

        totalCalculado += precioTotal;
        itemsPropios.push({
          productoId: match.id,
          nombre: match.nombre,
          cantidad,
          precioUnitario: precioUnit,
          precioTotal,
          descuento: esGratis ? match.precio * cantidad : 0,
          comentarios: modifiers.length > 0 ? JSON.stringify(modifiers) : '',
          encontradoEnCatalogo: true,
        });
      } else {
        // Si no se encontró en catálogo
        let precioEst = parentesisPrecio > 0 ? parentesisPrecio : 0;
        let precioUnitEst = precioEst > 0 ? Math.round(precioEst / cantidad) : 0;
        totalCalculado += precioEst;

        itemsPropios.push({
          nombre: nombreLimpio,
          cantidad,
          precioUnitario: precioUnitEst,
          precioTotal: precioEst,
          descuento: 0,
          comentarios: '',
          encontradoEnCatalogo: false,
        });
      }
    }

    if (totalCalculado === 0 && totalWA) {
      totalCalculado = parseMontoCOP(totalWA);
    }

    const tieneComida = this.pedidoTieneComida(textoDetalle, itemsPropios, itemsExternos);

    return {
      itemsPropios,
      itemsExternos,
      totalCalculado,
      notasGenerales: 'Mapeo generado por fallback determinista inteligente',
      isComidaBusiness,
      isGranizadosBusiness,
      tieneComida,
    };
  }

  /**
   * Reconcilia determinísticamente el resultado del mapeo de IA con las reglas del negocio:
   * 1. Asegura que los productos de otro comercio (ej. granizados gratis en local de comidas) no se pierdan de itemsExternos.
   * 2. En local de granizados, asegura que los granizados gratis/promo de 8oz se mapeen al plato "8 onz PROMO" ($0) con sus sabores, y no solo a la tapa.
   * 3. Recalcula los empaques/desechables cobrados estrictamente a partir de los platos reales de itemsPropios, dando prioridad absoluta a las reglas de PRODUCTO sobre las de CATEGORIA.
   */
  private reconciliarMapeoConReglas(params: {
    textoDetalle: string;
    itemsPropios: any[];
    itemsExternos: any[];
    productosValidos: any[];
    productosRaw: any[];
    parsedReglas: any[];
    isComidaBusiness: boolean;
    isGranizadosBusiness: boolean;
  }): { itemsPropios: any[]; itemsExternos: any[] } {
    const {
      textoDetalle,
      productosValidos,
      productosRaw,
      parsedReglas,
      isComidaBusiness,
      isGranizadosBusiness,
    } = params;

    let itemsPropios = [...params.itemsPropios];
    const itemsExternos = [...params.itemsExternos];

    const lineas = (textoDetalle || '')
      .split('\n')
      .map((l) => l.replace(/^[👉•\-\*\s]+/, '').trim())
      .filter(Boolean);

    // 1. Asegurar que ninguna línea del otro comercio se haya omitido de itemsExternos
    for (const linea of lineas) {
      let cantidad = 1;
      let textoSinCant = linea;
      const cantMatch = linea.match(/^(\d+)\s*[xX]?\s*(.*)$/);
      if (cantMatch) {
        cantidad = parseInt(cantMatch[1], 10) || 1;
        textoSinCant = cantMatch[2].trim();
      }
      // Quitar sufijo de precio como " - $4.000"
      const nombreLimpio = textoSinCant.replace(/\s*-\s*\$?\s*[\d.,]+\s*$/, '').trim();
      const lower = nombreLimpio.toLowerCase();

      if (isComidaBusiness && /granizado|coctel|cremoso|smirnoff|four loko|mojito/i.test(lower)) {
        const isGratisLine = /gratis|promo|8\s*oz|8\s*onz/i.test(lower);
        const yaExiste = itemsExternos.some((ext) => {
          const extLower = String(ext.nombre || '').toLowerCase();
          if (isGratisLine) return /gratis|promo|8\s*oz|8\s*onz/i.test(extLower);
          return extLower.includes(lower.slice(0, 15)) || lower.includes(extLower.slice(0, 15));
        });
        if (!yaExiste) {
          itemsExternos.push({
            nombre: nombreLimpio,
            cantidad,
            observacion: 'Granizado de otro comercio',
          });
        }
      }

      if (
        isGranizadosBusiness &&
        /alita|hamburguesa|perro|choriperro|sandwich|sanduche|salchipapa|carne|asado|costilla/i.test(lower)
      ) {
        const yaExiste = itemsExternos.some((ext) => {
          const extLower = String(ext.nombre || '').toLowerCase();
          return extLower.includes(lower.slice(0, 12)) || lower.includes(extLower.slice(0, 12));
        });
        if (!yaExiste) {
          itemsExternos.push({
            nombre: nombreLimpio,
            cantidad,
            observacion: 'Comida rápida de otro comercio',
          });
        }
      }
    }

    // Identificador de productos de empaque / desechables / tapas
    const empaqueIds = new Set(
      parsedReglas
        .map((r) => String(r.empaqueProductoId || '').trim())
        .filter(Boolean),
    );
    const empaqueNames = new Set(
      parsedReglas
        .map((r) => String(r.empaqueProductoNombre || '').trim().toLowerCase())
        .filter(Boolean),
    );
    const isEmpaqueItem = (it: any): boolean => {
      const id = String(it?.productoId || '').trim();
      const nombre = String(it?.nombre || '').trim().toLowerCase();
      if (id && empaqueIds.has(id)) return true;
      if (nombre && empaqueNames.has(nombre)) return true;
      return /^(des\s*[jp]\d+|desechable\b|tapa\s*8\s*(onz|oz)|tapas?\s*domicilio|empaque\b)/i.test(nombre);
    };

    // 2. En local de GRANIZADOS: rescatar el plato promocional "8 onz PROMO" ($0) si el pedido incluye granizados gratis/promo de 8oz
    if (isGranizadosBusiness) {
      const prodPromo8oz = productosValidos.find((p) =>
        /8\s*(onz|oz).*promo|promo.*8\s*(onz|oz)|granizado.*(gratis|promo)/i.test(p.nombre || ''),
      );
      if (prodPromo8oz) {
        const yaTienePromo8oz = itemsPropios.some((it) => it.productoId === prodPromo8oz.IDproductos);
        if (!yaTienePromo8oz) {
          const lineaPromo = lineas.find((l) => /granizado\b.*?(?:gratis|promo|8\s*oz|8\s*onz)/i.test(l));
          if (lineaPromo) {
            const cantMatch = lineaPromo.match(/^(\d+)\s*[xX]?\s*(.*)$/);
            const cantPromo = cantMatch ? parseInt(cantMatch[1], 10) || 1 : 1;
            const restoLinea = cantMatch ? cantMatch[2].trim() : lineaPromo;

            // Extraer sabores entre paréntesis: ej. "(3 Mango biche, 1 Lulo)"
            const modifiers: Array<{ name: string; price: number }> = [];
            const parenMatches = Array.from(restoLinea.matchAll(/\(([^)]+)\)/g)).map((m) => m[1].trim());
            for (const pText of parenMatches) {
              if (!/^\$?\s*[\d.,]+$/.test(pText) && !/^tapa/i.test(pText)) {
                const partes = pText
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean);
                for (const parte of partes) {
                  const mSab = parte.match(/^(\d+)\s*[xX]?\s*(.+)$/);
                  if (mSab) {
                    const cSab = parseInt(mSab[1], 10) || 1;
                    const nSab = mSab[2].trim();
                    modifiers.push({
                      name: `${cSab}x ${/sabor/i.test(nSab) ? nSab : `Sabor ${nSab}`}`,
                      price: 0,
                    });
                  } else {
                    modifiers.push({
                      name: /sabor/i.test(parte) ? parte : `Sabor ${parte}`,
                      price: 0,
                    });
                  }
                }
              }
            }

            const precioBasePromo = Number(prodPromo8oz.precioUnitario || 0);
            itemsPropios.unshift({
              productoId: prodPromo8oz.IDproductos,
              nombre: prodPromo8oz.nombre,
              cantidad: cantPromo,
              precioUnitario: precioBasePromo,
              precioTotal: precioBasePromo * cantPromo,
              descuento: 0,
              comentarios: JSON.stringify(modifiers),
              encontradoEnCatalogo: true,
            });
          }
        }
      }
    }

    // 3. Recalcular determinísticamente los empaques/desechables a partir de los platos reales cuando existen reglas configuradas
    const platosBase = itemsPropios.filter((it) => !isEmpaqueItem(it));
    if (parsedReglas.length > 0 && platosBase.length > 0) {
      const reconciledPropios: any[] = [];

      for (const plato of platosBase) {
        reconciledPropios.push(plato);

        const prodCatalog =
          productosValidos.find((p) => p.IDproductos === plato.productoId) ||
          productosRaw.find((p) => p.IDproductos === plato.productoId);

        const platoNombreNorm = String(plato.nombre || prodCatalog?.nombre || '')
          .trim()
          .toLowerCase();

        // Prioridad 1: Reglas específicas de PRODUCTO para este plato
        const reglasProducto = parsedReglas.filter(
          (r) =>
            r.tipoDestino === 'PRODUCTO' &&
            ((r.productoId && r.productoId === plato.productoId) ||
              (r.productoNombre && r.productoNombre.trim().toLowerCase() === platoNombreNorm)),
        );

        // Prioridad 2: Solo si el plato NO tiene regla específica de PRODUCTO, aplicar reglas de CATEGORIA
        const reglasAplicables =
          reglasProducto.length > 0
            ? reglasProducto
            : parsedReglas.filter(
                (r) =>
                  r.tipoDestino === 'CATEGORIA' &&
                  prodCatalog?.categoriaNombre &&
                  r.categoriaNombre &&
                  prodCatalog.categoriaNombre.trim().toLowerCase() === r.categoriaNombre.trim().toLowerCase(),
              );

        for (const regla of reglasAplicables) {
          const cantEmpaque = (Number(regla.cantidadPorPlato) || 1) * (Number(plato.cantidad) || 1);
          if (regla.cobrarAlCliente) {
            const prodEmpaque =
              productosRaw.find((p) => p.IDproductos === regla.empaqueProductoId) ||
              productosRaw.find(
                (p) =>
                  regla.empaqueProductoNombre &&
                  (p.nombre || '').trim().toLowerCase() === regla.empaqueProductoNombre.trim().toLowerCase(),
              );
            const empId = prodEmpaque?.IDproductos || regla.empaqueProductoId;
            const empNombre = prodEmpaque?.nombre || regla.empaqueProductoNombre || 'Empaque';
            const precioEmpaque = Number(prodEmpaque?.precioUnitario || 0);

            const existenteEmpaque = reconciledPropios.find(
              (item) => isEmpaqueItem(item) && item.productoId === empId,
            );
            if (existenteEmpaque) {
              existenteEmpaque.cantidad += cantEmpaque;
              existenteEmpaque.precioTotal = existenteEmpaque.precioUnitario * existenteEmpaque.cantidad;
            } else {
              reconciledPropios.push({
                productoId: empId,
                nombre: empNombre,
                cantidad: cantEmpaque,
                precioUnitario: precioEmpaque,
                precioTotal: precioEmpaque * cantEmpaque,
                descuento: 0,
                comentarios: '[]',
                encontradoEnCatalogo: Boolean(prodEmpaque),
              });
            }
          } else {
            let currentMods: any[] = [];
            try {
              const parsedMods = JSON.parse(plato.comentarios || '[]');
              if (Array.isArray(parsedMods)) currentMods = parsedMods;
            } catch {
              currentMods = [];
            }
            const labelEmpaque = `Empaque ${regla.empaqueProductoNombre}`;
            if (!currentMods.some((m) => String(m?.name || '').toLowerCase() === labelEmpaque.toLowerCase())) {
              currentMods.push({
                name: labelEmpaque,
                price: 0,
                quantity: Number(regla.cantidadPorPlato) || 1,
              });
              plato.comentarios = JSON.stringify(currentMods);
            }
          }
        }
      }

      itemsPropios = reconciledPropios;
    }

    return { itemsPropios, itemsExternos };
  }
}


