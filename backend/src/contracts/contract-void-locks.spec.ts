import { ConflictException, NotFoundException } from '@nestjs/common';
import { lockContractVoidExclusiveScope } from './contract-void-locks';

describe('contract void exclusive lock scope', () => {
  it('identity-only 读取后统一按 room -> 同房 contracts id ASC 加锁并返回目标合同', async () => {
    const tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, roomId: 3 }),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: 3 }])
        .mockResolvedValueOnce([
          { id: BigInt(7), roomId: BigInt(3), status: 'ACTIVE' },
          { id: BigInt(8), roomId: BigInt(3), status: 'PENDING' },
        ]),
    };

    await expect(
      lockContractVoidExclusiveScope(tx as never, 7),
    ).resolves.toMatchObject({
      roomId: 3,
      target: { id: 7, roomId: 3, status: 'ACTIVE' },
    });
    expect(tx.contract.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: { id: true, roomId: true },
    });
    const sql = tx.$queryRaw.mock.calls.map(([query]) =>
      (query as { strings: string[] }).strings.join('?'),
    );
    expect(sql[0]).toContain('FROM rooms');
    expect(sql[0]).toContain('FOR UPDATE');
    expect(sql[1]).toContain('FROM contracts');
    expect(sql[1]).toContain('ORDER BY id');
    expect(sql[1]).toContain('FOR UPDATE');
  });

  it('合同没有房源时以中文明确失败且不进入锁查询', async () => {
    const tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, roomId: null }),
      },
      $queryRaw: jest.fn(),
    };

    await expect(
      lockContractVoidExclusiveScope(tx as never, 7),
    ).rejects.toThrow('合同未关联房源，不能执行作废纠错');
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('房源锁内重载找不到目标合同时拒绝 identity 漂移', async () => {
    const tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, roomId: 3 }),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: 3 }])
        .mockResolvedValueOnce([
          { id: BigInt(8), roomId: BigInt(3), status: 'ACTIVE' },
        ]),
    };

    await expect(
      lockContractVoidExclusiveScope(tx as never, 7),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      lockContractVoidExclusiveScope(
        {
          contract: { findUnique: jest.fn().mockResolvedValue(null) },
          $queryRaw: jest.fn(),
        } as never,
        7,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
