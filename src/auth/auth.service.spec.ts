import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;

  const userServiceMock = {
    findByIdentifier: jest.fn(),
    create: jest.fn(),
  };
  const prismaMock = {
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const jwtServiceMock = {
    signAsync: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: userServiceMock },
        { provide: PrismaService, useValue: prismaMock },
        { provide: JwtService, useValue: jwtServiceMock },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    jest.clearAllMocks();
    jwtServiceMock.signAsync.mockResolvedValue('signed.access.token');
    prismaMock.refreshToken.create.mockResolvedValue({
      id: 'token-id',
      userId: 'user-1',
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    it('throws Unauthorized when no user matches the identifier', async () => {
      userServiceMock.findByIdentifier.mockResolvedValue(null);

      await expect(
        service.login({
          identifier: 'nobody@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws Unauthorized when the password does not match', async () => {
      const passwordHash = await argon2.hash('correct-password');
      userServiceMock.findByIdentifier.mockResolvedValue({
        id: 'user-1',
        username: 'alice',
        email: 'alice@example.com',
        passwordHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(
        service.login({
          identifier: 'alice@example.com',
          password: 'wrong-password',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns user + tokens when credentials are valid', async () => {
      const passwordHash = await argon2.hash('correct-password');
      userServiceMock.findByIdentifier.mockResolvedValue({
        id: 'user-1',
        username: 'alice',
        email: 'alice@example.com',
        passwordHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.login({
        identifier: 'alice@example.com',
        password: 'correct-password',
      });

      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.accessToken).toBe('signed.access.token');
      expect(result.refreshToken).toMatch(/^token-id\./);
    });
  });

  describe('signUp', () => {
    it('creates the user then returns user + tokens', async () => {
      userServiceMock.create.mockResolvedValue({
        id: 'user-2',
        username: 'bob',
        email: 'bob@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.register({
        username: 'bob',
        email: 'bob@example.com',
        password: 'Password123',
      });

      expect(userServiceMock.create).toHaveBeenCalled();
      expect(result.user.username).toBe('bob');
      expect(result.accessToken).toBe('signed.access.token');
    });
  });

  describe('refresh', () => {
    it('throws Unauthorized when the token is malformed', async () => {
      await expect(service.refresh('not-a-valid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws Unauthorized when the token does not exist', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh('token-id.secret')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws Unauthorized when the token is revoked or expired', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: 'token-id',
        userId: 'user-1',
        tokenHash: await argon2.hash('secret'),
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      await expect(service.refresh('token-id.secret')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rotates the token and returns a new pair when valid', async () => {
      const tokenHash = await argon2.hash('secret');
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: 'token-id',
        userId: 'user-1',
        tokenHash,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      prismaMock.refreshToken.update.mockResolvedValue({});

      const result = await service.refresh('token-id.secret');

      expect(prismaMock.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'token-id' },
        data: { revokedAt: expect.any(Date) as Date },
      });
      expect(result.accessToken).toBe('signed.access.token');
      expect(result.refreshToken).toMatch(/^token-id\./);
    });
  });

  describe('logout', () => {
    it('resolves silently when the token is malformed', async () => {
      await expect(
        service.logout('not-a-valid-token'),
      ).resolves.toBeUndefined();
      expect(prismaMock.refreshToken.update).not.toHaveBeenCalled();
    });

    it('resolves silently when the token does not exist', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.logout('token-id.secret')).resolves.toBeUndefined();
      expect(prismaMock.refreshToken.update).not.toHaveBeenCalled();
    });

    it('resolves silently when the token is already revoked', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: 'token-id',
        userId: 'user-1',
        tokenHash: await argon2.hash('secret'),
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      await expect(service.logout('token-id.secret')).resolves.toBeUndefined();
      expect(prismaMock.refreshToken.update).not.toHaveBeenCalled();
    });

    it('revokes the token when it is valid', async () => {
      const tokenHash = await argon2.hash('secret');
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: 'token-id',
        userId: 'user-1',
        tokenHash,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      prismaMock.refreshToken.update.mockResolvedValue({});

      await service.logout('token-id.secret');

      expect(prismaMock.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'token-id' },
        data: { revokedAt: expect.any(Date) as Date },
      });
    });

    it('does not revoke when the secret does not match', async () => {
      const tokenHash = await argon2.hash('secret');
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: 'token-id',
        userId: 'user-1',
        tokenHash,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      await service.logout('token-id.wrong-secret');

      expect(prismaMock.refreshToken.update).not.toHaveBeenCalled();
    });
  });
});
