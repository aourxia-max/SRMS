import { IsString, Length } from 'class-validator';
export class RejectVoidRequestDto {
  @IsString() @Length(1, 500) reason!: string;
}
