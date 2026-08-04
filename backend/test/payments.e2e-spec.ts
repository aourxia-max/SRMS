import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { RolesGuard } from '../src/authorization/roles.guard';
import { FilesService } from '../src/files/files.service';
import { PaymentsController } from '../src/payments/payments.controller';
import { PaymentsService } from '../src/payments/payments.service';

describe('payments API authorization (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: {} },
        { provide: FilesService, useValue: {} },
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
});
