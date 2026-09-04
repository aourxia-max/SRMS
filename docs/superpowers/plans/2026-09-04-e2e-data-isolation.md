# E2E Data Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every real-MySQL E2E run in a disposable local database, prevent fallback to shared/development databases, provide self-contained test users, and restore a clean lint baseline for the completed-checkout reversal change.

**Architecture:** A test-only support module owns URL validation, local `.env.test` parsing, disposable database creation, migrations, user seeding, Jest execution, cleanup, and post-cleanup verification. The public `npm run test:e2e` command always enters this runner; database-writing suites assert the disposable URL again before constructing `AppModule` or `PrismaService`. Shared `srms_docker` is read only for before/after fingerprints and is never the Jest target.

**Tech Stack:** Node.js 24, TypeScript, Jest 30, NestJS 11, Prisma 7, MariaDB driver, MySQL 8.4, PowerShell/Docker Compose for final local verification.

**Spec:** `docs/superpowers/specs/2026-09-04-e2e-data-isolation-design.md`

## Global Constraints

- The only disposable database names are lowercase names matching `^srms_e2e_[a-z0-9_]+$`.
- Database create/drop is allowed only on `127.0.0.1`, `localhost`, or `::1`, port `13306`.
- The configuration source database must be exactly `srms_docker`; it is fingerprinted read-only and is never a Jest target.
- Never print, copy, or commit passwords, tokens, keys, or the generated `DATABASE_URL`.
- Never connect to or modify production, `localhost:3306/srms`, or any database outside the generated `srms_e2e_*` target.
- Existing pollution in `srms_docker` is not deleted by this plan.
- Production contract, payment, refund, checkout, and finance behavior does not change.

---

### Task 1: Disposable database URL safety boundary

**Files:**
- Create: `backend/test/support/isolated-e2e-database.ts`
- Create: `backend/test/isolated-e2e-database.e2e-spec.ts`
- Modify: `backend/test/support/contract-void-mutation-database-guard.ts`
- Modify: `backend/test/contract-void-mutation-database-guard.e2e-spec.ts`

**Interfaces:**
- Produces: `assertDisposableE2eDatabaseUrl(databaseUrl: string): URL`
- Produces: `readLocalTestMySqlConfig(envPath: string): LocalTestMySqlConfig`
- Produces: `buildDisposableDatabaseName(now: Date, suffix: string): string`
- Consumes later: Tasks 2 through 4 use these functions before any database write.

- [ ] **Step 1: Write failing safety tests**

Add table-driven tests with hand-written expected outcomes:

```ts
it.each([
  'mysql://user:secret@127.0.0.1:13306/srms_docker',
  'mysql://user:secret@localhost:3306/srms_e2e_20260904_ab12',
  'mysql://user:secret@database.example:13306/srms_e2e_20260904_ab12',
  'mysql://user:secret@127.0.0.1:13306/srms',
  'mysql://user:secret@127.0.0.1:13306/SRMS_E2E_BAD',
])('rejects unsafe database target %s', (databaseUrl) => {
  expect(() => assertDisposableE2eDatabaseUrl(databaseUrl)).toThrow(
    'E2E 只能运行在本机 13306 端口的一次性 srms_e2e 数据库',
  );
});

it('accepts an exact disposable localhost target', () => {
  expect(
    assertDisposableE2eDatabaseUrl(
      'mysql://user:secret@127.0.0.1:13306/srms_e2e_20260904_ab12',
    ).pathname,
  ).toBe('/srms_e2e_20260904_ab12');
});
```

Test configuration parsing with a temporary fixture containing quoted values and assert only the parsed non-secret fields and missing-variable Chinese error. Test database-name generation with a fixed date and suffix.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
npm --prefix backend run test:e2e -- --runInBand --runTestsByPath test/isolated-e2e-database.e2e-spec.ts
```

Expected: FAIL because `isolated-e2e-database.ts` and its exports do not exist.

- [ ] **Step 3: Implement the safety module**

Define:

```ts
export type LocalTestMySqlConfig = {
  host: '127.0.0.1';
  port: 13306;
  sourceDatabase: 'srms_docker';
  user: string;
  password: string;
  rootPassword: string;
};

