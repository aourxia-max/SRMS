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

export class CreateFixedContractDto {
  @IsString() @Length(1, 40) contractNo!: string;
  @Type(() => Number) @IsInt() roomId!: number;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
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
}

export class CreateTieredContractDto extends CreateFixedContractDto {
  @IsArray()
  @Type(() => PricingTierDto)
  @ValidateNested({ each: true })
  tiers!: PricingTierDto[];
}
