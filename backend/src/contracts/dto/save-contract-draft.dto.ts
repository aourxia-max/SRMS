import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsNumberString,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
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
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, 80)
  externalContractNo?: string;
  @ValidateIf((_, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomId?: number;
  @ValidateIf((_, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  primaryTenantId?: number;
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  secondaryTenantIds?: number[];
  @ValidateIf((_, value) => value !== undefined)
  @IsDateString()
  startDate?: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsDateString()
  endDate?: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsDateString()
  plannedMoveInDate?: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsNumberString()
  monthlyRent?: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsNumberString()
  depositRequired?: string;
  @ValidateIf((_, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  paymentCycleMonths?: number;
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @Type(() => ConcessionDto)
  @ValidateNested({ each: true })
  concessions?: ConcessionDto[];
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  fileAssetIds?: number[];
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, 1000)
  remark?: string;
  @ValidateIf((_, value) => value !== undefined)
  @Type(() => ContractCommissionDto)
  @ValidateNested()
  commission?: ContractCommissionDto;
}
