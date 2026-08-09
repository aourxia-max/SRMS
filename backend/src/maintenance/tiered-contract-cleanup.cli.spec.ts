import {
  parseCleanupArguments,
  runCleanupCommand,
} from './tiered-contract-cleanup.cli';
import {
  CLEANUP_CONFIRMATION,
  CLEANUP_FINAL_AUTHORIZATION,
  TieredContractCleanupService,
} from './tiered-contract-cleanup.service';

describe('tiered contract cleanup CLI', () => {
  it('未提供 mode 时默认执行只读预检', async () => {
    const preflight = jest.fn().mockResolvedValue({ contractIds: [7] });
    const execute = jest.fn();
    const write = jest.fn();

    await runCleanupCommand(
      [],
      { preflight, execute } as unknown as TieredContractCleanupService,
      write,
    );

    expect(preflight).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining('"contractIds"'),
    );
  });

  it('execute 只有在四项授权参数完整时才传给服务', async () => {
    const preflight = jest.fn();
    const execute = jest.fn().mockResolvedValue({ contractIds: [7] });

    await runCleanupCommand(
      [
        '--mode=execute',
        '--environment=production',
        '--backup-no=BK-PROD-9',
        `--confirmation=${CLEANUP_CONFIRMATION}`,
        `--final-authorization=${CLEANUP_FINAL_AUTHORIZATION}`,
      ],
      { preflight, execute } as unknown as TieredContractCleanupService,
      jest.fn(),
    );

    expect(preflight).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith({
      environment: 'production',
      backupNo: 'BK-PROD-9',
      confirmation: CLEANUP_CONFIRMATION,
      finalAuthorization: CLEANUP_FINAL_AUTHORIZATION,
    });
  });

  it('拒绝未知 mode 和未知参数，避免拼写错误降级为其他操作', () => {
    expect(() => parseCleanupArguments(['--mode=delete'])).toThrow(
      'mode 仅支持 preflight 或 execute',
    );
    expect(() =>
      parseCleanupArguments(['--mode=preflight', '--token=x']),
    ).toThrow('未知参数');
  });
});
