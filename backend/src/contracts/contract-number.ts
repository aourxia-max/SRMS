import { randomBytes } from 'node:crypto';

const MAX_CONTRACT_NUMBER_LENGTH = 40;

function cleanPart(value: string | null | undefined, fallback: string): string {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/[|\r\n]/g, '')
    .replace(/\s+/g, ' ');
  return cleaned || fallback;
}

export function buildContractNumber(
  sequence: number,
  startDate: Date,
  fullHouseNo: string,
  tenantName: string | null | undefined,
): string {
  const date = startDate.toISOString().slice(0, 10).replace(/-/g, '');
  const sequenceText = String(sequence).padStart(4, '0');
  const room = cleanPart(fullHouseNo, '未登记房源');
  const tenant = cleanPart(tenantName, '未登记住户');
  const prefix = `HT${date}${sequenceText} | ${room} | `;
  return `${prefix}${tenant}`.slice(0, MAX_CONTRACT_NUMBER_LENGTH);
}

export function buildTemporaryContractNumber(): string {
  return `TMP-${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`.slice(
    0,
    MAX_CONTRACT_NUMBER_LENGTH,
  );
}
