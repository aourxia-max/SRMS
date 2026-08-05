import {
  buildContractNumber,
  buildTemporaryContractNumber,
} from './contract-number';

describe('contract number generation', () => {
  it('uses the contract start date and a global four-digit sequence', () => {
    expect(
      buildContractNumber(1, new Date('2026-08-05'), '2栋301', '李四'),
    ).toBe('HT202608050001 | 2栋301 | 李四');
  });

  it('keeps the complete sequence after four digits', () => {
    expect(
      buildContractNumber(12345, new Date('2026-08-05'), '2栋301', '李四'),
    ).toBe('HT2026080512345 | 2栋301 | 李四');
  });

  it('uses the fallback tenant label and removes separators from components', () => {
    expect(
      buildContractNumber(2, new Date('2026-08-05'), ' 2栋|301 ', '  '),
    ).toBe('HT202608050002 | 2栋301 | 未登记住户');
  });

  it('keeps the stored contract number within the database limit', () => {
    const number = buildContractNumber(
      3,
      new Date('2026-08-05'),
      '1栋101',
      '这是一个非常长的住户姓名用于验证合同编号长度限制',
    );
    expect(number.length).toBeLessThanOrEqual(40);
    expect(number.startsWith('HT202608050003 | 1栋101 | ')).toBe(true);
  });

  it('creates unique temporary numbers for the transaction insert', () => {
    const first = buildTemporaryContractNumber();
    const second = buildTemporaryContractNumber();
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(40);
    expect(second.length).toBeLessThanOrEqual(40);
  });
});
