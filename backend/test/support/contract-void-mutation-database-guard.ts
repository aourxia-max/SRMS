import { assertDisposableE2eDatabaseUrl } from './isolated-e2e-database';

const SAFETY_ERROR = '合同纠错 mutation 只能运行在本机一次性数据库';

export function assertContractVoidMutationDatabaseSafety(
  databaseUrl: string,
  mutationProofMode: boolean,
) {
  if (!mutationProofMode) return;

  try {
    assertDisposableE2eDatabaseUrl(databaseUrl);
  } catch {
    throw new Error(SAFETY_ERROR);
  }
}
