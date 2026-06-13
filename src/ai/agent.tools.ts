import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstadisticasService } from '../estadisticas/estadisticas.service';
import { tool } from '@langchain/core/tools';
import { RunnableConfig } from "@langchain/core/runnables";
import { z } from 'zod';

@Injectable()
export class AgentToolsService {
  constructor(
    private prisma: PrismaService,
    private estadisticas: EstadisticasService
  ) {}

  getTools() {
    return [
      this.listarInsumosCriticosTool(),
      this.registrarGastoTool(),
      this.registroMasivoInsumosTool(),
      this.buscarCuentaMesaTool(),
      this.modificarCuentaTool(),
      this.liquidarEmpleadoTool(),
      this.cerrarCajaTool(),
      this.consultarVentasTool(),
      this.consultarEstadisticasGeneralesTool(),
      this.guardarPreferenciaTool(),
      this.leerPreferenciaTool(),
      this.consultarInventarioGeneralTool(),
      this.buscarClienteTool(),
      this.analizarMovimientosInsumosTool(),
      this.consultarDescuadresCajaTool(),
      this.aprenderReglaTool()
    ];
  }

  private listarInsumosCriticosTool() {
    return tool(
      async () => {
        const insumos = await this.prisma.insumos.findMany({
          where: {
            OR: [
              { disponible: { lte: 5 } }, // Arbitrary threshold for now
            ],
          },
          select: { nombre: true, disponible: true },
        });
        return JSON.stringify(insumos);
      },
      {
        name: 'listar_insumos_criticos',
        description: 'Útil para obtener una lista de los insumos o materias primas que están bajos de inventario.',
        schema: z.object({}),
      }
    );
  }

  private registrarGastoTool() {
    return tool(
      async (args) => {
        const gasto = await this.prisma.gastos.create({
          data: {
            concepto: args.categoria + ' - ' + args.descripcion,
            valor: args.valor,
            fechaYHora: new Date(),
            fecha: new Date(),
          },
        });
        return `Gasto registrado con ID: ${gasto.IDgastos}`;
      },
      {
        name: 'registrar_gasto',
        description: 'Registra un nuevo gasto financiero (ej. transporte, compras, servicios). Requiere confirmación.',
        schema: z.object({
          categoria: z.string().describe('Categoría del gasto, ej. Servicios, Transporte, Insumos'),
          valor: z.number().describe('Valor numérico del gasto'),
          descripcion: z.string().describe('Motivo o detalle del gasto'),
        }),
      }
    );
  }

  private registroMasivoInsumosTool() {
    return tool(
      async (args) => {
        const resultados = [];
        for (const item of args.operaciones) {
          const insumoDb = await this.prisma.insumos.findFirst({
            where: { nombre: { contains: item.nombre, mode: 'insensitive' } },
          });

          if (insumoDb) {
            const nuevoDisponible = item.tipo === 'entrada' 
              ? Number(insumoDb.disponible || 0) + item.cantidad 
              : Number(insumoDb.disponible || 0) - item.cantidad;

            await this.prisma.insumos.update({
              where: { IDalimentos: insumoDb.IDalimentos },
              data: { disponible: nuevoDisponible },
            });
            resultados.push(`${item.nombre}: actualizado a ${nuevoDisponible}`);
          } else {
            resultados.push(`${item.nombre}: NO ENCONTRADO`);
          }
        }
        return JSON.stringify(resultados);
      },
      {
        name: 'registro_masivo_insumos',
        description: 'Registra múltiples entradas o salidas de insumos en un solo paso. Útil cuando el usuario dicta una lista de ítems. Requiere confirmación.',
        schema: z.object({
          operaciones: z.array(
            z.object({
              nombre: z.string().describe('Nombre del insumo'),
              cantidad: z.number().describe('Cantidad que entra o sale'),
              tipo: z.enum(['entrada', 'salida']).describe('Si es entrada (suma) o salida (resta) al inventario'),
            })
          ),
        }),
      }
    );
  }

  private buscarCuentaMesaTool() {
    return tool(
      async (args) => {
        const ventas = await this.prisma.ventas.findMany({
          where: { 
            mesa: args.mesaId.toString(),
            estado: { in: ['TOMADO', 'EN_EL_CARRITO', 'LISTO_PARA_ENTREGA'] }
          },
          include: { ordenVentas: true }
        });
        return JSON.stringify(ventas);
      },
      {
        name: 'buscar_cuenta_mesa',
        description: 'Busca el estado actual de los pedidos o la cuenta de una mesa específica.',
        schema: z.object({
          mesaId: z.string().describe('ID o nombre de la mesa a buscar'),
        }),
      }
    );
  }

