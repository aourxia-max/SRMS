import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../authorization/roles.guard';
import { DepositRefundsController } from './deposit-refunds.controller';

describe('DepositRefundsController refund proof downloads', () => {
  it('registers the download route behind the existing class guards', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, DepositRefundsController),
    ).toEqual([JwtAuthGuard, RolesGuard]);
    const download = (
      DepositRefundsController.prototype as unknown as {
        downloadProof?: unknown;
      }
    ).downloadProof;
    expect(download).toBeDefined();
    if (!download) return;
    expect(Reflect.getMetadata(PATH_METADATA, download)).toBe(
      ':id/files/:fileId/download',
    );
  });

  it('downloads a linked proof with safe content headers', async () => {
    const downloadDepositRefundProof = jest.fn().mockResolvedValue({
      asset: {
        originalName: '退款凭证.webp',
        mimeType: 'image/webp',
      },
      content: Buffer.from('proof'),
    });
    const controller = new DepositRefundsController(
      {} as never,
      { downloadDepositRefundProof } as never,
    );
    const response = {
      setHeader: jest.fn(),
      send: jest.fn(),
    };

    await expect(
      Promise.resolve().then(() =>
        (
          controller as unknown as {
            downloadProof: (
              refundId: number,
              fileId: number,
              response: typeof response,
            ) => Promise<void>;
          }
        ).downloadProof(6, 77, response),
      ),
    ).resolves.toBeUndefined();

    expect(downloadDepositRefundProof).toHaveBeenCalledWith(6, 77);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'image/webp',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      "attachment; filename*=UTF-8''%E9%80%80%E6%AC%BE%E5%87%AD%E8%AF%81.webp",
    );
    expect(response.send).toHaveBeenCalledWith(Buffer.from('proof'));
  });

  it('exposes a guarded cancellation action for a pending refund', async () => {
    const cancel = jest.fn().mockResolvedValue({
      id: 49,
      approvalStatus: 'CANCELLED',
    });
    const controller = new DepositRefundsController(
      { cancel } as never,
      {} as never,
    );
    const user = { id: 2, username: 'admin', role: 'ADMIN' } as const;

    await expect(controller.cancel(49, user)).resolves.toEqual({
      code: 200,
      message: 'success',
      data: { id: 49, approvalStatus: 'CANCELLED' },
    });
    expect(cancel).toHaveBeenCalledWith(49, user);
  });
});
