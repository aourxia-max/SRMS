import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class PropertyAffairVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
