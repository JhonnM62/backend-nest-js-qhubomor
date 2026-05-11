import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/pos',
})
export class PosGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(PosGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinKitchen')
  handleJoinKitchen(@ConnectedSocket() client: Socket) {
    client.join('kitchen');
    this.logger.log(`Client ${client.id} joined kitchen room`);
    return { event: 'joined', room: 'kitchen' };
  }

  @SubscribeMessage('joinCaja')
  handleJoinCaja(@ConnectedSocket() client: Socket) {
    client.join('caja');
    this.logger.log(`Client ${client.id} joined caja room`);
    return { event: 'joined', room: 'caja' };
  }

  @SubscribeMessage('nuevaOrden')
  handleNuevaOrden(@MessageBody() data: any) {
    this.logger.log(`Nueva orden: ${JSON.stringify(data)}`);
    this.server.to('kitchen').emit('ordenRecibida', data);
    this.server.to('caja').emit('ordenActualizada', data);
    return { success: true, event: 'ordenRecibida' };
  }

  @SubscribeMessage('ordenActualizada')
  handleOrdenActualizada(@MessageBody() data: any) {
    this.logger.log(`Orden actualizada: ${JSON.stringify(data)}`);
    this.server.to('kitchen').emit('ordenActualizadaKitchen', data);
    this.server.to('caja').emit('ordenActualizadaCaja', data);
    return { success: true };
  }

  @SubscribeMessage('ordenCompletada')
  handleOrdenCompletada(@MessageBody() data: any) {
    this.logger.log(`Orden completada: ${JSON.stringify(data)}`);
    this.server.to('caja').emit('ordenCompletada', data);
    return { success: true };
  }

  emitToKitchen(event: string, data: any) {
    this.server.to('kitchen').emit(event, data);
  }

  emitToCaja(event: string, data: any) {
    this.server.to('caja').emit(event, data);
  }

  emitToAll(event: string, data: any) {
    this.server.emit(event, data);
  }
}
