import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class PricingTierDto {
  @IsString() @Length(1, 50) tierName!: string;
  @Type(() => Number) @IsInt() @Min(0) thresholdMonths!: number;
  @IsNumberString() monthlyRent!: string;
  @IsOptional() @IsBoolean() requiresFullyPaid = true;
}
