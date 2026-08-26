import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ContractVoidRequestsService } from './contract-void-requests.service';
import {
  RejectContractVoidRequestDto,
  SubmitContractVoidRequestDto,
} from './dto/contract-void.dto';

const admin = {
  id: 2,
  username: 'admin',
  displayName: '\u7ba1\u7406\u5458',
  role: UserRole.ADMIN,
};
const superAdmin = { ...admin, id: 1, role: UserRole.SUPER_ADMIN };
const visitor = { ...admin, id: 3, role: UserRole.VISITOR };
const impactHash = 'a'.repeat(64);
const dto = {
  contractId: 7,
  reason: '\u5408\u540c\u5f55\u5165\u9519\u8bef',
  impactHash,
  fileAssetIds: [31, 32],
  idempotencyKey: 'submit-contract-void-0001',
};

describe('contract void DTO validation', () => {
  it('rejects malformed submission fields', async () => {
    const submit = plainToInstance(SubmitContractVoidRequestDto, {
      contractId: 0,
      reason: '',
      impactHash: 'BAD',
      fileAssetIds: [1, 1, 0],
      idempotencyKey: '',
    });

    const errors = await validate(submit);
    expect(errors.map((item) => item.property).sort()).toEqual([
      'contractId',
      'fileAssetIds',
      'idempotencyKey',
      'impactHash',
      'reason',
    ]);
    const messages = errors.flatMap((item) =>
      Object.values(item.constraints ?? {}),
    );
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((message) => /[\u4e00-\u9fff]/.test(message))).toBe(
      true,
    );
  });

  it('accepts unique positive proof ids and exact boundaries', async () => {
    const submit = plainToInstance(SubmitContractVoidRequestDto, {
      contractId: 7,
      reason: 'x'.repeat(500),
      impactHash,
      fileAssetIds: [31, 32],
      idempotencyKey: 'x'.repeat(16),
    });
    const reject = plainToInstance(RejectContractVoidRequestDto, {
      reason: 'y'.repeat(500),
    });

    expect(await validate(submit)).toEqual([]);
    expect(await validate(reject)).toEqual([]);
  });
});

