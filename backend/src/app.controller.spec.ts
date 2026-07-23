import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should report a healthy service', () => {
      expect(appController.getHealth()).toMatchObject({
        code: 200,
        message: 'success',
        data: { service: 'srms-api', status: 'ok' },
      });
    });
  });
});
