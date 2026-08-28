const DISPOSABLE_DATABASE_NAME =
  /^srms_contract_void_mutation_[a-z0-9][a-z0-9_]*$/i;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

const SAFETY_ERROR = '合同纠错 mutation 只能运行在本机一次性数据库';

export function assertContractVoidMutationDatabaseSafety(
  databaseUrl: string,
  mutationProofMode: boolean,
) {
  if (!mutationProofMode) return;

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error(SAFETY_ERROR);
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  if (
    !LOCAL_HOSTS.has(url.hostname.toLowerCase()) ||
    !DISPOSABLE_DATABASE_NAME.test(databaseName)
  ) {
    throw new Error(SAFETY_ERROR);
  }
}
