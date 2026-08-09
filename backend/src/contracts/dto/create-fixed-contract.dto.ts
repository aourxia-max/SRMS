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
import { PricingTierDto } from './pricing-tier.dto';
import { ConcessionDto } from './concession.dto';
import { ContractCommissionDto } from './save-contract-draft.dto';

export class CreateFixedContractDto {
  @IsOptional() @IsString() @Length(1, 80) externalContractNo?: string;
  @Type(() => Number) @IsInt() roomId!: number;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @IsDateString() plannedMoveInDate?: string;
  @IsNumberString() monthlyRent!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(12) paymentCycleMonths = 1;
  @IsNumberString() depositRequired = '0';
  @Type(() => Number) @IsInt() primaryTenantId!: number;
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  secondaryTenantIds?: number[];
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

export class CreateTieredContractDto extends CreateFixedContractDto {
  @IsArray()
  @Type(() => PricingTierDto)
  @ValidateNested({ each: true })
  tiers!: PricingTierDto[];
}