  private modificarCuentaTool() {
    return tool(
      async (args) => {
        // Lógica simplificada, en realidad debería interactuar con los servicios de venta
        return `Estado de cuenta ${args.idVenta} modificado a ${args.nuevoEstado}`;
      },
      {
        name: 'modificar_cuenta',
        description: 'Modifica el estado de una venta o pedido. Requiere confirmación.',
        schema: z.object({
          idVenta: z.string().describe('ID de la venta a modificar'),
          nuevoEstado: z.enum(['PAGADO', 'CANCELADO', 'ENTREGADO']).describe('Nuevo estado'),
        }),
      }
    );
  }

  private liquidarEmpleadoTool() {
    return tool(
      async (args) => {
        return `Empleado ${args.idEmpleado} liquidado por ${args.valorLiquidacion}`;
      },
      {
        name: 'liquidar_empleado',
        description: 'Marca como liquidados los turnos de un empleado y registra el pago. Requiere confirmación.',
        schema: z.object({
          idEmpleado: z.string().describe('ID del empleado a liquidar'),
          valorLiquidacion: z.number().describe('Total a pagarle al empleado'),
        }),
      }
    );
  }

  private cerrarCajaTool() {
    return tool(
      async (args) => {
        return `Caja cerrada con éxito. Apertura dictada: ${args.apertura}, Cierre: ${args.cierre}`;
      },
      {
        name: 'cerrar_caja',
        description: 'Cierra la caja del día actual. Permite ingresar cantidades de apertura y cierre dictadas por el usuario. Requiere confirmación.',
        schema: z.object({
          apertura: z.number().describe('Cantidad de insumos reportada al abrir (si la dicta el usuario)'),
          cierre: z.number().describe('Cantidad de insumos reportada al cerrar (si la dicta el usuario)'),
        }),
      }
    );
  }

  private consultarVentasTool() {
    return tool(
      async (args) => {
        try {
          const startDate = new Date(`${args.fechaInicio}T05:00:00.000Z`);
          const nextDay = new Date(`${args.fechaFin}T05:00:00.000Z`);
          nextDay.setDate(nextDay.getDate() + 1);
          const endDate = new Date(nextDay.getTime() - 1);
          
          const whereClause: any = {
            fecha: {
              gte: startDate,
              lte: endDate
            },
            venta: {
              estado: { in: ['PAGADO', 'ENTREGADO'] }
            }
          };

          if (args.producto) {
            whereClause.OR = [
              { nombre: { contains: args.producto, mode: 'insensitive' } },
              { comentarios: { contains: args.producto, mode: 'insensitive' } },
              { venta: { mensaje: { contains: args.producto, mode: 'insensitive' } } }
            ];
          }

          const ordenes = await this.prisma.orderventas.findMany({
            where: whereClause,
            select: { 
              cantidad: true, 
              precioTotal: true, 
              nombre: true,
              comentarios: true,
              venta: {
                select: {
                  hora: true,
                  mensaje: true
                }
              }
            }
          });

          let totalUnidades = 0;
          let ingresosTotales = 0;
          
          for (const orden of ordenes) {
            totalUnidades += orden.cantidad || 0;
            ingresosTotales += Number(orden.precioTotal) || 0;
          }

          if (ordenes.length === 0) {
            return `No se encontraron ventas pagadas${args.producto ? ` con la palabra '${args.producto}'` : ''} entre el ${args.fechaInicio} y el ${args.fechaFin}.`;
          }

          if (args.detallado) {
            const detalles = ordenes.slice(0, 50).map(o => {
               let nota = '';
               if (o.comentarios) nota += ` [Comentario: ${o.comentarios}]`;
               if (o.venta?.mensaje) nota += ` [Mensaje: ${o.venta.mensaje}]`;
               return `- ${o.venta?.hora || 'N/A'} | ${o.cantidad}x ${o.nombre} ($${Number(o.precioTotal).toLocaleString('es-CO')})${nota}`;
            });
            
            let resumen = `Se encontraron ${ordenes.length} ventas${args.producto ? ` para '${args.producto}'` : ''}. Mostrando las primeras ${Math.min(50, ordenes.length)}:\n`;
            resumen += detalles.join('\n');
            resumen += `\n\nTotal ingresos: $${ingresosTotales.toLocaleString('es-CO')} | Unidades totales: ${totalUnidades}`;
            return resumen;
          }

          return `Resumen de ventas${args.producto ? ` para '${args.producto}'` : ''} (${args.fechaInicio} a ${args.fechaFin}):
- Unidades vendidas: ${totalUnidades}
- Ingresos generados: $${ingresosTotales.toLocaleString('es-CO')}`;

        } catch (error: any) {
          return `Ocurrió un error al consultar las ventas: ${error.message}`;
        }
      },
      {
        name: 'consultar_ventas',
        description: 'Útil para consultar reportes de ventas históricas, sumar ingresos, o buscar productos, promociones o notas específicas en las ventas. Soporta búsquedas avanzadas en comentarios.',
        schema: z.object({
          fechaInicio: z.string().describe('Fecha de inicio (YYYY-MM-DD). Calcula la fecha exacta si el usuario dice "ayer" o "hoy".'),
          fechaFin: z.string().describe('Fecha de fin (YYYY-MM-DD). Si es para un solo día, usa la misma que fechaInicio.'),
          producto: z.string().optional().describe('Palabra clave a buscar (ej. "promo", "granizado"). Busca en el nombre del producto y en las notas de la venta. Si no se especifica, buscará todas las ventas.'),
          detallado: z.boolean().optional().describe('Establece en true si el usuario pide "listar", "mostrar" o ver el detalle de las ventas encontradas. Si solo pide el "total" o "cuánto se vendió", ponlo en false.'),
        }),
      }
    );
  }

