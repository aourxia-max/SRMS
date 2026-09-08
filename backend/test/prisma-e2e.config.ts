import { defineConfig } from 'prisma/config';
import { assertDisposableE2eDatabaseUrl } from './support/isolated-e2e-database';

// This entry point deliberately has no dotenv loader. Validate at the final
// datasource boundary, even when invoked independently of the public runner.
const databaseUrl = process.env.DATABASE_URL ?? '';
assertDisposableE2eDatabaseUrl(databaseUrl);

export default defineConfig({
  schema: '../prisma/schema.prisma',
  migrations: { path: '../prisma/migrations' },
  datasource: { url: databaseUrl },
});
