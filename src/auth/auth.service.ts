import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { RegisterDto, LoginDto, AuthResponseDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
    this.logger.log(`Attempting to register user: ${registerDto.email}`);
    const existingUser = await this.prisma.usuarios.findFirst({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      this.logger.warn(`Registration failed: User with email ${registerDto.email} already exists.`);
      throw new UnauthorizedException('El usuario con este email ya existe');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    const user = await this.prisma.usuarios.create({
      data: {
        nombre: registerDto.nombre,
        email: registerDto.email,
        password: hashedPassword,
        rol: registerDto.rol || 'usuario',
        telefono: registerDto.telefono,
        direccion: registerDto.direccion,
        isActive: true,
      },
    });

    this.logger.log(`User registered successfully: ${user.email} (ID: ${user.IDusuarios})`);

    const payload = { sub: user.IDusuarios, email: user.email || '', rol: user.rol || 'usuario' };
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: user.IDusuarios,
        email: user.email || '',
        nombre: user.nombre || '',
        rol: user.rol || 'usuario',
        permisos: user.permisos,
      },
    };
  }

  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    this.logger.log(`Attempting to login user: ${loginDto.email}`);
    const user = await this.prisma.usuarios.findFirst({
      where: { email: loginDto.email },
    });

    if (!user || !user.password) {
      this.logger.warn(`Login failed: Invalid credentials for email ${loginDto.email}`);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);

    if (!isPasswordValid) {
      this.logger.warn(`Login failed: Invalid password for email ${loginDto.email}`);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (!user.isActive) {
      this.logger.warn(`Login failed: User ${loginDto.email} is inactive`);
      throw new UnauthorizedException('Usuario inactivo');
    }

    this.logger.log(`User logged in successfully: ${user.email}`);

    const payload = { sub: user.IDusuarios, email: user.email || '', rol: user.rol || 'usuario' };
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: user.IDusuarios,
        email: user.email || '',
        nombre: user.nombre || '',
        rol: user.rol || 'usuario',
        permisos: user.permisos,
      },
    };
  }

  async validateUser(userId: string) {
    return this.prisma.usuarios.findUnique({
      where: { IDusuarios: userId },
    });
  }
}