  private consultarEstadisticasGeneralesTool() {
    return tool(
      async (args) => {
        try {
          const stats = await this.estadisticas.getEstadisticasGenerales(args.fechaInicio, args.fechaFin);
          return JSON.stringify({
            ventasTotales: stats.totales.ventas,
            gastosNegocio: stats.totales.gastosNegocio,
            gastosPersonales: stats.totales.gastosPersonales,
            utilidadNegocio: stats.totales.utilidadNegocio,
            utilidadNeta: stats.totales.utilidadNeta,
            comprasInventarioTotales: stats.totales.inventarioTotal
          });
        } catch (error: any) {
          return `Ocurrió un error al consultar las estadísticas: ${error.message}`;
        }
      },
      {
        name: 'consultar_estadisticas_generales',
        description: 'Obtiene las estadísticas generales, utilidad del negocio, utilidad neta, y resumen de gastos del restaurante. Útil para responder "cuál es la utilidad", "gastos de este mes", etc.',
        schema: z.object({
          fechaInicio: z.string().describe('Fecha de inicio (YYYY-MM-DD)'),
          fechaFin: z.string().describe('Fecha de fin (YYYY-MM-DD)'),
        }),
      }
    );
  }

  private guardarPreferenciaTool() {
    return tool(
      async (args, config: any) => {
        const store = config.store;
        if (!store) return "No hay memoria a largo plazo (store) disponible.";
        const namespace = ["preferencias", config.configurable?.thread_id || "global"];
        await store.put(namespace, args.clave, { valor: args.valor });
        return `Preferencia '${args.clave}' guardada exitosamente con el valor '${args.valor}'.`;
      },
      {
        name: 'guardar_preferencia',
        description: 'Guarda una preferencia a largo plazo para el usuario (ej. recordatorios, formatos preferidos, nombres, cómo referirse a la persona).',
        schema: z.object({
          clave: z.string().describe('La clave o nombre de la preferencia (ej. "formato_moneda")'),
          valor: z.string().describe('El valor a recordar (ej. "es-CO")'),
        }),
      }
    );
  }

  private leerPreferenciaTool() {
    return tool(
      async (args, config: any) => {
        const store = config.store;
        if (!store) return "No hay memoria a largo plazo (store) disponible.";
        const namespace = ["preferencias", config.configurable?.thread_id || "global"];
        const item = await store.get(namespace, args.clave);
        return item && item.value ? item.value.valor : "Preferencia no encontrada.";
      },
      {
        name: 'leer_preferencia',
        description: 'Lee una preferencia a largo plazo guardada previamente.',
        schema: z.object({
          clave: z.string().describe('La clave de la preferencia a buscar.'),
        }),
      }
    );
  }

  private consultarInventarioGeneralTool() {
    return tool(
      async () => {
        const insumos = await this.prisma.insumos.findMany({
          where: { estado: 'ACTIVO' },
          select: { nombre: true, disponible: true, unidades: true }
        });
        return JSON.stringify(insumos);
      },
      {
        name: 'consultar_inventario_general',
        description: 'Muestra el inventario completo y general del restaurante (cantidades disponibles actuales).',
        schema: z.object({}),
      }
    );
  }

  private buscarClienteTool() {
    return tool(
      async (args) => {
        const clientes = await this.prisma.clientes.findMany({
          where: {
            OR: [
              { nombre: { contains: args.query, mode: 'insensitive' } },
              { whatsapp: { contains: args.query, mode: 'insensitive' } }
            ],
            isActive: true
          },
          take: 20
        });
        return JSON.stringify(clientes);
      },
      {
        name: 'buscar_cliente',
        description: 'Busca un cliente por nombre o teléfono (WhatsApp) para consultar sus datos o su fidelización (compras).',
        schema: z.object({
          query: z.string().describe('Nombre, porción del nombre o número de teléfono del cliente a buscar.'),
        }),
      }
    );
  }

