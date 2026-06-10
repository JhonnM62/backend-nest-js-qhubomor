import {
  Controller, Get, Post, Patch, Delete, Body, Param,
  Query, UseGuards, UseInterceptors, UploadedFile,
  BadRequestException, Request
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { join } from 'path';
import * as fs from 'fs';
import sharp from 'sharp';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { NominaService } from './nomina.service';
import {
  RegistrarEntradaDto, RegistrarSalidaDto, UpdateTurnoAdminDto, TurnosQueryDto,
  CreateDescuentoDto, RepartirDescuentoDto, UpdateDescuentoDto, DescuentosQueryDto,
  LiquidarEmpleadoDto
} from './dto/nomina.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

const ROLES_ADMIN = ['Admin app', 'Admin negocio', 'Jefe'];

@ApiTags('Nómina y Asistencia')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('nomina')
export class NominaController {
  constructor(private readonly nominaService: NominaService) {}

  // ─── TURNOS ───────────────────────────────────────────────────────────────

  @Post('turno/entrada')
  @ApiOperation({ summary: 'Registrar entrada del empleado (check-in con foto y GPS)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('foto', {
    storage: memoryStorage(),
    fileFilter: (req, file, cb) => {
      if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
        return cb(new BadRequestException('Solo se permiten imágenes JPG, PNG o WebP'), false);
      }
      cb(null, true);
    },
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  }))
  async registrarEntrada(
    @Request() req: any,
    @Body() dto: RegistrarEntradaDto,
    @UploadedFile() foto?: Express.Multer.File,
  ) {
    let fotoPath: string | undefined;

    if (foto) {
      const isProd = process.env.NODE_ENV === 'production';
      const destFolder = isProd ? '/app/public/uploads/asistencia' : './public/uploads/asistencia';
      if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });

      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const finalFilename = `${uniqueSuffix}.jpg`;
      const filePath = join(destFolder, finalFilename);

      // Comprimir foto de selfie (menor resolución, más comprimida)
      await sharp(foto.buffer)
        .resize({ width: 600, withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toFile(filePath);

      fotoPath = `/uploads/asistencia/${finalFilename}`;
    }

    return this.nominaService.registrarEntrada(req.user.id, dto, fotoPath);
  }

  @Patch('turno/:id/salida')
  @ApiOperation({ summary: 'Registrar salida del turno. Campo "ceno" es OBLIGATORIO.' })
  @UseInterceptors(FileInterceptor('foto', {
    fileFilter: (req, file, cb) => {
      if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
        return cb(new BadRequestException('Solo se permiten imágenes JPG, PNG o WebP'), false);
      }
      cb(null, true);
    },
    limits: { fileSize: 15 * 1024 * 1024 },
  }))
  async registrarSalida(
    @Param('id') id: string,
    @Body() dto: RegistrarSalidaDto,
    @Request() req: any,
    @UploadedFile() foto?: Express.Multer.File,
  ) {
    let fotoPath: string | undefined;

    if (foto) {
      const isProd = process.env.NODE_ENV === 'production';
      const destFolder = isProd ? '/app/public/uploads/asistencia' : './public/uploads/asistencia';
      if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });

      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const finalFilename = `${uniqueSuffix}_out.jpg`;
      const filePath = join(destFolder, finalFilename);

      await sharp(foto.buffer)
        .resize({ width: 600, withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toFile(filePath);

      fotoPath = `/uploads/asistencia/${finalFilename}`;
    }

    const esAdmin = ROLES_ADMIN.includes(req.user.rol);
    return this.nominaService.registrarSalida(id, dto, req.user.id, esAdmin, fotoPath);
  }

  @Get('turno/activo-hoy')
  @ApiOperation({ summary: 'Verificar si el empleado tiene turno activo hoy' })
  turnoActivoHoy(@Request() req: any) {
    return this.nominaService.getTurnoActivoDelDia(req.user.id);
  }

  @Get('turnos')
  @UseGuards(RolesGuard)
  @Roles(...ROLES_ADMIN)
  @ApiOperation({ summary: '(Admin) Listar todos los turnos con filtros' })
  getTurnos(@Query() query: TurnosQueryDto) {
    return this.nominaService.getTurnos(query);
  }

  @Get('mis-turnos')
  @ApiOperation({ summary: 'Mis turnos (empleado autenticado)' })
  getMisTurnos(@Request() req: any, @Query() query: TurnosQueryDto) {
    return this.nominaService.getMisTurnos(req.user.id, query);
  }

  @Get('turno/:id')
  @ApiOperation({ summary: 'Detalle de un turno' })
  getTurno(@Param('id') id: string) {
    return this.nominaService.getTurno(id);
  }

  @Patch('turno/:id')
  @UseGuards(RolesGuard)
  @Roles(...ROLES_ADMIN)
  @ApiOperation({ summary: '(Admin) Editar turno manualmente' })
  updateTurno(@Param('id') id: string, @Body() dto: UpdateTurnoAdminDto) {
    return this.nominaService.updateTurnoAdmin(id, dto);
  }

  // ─── DESCUENTOS ───────────────────────────────────────────────────────────

  @Post('descuento')
  @UseGuards(RolesGuard)
  @Roles(...ROLES_ADMIN)
  @ApiOperation({ summary: '(Admin) Crear descuento individual' })
  createDescuento(@Body() dto: CreateDescuentoDto, @Request() req: any) {
    return this.nominaService.createDescuento(dto, req.user.nombre);
  }

  @Post('descuento/repartir')
  @UseGuards(RolesGuard)
  @Roles(...ROLES_ADMIN)
  @ApiOperation({ summary: '(Admin) Repartir descuento equitativamente entre N empleados' })
  repartirDescuento(@Body() dto: RepartirDescuentoDto, @Request() req: any) {
    return this.nominaService.repartirDescuento(dto, req.user.nombre);
  }

  @Get('descuentos')
  @UseGuards(RolesGuard)
  @Roles(...ROLES_ADMIN)
  @ApiOperation({ summary: '(Admin) Listar todos los descuentos' })
  getDescuentos(@Query() query: DescuentosQueryDto) {
    return this.nominaService.getDescuentos(query);
  }

  @Get('mis-descuentos')
  @ApiOperation({ summary: 'Mis descuentos (empleado autenticado)' })
  getMisDescuentos(@Request() req: any, @Query() query: DescuentosQueryDto) {
    return this.nominaService.getMisDescuentos(req.user.id, query);
  }

  @Patch('descuento/:id/visto')
  @ApiOperation({ summary: 'Empleado marca un descuento como visto (confirmación de lectura)' })
  marcarVisto(@Param('id') id: string, @Request() req: any) {
    return this.nominaService.marcarDescuentoVisto(id, req.user.id);
  }

  @Patch('descuento/:id')
  @UseGuards(RolesGuard)
  @Roles(...ROLES_ADMIN)
  @ApiOperation({ summary: '(Admin) Editar/aprobar un descuento' })
  updateDescuento(@Param('id') id: string, @Body() dto: UpdateDescuentoDto) {
    return this.nominaService.updateDescuento(id, dto);
  }

  @Delete('descuento/:id')
  @UseGuards(RolesGuard)
  @Roles(...ROLES_ADMIN)
  @ApiOperation({ summary: '(Admin) Eliminar un descuento' })
  deleteDescuento(@Param('id') id: string) {
    return this.nominaService.deleteDescuento(id);
  }

  // ─── RESUMEN ──────────────────────────────────────────────────────────────

  @Get('resumen/mio')
  @ApiOperation({ summary: 'Resumen de nómina del empleado autenticado' })
  getMiResumen(
    @Request() req: any,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    return this.nominaService.getResumenEmpleado(req.user.id, fechaDesde, fechaHasta);
  }

  @Get('resumen/:usuarioId')
  @UseGuards(RolesGuard)
  @Roles(...ROLES_ADMIN)
  @ApiOperation({ summary: '(Admin) Resumen de nómina de un empleado específico' })
  getResumenEmpleado(
    @Param('usuarioId') usuarioId: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    return this.nominaService.getResumenEmpleado(usuarioId, fechaDesde, fechaHasta);
  }

  // ─── LIQUIDACIONES ────────────────────────────────────────────────────────

  @Post('liquidar')
  @UseGuards(RolesGuard)
  @Roles(...ROLES_ADMIN)
  @ApiOperation({ summary: '(Admin) Generar liquidación para un empleado en un período' })
  liquidar(@Body() dto: LiquidarEmpleadoDto, @Request() req: any) {
    return this.nominaService.liquidarEmpleado(dto, req.user.nombre);
  }

  @Get('liquidaciones')
  @UseGuards(RolesGuard)
  @Roles(...ROLES_ADMIN)
  @ApiOperation({ summary: '(Admin) Listar liquidaciones' })
  getLiquidaciones(
    @Query('usuarioId') usuarioId?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.nominaService.getLiquidaciones(usuarioId, page, limit);
  }

  @Get('liquidaciones/:id')
  @ApiOperation({ summary: 'Detalle de una liquidación' })
  getLiquidacion(@Param('id') id: string) {
    return this.nominaService.getLiquidacion(id);
  }

  @Patch('liquidaciones/:id/pagar')
  @UseGuards(RolesGuard)
  @Roles(...ROLES_ADMIN)
  @ApiOperation({ summary: '(Admin) Marcar liquidación como PAGADA' })
  marcarPagada(@Param('id') id: string) {
    return this.nominaService.marcarLiquidacionPagada(id);
  }
}
