import { NestFactory } from '@nestjs/core';
import { MaintenanceModule } from './maintenance.module';
import {
  CleanupAuthorization,
  TieredContractCleanupService,
} from './tiered-contract-cleanup.service';

type CleanupMode = 'preflight' | 'execute';

type CleanupArguments = {
  mode: CleanupMode;
  authorization?: CleanupAuthorization;
};

const allowedArguments = new Set([
  'mode',
  'environment',
  'backup-no',
  'confirmation',
  'final-authorization',
]);

export function parseCleanupArguments(argv: string[]): CleanupArguments {
  const values = new Map<string, string>();
  for (const argument of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(argument);
    if (!match || !allowedArguments.has(match[1])) {
      throw new Error(`未知参数：${argument}`);
    }
    values.set(match[1], match[2]);
  }
  const mode = values.get('mode') ?? 'preflight';
  if (mode !== 'preflight' && mode !== 'execute') {
    throw new Error('mode 仅支持 preflight 或 execute');
  }
  if (mode === 'preflight') return { mode };

  const environment = values.get('environment');
  if (environment !== 'test' && environment !== 'production') {
    throw new Error('execute 必须指定 environment=test 或 production');
  }
  return {
    mode,
    authorization: {
      environment: environment,
      backupNo: values.get('backup-no') ?? '',
      confirmation: values.get('confirmation') ?? '',
      finalAuthorization: values.get('final-authorization') ?? '',
    },
  };
}

export async function runCleanupCommand(
  argv: string[],
  service: TieredContractCleanupService,
  write: (value: string) => void,
): Promise<void> {
  const command = parseCleanupArguments(argv);
  const result =
    command.mode === 'preflight'
      ? await service.preflight()
      : await service.execute(command.authorization as CleanupAuthorization);
  write(JSON.stringify(result, null, 2));
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(MaintenanceModule, {
    logger: ['error'],
  });
  try {
    await runCleanupCommand(
      process.argv.slice(2),
      app.get(TieredContractCleanupService),
      (value) => process.stdout.write(`${value}\n`),
    );
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void bootstrap().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : '清理命令执行失败';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