export function assertDisposableE2eDatabaseUrl(databaseUrl: string): URL;
export function readLocalTestMySqlConfig(envPath: string): LocalTestMySqlConfig;
export function buildDisposableDatabaseName(now: Date, suffix: string): string;
```

Parse `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, and `MYSQL_PORT`. Reject missing values, any port other than `13306`, and any source database other than `srms_docker`. Return secrets only in memory and never log the returned object.

Replace the contract-void-specific disposable-name validation with a call to the shared validator while preserving the existing mutation-proof Chinese error at its public boundary.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
npm --prefix backend run test:e2e -- --runInBand --runTestsByPath test/isolated-e2e-database.e2e-spec.ts test/contract-void-mutation-database-guard.e2e-spec.ts
```

Expected: both suites pass and no database connection is opened.

- [ ] **Step 5: Commit Task 1**

```powershell
git add backend/test/support/isolated-e2e-database.ts backend/test/isolated-e2e-database.e2e-spec.ts backend/test/support/contract-void-mutation-database-guard.ts backend/test/contract-void-mutation-database-guard.e2e-spec.ts
git commit -m "test: enforce disposable e2e database targets"
```

### Task 2: Testable disposable database lifecycle

**Files:**
- Create: `backend/test/support/isolated-e2e-lifecycle.ts`
- Create: `backend/test/isolated-e2e-lifecycle.e2e-spec.ts`

**Interfaces:**
- Consumes: `assertDisposableE2eDatabaseUrl` from Task 1.
- Produces: `runIsolatedE2e(options: IsolatedE2eOptions, dependencies: IsolatedE2eDependencies): Promise<number>`.
- Produces: dependency interfaces for create, migrate, seed, fingerprint, Jest, drop, and existence checks.
- Consumes later: Task 3 supplies real MariaDB and child-process dependencies.

- [ ] **Step 1: Write failing lifecycle tests**

Use deterministic fake dependencies that append literal operation names to an array. Cover these behaviors separately:

```ts
expect(operations).toEqual([
  'fingerprint-before',
  'create',
  'migrate',
  'seed',
  'jest',
  'drop',
  'assert-absent',
  'fingerprint-after',
]);
```

Add tests proving migration failure still calls `drop` and `assert-absent`, Jest exit code `1` is preserved after successful cleanup, cleanup failure forces exit code `1`, and a changed shared fingerprint forces exit code `1` without logging secret configuration.

- [ ] **Step 2: Run lifecycle tests and verify RED**

Run:

```powershell
npm --prefix backend run test:e2e -- --runInBand --runTestsByPath test/isolated-e2e-lifecycle.e2e-spec.ts
```

Expected: FAIL because `runIsolatedE2e` does not exist.

- [ ] **Step 3: Implement minimal lifecycle orchestration**

Define exact contracts:

```ts
export type IsolatedE2eOptions = {
  databaseUrl: string;
  databaseName: string;
  jestArgs: string[];
};

export type IsolatedE2eDependencies = {
  fingerprintShared(): Promise<string>;
  createDatabase(name: string): Promise<void>;
  migrate(databaseUrl: string): Promise<void>;
  seedUsers(databaseUrl: string): Promise<void>;
  runJest(databaseUrl: string, args: string[]): Promise<number>;
  dropDatabase(name: string): Promise<void>;
  databaseExists(name: string): Promise<boolean>;
};

