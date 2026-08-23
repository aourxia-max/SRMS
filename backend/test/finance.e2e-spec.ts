import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import type { AuthUser } from '../src/auth/auth-user.type';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { RolesGuard } from '../src/authorization/roles.guard';
import { ExportTasksService } from '../src/finance/export-tasks.service';
import { FinanceController } from '../src/finance/finance.controller';
import { FinanceExportService } from '../src/finance/finance-export.service';
import { FinanceService } from '../src/finance/finance.service';

describe('finance overview authorization (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [FinanceController],
      providers: [
        RolesGuard,
        {
          provide: FinanceService,
          useValue: {
            overview: jest
              .fn()
              .mockResolvedValue({ depositBalanceTotal: '10000.00' }),
          },
        },
        { provide: FinanceExportService, useValue: {} },
        { provide: ExportTasksService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const testRequest = context.switchToHttp().getRequest<{
            headers: Record<string, string | string[] | undefined>;
            user?: AuthUser;
          }>();
          const role = testRequest.headers['x-test-role'];
          if (!role) throw new UnauthorizedException('登录状态已失效');
          testRequest.user = {
            id: 1,
            username: 'test-user',
            displayName: '测试用户',
            role: role as UserRole,
          };
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => app.close());

  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/api/finance/overview').expect(401);
  });

  it('rejects an ordinary administrator', async () => {
    await request(app.getHttpServer())
      .get('/api/finance/overview')
      .set('x-test-role', UserRole.ADMIN)
      .expect(403);
  });

  it('returns the deposit balance total to a super administrator', async () => {
    await request(app.getHttpServer())
      .get('/api/finance/overview')
      .set('x-test-role', UserRole.SUPER_ADMIN)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          code: 200,
          message: 'success',
          data: { depositBalanceTotal: '10000.00' },
        });
      });
  });
});
