import { Controller, Post, Body, Get, Param, Patch } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('token')
  async registerToken(@Body() body: { userId: string; token: string; deviceName?: string }) {
    return this.notificationsService.saveToken(body.userId, body.token, body.deviceName);
  }

  @Get('settings/:userId')
  async getSettings(@Param('userId') userId: string) {
    return this.notificationsService.getSettings(userId);
  }

  @Patch('settings/:userId')
  async updateSettings(@Param('userId') userId: string, @Body() data: any) {
    return this.notificationsService.updateSettings(userId, data);
  }

  @Get('history/:userId')
  async getHistory(@Param('userId') userId: string) {
    return this.notificationsService.getHistory(userId);
  }

  @Patch('history/:id/read')
  async markAsRead(@Param('id') id: string) {
    return this.notificationsService.markAsRead(id);
  }
}
