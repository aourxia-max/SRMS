import { ExecutionContext, ValidationPipe } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ROLES_KEY } from '../authorization/roles.decorator';
import { RolesGuard } from '../authorization/roles.guard';
import { FilesService } from '../files/files.service';
import { ContractVoidPreviewService } from './contract-void-preview.service';
import { ContractVoidRequestsService } from './contract-void-requests.service';
import { ContractVoidController } from './contract-void.controller';

const admin = {
  id: 2,
  username: 'admin',
  displayName: '\u7ba1\u7406\u5458',
  role: UserRole.ADMIN,
};

describe('ContractVoidController', () => {
  it('excludes visitors from preview/create and admins from rejection', () => {
    const prototype = ContractVoidController.prototype as unknown as Record<
      string,
      object
    >;

    expect(Reflect.getMetadata(PATH_METADATA, prototype.preview)).toBe(
      ':id/void-preview',
    );
    expect(Reflect.getMetadata(ROLES_KEY, prototype.preview)).toEqual([
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, prototype.submit)).toEqual([
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, prototype.reject)).toEqual([
      UserRole.SUPER_ADMIN,
    ]);
  });

  it('wraps request and preview results in the standard envelope', async () => {
    const requests = {
      list: jest.fn().mockResolvedValue([{ id: 9 }]),
      submit: jest.fn().mockResolvedValue({ id: 9 }),
    };
    const previews = {
      preview: jest.fn().mockResolvedValue({ impactHash: 'a' }),
    };
    const controller = Reflect.construct(ContractVoidController, [
      requests,
      previews,
      {},
    ]) as ContractVoidController;

    await expect(controller.list({}, admin)).resolves.toEqual({
      code: 200,
      message: 'success',
      data: [{ id: 9 }],
    });
    await expect(
      controller.submit(
        {
          contractId: 7,
          reason: '\u5f55\u5165\u9519\u8bef',
          impactHash: 'a'.repeat(64),
          idempotencyKey: 'submit-contract-void-0001',
        },
        admin,
      ),
    ).resolves.toEqual({
      code: 200,
      message: 'success',
      data: { id: 9 },
    });
    await expect(controller.preview(7, admin)).resolves.toEqual({
      code: 200,
      message: 'success',
      data: { impactHash: 'a' },
    });
  });
});

describe('ContractVoidController HTTP errors', () => {
  async function createApp(role: UserRole) {
    const requests = {
      list: jest.fn().mockResolvedValue([]),
      detail: jest.fn().mockResolvedValue({}),
      submit: jest.fn().mockResolvedValue({}),
      cancel: jest.fn().mockResolvedValue({}),
      reject: jest.fn().mockResolvedValue({}),
    };
    const module = await Test.createTestingModule({
      controllers: [ContractVoidController],
      providers: [
        { provide: ContractVoidRequestsService, useValue: requests },
        {
          provide: ContractVoidPreviewService,
          useValue: { preview: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: FilesService,
          useValue: { saveContractVoidProof: jest.fn().mockResolvedValue({}) },
        },
        RolesGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest().user = {
            id: 2,
            username: 'test',
            displayName: '测试用户',
            role,
          };
          return true;
        },
      })
      .compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    return { app, requests };
  }

  it('returns a Chinese envelope for invalid submission DTOs', async () => {
    const { app, requests } = await createApp(UserRole.ADMIN);
    try {
      const response = await request(app.getHttpServer())
        .post('/contracts/void-requests')
        .send({
          contractId: 0,
          reason: '',
          impactHash: 'BAD',
          idempotencyKey: '',
        })
        .expect(400);

      expect(response.body).toEqual({
        code: 400,
        message: expect.stringMatching(/[\u4e00-\u9fff]/),
        data: null,
      });
      expect(requests.submit).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each(['not-a-number', '9007199254740992', '999999999999999999999999'])(
    'returns a Chinese envelope for invalid positive path id %s',
    async (invalidId) => {
      const { app } = await createApp(UserRole.ADMIN);
      try {
        const response = await request(app.getHttpServer())
          .get(`/contracts/${invalidId}/void-preview`)
          .expect(400);
        expect(response.body).toEqual({
          code: 400,
          message: '编号必须为正整数',
          data: null,
        });
      } finally {
        await app.close();
      }
    },
  );

  it('returns the required envelope for role permission errors', async () => {
    const { app } = await createApp(UserRole.VISITOR);
    try {
      const response = await request(app.getHttpServer())
        .get('/contracts/7/void-preview')
        .expect(403);
      expect(response.body).toEqual({
        code: 403,
        message: '无权访问此资源',
        data: null,
      });
    } finally {
      await app.close();
    }
  });
});
