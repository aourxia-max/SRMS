import { TenantStatus, TenantType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class UpdateTenantDto {
  @IsOptional() @IsEnum(TenantType) tenantType?: TenantType;
  @IsOptional() @IsString() @Length(1, 100) name?: string;
  @IsOptional() @IsString() @Length(1, 30) phone?: string;
  @IsOptional() @IsString() @Length(1, 50) idType?: string;
  @IsOptional() @IsString() @Length(1, 100) idNo?: string;
  @IsOptional() @IsString() @Length(1, 300) contactAddress?: string;
  @IsOptional() @IsEnum(TenantStatus) status?: TenantStatus;
  @IsOptional() @IsString() @Length(1, 500) remark?: string;
}
