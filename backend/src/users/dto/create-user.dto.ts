import { UserRole } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class CreateUserDto {
  @IsString() @Length(1, 50) username!: string;
  @IsString() @Length(1, 50) displayName!: string;
  @IsEnum(UserRole) role!: UserRole;
  @IsOptional() @IsString() @Length(1, 30) phone?: string;
  @IsString() @Length(8, 200) password!: string;
}
