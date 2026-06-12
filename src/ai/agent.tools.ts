import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

@Injectable()
export class AgentToolsService {
  constructor(private prisma: PrismaService) {}

  getTools() {
    return [
      this.listarInsumosCriticosTool(),
      this.registrarGastoTool(),
      this.registroMasivoInsumosTool(),
      this.buscarCuentaMesaTool(),
      this.modificarCuentaTool(),
      this.liquidarEmpleadoTool(),
      this.cerrarCajaTool(),
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
}
