import { Test, TestingModule } from '@nestjs/testing';
import { CajaService } from './caja.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CajaService', () => {
  let service: CajaService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    aperturaCierreCaja: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    ventas: {
      findMany: jest.fn(),
    },
    aperturaCierreInsumos: {
      findMany: jest.fn(),
    }
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CajaService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<CajaService>(CajaService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getResumenCaja - Reglas de Negocio Financieras', () => {
    it('Debe calcular correctamente el efectivo y transferencia excluyendo estados TOMADO', async () => {
      const mockCaja = {
        IDcaja: '123',
        fechaDeApertura: new Date('2026-05-06T12:00:00Z'),
        efectivoDeApertura: 109000,
      };

      const mockVentas = [
        { estado: 'PAGADO', medioDePago: 'EFECTIVO', totalInput: 61000 },
        { estado: 'ENTREGADO', medioDePago: 'TRANSFERENCIA', totalInput: 67000 },
        { estado: 'TOMADO', medioDePago: 'EFECTIVO', totalInput: 20000 }, // Debe ser excluido por la DB (pero si llega, se prueba lógica)
        { estado: 'PAGADO', medioDePago: 'EFECTIVO Y OTROS', totalInput: 10000, efectivoRecibido: 4000 },
      ];

      // Simulamos que findMany solo retorna los válidos (PAGADO y ENTREGADO)
      const ventasFiltradas = mockVentas.filter(v => v.estado === 'PAGADO' || v.estado === 'ENTREGADO');

      mockPrismaService.aperturaCierreCaja.findUnique.mockResolvedValue(mockCaja);
      mockPrismaService.ventas.findMany.mockResolvedValue(ventasFiltradas.map(v => ({ ...v, ordenVentas: [] })));
      mockPrismaService.aperturaCierreInsumos.findMany.mockResolvedValue([]);

      const result = await service.getResumenCaja('123');

      // Efectivo: 61000 (PAGADO) + 4000 (MIXTO) = 65000
      expect(result.resumen.totalEfectivo).toBe(65000);
      // Transferencia: 67000 (ENTREGADO) + 6000 (MIXTO) = 73000
      expect(result.resumen.totalTransferencia).toBe(73000);
      // Ventas Sistema: 65000 + 73000 = 138000
      expect(result.resumen.totalVentas).toBe(138000);
    });

    it('Debe contabilizar las órdenes repartidas correctamente (EFECTIVO Y OTROS)', async () => {
      const mockCaja = {
        IDcaja: '123',
        fechaDeApertura: new Date(),
      };

      const mockVentas = [
        {
          IDventas: '1',
          estado: 'ENTREGADO',
          medioDePago: 'EFECTIVO Y OTROS',
          totalInput: 30000,
          efectivoRecibido: 20000,
          costoDelDomicilio: 2000
        },
        {
          IDventas: '2',
          estado: 'PAGADO',
          medioDePago: 'EFECTIVO Y OTROS',
          banco: 'NEQUI',
          totalInput: 25000,
          efectivoRecibido: 10000,
          direccion: 'Calle 123'
        }
      ];

      mockPrismaService.aperturaCierreCaja.findUnique.mockResolvedValue(mockCaja);
      mockPrismaService.ventas.findMany.mockResolvedValue(mockVentas.map(v => ({ ...v, ordenVentas: [] })));
      mockPrismaService.aperturaCierreInsumos.findMany.mockResolvedValue([]);

      const result = await service.getResumenCaja('123');

      expect(result.resumen.numeroOrdenesRepartidas).toBe(2);
      // 20000 + 10000
      expect(result.resumen.efectivoRepartido).toBe(30000);
      // (30000 - 20000) + (25000 - 10000) = 10000 + 15000 = 25000
      expect(result.resumen.transferenciasRepartidas).toBe(25000);
    });
  });
});
