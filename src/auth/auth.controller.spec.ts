import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  const authServiceMock = {
    login: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authServiceMock }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('login delegates to AuthService', async () => {
    const result = { id: '1', username: 'alice', email: 'alice@example.com' };
    authServiceMock.login.mockResolvedValue(result);

    const payload = {
      identifier: 'alice@example.com',
      password: 'password123',
    };
    await expect(controller.login(payload)).resolves.toEqual(result);
    expect(authServiceMock.login).toHaveBeenCalledWith(payload);
  });
});
