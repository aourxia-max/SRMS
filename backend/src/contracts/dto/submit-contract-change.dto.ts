import {
  IsDateString,
  IsIn,
  IsObject,
  IsString,
  Length,
} from 'class-validator';

export const CONTRACT_CHANGE_TYPES = [
  'RENT',
  'TERM',
  'PRIMARY_TENANT',
  'CONCESSION',
] as const;

export class SubmitContractChangeDto {
  @IsIn(CONTRACT_CHANGE_TYPES)
  changeType!: (typeof CONTRACT_CHANGE_TYPES)[number];
  @IsDateString() effectiveDate!: string;
  @IsObject() afterSnapshot!: Record<string, unknown>;
  @IsString() @Length(1, 500) reason!: string;
}
