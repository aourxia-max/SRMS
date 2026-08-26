import { ContractVoidRequestStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

export class ListContractVoidRequestsDto {
  @IsOptional()
  @IsEnum(ContractVoidRequestStatus)
  status?: ContractVoidRequestStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  contractId?: number;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  contractNo?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  roomKeyword?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  tenantKeyword?: string;
}

export class SubmitContractVoidRequestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  contractId!: number;

  @IsString()
  @Length(1, 500)
  reason!: string;

  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  impactHash!: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  fileAssetIds?: number[];

  @IsString()
  @Length(16, 100)
  idempotencyKey!: string;
}

export class RejectContractVoidRequestDto {
  @IsString()
  @Length(1, 500)
  reason!: string;
}
