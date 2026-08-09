import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNumberString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ConcessionDto } from './concession.dto';

export class PreviewFixedContractDto {
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsNumberString() monthlyRent!: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @Type(() => ConcessionDto)
  @ValidateNested({ each: true })
  concessions?: ConcessionDto[];
}
