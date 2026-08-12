import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class FacturacionService {
  private readonly logger = new Logger(FacturacionService.name);
  private token: string | null = null;
  private tokenExpiresAt: Date | null = null;

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
  ) {}

  private async getConfig() {
    const config = await this.prisma.configuracionNegocio.findFirst();
    if (!config || !config.factusEmail || !config.factusPassword || !config.factusClientId || !config.factusClientSecret) {
      throw new HttpException('Credenciales de Factus no configuradas', HttpStatus.BAD_REQUEST);
    }
    return config;
  }

  private getBaseUrl(entorno: string) {
    return entorno === 'PRODUCCION' ? 'https://api.factus.com.co' : 'https://api-sandbox.factus.com.co';
  }

  private async getToken(config: any): Promise<string> {
    if (this.token && this.tokenExpiresAt && this.tokenExpiresAt > new Date()) {
      return this.token;
    }

    try {
      const baseUrl = this.getBaseUrl(config.factusEntorno);
      const payload = {
        grant_type: 'password',
        client_id: config.factusClientId,
        client_secret: config.factusClientSecret,
        username: config.factusEmail,
        password: config.factusPassword,
      };

      const response = await firstValueFrom(
        this.httpService.post(`${baseUrl}/oauth/token`, payload)
      );

      this.token = response.data.access_token;
      // El token de Factus suele durar 1 hora. Guardamos 55 minutos para estar seguros.
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 55);
      this.tokenExpiresAt = expiresAt;

      return this.token as string;
    } catch (error: any) {
      this.logger.error('Error al obtener token de Factus', error?.response?.data || error);
      throw new HttpException('Error de autenticación con Factus', HttpStatus.UNAUTHORIZED);
    }
  }

  private async getNumberingRange(config: any, token: string): Promise<number> {
    try {
      const baseUrl = this.getBaseUrl(config.factusEntorno);
      const response = await firstValueFrom(
        this.httpService.get(`${baseUrl}/v2/numbering-ranges`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      );
      
      const data = response.data?.data;
      if (!data || data.length === 0) {
        throw new Error('No hay rangos de numeración activos');
      }
      return data[0].id;
    } catch (error: any) {
      this.logger.error('Error al obtener rango de numeración', error?.response?.data || error);
      throw new HttpException('Error al obtener rangos de Factus', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async emitirFactura(ventaId: string) {
    const config = await this.getConfig();
    const token = await this.getToken(config);

    const venta = await this.prisma.ventas.findUnique({
      where: { IDventas: ventaId },
      include: {
        ordenVentas: true,
        clienteRelacion: true,
      },
    });

    if (!venta) {
      throw new HttpException('Venta no encontrada', HttpStatus.NOT_FOUND);
    }
    
    const existing = await this.prisma.facturasElectronicas.findUnique({
      where: { ventaId }
    });
    if (existing && existing.estado === 'VALIDADA') {
      throw new HttpException('La venta ya cuenta con una factura electrónica validada', HttpStatus.BAD_REQUEST);
    }

    const numberingRangeId = await this.getNumberingRange(config, token);

    // Mapear Cliente
    let customer: any;
    if (venta.clienteRelacion && venta.clienteRelacion.cedula) {
      customer = {
        identification_document_code: venta.clienteRelacion.tipoDocumento || '13',
        identification: venta.clienteRelacion.cedula.toString(),
        legal_organization_code: '2', // Asumiendo persona natural por defecto a menos que se agregue el campo
        tribute_code: 'ZZ',
        country_code: 'CO',
        responsibilities: [venta.clienteRelacion.responsabilidadTributaria || 'R-99-PN'],
        municipality_code: venta.clienteRelacion.municipio || config.factusMunicipioCodigo,
        names: venta.clienteRelacion.nombre || 'Sin Nombre',
        address: venta.clienteRelacion.direccion || 'Sin Dirección',
        email: venta.clienteRelacion.email || config.factusEmail,
        phone: venta.clienteRelacion.whatsapp || '0000000000',
      };
    } else {
      customer = {
        identification_document_code: '31', // NIT
        identification: '222222222222',
        legal_organization_code: '2',
        names: 'Consumidor Final',
        address: 'N/A',
        tribute_code: 'ZZ',
        country_code: 'CO',
        responsibilities: ['R-99-PN'],
        municipality_code: config.factusMunicipioCodigo,
        email: config.factusEmail,
        phone: '0000000000',
      };
    }

    // Mapear Medios de Pago
    const payment_details = [];
    if (venta.efectivoRecibido && Number(venta.efectivoRecibido) > 0) {
      payment_details.push({
        payment_form: '1', // Contado
        payment_method_code: '10', // Efectivo
        amount: Number(venta.efectivoRecibido).toFixed(2),
      });
    }
    if (venta.valorDeTransferencia && Number(venta.valorDeTransferencia) > 0) {
      payment_details.push({
        payment_form: '1',
        payment_method_code: '42', // Consignación / Transferencia
        amount: Number(venta.valorDeTransferencia).toFixed(2),
      });
    }
    // Si no hay pago definido pero es una venta
    if (payment_details.length === 0 && venta.totalInput) {
       payment_details.push({
        payment_form: '1',
        payment_method_code: '10',
        amount: Number(venta.totalInput).toFixed(2),
      });
    }

    // Mapear Items
    const items = venta.ordenVentas.map(ov => ({
      code_reference: ov.IDorderventas.substring(0, 8),
      name: ov.nombreProducto || ov.nombre || 'Producto Generico',
      quantity: Number(ov.cantidad || 1).toFixed(2),
      price: Number(ov.precio || 0).toFixed(2),
      unit_measure_code: '94', // Unidad
      standard_code: '999', // Adopción contribuyente
      discount_rate: '0.00', // Sin descuento por ahora, o mapear ov.descuento
      taxes: [
        {
          code: '01',
          rate: '0.00' // Sin impuestos como fue solicitado
        }
      ]
    }));

    const body = {
      reference_code: `VTA-${venta.IDventas}`,
      document: '01',
      numbering_range_id: numberingRangeId,
      operation_type: '10',
      observation: `Factura generada desde POS - Venta ${venta.IDventas}`,
      payment_details,
      cash_rounding_amount: '0.00',
      customer,
      items,
    };

    try {
      const baseUrl = this.getBaseUrl(config.factusEntorno);
      const response = await firstValueFrom(
        this.httpService.post(`${baseUrl}/v2/bills/validate`, body, {
          headers: { 
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        })
      );
      
      const data = response.data?.data;
      
      const factura = await this.prisma.facturasElectronicas.upsert({
        where: { ventaId },
        create: {
          ventaId,
          factusId: data.reference_code,
          numeroFactura: data.number,
          cufe: data.cufe,
          qrImage: data.links?.qr,
          pdfUrl: data.links?.public_url,
          estado: data.is_validated ? 'VALIDADA' : 'CREADA_NO_VALIDADA',
          jsonRespuesta: data,
        },
        update: {
          factusId: data.reference_code,
          numeroFactura: data.number,
          cufe: data.cufe,
          qrImage: data.links?.qr,
          pdfUrl: data.links?.public_url,
          estado: data.is_validated ? 'VALIDADA' : 'CREADA_NO_VALIDADA',
          jsonRespuesta: data,
        }
      });
      
      return factura;
    } catch (error: any) {
      const errorData = error?.response?.data || error.message;
      this.logger.error('Error al emitir factura', errorData);
      
      await this.prisma.facturasElectronicas.upsert({
        where: { ventaId },
        create: {
          ventaId,
          estado: 'RECHAZADA',
          jsonRespuesta: errorData,
        },
        update: {
          estado: 'RECHAZADA',
          jsonRespuesta: errorData,
        }
      });
      
      throw new HttpException(
        { message: 'Error al emitir factura con Factus', error: errorData },
        HttpStatus.BAD_REQUEST
      );
    }
  }
}
