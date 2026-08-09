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
import { PricingTierDto } from './pricing-tier.dto';
import { ConcessionDto } from './concession.dto';
import { ContractCommissionDto } from './save-contract-draft.dto';

export class CreateFixedContractDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, 80)
  externalContractNo?: string;
  @Type(() => Number) @IsInt() roomId!: number;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsDateString()
  plannedMoveInDate?: string;
  @IsNumberString() monthlyRent!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(12) paymentCycleMonths = 1;
  @IsNumberString() depositRequired = '0';
  @Type(() => Number) @IsInt() primaryTenantId!: number;
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  secondaryTenantIds?: number[];
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

export class CreateTieredContractDto extends CreateFixedContractDto {
  @IsArray()
  @Type(() => PricingTierDto)
  @ValidateNested({ each: true })
  tiers!: PricingTierDto[];
}
