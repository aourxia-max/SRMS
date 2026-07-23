import { IsString, Length } from 'class-validator';
export class RejectContractChangeDto {
  @IsString() @Length(1, 500) reason!: string;
}
