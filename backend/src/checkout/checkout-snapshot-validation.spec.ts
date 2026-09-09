import { CheckoutService } from './checkout.service';

describe('checkout finance snapshot date validation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-31T16:30:00Z'));
  });
  afterEach(() => jest.useRealTimers());
  function harness(status = 'ACTIVE', origin = 'ACTIVE') {
    const contract = {
      id: 3,
      status,
      startDate: new Date('2026-08-01'),
      checkoutSettlements: [
        { id: 8, status: 'DRAFT', originContractStatus: origin },
      ],
      bills: [
        {
          id: 21,
          billNo: 'ZD21',
          billCategory: 'RENT',
          status: 'PENDING',
          outstandingAmount: '1600',
          periodStart: new Date('2026-09-01'),
          periodEnd: new Date('2026-09-30'),
        },
      ],
    };
    const db = {
      contract: { findUniqueOrThrow: jest.fn().mockResolvedValue(contract) },
      depositTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
      prepaymentTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    return { service: new CheckoutService({ db } as never), db };
  }
  it.each([undefined, ''])(
    'includes a bill starting today without an actual checkout cutoff (%p)',
    async (date) => {
      const { service } = harness();
      const snapshot =
        date === undefined
          ? await service.getFinanceSnapshot(3)
          : await service.getFinanceSnapshot(3, date);
      expect(snapshot).toMatchObject({
        rentOutstanding: '1600.00',
        futureBillCount: 0,
        arrearsBills: [{ id: 21 }],
      });
    },
  );
  it('excludes checkout day only when the actual date is explicit', async () => {
    expect(
      await harness().service.getFinanceSnapshot(3, '2026-09-01'),
    ).toMatchObject({ rentOutstanding: '0.00', futureBillCount: 1 });
  });
  it.each([
    ['not-a-date', '实际退房日期格式不正确'],
    ['2026-02-30', '实际退房日期格式不正确'],
    ['2026-09-02', '实际退房日期不能晚于当前日期'],
    ['2026-07-31', '实际退房日期不能早于合同开始日期'],
  ])(
    'rejects %s after authoritative contract load and before derived balance reads',
    async (date, message) => {
      const h = harness();
      await expect(h.service.getFinanceSnapshot(3, date)).rejects.toThrow(
        message,
      );
      expect(h.db.contract.findUniqueOrThrow).toHaveBeenCalledTimes(1);
      expect(h.db.depositTransaction.findFirst).not.toHaveBeenCalled();
      expect(h.db.prepaymentTransaction.findFirst).not.toHaveBeenCalled();
    },
  );
  it.each(['VOIDED', 'ENDED', 'DRAFT', 'PENDING_EFFECTIVE'])(
    'rejects ineligible %s contracts with a Chinese business error',
    async (status) => {
      await expect(
        harness(status).service.getFinanceSnapshot(3, '2026-09-01'),
      ).rejects.toThrow(/[\u4e00-\u9fff]/);
    },
  );
  it.each(['PENDING_START', 'PENDING_CHECKOUT'])(
    'preserves pre-start checkout for %s origin PENDING_START',
    async (status) => {
      expect(
        await harness(status, 'PENDING_START').service.getFinanceSnapshot(
          3,
          '2026-07-31',
        ),
      ).toMatchObject({ rentOutstanding: '0.00', futureBillCount: 1 });
    },
  );
  it('rejects a pre-start date for a pending checkout originating from ACTIVE', async () => {
    await expect(
      harness('PENDING_CHECKOUT').service.getFinanceSnapshot(3, '2026-07-31'),
    ).rejects.toThrow('实际退房日期不能早于合同开始日期');
  });
});
