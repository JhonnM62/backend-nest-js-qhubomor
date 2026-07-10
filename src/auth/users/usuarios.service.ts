import { Injectable, NotFoundException, ConflictException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUsuarioDto, UpdateUsuarioDto, UsuarioQueryDto, ROLES_DISPONIBLES } from './dto/usuario.dto';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AppGateway } from '../../websocket/app.gateway';
import { SocketEvent } from '../../websocket/types/socket.types';

@Injectable()
export class UsuariosService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => AppGateway))
    private readonly appGateway: AppGateway
  ) {}

  async create(createUsuarioDto: CreateUsuarioDto) {
    const existingUser = await this.prisma.usuarios.findFirst({
      where: { email: createUsuarioDto.email },
    });

    if (existingUser) {
      throw new ConflictException('El correo electrónico ya está registrado');
    }

    const validRoles = ROLES_DISPONIBLES.map(r => r.key);
    if (!validRoles.includes(createUsuarioDto.rol)) {
      throw new BadRequestException(`El rol "${createUsuarioDto.rol}" no es válido. Roles válidos: ${validRoles.join(', ')}`);
    }

    const hashedPassword = await bcrypt.hash(createUsuarioDto.password, 10);

    const usuario = await this.prisma.usuarios.create({
      data: {
        ...createUsuarioDto,
        password: hashedPassword,
        isActive: true,
      },
      select: {
        IDusuarios: true,
        nombre: true,
        email: true,
        telefono: true,
        rol: true,
        isActive: true,
        permisos: true,
        createdAt: true,
      },
    });

    return {
      success: true,
      message: 'Usuario creado exitosamente',
      data: usuario,
      credentials: {
        email: createUsuarioDto.email,
        passwordTemporal: createUsuarioDto.password,
      },
    };
  }

  async findAll(query: UsuarioQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;
    const { rol, buscar } = query;

    const where: Prisma.UsuariosWhereInput = {};

    if (rol) {
      where.rol = rol;
    }

    if (buscar) {
      where.OR = [
        { nombre: { contains: buscar, mode: 'insensitive' } },
        { email: { contains: buscar, mode: 'insensitive' } },
      ];
    }

    if (query.soloInactivos === true || String(query.soloInactivos) === 'true') {
      where.isActive = false;
    } else {
      where.isActive = true;
    }

    const [data, total] = await Promise.all([
      this.prisma.usuarios.findMany({
        where,
        skip,
        take: limit,
        orderBy: { nombre: 'asc' },
        select: {
          IDusuarios: true,
          nombre: true,
          email: true,
          cedula: true,
          telefono: true,
          direccion: true,
          rol: true,
          foto: true,
          salario: true,
          propinas: true,
          isActive: true,
          permisos: true,
          cargoId: true,
          tarifaPersonalizada: true,
          geocercaActiva: true,
          esPersonalDePrueba: true,
          cargo: true,
          createdAt: true,
        },
      }),
      this.prisma.usuarios.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPreviousPage: page > 1,
      },
    };
  }

  async findOne(id: string) {
    const usuario = await this.prisma.usuarios.findUnique({
      where: { IDusuarios: id },
      select: {
        IDusuarios: true,
        nombre: true,
        email: true,
        cedula: true,
        telefono: true,
        direccion: true,
        rol: true,
        foto: true,
        salario: true,
        propinas: true,
        isActive: true,
        permisos: true,
        cargoId: true,
        tarifaPersonalizada: true,
        geocercaActiva: true,
        esPersonalDePrueba: true,
        cargo: true,
        createdAt: true,
      },
    });

    if (!usuario) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
    }

    return usuario;
  }

  async update(id: string, updateUsuarioDto: UpdateUsuarioDto) {
    const usuario = await this.prisma.usuarios.findUnique({
      where: { IDusuarios: id },
    });

    if (!usuario) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
    }

    if (updateUsuarioDto.email && updateUsuarioDto.email !== usuario.email) {
      const existingUser = await this.prisma.usuarios.findFirst({
        where: {
          email: updateUsuarioDto.email,
          NOT: { IDusuarios: id },
        },
      });

      if (existingUser) {
        throw new ConflictException('El correo electrónico ya está registrado');
      }
    }

    if (updateUsuarioDto.password) {
      updateUsuarioDto.password = await bcrypt.hash(updateUsuarioDto.password, 10);
    }

    if (updateUsuarioDto.rol) {
      const validRoles = ROLES_DISPONIBLES.map(r => r.key);
      if (!validRoles.includes(updateUsuarioDto.rol)) {
        throw new BadRequestException(`El rol "${updateUsuarioDto.rol}" no es válido`);
      }
    }

    const updatedUser = await this.prisma.usuarios.update({
      where: { IDusuarios: id },
      data: updateUsuarioDto,
    });

    // Notify the specific user about their permission update if permissions changed
    if (updateUsuarioDto.permisos !== undefined) {
      this.appGateway.server.to(`user_${id}`).emit(SocketEvent.USER_PERMISSIONS_UPDATED, {
        userId: id,
        permisos: updatedUser.permisos,
        rol: updatedUser.rol
      });
    }

    return updatedUser;
  }

  async remove(id: string) {
    const usuario = await this.prisma.usuarios.findUnique({
      where: { IDusuarios: id },
    });

    if (!usuario) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
    }

    return this.prisma.usuarios.delete({
      where: { IDusuarios: id },
    });
  }

  async getRoles() {
    return ROLES_DISPONIBLES;
  }
}
