import { Injectable, Logger } from '@nestjs/common';
import { AppGateway } from './app.gateway';
import { PrismaService } from '../prisma/prisma.service';

interface Reserva {
  productoId: string;
  cantidad: number;
}

interface SocketSession {
  socketId: string;
  reservas: Map<string, Reserva>;
  lastActivity: number;
}

@Injectable()
export class ReservasInventarioService {
  private readonly logger = new Logger(ReservasInventarioService.name);
  
  // Mapa de socketId a su sesión de reservas
  private sessions = new Map<string, SocketSession>();
  
  // Total reservado globalmente por productoId
  private globalReservations = new Map<string, number>();

  constructor(
    private readonly appGateway: AppGateway,
    private readonly prisma: PrismaService,
  ) {
    // Iniciar Cron local para expirar sesiones inactivas
    setInterval(() => this.checkExpirations(), 10000); // Revisar cada 10s
  }

  private async getExpirationTimeMs(): Promise<number> {
    try {
      const config = await this.prisma.configuracionNegocio.findUnique({ where: { id: 1 } });
      const minutos = config?.tiempoReservaInventario || 5;
      return minutos * 60 * 1000;
    } catch (e) {
      return 5 * 60 * 1000;
    }
  }

  async reservarProducto(socketId: string, productoId: string, cantidad: number) {
    if (!socketId || !productoId) return;

    let session = this.sessions.get(socketId);
    if (!session) {
      session = {
        socketId,
        reservas: new Map(),
        lastActivity: Date.now(),
      };
      this.sessions.set(socketId, session);
    }

    session.lastActivity = Date.now();

    const currentReserva = session.reservas.get(productoId) || { productoId, cantidad: 0 };
    const oldCantidad = currentReserva.cantidad;
    
    // Si la cantidad es 0, no lo guardamos
    if (cantidad <= 0) {
      session.reservas.delete(productoId);
    } else {
      currentReserva.cantidad = cantidad;
      session.reservas.set(productoId, currentReserva);
    }

    const delta = (cantidad <= 0 ? 0 : cantidad) - oldCantidad;

    if (delta !== 0) {
      this.updateGlobalReservation(productoId, delta);
    }
  }

  liberarTodasReservasDeSocket(socketId: string) {
    const session = this.sessions.get(socketId);
    if (!session) return;

    const productosAfectados = new Set<string>();

    for (const [productoId, reserva] of session.reservas.entries()) {
      this.updateGlobalReservation(productoId, -reserva.cantidad);
      productosAfectados.add(productoId);
    }

    this.sessions.delete(socketId);
    this.broadcastAffected(productosAfectados);
  }

  private updateGlobalReservation(productoId: string, delta: number) {
    const current = this.globalReservations.get(productoId) || 0;
    const next = current + delta;
    if (next <= 0) {
      this.globalReservations.delete(productoId);
    } else {
      this.globalReservations.set(productoId, next);
    }
    
    // Emitir el evento individual (útil para cuando cambia en vivo)
    this.appGateway.server.emit('stock_reservado_update', {
      productoId,
      cantidadReservadaTotal: next <= 0 ? 0 : next,
    });
  }

  private broadcastAffected(productosAfectados: Set<string>) {
    for (const productoId of productosAfectados) {
      const cant = this.globalReservations.get(productoId) || 0;
      this.appGateway.server.emit('stock_reservado_update', {
        productoId,
        cantidadReservadaTotal: cant,
      });
    }
  }

  private async checkExpirations() {
    const expirationMs = await this.getExpirationTimeMs();
    const now = Date.now();
    
    for (const [socketId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > expirationMs) {
        this.logger.log(`Expirando reservas del socket ${socketId} por inactividad`);
        
        // Emitir alerta al socket específico antes de liberarlo
        const socket = this.appGateway.server.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('reserva_expirada', { message: 'Tus productos reservados han sido devueltos al inventario por inactividad.' });
        }
        
        this.liberarTodasReservasDeSocket(socketId);
      }
    }
  }

  // Método para sincronizar todo el estado inicial cuando un cliente se conecta
  getAllReservations(): Record<string, number> {
    const res: Record<string, number> = {};
    for (const [productoId, cant] of this.globalReservations.entries()) {
      res[productoId] = cant;
    }
    return res;
  }
}
