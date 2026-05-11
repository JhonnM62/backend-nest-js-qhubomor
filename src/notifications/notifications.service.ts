import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import Expo, { ExpoPushMessage } from 'expo-server-sdk';

export type NotificationEventType = 
  | 'VENTA_CREATED' | 'VENTA_UPDATED' | 'VENTA_DELETED' | 'VENTA_TRASH_EMPTY'
  | 'PRODUCTO_CREATED' | 'PRODUCTO_PRICE_CHANGED' | 'PRODUCTO_RECIPE_CHANGED' | 'PRODUCTO_DELETED'
  | 'INSUMO_CREATED' | 'INSUMO_STOCK_POSITIVE' | 'INSUMO_STOCK_NEGATIVE' | 'INSUMO_STOCK_LOW' | 'INSUMO_DELETED'
  | 'CAJA_OPENED' | 'CAJA_CLOSED_PERFECT' | 'CAJA_CLOSED_MISMATCH' | 'CAJA_DELETED'
  | 'ORDER_INVENTARIO_UPDATED'
  | 'DINERO_RETIRADO'
  | 'GASTO_CREATED' | 'GASTO_DELETED';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private expo = new Expo();

  constructor(private prisma: PrismaService) {}

  async saveToken(userId: string, token: string, deviceName?: string) {
    if (!Expo.isExpoPushToken(token)) {
      throw new Error(`Token de push inválido: ${token}`);
    }

    // Asegurar que exista la configuración de notificaciones para este usuario
    const settingsExist = await this.prisma.notificationSetting.findUnique({ where: { userId } });
    if (!settingsExist) {
      await this.prisma.notificationSetting.create({ data: { userId } });
    }

    return this.prisma.pushToken.upsert({
      where: { token },
      update: { userId, deviceName },
      create: { userId, token, deviceName },
    });
  }

  async getSettings(userId: string) {
    let settings = await this.prisma.notificationSetting.findUnique({
      where: { userId },
    });

    if (!settings) {
      settings = await this.prisma.notificationSetting.create({
        data: { userId },
      });
    }

    return settings;
  }

  async updateSettings(userId: string, data: any) {
    return this.prisma.notificationSetting.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
  }

  async getHistory(userId: string) {
    return this.prisma.notificationHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markAsRead(id: string) {
    return this.prisma.notificationHistory.update({
      where: { id },
      data: { read: true },
    });
  }

  async sendNotification(
    eventType: NotificationEventType,
    title: string,
    body: string,
    dataContext?: any
  ) {
    try {
      // Determinar la columna de configuración a chequear según el evento
      const settingColumn = this.mapEventToSettingColumn(eventType);
      if (!settingColumn) return;

      // Buscar qué usuarios (administradores) tienen encendida esta alerta
      const settings = await this.prisma.notificationSetting.findMany({
        where: { [settingColumn]: true },
        include: {
          usuario: {
            include: { pushTokens: true }
          }
        }
      });

      const messages: ExpoPushMessage[] = [];
      const historyRecords = [];

      for (const setting of settings) {
        // Solo notificar si es Admin
        if (setting.usuario.rol !== 'Admin app' && setting.usuario.rol !== 'Admin negocio') {
          continue;
        }

        // Guardar en historial in-app
        historyRecords.push({
          userId: setting.userId,
          title,
          body,
          type: eventType,
          data: dataContext ? dataContext : {},
        });

        // Preparar push notifications
        for (const pushToken of setting.usuario.pushTokens) {
          if (!Expo.isExpoPushToken(pushToken.token)) continue;

          messages.push({
            to: pushToken.token,
            sound: 'default',
            title,
            body,
            data: { eventType, ...dataContext },
          });
        }
      }

      // Guardar historiales
      if (historyRecords.length > 0) {
        await this.prisma.notificationHistory.createMany({
          data: historyRecords,
        });
      }

      // Enviar notificaciones push a Expo
      if (messages.length > 0) {
        const chunks = this.expo.chunkPushNotifications(messages);
        const tickets = [];
        
        for (const chunk of chunks) {
          try {
            const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
            tickets.push(...ticketChunk);
          } catch (error) {
            this.logger.error('Error enviando notificaciones push chunk', error);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Error enviando notificación general: ${error.message}`);
    }
  }

  private mapEventToSettingColumn(eventType: NotificationEventType): string | null {
    const map: Record<NotificationEventType, string> = {
      'VENTA_CREATED': 'notifyVentaCreated',
      'VENTA_UPDATED': 'notifyVentaUpdated',
      'VENTA_DELETED': 'notifyVentaDeleted',
      'VENTA_TRASH_EMPTY': 'notifyVentaTrashEmpty',
      'PRODUCTO_CREATED': 'notifyProductoCreated',
      'PRODUCTO_PRICE_CHANGED': 'notifyProductoPriceChanged',
      'PRODUCTO_RECIPE_CHANGED': 'notifyProductoRecipeChanged',
      'PRODUCTO_DELETED': 'notifyProductoDeleted',
      'INSUMO_CREATED': 'notifyInsumoCreated',
      'INSUMO_STOCK_POSITIVE': 'notifyInsumoStockPositive',
      'INSUMO_STOCK_NEGATIVE': 'notifyInsumoStockNegative',
      'INSUMO_STOCK_LOW': 'notifyInsumoStockLow',
      'INSUMO_DELETED': 'notifyInsumoDeleted',
      'CAJA_OPENED': 'notifyCajaOpened',
      'CAJA_CLOSED_PERFECT': 'notifyCajaClosedPerfect',
      'CAJA_CLOSED_MISMATCH': 'notifyCajaClosedMismatch',
      'CAJA_DELETED': 'notifyCajaDeleted',
      'ORDER_INVENTARIO_UPDATED': 'notifyOrderInventarioUpdated',
      'DINERO_RETIRADO': 'notifyDineroRetirado',
      'GASTO_CREATED': 'notifyGastoCreated',
      'GASTO_DELETED': 'notifyGastoDeleted',
    };
    return map[eventType] || null;
  }
}