describe('ContractVoidRequestsService', () => {
  function transactionService(overrides: Record<string, unknown> = {}) {
    const tx = {
      contractVoidRequest: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 9,
            requestNo: 'HTZF20260826000009',
            status: 'PENDING',
            ...data,
            files: (data.files?.create ?? []).map(
              ({ fileAssetId }: { fileAssetId: number }) => ({ fileAssetId }),
            ),
          }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      fileAsset: {
        findMany: jest.fn().mockResolvedValue([{ id: 31 }, { id: 32 }]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      operationLog: { create: jest.fn().mockResolvedValue({}) },
      ...overrides,
    };
    const db = {
      contractVoidRequest: tx.contractVoidRequest,
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    };
    const preview = {
      preview: jest.fn().mockResolvedValue({
        contract: { id: 7, status: 'ACTIVE', roomId: 3 },
        rows: [],
        sourceSnapshot: { contractMembers: [] },
        impactHash,
      }),
    };
    return {
      tx,
      db,
      preview,
      service: new ContractVoidRequestsService(
        { db } as never,
        preview as never,
      ),
    };
  }

  it('returns JSON-safe attachment metadata from request detail', async () => {
    const findUnique = jest.fn().mockImplementation(({ include }) => {
      const fileAsset = include.files.include.fileAsset;
      const tenant = include.contract.include.members.include.tenant;
      return Promise.resolve({
        id: 9,
        contract: {
          members: [
            {
              tenant:
                tenant === true
                  ? {
                      id: 5,
                      name: '张三',
                      idNoCiphertext: 'secret',
                      idNoHash: 'hash',
                    }
                  : { id: 5, name: '张三', phone: '13800000000' },
            },
          ],
        },
        files: [
          {
            fileAssetId: 61,
            fileAsset:
              fileAsset === true
                ? {
                    id: 61,
                    originalName: 'proof.pdf',
                    mimeType: 'application/pdf',
                    sizeBytes: 9n,
                  }
                : {
                    id: 61,
                    originalName: 'proof.pdf',
                    mimeType: 'application/pdf',
                  },
          },
        ],
      });
    });
    const service = new ContractVoidRequestsService(
      { db: { contractVoidRequest: { findUnique } } } as never,
      {} as never,
    );

    const result = await service.detail(9, admin);
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(
      findUnique.mock.calls[0][0].include.contract.include.members.include
        .tenant,
    ).toEqual({
      select: { id: true, name: true, phone: true },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('idNoHash');
  });

  it('stores the latest preview and links staged proof assets', async () => {
    const { service, tx } = transactionService();

    const result = await service.submit(dto, admin);

    expect(result).toEqual(expect.objectContaining({ id: 9 }));
    expect(tx.contractVoidRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractId: 7,
        activeContractKey: 'contract:7',
        submissionIdempotencyKey: dto.idempotencyKey,
        impactHash,
        impactSnapshot: expect.objectContaining({
          sourceSnapshot: expect.objectContaining({ contractMembers: [] }),
        }),
        files: {
          create: [{ fileAssetId: 31 }, { fileAssetId: 32 }],
        },
      }),
      include: expect.objectContaining({ files: expect.anything() }),
    });
    expect(tx.fileAsset.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [31, 32] },
        category: 'CONTRACT_VOID_PROOF',
        uploadedBy: admin.id,
        lockedAt: null,
      },
      select: { id: true },
    });
    expect(tx.fileAsset.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: [31, 32] },
        category: 'CONTRACT_VOID_PROOF',
        uploadedBy: admin.id,
        lockedAt: null,
      },
      data: { lockedAt: expect.any(Date) },
    });
    expect(tx.operationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'SUBMIT',
        entityType: 'CONTRACT_VOID_REQUEST',
        operatorId: admin.id,
      }),
    });
  });

  it('rejects a stale impact hash before creating a request', async () => {
    const { service, tx, preview } = transactionService();
    preview.preview.mockResolvedValue({ impactHash: 'b'.repeat(64) });

    await expect(service.submit(dto, admin)).rejects.toThrow(
      '\u5408\u540c\u5173\u8054\u6570\u636e\u5df2\u53d8\u5316\uff0c\u8bf7\u91cd\u65b0\u9884\u89c8',
    );
    expect(tx.contractVoidRequest.create).not.toHaveBeenCalled();
  });

  it('returns the original request for an exact idempotent retry', async () => {
    const { service, db, preview } = transactionService();
    db.contractVoidRequest.findUnique.mockResolvedValue({
      id: 9,
      contractId: 7,
      reason: dto.reason,
      impactHash,
      submissionIdempotencyKey: dto.idempotencyKey,
      files: [{ fileAssetId: 32 }, { fileAssetId: 31 }],
    });

    await expect(service.submit(dto, admin)).resolves.toEqual(
      expect.objectContaining({ id: 9 }),
    );
    expect(preview.preview).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key reused for a different payload', async () => {
    const { service, db } = transactionService();
    db.contractVoidRequest.findUnique.mockResolvedValue({
      id: 9,
      contractId: 8,
      reason: dto.reason,
      impactHash,
      submissionIdempotencyKey: dto.idempotencyKey,
      files: [],
    });

    await expect(service.submit(dto, admin)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('converts a pending-contract unique collision to a Chinese conflict', async () => {
    const { service, tx } = transactionService();
    tx.contractVoidRequest.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['activeContractKey'] },
    });

    await expect(service.submit(dto, admin)).rejects.toEqual(
      expect.objectContaining({
        message:
          '\u8be5\u5408\u540c\u5df2\u6709\u5f85\u786e\u8ba4\u7684\u4f5c\u5e9f\u7533\u8bf7',
      }),
    );
  });

  it('routes a submission-key collision through idempotent retry logic', async () => {
    const { service, tx } = transactionService();
    tx.contractVoidRequest.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 9,
        contractId: dto.contractId,
        reason: dto.reason,
        impactHash: dto.impactHash,
        files: [{ fileAssetId: 31 }, { fileAssetId: 32 }],
      });
    tx.contractVoidRequest.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['submissionIdempotencyKey'] },
    });

    await expect(service.submit(dto, admin)).resolves.toEqual(
      expect.objectContaining({ id: 9 }),
    );
  });

  it('reports a request-number collision distinctly', async () => {
    const { service, tx } = transactionService();
    tx.contractVoidRequest.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['requestNo'] },
    });

    await expect(service.submit(dto, admin)).rejects.toEqual(
      expect.objectContaining({ message: '作废申请编号冲突，请重试' }),
    );
  });

  it.each([
    ['foreign', superAdmin],
    ['locked', admin],
  ])(
    'rejects a %s staged proof before request creation',
    async (_case, submittingUser) => {
      const { service, tx } = transactionService();
      tx.fileAsset.findMany.mockResolvedValue([]);

      await expect(service.submit(dto, submittingUser)).rejects.toThrow(
        '证明附件不存在、已被使用或无权使用',
      );
      expect(tx.fileAsset.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: [31, 32] },
          category: 'CONTRACT_VOID_PROOF',
          uploadedBy: submittingUser.id,
          lockedAt: null,
        },
        select: { id: true },
      });
      expect(tx.contractVoidRequest.create).not.toHaveBeenCalled();
    },
  );

  it('rejects proof reuse lost during the transactional claim', async () => {
    const { service, tx } = transactionService();
    tx.fileAsset.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.submit(dto, admin)).rejects.toThrow(
      '证明附件已被使用，请重新上传',
    );
    expect(tx.contractVoidRequest.create).not.toHaveBeenCalled();
  });

  it('enforces submit permissions in the service layer', async () => {
    const { service, preview } = transactionService();

    await expect(service.submit(dto, visitor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(preview.preview).not.toHaveBeenCalled();
  });

  it('allows the submitter to cancel pending and clears the active key', async () => {
    const request = {
      id: 9,
      requestNo: 'HTZF20260826000009',
      status: 'PENDING',
      submittedBy: admin.id,
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { service, tx } = transactionService({
      contractVoidRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany,
      },
    });

    await service.cancel(9, admin);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 9, status: 'PENDING' },
      data: expect.objectContaining({
        status: 'CANCELLED',
        activeContractKey: null,
        cancelledBy: admin.id,
        cancelledAt: expect.any(Date),
      }),
    });
    expect(tx.operationLog.create).toHaveBeenCalled();
  });

  it('rejects cancellation of a non-pending request', async () => {
    const { service } = transactionService({
      contractVoidRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 9,
          status: 'COMPLETED',
          submittedBy: 99,
        }),
      },
    });

    await expect(service.cancel(9, admin)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects cancellation of another submitter pending request', async () => {
    const updateMany = jest.fn();
    const { service } = transactionService({
      contractVoidRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 9,
          status: 'PENDING',
          submittedBy: 99,
        }),
        updateMany,
      },
    });

    await expect(service.cancel(9, admin)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does not log when cancellation loses the pending-state race', async () => {
    const { service, tx } = transactionService({
      contractVoidRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 9,
          requestNo: 'HTZF20260826000009',
          status: 'PENDING',
          submittedBy: admin.id,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    });

    await expect(service.cancel(9, admin)).rejects.toThrow(
      '申请状态已变化，请刷新后重试',
    );
    expect(tx.operationLog.create).not.toHaveBeenCalled();
  });

  it('only lets a super admin reject pending and logs the transition', async () => {
    const request = {
      id: 9,
      requestNo: 'HTZF20260826000009',
      status: 'PENDING',
      submittedBy: admin.id,
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { service, tx } = transactionService({
      contractVoidRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        updateMany,
      },
    });

    await expect(
      service.reject(9, 'invalid proof', admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await service.reject(9, 'invalid proof', superAdmin);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 9, status: 'PENDING' },
      data: expect.objectContaining({
        status: 'REJECTED',
        activeContractKey: null,
        rejectedBy: superAdmin.id,
        rejectedReason: 'invalid proof',
      }),
    });
    expect(tx.operationLog.create).toHaveBeenCalled();
  });

  it('does not log when rejection loses the pending-state race', async () => {
    const { service, tx } = transactionService({
      contractVoidRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 9,
          requestNo: 'HTZF20260826000009',
          status: 'PENDING',
          submittedBy: admin.id,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    });

    await expect(service.reject(9, '资料不符', superAdmin)).rejects.toThrow(
      '申请状态已变化，请刷新后重试',
    );
    expect(tx.operationLog.create).not.toHaveBeenCalled();
  });
});

