import { IsString, Length } from 'class-validator';
export class ResetPasswordDto {
  @IsString() @Length(8, 200) password!: string;
}
