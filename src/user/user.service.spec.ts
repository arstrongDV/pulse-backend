import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UserService', () => {
  let service: UserService;
  const prismaMock = {
    user: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('findAll returns users without passwordHash', async () => {
    const users = [
      {
        id: '1',
        username: 'alice',
        email: 'alice@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    prismaMock.user.findMany.mockResolvedValue(users);

    await expect(service.findAll()).resolves.toEqual(users);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: {}, // Додано об'єкт where
      select: {
        id: true,
        username: true,
        email: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  it('findAll returns only searched users', async () => {
    const searchedUsers = [
      {
        id: '2',
        username: 'bob',
        email: 'bob@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    prismaMock.user.findMany.mockResolvedValue(searchedUsers);

    // Виправлено закриття дужки перед .resolves
    await expect(service.findAll('bo')).resolves.toEqual(searchedUsers);

    // Перевірка, що Prisma отримала правильний деструктурований пошук
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: {
        username: {
          contains: 'bo',
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        username: true,
        email: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });
});
