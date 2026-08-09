import {
  buildBillNumber,
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

  it('preserves every legal component in long final contract and bill numbers', () => {
    const number = buildContractNumber(
      3,
      new Date('2026-08-05'),
      '1栋101',
      '这是一个非常长的住户姓名用于验证合同编号不再按照旧字段长度截断',
    );
    expect(number).toBe(
      'HT202608050003 | 1栋101 | 这是一个非常长的住户姓名用于验证合同编号不再按照旧字段长度截断',
    );
    expect(number.length).toBeGreaterThan(40);
    expect(buildBillNumber(number, 12)).toBe(`${number}-B012`);
  });

  it('creates unique temporary numbers for the transaction insert', () => {
    const first = buildTemporaryContractNumber();
    const second = buildTemporaryContractNumber();
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(40);
    expect(second.length).toBeLessThanOrEqual(40);
  });
});
