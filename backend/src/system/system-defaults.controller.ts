import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SystemService } from './system.service';

@Controller('system')
export class SystemDefaultsController {
  constructor(private readonly system: SystemService) {}

  @Get('defaults')
  @UseGuards(JwtAuthGuard)
  async defaults() {
    return {
      code: 200,
      message: 'success',
      data: await this.system.businessDefaults(),
    };
  }

  @Get('public')
  async publicInfo() {
    return {
      code: 200,
      message: 'success',
      data: await this.system.publicInfo(),
    };
  }
}
