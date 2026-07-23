import { IsString, Length } from 'class-validator';
export class RejectAdjustmentDto {
  @IsString() @Length(1, 500) reason!: string;
}