describe('ContractVoidRequestsService reversal detail contract', () => {
  it('loads deterministically ordered reversals and serializes monetary and date fields for detail', async () => {
    const findUnique = jest.fn().mockImplementation(({ include }) => {
      if (!include.reversals) return Promise.resolve({ id: 9 });
      return Promise.resolve({
        id: 9,
        reversals: [
          {
            id: 4,
            contractVoidRequestId: 9,
            category: 'PAYMENT',
            originalEntityType: 'Payment',
            originalEntityId: 31,
            amount: new Prisma.Decimal('-12.50'),
            balanceBefore: new Prisma.Decimal('12.50'),
            balanceAfter: new Prisma.Decimal('0.00'),
            generatedEntityType: 'PaymentReversal',
            generatedEntityId: 71,
            originalOccurredAt: new Date('2026-08-20T00:00:00.000Z'),
            correctionOccurredAt: new Date('2026-08-26T00:00:00.000Z'),
            idempotencyKey: 'contract-void:9:PAYMENT:31',
            metadata: { paymentId: 31 },
          },
        ],
      });
    });
    const service = new ContractVoidRequestsService(
      { db: { contractVoidRequest: { findUnique } } } as never,
      {} as never,
    );

    const result = JSON.parse(JSON.stringify(await service.detail(9, admin)));

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 9 },
      include: expect.objectContaining({
        reversals: {
          orderBy: [{ correctionOccurredAt: 'asc' }, { id: 'asc' }],
        },
      }),
    });
    expect(result.reversals).toEqual([
      expect.objectContaining({
        amount: '-12.5',
        balanceBefore: '12.5',
        balanceAfter: '0',
        originalOccurredAt: '2026-08-20T00:00:00.000Z',
        correctionOccurredAt: '2026-08-26T00:00:00.000Z',
        generatedEntityType: 'PaymentReversal',
        generatedEntityId: 71,
        idempotencyKey: 'contract-void:9:PAYMENT:31',
      }),
    ]);
  });

  it('keeps reversals out of list queries', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new ContractVoidRequestsService(
      { db: { contractVoidRequest: { findMany } } } as never,
      {} as never,
    );

    await service.list({}, admin);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.not.objectContaining({ reversals: expect.anything() }),
      }),
    );
  });
});
