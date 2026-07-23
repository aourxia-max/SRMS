import { IsIn, IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsString() @IsNotEmpty() projectName!: string;
  @IsInt() @Min(1) @Max(90) rentReminderDays!: number;
  @IsInt() @Min(1) @Max(365) contractExpiryDays!: number;
  @IsInt() @Min(1) @Max(365) longVacancyDays!: number;
  @IsString() @IsNotEmpty() receiptPrefix!: string;
  @IsInt() @Min(1) @Max(100) uploadSizeLimitMb!: number;
  @IsIn(['INDIVIDUAL', 'COMPANY']) defaultTenantType!: 'INDIVIDUAL' | 'COMPANY';
  @IsIn(['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY'])
  defaultPaymentCycle!: string;
}