export async function runIsolatedE2e(
  options: IsolatedE2eOptions,
  dependencies: IsolatedE2eDependencies,
): Promise<number>;
```

Validate the URL before `fingerprintShared` and again immediately before create/drop. Always execute cleanup in `finally`. Throw the fixed Chinese message `E2E 临时数据库清理失败` when drop or absence verification fails. Compare shared fingerprints only after cleanup.

- [ ] **Step 4: Run lifecycle tests and verify GREEN**

Run the focused command from Step 2. Expected: all lifecycle cases pass.

- [ ] **Step 5: Commit Task 2**

```powershell
git add backend/test/support/isolated-e2e-lifecycle.ts backend/test/isolated-e2e-lifecycle.e2e-spec.ts
git commit -m "test: add disposable e2e lifecycle"
```

### Task 3: Real local runner and package entry point

**Files:**
- Create: `backend/test/run-isolated-e2e.ts`
- Create: `backend/test/isolated-e2e-runner.e2e-spec.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `npm run test:e2e` as the safe public command.
- Produces: `npm run test:e2e:raw` as an internal Jest command that database suites reject unless `DATABASE_URL` is disposable.

- [ ] **Step 1: Write failing runner dependency tests**

Test exported pure builders rather than source text:

```ts
expect(buildMigrationCommand('C:/repo/backend')).toEqual({
  command: process.execPath,
  args: ['C:/repo/backend/node_modules/prisma/build/index.js', 'migrate', 'deploy'],
});

expect(buildJestCommand('C:/repo/backend', ['--runInBand'])).toEqual({
  command: process.execPath,
  args: [
    'C:/repo/backend/node_modules/jest/bin/jest.js',
    '--config',
    'C:/repo/backend/test/jest-e2e.json',
    '--runInBand',
  ],
});
```

Add a test that a seed call creates one active `SUPER_ADMIN` and one active `ADMIN` using parameterized SQL and never returns the password hash.

- [ ] **Step 2: Run runner tests and verify RED**

Run:

```powershell
npm --prefix backend run test:e2e -- --runInBand --runTestsByPath test/isolated-e2e-runner.e2e-spec.ts
```

Expected: FAIL because the real dependency builders do not exist.

- [ ] **Step 3: Implement the CLI runner**

The runner must:

1. Read `deploy/.env.test` through Task 1 without printing it.
2. Generate `srms_e2e_<UTC timestamp>_<six lowercase alphanumeric characters>`.
3. Build an in-memory root `DATABASE_URL` for the generated database.
4. Use MariaDB parameterized queries for shared fingerprints, schema creation, user seeding, schema deletion, and absence verification. Quote the validated database identifier only after regex validation.
5. Use `spawn`/`spawnSync` argument arrays, never a shell string, for Prisma and Jest.
6. Forward only the Jest child stdout/stderr and process exit code.
7. Close every MariaDB pool/connection in `finally`.

Change scripts to:

```json
{
  "test:e2e": "ts-node --project tsconfig.json test/run-isolated-e2e.ts",
  "test:e2e:raw": "jest --config ./test/jest-e2e.json"
}
```

The shared fingerprint is a stable JSON serialization of counts and monetary sums from `buildings`, `rooms`, `tenants`, `contracts`, `rent_bills`, `payments`, `deposit_transactions`, `prepayment_transactions`, `checkout_settlements`, and `deposit_refunds` in `srms_docker`.

- [ ] **Step 4: Run runner tests and verify GREEN**

Run the focused command from Step 2. Expected: all pure dependency and seed-shape tests pass without creating a database.

- [ ] **Step 5: Commit Task 3**

```powershell
git add backend/test/run-isolated-e2e.ts backend/test/isolated-e2e-runner.e2e-spec.ts backend/package.json
git commit -m "test: run e2e in disposable mysql database"
```

### Task 4: Make every database-writing E2E self-contained

**Files:**
- Modify: `backend/test/approval-tasks-contract-remark.e2e-spec.ts`
- Modify: `backend/test/checkout-rent-refund.e2e-spec.ts`
- Modify: `backend/test/contract-deposit.e2e-spec.ts`
- Modify: `backend/test/contract-void-correction.e2e-spec.ts`
- Modify: `backend/test/contract-void-executor.mysql.e2e-spec.ts`
- Modify: `backend/test/property-affairs.e2e-spec.ts`
- Modify: `backend/test/finance.e2e-spec.ts`
- Modify: `backend/test/payments.e2e-spec.ts`

