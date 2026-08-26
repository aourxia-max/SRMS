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
  @IsEnum(ContractVoidRequestStatus, { message: '申请状态无效' })
  status?: ContractVoidRequestStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '合同编号必须为整数' })
  @Min(1, { message: '合同编号必须为正整数' })
  contractId?: number;

  @IsOptional()
  @IsString({ message: '合同号必须为文本' })
  @Length(1, 100, { message: '合同号长度必须为1至100个字符' })
  contractNo?: string;

  @IsOptional()
  @IsString({ message: '房号关键词必须为文本' })
  @Length(1, 100, { message: '房号关键词长度必须为1至100个字符' })
  roomKeyword?: string;

  @IsOptional()
  @IsString({ message: '承租人关键词必须为文本' })
  @Length(1, 100, { message: '承租人关键词长度必须为1至100个字符' })
  tenantKeyword?: string;
}

export class SubmitContractVoidRequestDto {
  @Type(() => Number)
  @IsInt({ message: '合同编号必须为整数' })
  @Min(1, { message: '合同编号必须为正整数' })
  contractId!: number;

  @IsString({ message: '作废原因必须为文本' })
  @Length(1, 500, { message: '作废原因长度必须为1至500个字符' })
  reason!: string;

  @IsString({ message: '影响摘要哈希必须为文本' })
  @Matches(/^[0-9a-f]{64}$/, { message: '影响摘要哈希格式无效' })
  impactHash!: string;

  @IsOptional()
  @IsArray({ message: '证明附件编号必须为数组' })
  @ArrayUnique({ message: '证明附件编号不能重复' })
  @IsInt({ each: true, message: '证明附件编号必须为整数' })
  @Min(1, { each: true, message: '证明附件编号必须为正整数' })
  fileAssetIds?: number[];

  @IsString({ message: '提交幂等键必须为文本' })
  @Length(16, 100, { message: '提交幂等键长度必须为16至100个字符' })
  idempotencyKey!: string;
}

export class RejectContractVoidRequestDto {
  @IsString({ message: '驳回原因必须为文本' })
  @Length(1, 500, { message: '驳回原因长度必须为1至500个字符' })
  reason!: string;
}
