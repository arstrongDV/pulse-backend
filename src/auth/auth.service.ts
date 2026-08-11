import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from '../user/user.service';
import { AuthPayloadDto } from './dto/auth.dto';
import { CreateUserPayloadDto } from '../user/dto/create-user.dto';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface SafeUser {
  id: string;
  username: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(payload: AuthPayloadDto) {
    const user = await this.userService.findByIdentifier(payload.identifier);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await argon2.verify(
      user.passwordHash,
      payload.password,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.buildAuthResponse(user);
  }

  async register(payload: CreateUserPayloadDto) {
    const user = await this.userService.create(payload);
    return this.buildAuthResponse(user);
  }

  async refresh(refreshToken: string) {
    const storedToken = await this.validateRefreshToken(refreshToken);
    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Rotation: this refresh token can only be used once.
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(storedToken.userId);
  }

  async logout(refreshToken: string) {
    const storedToken = await this.validateRefreshToken(refreshToken);
    if (!storedToken) {
      // Already invalid/expired/revoked — logout is idempotent either way.
      return;
    }

    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });
  }

  private async validateRefreshToken(refreshToken: string) {
    const [tokenId, secret] = refreshToken.split('.');
    if (!tokenId || !secret) {
      return null;
    }

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { id: tokenId },
    });

    if (
      !storedToken ||
      storedToken.revokedAt ||
      storedToken.expiresAt < new Date()
    ) {
      return null;
    }

    const secretMatches = await argon2.verify(storedToken.tokenHash, secret);
    return secretMatches ? storedToken : null;
  }

  private async buildAuthResponse(user: SafeUser) {
    const tokens = await this.issueTokens(user.id);
    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      ...tokens,
    };
  }

  private async issueTokens(userId: string) {
    const accessToken = await this.jwtService.signAsync({ sub: userId });

    const refreshSecret = randomBytes(32).toString('base64url');
    const tokenHash = await argon2.hash(refreshSecret);

    const refreshTokenRow = await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return {
      accessToken,
      refreshToken: `${refreshTokenRow.id}.${refreshSecret}`,
    };
  }
}
