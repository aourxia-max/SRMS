import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ConcessionDto } from './concession.dto';

export class ContractCommissionDto {
  @IsString() @Length(1, 100) recipientName!: string;
  @IsNumberString() amount!: string;
}

export type ContractDraftPayload = {
  externalContractNo?: string;
  roomId?: number;
  primaryTenantId?: number;
  secondaryTenantIds?: number[];
  startDate?: string;
  endDate?: string;
  plannedMoveInDate?: string;
  monthlyRent?: string;
  depositRequired?: string;
  paymentCycleMonths?: number;
  concessions?: ConcessionDto[];
  fileAssetIds?: number[];
  remark?: string;
  commission?: { recipientName: string; amount: string };
};

export class SaveContractDraftDto implements ContractDraftPayload {
  @IsOptional() @IsString() @Length(1, 80) externalContractNo?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) roomId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) primaryTenantId?: number;
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  secondaryTenantIds?: number[];
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsDateString() plannedMoveInDate?: string;
  @IsOptional() @IsNumberString() monthlyRent?: string;
  @IsOptional() @IsNumberString() depositRequired?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  paymentCycleMonths?: number;
  @IsOptional()
  @IsArray()
  @Type(() => ConcessionDto)
  @ValidateNested({ each: true })
  concessions?: ConcessionDto[];
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  fileAssetIds?: number[];
  @IsOptional() @IsString() @Length(1, 1000) remark?: string;
  @IsOptional()
  @Type(() => ContractCommissionDto)
  @ValidateNested()
  commission?: ContractCommissionDto;
}
