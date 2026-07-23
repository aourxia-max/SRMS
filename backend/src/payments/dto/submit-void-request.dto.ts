import { Type } from 'class-transformer';
import { IsInt, IsString, Length, Min } from 'class-validator';
export class SubmitVoidRequestDto {
  @Type(() => Number) @IsInt() @Min(1) paymentId!: number;
  @IsString() @Length(1, 500) reason!: string;
}
