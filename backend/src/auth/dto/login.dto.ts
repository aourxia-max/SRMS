import { IsString, Length } from 'class-validator';

export class LoginDto {
  @IsString()
  @Length(1, 50)
  username!: string;

  @IsString()
  @Length(1, 200)
  password!: string;
}
