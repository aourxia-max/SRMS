import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly client?: PrismaClient;

  constructor(config: ConfigService) {
    const databaseUrl = config.get<string>('DATABASE_URL');
    if (!databaseUrl) return;

    const url = new URL(databaseUrl);
    this.client = new PrismaClient({
      adapter: new PrismaMariaDb({
        host: url.hostname,
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.replace(/^\//, ''),
      }),
    });
  }

  get db(): PrismaClient {
    if (!this.client) {
      throw new Error('DATABASE_URL is required for database operations.');
    }
    return this.client;
  }

  async onModuleDestroy() {
    await this.client?.$disconnect();
  }
}
