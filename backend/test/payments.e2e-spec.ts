import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { RolesGuard } from '../src/authorization/roles.guard';
import { ContractLifecycleService } from '../src/contracts/contract-lifecycle.service';
import { FilesService } from '../src/files/files.service';
import { PaymentsController } from '../src/payments/payments.controller';
import { PaymentsService } from '../src/payments/payments.service';
import { PaymentReviewsController } from '../src/payments/payment-reviews.controller';
import { PaymentReviewsService } from '../src/payments/payment-reviews.service';

describe('payments API authorization (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [PaymentsController, PaymentReviewsController],
      providers: [
        { provide: PaymentsService, useValue: {} },
        { provide: FilesService, useValue: {} },
        { provide: ContractLifecycleService, useValue: { run: jest.fn() } },
        { provide: PaymentReviewsService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: () => {
          throw new UnauthorizedException();
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => app.close());

  it('protects payment proof upload and download', async () => {
    await request(app.getHttpServer())
      .post('/api/payments/proof-files')
      .attach('file', Buffer.from('proof'), 'proof.png')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/payments/81/files/31')
      .expect(401);
  });

  it('protects payment detail and printable receipt data', async () => {
    await request(app.getHttpServer()).get('/api/payments/81').expect(401);
    await request(app.getHttpServer())
      .get('/api/payments/81/receipt')
      .expect(401);
  });

  it('protects payment correction', async () => {
    await request(app.getHttpServer())
      .patch('/api/payments/81')
      .send({ amount: '600.00', editReason: '修正金额' })
      .expect(401);
  });

  it('protects the unified payment review queue and detail', async () => {
    await request(app.getHttpServer()).get('/api/payment-reviews').expect(401);
    await request(app.getHttpServer())
      .get('/api/payment-reviews/REFUND/201')
      .expect(401);
  });
});
