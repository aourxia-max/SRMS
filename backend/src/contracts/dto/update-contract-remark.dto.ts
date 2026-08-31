import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateContractRemarkDto {
  @IsOptional()
  @IsString({ message: '合同备注必须是文本' })
  @MaxLength(500, { message: '合同备注不能超过500个字符' })
  remark?: string | null;
}
