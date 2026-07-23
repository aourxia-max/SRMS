import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters';
    process.env.JWT_REFRESH_SECRET =
      'test-refresh-secret-at-least-32-characters';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  it('/api/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 200,
          message: 'success',
          data: { service: 'srms-api', status: 'ok' },
        });
      });
  });

  it('/api/auth/me rejects an unauthenticated request', () => {
    return request(app.getHttpServer()).get('/api/auth/me').expect(401);
  });

  it('/api/properties/rooms rejects an unauthenticated request', () => {
    return request(app.getHttpServer())
      .get('/api/properties/rooms')
      .expect(401);
  });

  it('/api/contracts change endpoints reject unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .get('/api/contracts/1/changes')
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/contracts/1/changes')
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/contracts/changes/1/approve')
      .expect(401);
  });

  it('/api/payments endpoints reject unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/api/payments').expect(401);
    await request(app.getHttpServer())
      .get('/api/payments/prepayments')
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/payments')
      .send({})
      .expect(401);
  });

  it('/api Task008 endpoints reject unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .post('/api/bill-adjustments')
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/payment-refunds')
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/payment-void-requests')
      .send({})
      .expect(401);
  });

  afterEach(async () => {
    await app.close();
  });
});
