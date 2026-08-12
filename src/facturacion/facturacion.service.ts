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
      throw new HttpException('Error de autenticación con Factus: Revisa tus credenciales', HttpStatus.BAD_REQUEST);
    }
  }

  private async getNumberingRange(config: any, token: string): Promise<number> {
    try {
      const baseUrl = this.getBaseUrl(config.factusEntorno);
      
      // Intentar primero traer los rangos ya configurados por el usuario
      let data: any[] = [];
      try {
        let response = await firstValueFrom(
          this.httpService.get(`${baseUrl}/v2/numbering-ranges`, {
            headers: { Authorization: `Bearer ${token}` }
          })
        );
        data = response.data?.data || [];
      } catch (err: any) {
        this.logger.warn('Fallo al obtener rangos manuales (puede estar vacío):', err?.response?.data || err.message);
      }
      
      // Si no hay rangos manuales, intentar traer los rangos automáticos de la DIAN asociados al software
      if (!data || data.length === 0) {
        this.logger.log('No se encontraron rangos manuales, intentando obtener los asociados al software (DIAN)...');
        try {
          const dianResponse = await firstValueFrom(
            this.httpService.get(`${baseUrl}/v2/numbering-ranges/dian`, {
              headers: { Authorization: `Bearer ${token}` }
            })
          );
          data = dianResponse.data?.data || [];
        } catch (dianError: any) {
          this.logger.warn('Fallo al obtener rangos de la DIAN:', dianError?.response?.data || dianError.message);
          throw dianError; // Si ambos fallan, propagamos el último error para verlo
        }
      }

      // Dependiendo de cómo Factus envuelva la respuesta, la lista real de rangos puede estar en data, o data.data
      let actualRanges: any[] = [];
      if (Array.isArray(data)) {
        actualRanges = data;
      } else if (data && Array.isArray((data as any).data)) {
        actualRanges = (data as any).data;
      } else if (data) {
        actualRanges = [data];
      }

      if (!actualRanges || actualRanges.length === 0) {
        throw new HttpException('No hay rangos de numeración activos ni asociados al software (Crea uno en Factus o asocia el software en la DIAN)', HttpStatus.BAD_REQUEST);
      }
      
      // Buscar el rango específico para facturas de venta
      // En la DIAN el documento suele llamarse "Factura de Venta"
      let range = actualRanges.find(r => r.document === 'Factura de Venta' || r.document?.toLowerCase().includes('factura'));
      
      // Si no se encuentra uno específico, usamos el primero que tenga ID
      if (!range) {
        range = actualRanges.find(r => r.id || r.numbering_range_id) || actualRanges[0];
      }
      
      const rangeId = range?.id || range?.numbering_range_id;
      
      if (!rangeId) {
         throw new HttpException(`El rango de la DIAN no incluye un ID válido. Respuesta extraida: ${JSON.stringify(range)}`, HttpStatus.BAD_REQUEST);
      }
      return rangeId;
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      const errorMsg = error?.response?.data?.message || JSON.stringify(error?.response?.data) || error.message;
      this.logger.error('Error al obtener rango de numeración', errorMsg);
      throw new HttpException(`Error Factus al obtener rangos: ${errorMsg}`, HttpStatus.BAD_REQUEST);
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
        municipality_code: venta.clienteRelacion.municipio || config.factusMunicipioCodigo || '11001',
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
        municipality_code: config.factusMunicipioCodigo || '11001',
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

  async eliminarFactura(ventaId: string) {
    const config = await this.getConfig();
    const token = await this.getToken(config);

    const factura = await this.prisma.facturasElectronicas.findUnique({
      where: { ventaId }
    });

    if (!factura) {
      throw new HttpException('No hay factura electrónica para esta venta', HttpStatus.NOT_FOUND);
    }

    // Intentar eliminar en Factus si tiene reference_code (factusId)
    if (factura.factusId) {
      try {
        const baseUrl = this.getBaseUrl(config.factusEntorno);
        await firstValueFrom(
          this.httpService.delete(`${baseUrl}/v2/bills/destroy/reference/${factura.factusId}`, {
            headers: { 
              Authorization: `Bearer ${token}`
            }
          })
        );
      } catch (error: any) {
        this.logger.warn(`No se pudo eliminar en Factus (puede estar validada): ${error?.response?.data?.message || error.message}`);
      }
    }

    // Eliminar localmente
    await this.prisma.facturasElectronicas.delete({
      where: { ventaId }
    });

    return { message: 'Factura eliminada localmente (y en Factus si era posible)' };
  }
}