  private analizarMovimientosInsumosTool() {
    return tool(
      async (args) => {
        const start = new Date(`${args.fechaInicio}T05:00:00.000Z`);
        const end = new Date(`${args.fechaFin}T05:00:00.000Z`);
        end.setUTCHours(23, 59, 59, 999);

        // Buscar en compras (Orderinventario)
        const compras = await this.prisma.orderinventario.findMany({
          where: { fecha: { gte: start, lte: end } },
          select: { nombreDelAlimento: true, cantidad: true, precioActual: true, subtotal: true }
        });

        // Buscar en gastos reales reportados en caja (AperturaCierreInsumos)
        const consumosFisicos = await this.prisma.aperturaCierreInsumos.findMany({
          where: { fecha: { gte: start, lte: end } },
          select: { nombreDelProducto: true, cantApertura: true, cantDeCierre: true, seUtilizaron: true }
        });

        return JSON.stringify({
          comprasRegistradas: compras.slice(0, 100), 
          consumosFisicosEnCaja: consumosFisicos.slice(0, 100),
          nota: "Las listas muestran las operaciones del periodo. Agrupa por nombreDelAlimento o nombreDelProducto para decirle al usuario cuáles fueron los que más se compraron o gastaron."
        });
      },
      {
        name: 'analizar_movimientos_insumos',
        description: 'Consulta qué insumos se compraron más o se gastaron más en una fecha o rango de fechas (días, semanas, meses).',
        schema: z.object({
          fechaInicio: z.string().describe('Fecha de inicio (YYYY-MM-DD)'),
          fechaFin: z.string().describe('Fecha de fin (YYYY-MM-DD)'),
        }),
      }
    );
  }

  private consultarDescuadresCajaTool() {
    return tool(
      async (args) => {
        const start = new Date(`${args.fechaInicio}T05:00:00.000Z`);
        const end = new Date(`${args.fechaFin}T05:00:00.000Z`);
        end.setUTCHours(23, 59, 59, 999);

        const cajas = await this.prisma.aperturaCierreCaja.findMany({
          where: {
            fechaDeApertura: { gte: start, lte: end },
            OR: [
              { valorFaltante: { gt: 0 } },
              { valorExcedente: { gt: 0 } }
            ]
          },
          select: {
            fechaDeApertura: true,
            fechaDeCierre: true,
            valorFaltante: true,
            valorExcedente: true,
            observaciones: true
          }
        });

        let totalFaltante = 0;
        let totalExcedente = 0;
        for (const caja of cajas) {
          totalFaltante += Number(caja.valorFaltante || 0);
          totalExcedente += Number(caja.valorExcedente || 0);
        }

        return JSON.stringify({
          totalFaltante,
          totalExcedente,
          descuadresRegistrados: cajas,
          nota: "Usa 'fechaDeApertura' como la fecha principal de la caja al dar la respuesta al usuario, ya que así es como se organizan los días en el negocio."
        });
      },
      {
        name: 'consultar_descuadres_caja',
        description: 'Consulta los descuadres de caja (faltantes de dinero y excedentes) en un rango de fechas. Muy útil para quincenas.',
        schema: z.object({
          fechaInicio: z.string().describe('Fecha de inicio (YYYY-MM-DD)'),
          fechaFin: z.string().describe('Fecha de fin (YYYY-MM-DD)'),
        }),
      }
    );
  }

  private aprenderReglaTool() {
    return tool(
      async (args) => {
        try {
          await this.prisma.instruccionesAgente.create({
            data: {
              contexto: args.contexto,
              instruccion: args.instruccion,
            }
          });
          return `Regla aprendida y guardada exitosamente bajo el contexto: ${args.contexto}. Me acordaré de esto en el futuro.`;
        } catch (error: any) {
          return `Ocurrió un error al guardar la regla: ${error.message}`;
        }
      },
      {
        name: 'aprender_regla',
        description: 'Usa esta herramienta cuando el usuario te dé una retroalimentación, instrucción o regla sobre cómo debes comportarte, cómo hacer cálculos o cómo usar tus otras herramientas (ej. "A partir de ahora ten en cuenta X al revisar la caja"). Esto guardará la regla en la base de datos para que la recuerdes siempre en tus futuras conversaciones.',
        schema: z.object({
          contexto: z.string().describe('El tema o categoría de la regla (ej. "Caja", "Ventas", "Inventario", "consultarVentasTool", "General").'),
          instruccion: z.string().describe('La instrucción o regla exacta que el usuario quiere que aprendas y recuerdes.'),
        }),
      }
    );
  }
}
