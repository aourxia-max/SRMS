import { IsString, Length } from 'class-validator';
export class RejectRefundDto {
  @IsString() @Length(1, 500) reason!: string;
}
