// ============================================================
// Q'HUBO MOR ERP - AppGateway
// ============================================================
// Gateway WebSocket genérico y escalable para el ERP
//
// CARACTERÍSTICAS:
// - Soporte para múltiples módulos (POS, Inventario, Insumos, Gastos, Caja)
// - Rooms dinámicos por módulo
// - Validación de autenticación
// - Tipado estricto con socket-types
//
// ESTRUCTURA DE ROOMS:
// - kitchen: Pedidos de cocina
// - caja: Actualizaciones de caja
// - inventario: Actualizaciones de inventario (futuro)
// - insumos: Actualizaciones de insumos (futuro)
// - gastos: Actualizaciones de gastos (futuro)
//
// EVENTOS:
// - joinRoom/leaveRoom: Unirse/salir de rooms dinámicos
// - events por módulo: Cada módulo tiene sus propios eventos
// ============================================================

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, forwardRef, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SocketEvent, Room } from './types/socket.types';
import { ReservasInventarioService } from './reservas.service';
import type { PrintJobPayload, PrintAckPayload } from './types/socket.types';

interface ConnectedClient {
  socket: Socket;
  rooms: Set<string>;
  userId?: string;
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/pos',
  transports: ['websocket', 'polling'],
})
export class AppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AppGateway.name);
  private connectedClients = new Map<string, ConnectedClient>();

  constructor(
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => ReservasInventarioService))
    private readonly reservasService: ReservasInventarioService,
  ) {}

  handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;

      if (!token) {
        this.logger.warn(`Client ${client.id} rejected: No token provided`);
        client.emit(SocketEvent.ERROR, { message: 'Token requerido', code: 'AUTH_NO_TOKEN' });
        client.disconnect();
        return;
      }

      let userId: string | undefined;
      try {
        // Decode token to get user ID
        const decoded = this.jwtService.verify(token);
        userId = decoded.sub; // Assuming the token has 'sub' as user ID
      } catch (e) {
        this.logger.warn(`Client ${client.id} provided invalid token`);
        // We might not want to disconnect them immediately if they are just logging out
      }

      this.connectedClients.set(client.id, {
        socket: client,
        rooms: new Set(),
        userId,
      });
      
      // Automatically join a personal room for direct messages
      if (userId) {
        const personalRoom = `user_${userId}`;
        client.join(personalRoom);
        const clientData = this.connectedClients.get(client.id);
        if (clientData) clientData.rooms.add(personalRoom);
        this.logger.log(`Client ${client.id} mapped to user ${userId} and joined ${personalRoom}`);
      } else {
        this.logger.log(`Client connected without valid userId: ${client.id}`);
      }
    } catch (error) {
      this.logger.error(`Connection error for ${client.id}:`, error);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const clientData = this.connectedClients.get(client.id);
    if (clientData) {
      this.logger.log(`Client disconnected: ${client.id} (was in rooms: ${[...clientData.rooms].join(', ')})`);
      this.connectedClients.delete(client.id);
    }
    this.reservasService.liberarTodasReservasDeSocket(client.id);
  }

  @SubscribeMessage('reservar_producto')
  handleReservarProducto(client: Socket, payload: { productoId: string; cantidad: number }) {
    this.reservasService.reservarProducto(client.id, payload.productoId, payload.cantidad);
  }

  @SubscribeMessage('liberar_reservas')
  handleLiberarReservas(client: Socket) {
    this.reservasService.liberarTodasReservasDeSocket(client.id);
  }

  @SubscribeMessage('get_reservas')
  handleGetReservas(client: Socket) {
    const reservas = this.reservasService.getAllReservations();
    client.emit('init_reservas', reservas);
  }

  @SubscribeMessage(SocketEvent.JOIN_ROOM)
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { room: string },
  ) {
    const room = data.room;
    if (!room) {
      client.emit(SocketEvent.ERROR, { message: 'Room es requerido', code: 'ROOM_REQUIRED' });
      return { success: false, error: 'Room es requerido' };
    }

    const clientData = this.connectedClients.get(client.id);
    if (!clientData) {
      return { success: false, error: 'Cliente no encontrado' };
    }

    client.join(room);
    clientData.rooms.add(room);

    this.logger.log(`Client ${client.id} joined room: ${room}`);

    return {
      success: true,
      event: SocketEvent.JOINED,
      data: { room, timestamp: Date.now() },
    };
  }

  @SubscribeMessage(SocketEvent.LEAVE_ROOM)
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { room: string },
  ) {
    const room = data.room;
    if (!room) {
      return { success: false, error: 'Room es requerido' };
    }

    const clientData = this.connectedClients.get(client.id);
    if (clientData) {
      client.leave(room);
      clientData.rooms.delete(room);
      this.logger.log(`Client ${client.id} left room: ${room}`);
    }

    return { success: true };
  }

  // ============================================================
  // EVENTOS POS / VENTAS
  // ============================================================

  @SubscribeMessage(SocketEvent.NUEVA_ORDEN)
  handleNuevaOrden(@MessageBody() data: any) {
    this.logger.log(`Nueva orden received: ${data.ventaId || data.venta?.pedido}`);

    const enrichedData = { ...data, timestamp: Date.now(), module: 'POS' };

    this.server.to(Room.KITCHEN).emit(SocketEvent.ORDEN_RECIBIDA, enrichedData);
    this.server.to(Room.KITCHEN).emit(SocketEvent.ORDEN_ACTUALIZADA_KITCHEN, enrichedData);
    this.server.to(Room.CAJA).emit(SocketEvent.ORDEN_ACTUALIZADA_CAJA, enrichedData);

    return { success: true };
  }

  @SubscribeMessage(SocketEvent.ORDEN_ACTUALIZADA)
  handleOrdenActualizada(@MessageBody() data: any) {
    this.logger.log(`Orden actualizada received: ${data.ventaId || data.IDventas}`);

    const enrichedData = { ...data, timestamp: Date.now(), module: 'POS' };

    this.server.to(Room.KITCHEN).emit(SocketEvent.ORDEN_ACTUALIZADA_KITCHEN, enrichedData);
    this.server.to(Room.CAJA).emit(SocketEvent.ORDEN_ACTUALIZADA_CAJA, enrichedData);
    this.server.to(Room.CAJA).emit(SocketEvent.ORDEN_ACTUALIZADA, enrichedData); // Agregamos este evento

    return { success: true };
  }

  @SubscribeMessage(SocketEvent.ORDEN_COMPLETADA)
  handleOrdenCompletada(@MessageBody() data: any) {
    this.logger.log(`Orden completada received: ${data.ventaId}`);

    const enrichedData = { ...data, timestamp: Date.now(), module: 'POS' };

    this.server.to(Room.CAJA).emit(SocketEvent.ORDEN_COMPLETADA, enrichedData);

    return { success: true };
  }

  // ============================================================
  // IMPRESIÓN REMOTA BT via Socket
  // Permite delegar la impresión a un dispositivo con BT conectado
  // ============================================================

  @SubscribeMessage(SocketEvent.PRINT_REGISTER)
  handlePrintRegister(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { negocioId?: string },
  ) {
    const room = `printers:${data.negocioId ?? 'default'}`;
    client.join(room);
    const clientData = this.connectedClients.get(client.id);
    if (clientData) clientData.rooms.add(room);
    this.logger.log(`Dispositivo ${client.id} registrado como servidor de impresión en ${room}`);
    client.emit(SocketEvent.PRINT_REGISTERED, { ok: true, room });
    return { success: true };
  }

  @SubscribeMessage(SocketEvent.PRINT_REQUEST)
  handlePrintRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: PrintJobPayload,
  ) {
    const room = `printers:${payload.negocioId ?? 'default'}`;
    this.logger.log(`Print request jobId=${payload.jobId} type=${payload.type} → room=${room}`);
    // Reenviar el trabajo al primer dispositivo disponible con impresora
    this.server.to(room).emit(SocketEvent.PRINT_JOB, payload);
    return { success: true, jobId: payload.jobId };
  }

  @SubscribeMessage(SocketEvent.PRINT_DONE)
  handlePrintDone(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: PrintAckPayload,
  ) {
    this.logger.log(`Print done jobId=${payload.jobId} success=${payload.success}`);
    // Notificar al solicitante original por evento dinámico
    this.server.emit(`print:ack:${payload.jobId}`, payload);
    return { success: true };
  }

  // ============================================================
  // MÉTODOS HELPER PARA EMITIR DESDE SERVICIOS
  // ============================================================

  emitToRoom(room: string, event: string, data: any) {
    this.server.to(room).emit(event, { ...data, timestamp: Date.now() });
  }

  emitToKitchen(event: string, data: any) {
    this.emitToRoom(Room.KITCHEN, event, data);
  }

  emitToCaja(event: string, data: any) {
    this.emitToRoom(Room.CAJA, event, data);
  }

  emitToAll(event: string, data: any) {
    this.logger.log(`Broadcasting event ${event} to all clients in namespace`);
    this.server.emit(event, { ...data, timestamp: Date.now() });
  }

  // ============================================================
  // MÉTODOS PARA FUTUROS MÓDULOS
  // ============================================================

  emitToInventario(event: string, data: any) {
    this.emitToRoom(Room.INVENTARIO, event, data);
    // Para simplificar a clientes que no se unen al room
    this.emitToAll(event, data);
  }

  emitToInsumos(event: string, data: any) {
    this.emitToRoom(Room.INSUMOS, event, data);
    this.emitToAll(event, data);
  }

  emitToProductos(event: string, data: any) {
    this.emitToRoom(Room.PRODUCTOS, event, data);
    this.emitToAll(event, data);
  }

  emitToCategorias(event: string, data: any) {
    this.emitToRoom(Room.CATEGORIAS, event, data);
    this.emitToAll(event, data);
  }

  emitToGastos(event: string, data: any) {
    this.emitToRoom(Room.GASTOS, event, data);
    this.emitToAll(event, data);
  }

  emitToVentas(event: string, data: any) {
    this.logger.log(`Emitting to Ventas room and all clients: ${event}`);
    this.emitToRoom(Room.VENTAS, event, data);
    this.emitToAll(event, data);
  }

  // ============================================================
  // UTILIDADES
  // ============================================================

  getConnectedClientsCount(): number {
    return this.connectedClients.size;
  }

  getClientsInRoom(room: string): string[] {
    const roomClients = this.server.sockets.adapter.rooms.get(room);
    return roomClients ? [...roomClients] : [];
  }

  getRooms(): string[] {
    const rooms = new Set<string>();
    this.connectedClients.forEach((client) => {
      client.rooms.forEach((room) => rooms.add(room));
    });
    return [...rooms];
  }
}
