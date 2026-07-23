import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth() {
    return {
      code: 200,
      message: 'success',
      data: {
        service: 'srms-api',
        status: 'ok',
        timestamp: new Date().toISOString(),
      },
    };
  }
}
