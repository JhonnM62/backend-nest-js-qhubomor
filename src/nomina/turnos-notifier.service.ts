import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';

@Injectable()
export class TurnosNotifierService {
  private readonly logger = new Logger(TurnosNotifierService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfiguracionService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async checkDescansos() {
    try {
      // 1. Get global config
      const globalConfig = await this.configService.getConfiguracionWhatsapp();
      if (!globalConfig.enabled || !globalConfig.descansoAlertEnabled) {
        return; // Not enabled globally
      }

      const { descansoAnticipacionMinutos, descansoFrecuenciaMinutos } = globalConfig;

      // 2. Find active turnos in descanso
      const turnosEnDescanso = await this.prisma.turnos.findMany({
        where: {
          inicioDescanso: { not: null },
          finDescanso: null,
        },
        include: {
          usuario: {
            include: {
              cargo: true,
              notificationSetting: true,
            },
          },
        },
      });

      const now = new Date();

      for (const turno of turnosEnDescanso) {
        // Check if user has it enabled (default is true if settings don't exist)
        const userWantsNotify = turno.usuario?.notificationSetting?.notifyTurnoDescanso !== false;
        
        if (!userWantsNotify || !turno.usuario?.telefono) {
          continue; // Skip if disabled or no phone number
        }

        const durationMinutes = turno.usuario?.cargo?.duracionDescansoMinutos || 0;
        if (durationMinutes === 0) continue; // If cargo has 0 minutes, we don't know when it ends

        const inicioDescanso = new Date(turno.inicioDescanso!);
        
        // Calculate end time
        const endTime = new Date(inicioDescanso.getTime() + durationMinutes * 60000);
        
        // Calculate the threshold to start sending alerts
        const firstAlertTime = new Date(endTime.getTime() - descansoAnticipacionMinutos * 60000);

        // We should only alert if now >= firstAlertTime
        if (now >= firstAlertTime) {
          let shouldSendAlert = false;
          let isFinalAlert = false;
          
          // Is it past the end time?
          if (now >= endTime) {
             isFinalAlert = true;
          }

          if (!turno.ultimaAlertaDescanso) {
            // Never sent an alert, send the first one!
            shouldSendAlert = true;
          } else {
            // Check frequency
            const lastAlert = new Date(turno.ultimaAlertaDescanso!);
            const diffMinutes = (now.getTime() - lastAlert.getTime()) / 60000;
            if (diffMinutes >= descansoFrecuenciaMinutos) {
               shouldSendAlert = true;
            }
          }

          if (shouldSendAlert) {
             // Calculate exactly how many minutes are left
             const minutesLeft = Math.ceil((endTime.getTime() - now.getTime()) / 60000);
             
             let message = '';
             if (isFinalAlert) {
               message = `🚨 ¡Hola ${turno.usuario.nombre || ''}! Tu tiempo de descanso ha finalizado. Por favor, regresa a tu puesto de trabajo.`;
             } else {
               message = `⏳ ¡Hola ${turno.usuario.nombre || ''}! Tu descanso está por finalizar en aproximadamente ${minutesLeft} minutos. Prepárate para regresar a tu turno.`;
             }

             try {
               await this.configService.sendTextToWhatsapp(turno.usuario.telefono, message);
               
               // Update Turno
               await this.prisma.turnos.update({
                 where: { IDturno: turno.IDturno },
                 data: {
                   ultimaAlertaDescanso: now,
                   alertasDescansoEnviadas: { increment: 1 }
                 }
               });
               this.logger.log(`Alerta de descanso enviada a ${turno.usuario.nombre} (${turno.usuario.telefono})`);
             } catch (e: any) {
               this.logger.error(`Error al enviar alerta de descanso a ${turno.usuario.telefono}: ${e.message}`);
             }
          }
        }
      }
    } catch (err: any) {
      this.logger.error('Error procesando el Cron de descansos: ' + err.message);
    }
  }
}
