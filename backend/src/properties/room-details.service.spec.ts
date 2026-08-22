import { RoomDetailsService } from './room-details.service';

function pendingDelegates(counts: Partial<Record<string, number>> = {}) {
  const delegate = (name: string) => ({
    count: jest.fn().mockResolvedValue(counts[name] ?? 0),
  });
  return {
    contractChange: delegate('contractChange'),
    billAdjustment: delegate('billAdjustment'),
    paymentRefund: delegate('paymentRefund'),
    paymentVoidRequest: delegate('paymentVoidRequest'),
    pricingRebate: delegate('pricingRebate'),
    depositRefund: delegate('depositRefund'),
    checkoutSettlement: delegate('checkoutSettlement'),
  };
}

describe('RoomDetailsService', () => {
  it('does not return financial details to an administrator', async () => {
    const prisma = {
      db: {
        room: {
          findFirstOrThrow: jest.fn().mockResolvedValue({
            id: 11,
            roomStatus: 'EMPTY',
            building: { buildingNo: 'TEST-B1', buildingName: '测试楼' },
            histories: [],
            contracts: [],
          }),
        },
        ...pendingDelegates(),
      },
    } as any;
    const service = new RoomDetailsService(prisma);

    const result = await service.detail(11, { id: 2, role: 'ADMIN' });

    expect(result).not.toHaveProperty('financial');
    expect(result.riskLabels).toEqual(['当前无待办']);
  });

  it('shows room approval and checkout todos instead of current no todo', async () => {
    const prisma = {
      db: {
        room: {
          findFirstOrThrow: jest.fn().mockResolvedValue({
            id: 11,
            roomStatus: 'EMPTY',
            building: { buildingNo: 'TEST-B1', buildingName: '测试楼' },
            histories: [],
            contracts: [
              {
                id: 21,
                status: 'ACTIVE',
                endDate: new Date('2030-12-31'),
                bills: [],
                members: [],
              },
            ],
          }),
        },
        ...pendingDelegates({
          contractChange: 2,
          billAdjustment: 1,
          paymentRefund: 1,
          paymentVoidRequest: 1,
          pricingRebate: 1,
          depositRefund: 1,
          checkoutSettlement: 1,
        }),
      },
    } as any;
    const service = new RoomDetailsService(prisma);

    const result = await service.detail(11, { id: 2, role: 'ADMIN' });

    expect(result.riskLabels).toEqual([
      '合同变更待审批（2）',
      '账单调整待审批',
      '收款退款待审批',
      '收款作废待审批',
      '固定月租退差待审批',
      '押金退款待审批',
      '退租结算待处理',
    ]);
    expect(result.riskLabels).not.toContain('当前无待办');
  });
});
