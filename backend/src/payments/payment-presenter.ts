import { PaymentStatus, Prisma } from '@prisma/client';

export type ReceiptType = 'PROVISIONAL' | 'FORMAL' | 'VOIDED';

export function receiptTypeFor(
  paymentStatus: PaymentStatus,
  adjustments: Array<{ approvalStatus: string }>,
): ReceiptType {
  if (paymentStatus === PaymentStatus.VOIDED) return 'VOIDED';
  return adjustments.some((item) => item.approvalStatus === 'PENDING')
    ? 'PROVISIONAL'
    : 'FORMAL';
}

const numerals = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
const sectionUnits = ['', '拾', '佰', '仟'];
const groupUnits = ['', '万', '亿', '兆'];

function sectionToChinese(value: number) {
  let section = value;
  let unitIndex = 0;
  let zeroPending = true;
  let output = '';
  while (section > 0) {
    const digit = section % 10;
    if (digit === 0) {
      if (!zeroPending && output) zeroPending = true;
    } else {
      if (zeroPending && output) output = `零${output}`;
      output = `${numerals[digit]}${sectionUnits[unitIndex]}${output}`;
      zeroPending = false;
    }
    section = Math.floor(section / 10);
    unitIndex += 1;
  }
  return output;
}

export function chineseUppercaseMoney(amount: Prisma.Decimal.Value) {
  const fixed = new Prisma.Decimal(amount).toDecimalPlaces(2).toFixed(2);
  const [integerText, fractionText] = fixed.split('.');
  let integer = Number(integerText);
  let groupIndex = 0;
  let zeroGroup = false;
  let output = '';

  while (integer > 0) {
    const group = integer % 10000;
    if (group === 0) {
      if (output) zeroGroup = true;
    } else {
      const prefix = output && (zeroGroup || group < 1000) ? '零' : '';
      output = `${sectionToChinese(group)}${groupUnits[groupIndex]}${prefix}${output}`;
      zeroGroup = false;
    }
    integer = Math.floor(integer / 10000);
    groupIndex += 1;
  }

  const [jiao, fen] = fractionText.split('').map(Number);
  const integerPart = `${output || '零'}元`;
  if (jiao === 0 && fen === 0) return `${integerPart}整`;
  const fractionPart = `${jiao ? `${numerals[jiao]}角` : fen ? '零' : ''}${
    fen ? `${numerals[fen]}分` : ''
  }`;
  return `${integerPart}${fractionPart}`;
}
