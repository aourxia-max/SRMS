import { UserRole, UserStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class UpdateUserDto {
  @IsOptional() @IsString() @Length(1, 50) displayName?: string;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() @IsString() @Length(1, 30) phone?: string | null;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
}
