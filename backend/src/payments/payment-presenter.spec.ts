import { chineseUppercaseMoney, receiptTypeFor } from './payment-presenter';

describe('payment presenter', () => {
  it('marks a receipt provisional while a linked adjustment is pending', () => {
    expect(receiptTypeFor('CONFIRMED', [{ approvalStatus: 'PENDING' }])).toBe(
      'PROVISIONAL',
    );
  });

  it('marks a receipt formal after every linked adjustment is decided', () => {
    expect(
      receiptTypeFor('CONFIRMED', [
        { approvalStatus: 'APPROVED' },
        { approvalStatus: 'REJECTED' },
      ]),
    ).toBe('FORMAL');
  });

  it('keeps the original receipt visibly void after payment voiding', () => {
    expect(receiptTypeFor('VOIDED', [])).toBe('VOIDED');
  });

  it('renders a hand-derived Chinese uppercase amount', () => {
    expect(chineseUppercaseMoney('5700.08')).toBe('伍仟柒佰元零捌分');
    expect(chineseUppercaseMoney('1000.00')).toBe('壹仟元整');
  });
});
