import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { TenantsController } from './tenants.controller';
import { TenantCryptoService } from './tenant-crypto.service';
import { TenantsService } from './tenants.service';

@Module({
  imports: [FilesModule],
  controllers: [TenantsController],
  providers: [TenantsService, TenantCryptoService],
})
export class TenantsModule {}
