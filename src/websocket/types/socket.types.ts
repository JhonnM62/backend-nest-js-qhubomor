export enum SocketEvent {
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  ERROR = 'error',
  JOIN_ROOM = 'joinRoom',
  LEAVE_ROOM = 'leaveRoom',
  JOINED = 'joined',
  NUEVA_ORDEN = 'nuevaOrden',
  ORDEN_RECIBIDA = 'ordenRecibida',
  ORDEN_ACTUALIZADA = 'ordenActualizada',
  ORDEN_ACTUALIZADA_KITCHEN = 'ordenActualizadaKitchen',
  ORDEN_ACTUALIZADA_CAJA = 'ordenActualizadaCaja',
  ORDEN_COMPLETADA = 'ordenCompletada',
  REFRESH_INVENTARIO = 'refreshInventario',
  REFRESH_INSUMOS = 'refreshInsumos',
  REFRESH_CAJA = 'refreshCaja',
  REFRESH_PRODUCTOS = 'refreshProductos',
  REFRESH_CATEGORIAS = 'refreshCategorias',
  REFRESH_GASTOS = 'refreshGastos',
  REFRESH_VENTAS = 'refreshVentas',
  USER_PERMISSIONS_UPDATED = 'userPermissionsUpdated',
  VENTA_ID_GENERATED = 'ventaIdGenerated',
  // Secciones de cocina
  REFRESH_SECCIONES_COCINA = 'refreshSeccionesCocina',
  // Impresión remota BT via socket
  PRINT_REGISTER   = 'print:register',
  PRINT_REGISTERED = 'print:registered',
  PRINT_REQUEST    = 'print:request',
  PRINT_JOB        = 'print:job',
  PRINT_DONE       = 'print:done',
  PRINT_ACK        = 'print:ack',
  GET_PRINT_SERVERS= 'print:get_servers',
  PRINT_SERVERS_UPDATE = 'print:servers_update',
}

export enum Room {
  KITCHEN = 'kitchen',
  CAJA = 'caja',
  INVENTARIO = 'inventario',
  INSUMOS = 'insumos',
  PRODUCTOS = 'productos',
  CATEGORIAS = 'categorias',
  GASTOS = 'gastos',
  VENTAS = 'ventas',
}

export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
}

export interface BasePayload {
  timestamp?: number;
  module?: string;
}

export interface JoinRoomPayload {
  room: Room | string;
}

export interface JoinedPayload {
  room: string;
  timestamp: number;
}

export interface ErrorPayload {
  message: string;
  code?: string;
}

export interface BaseResponse {
  success: boolean;
  event?: string;
  error?: string;
}

export interface ProductoPayload {
  productoId: string;
  nombre: string;
  nombreProducto: string;
  categoria: string;
  categoriaProducto: string;
  cantidad: number;
  precio: number;
  precioTotal: number;
  estado: string;
  imagenUrl?: string;
  comentarios?: string;
  salsa?: string;
  helado?: string;
  topings?: string;
}

export interface VentaData {
  IDventas?: string;
  estado: string;
  medioDePago?: string;
  efectivoRecibido?: number;
  devueltas?: number;
  banco?: string;
  transferencia?: number;
  totalInput: number;
  pedido: string;
  mesa?: string | null;
  fecha?: string;
  hora?: string;
  [key: string]: any;
}

export interface OrdenPayload extends BasePayload {
  ventaId: string;
  venta: VentaData;
  productos: ProductoPayload[];
  module?: string;
}

export interface OrdenActualizadaPayload extends BasePayload {
  ventaId?: string;
  IDventas?: string;
  venta?: Partial<VentaData>;
  estado?: string;
  productos?: ProductoPayload[];
  module?: string;
}

export interface OrdenCompletadaPayload extends BasePayload {
  ventaId: string;
  pedido: string;
  totalInput: number;
  medioDePago: string;
  module?: string;
}

// ============================================================
// PRINT JOB — Impresión remota BT via socket
// ============================================================
export interface PrintJobPayload {
  jobId: string;          // UUID único por trabajo de impresión
  negocioId?: string;     // Para filtrar por negocio (sala printers:<negocioId>)
  ticketData: any;        // Misma estructura que usa executePrint()
  type: 'comanda' | 'factura';
  paperSize: 58 | 80;
  seccionNombre?: string; // Si es ticket de sección específica
}

export interface PrintAckPayload {
  jobId: string;
  success: boolean;
  error?: string;
}
