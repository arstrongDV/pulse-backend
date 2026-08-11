import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserPayloadDto } from './dto/create-user.dto';
import * as argon2 from 'argon2';
import { contains } from 'class-validator';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(search?: string) {
    const cleanSearch = search?.replace(/^@/, '').trim();

    return this.prisma.user.findMany({
      where: cleanSearch ? {
        username: {
          contains: cleanSearch,
          mode: 'insensitive',
        }
      } : {},
      select: {
        id: true,
        username: true,
        email: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  findByIdentifier(identifier: string) {
    return this.prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: identifier, mode: 'insensitive' } },
          { username: { equals: identifier, mode: 'insensitive' } },
        ],
      },
    });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async create(payload: CreateUserPayloadDto) {
    const passwordHash = await argon2.hash(payload.password);

    try {
      const newUser = await this.prisma.user.create({
        data: {
          username: payload.username,
          email: payload.email,
          passwordHash,
        },
      });

      return {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        avatarUrl: newUser.avatarUrl,
        createdAt: newUser.createdAt,
        updatedAt: newUser.updatedAt,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('User already exists');
      }
      throw error;
    }
  }
}