**Interfaces:**
- Consumes: `assertDisposableE2eDatabaseUrl(process.env.DATABASE_URL ?? '')`.
- Consumes: the two users seeded by Task 3.
- Produces: no suite may construct `AppModule` or `PrismaService` before the disposable URL assertion passes.

- [ ] **Step 1: Write the failing integration guard case**

Add a case to `isolated-e2e-database.e2e-spec.ts` that temporarily sets `DATABASE_URL` to `mysql://user:secret@localhost:3306/srms`, invokes the shared suite guard, and expects the fixed Chinese safety error before a supplied `connect` spy is called.

- [ ] **Step 2: Run the guard test and verify RED**

Run the Task 1 focused command. Expected: FAIL because database suites do not yet expose/use the shared guard-before-connect helper.

- [ ] **Step 3: Replace per-suite loaders and implicit defaults**

At the start of every database-writing suite `beforeAll`, execute:

```ts
const databaseUrl = process.env.DATABASE_URL ?? '';
assertDisposableE2eDatabaseUrl(databaseUrl);
process.env.NODE_ENV = 'test';
```

Remove the duplicated `loadLocalTestDatabaseEnvironment` functions. `contract-deposit.e2e-spec.ts` must no longer be able to use `backend/.env`. Keep business fixture creation and assertions unchanged.

Update `property-affairs.e2e-spec.ts` to select the runner-seeded usernames `srms-e2e-super-admin` and `srms-e2e-admin`, then assert their roles/status. Do not create or depend on shared accounts inside the suite.

- [ ] **Step 4: Run guard and TypeScript tests and verify GREEN**

Run:

```powershell
npm --prefix backend run test:e2e:raw -- --runInBand --runTestsByPath test/isolated-e2e-database.e2e-spec.ts test/contract-void-mutation-database-guard.e2e-spec.ts
npm --prefix backend run build
```

Expected: guard tests and backend build pass. Do not run database-writing suites with `test:e2e:raw`.

- [ ] **Step 5: Commit Task 4**

```powershell
git add backend/test
git commit -m "test: require isolated database in mysql e2e suites"
```

### Task 5: Restore checkout-reversal lint baseline

**Files:**
- Modify: `backend/src/checkout/checkout-completed-reversal.ts`
- Modify: `backend/src/checkout/checkout-completed-reversal.spec.ts`
- Modify: `backend/src/checkout/checkout.controller.spec.ts`
- Modify: `backend/src/checkout/checkout.service.ts`
- Modify: `backend/src/checkout/checkout.service.spec.ts`

**Interfaces:**
- Production behavior remains byte-for-byte equivalent except formatting.
- The two `no-unsafe-return` test helpers receive explicit return types or typed mock implementations.

- [ ] **Step 1: Preserve the failing lint evidence**

Run:

```powershell
npm --prefix backend run lint:check
```

Expected: 37 current errors, including two `@typescript-eslint/no-unsafe-return` errors in `checkout.service.spec.ts`.

- [ ] **Step 2: Apply only targeted formatting**

Run Prettier only on the five listed files:

```powershell
npx --prefix backend prettier --write backend/src/checkout/checkout-completed-reversal.ts backend/src/checkout/checkout-completed-reversal.spec.ts backend/src/checkout/checkout.controller.spec.ts backend/src/checkout/checkout.service.ts backend/src/checkout/checkout.service.spec.ts
```

If the command path resolution requires running inside `backend`, use the same five paths relative to that directory. Do not run repository-wide auto-fix.

- [ ] **Step 3: Fix the two typed test helpers**

Replace `any`-inferred callback returns with explicit Prisma-compatible fixture types or `unknown` narrowed before return. Do not change production service logic or weaken ESLint rules.

- [ ] **Step 4: Verify lint and focused checkout tests**

Run:

