import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
export class HideLogDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}
