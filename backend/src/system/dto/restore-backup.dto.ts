import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RestoreBackupDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsString() @IsNotEmpty() confirmation!: string;
}