```powershell
npm --prefix backend run lint:check
npm --prefix backend test -- --runInBand checkout-completed-reversal.spec.ts checkout.service.spec.ts checkout.controller.spec.ts
```

Expected: zero lint errors and all focused tests pass.

- [ ] **Step 5: Commit Task 5**

```powershell
git add backend/src/checkout
git commit -m "test: clean checkout reversal lint errors"
```

### Task 6: Real disposable-database proof

**Files:**
- Modify only if evidence reveals a runner defect: files from Tasks 1 through 4.

**Interfaces:**
- Consumes: safe `npm run test:e2e` entry from Task 3.
- Produces evidence: shared fingerprint unchanged, disposable schema absent, all E2E suites passed or an exact failing suite retained.

- [ ] **Step 1: Capture read-only shared baseline**

Use the runner fingerprint function against `srms_docker`; record only the hash/count summary, never credentials.

- [ ] **Step 2: Run all E2E through the safe runner**

Run:

```powershell
npm --prefix backend run test:e2e -- --runInBand
```

Expected: the runner creates one `srms_e2e_*` database, migrates it, seeds both roles, and all ten suites pass.

- [ ] **Step 3: Prove cleanup and shared immutability**

Verify the runner reports:

```text
共享测试库指纹未变化
E2E 临时数据库已删除
```

Independently query `information_schema.schemata` for the emitted temporary name and expect `0`. Recompute the shared fingerprint and require exact equality with Step 1.

- [ ] **Step 4: Mutation-check the safety gate**

Run raw Jest for one writing suite with no `DATABASE_URL`:

```powershell
npm --prefix backend run test:e2e:raw -- --runInBand --runTestsByPath test/contract-deposit.e2e-spec.ts
```

Expected: FAIL with the disposable-database Chinese safety error before fixture creation. Recompute the shared fingerprint and require no change.

- [ ] **Step 5: Commit any evidence-driven runner fix**

Only if Step 2 or 3 exposed a runner defect, repeat RED/GREEN and commit the minimal fix:

```powershell
git add backend/test backend/package.json
git commit -m "fix: harden isolated e2e cleanup"
```

If no defect exists, make no commit for this step.

### Task 7: Full project and data verification

**Files:**
- No production changes expected.

**Interfaces:**
- Consumes all prior tasks.
- Produces final evidence for integration into local `main`.

- [ ] **Step 1: Run backend quality gates**

```powershell
npm --prefix backend run lint:check
npm --prefix backend test -- --runInBand
npm --prefix backend run test:e2e -- --runInBand
npm --prefix backend run build
npm --prefix backend run prisma:validate
```

Expected: zero lint errors, 101 unit suites/872 tests or higher pass, all E2E suites pass in the disposable database, build succeeds, and Prisma schema validates.

- [ ] **Step 2: Run frontend regression**

```powershell
npm --prefix frontend run test:unit
npm --prefix frontend run build
```

Expected: 63 test files/454 tests or higher pass and the production bundle builds. The existing bundle-size warning is recorded but is not a failure.

- [ ] **Step 3: Re-run read-only data invariants on `srms_docker`**

Require zero anomalies for bill formula, outstanding amount, allocation range, refund overflow, payment status, refund component sum, negative latest balances, deposit/prepayment balance-chain steps, contract date order, current-room contract collision, checkout formula, active checkout duplication, and completed-checkout contract status.

- [ ] **Step 4: Verify repository and service state**

```powershell
git diff --check
git status --short
docker compose -p srms_test --env-file deploy/.env.test -f deploy/docker-compose.yml ps
```

Expected: only intentional committed branch changes, no generated credentials/configuration, and existing test services remain healthy. This plan does not rebuild or deploy services.

- [ ] **Step 5: Review and integration handoff**

Summarize exact commits, test counts, shared fingerprint equality, disposable database deletion proof, remaining historical pollution, and the blocked cleanup of `localhost:3306/srms`. Do not merge, push, deploy, restore, or delete shared data without a separate user instruction.

