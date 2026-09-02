import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class PropertyAffairVersionDto {
  @Type(() => Number)
  @IsInt({ message: '版本号必须为整数' })
  @Min(1, { message: '版本号必须为正整数' })
  version!: number;
}
