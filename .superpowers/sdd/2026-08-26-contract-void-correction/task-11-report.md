# Task 11 Report: Full regression, migration rehearsal and acceptance record

## Status

COMPLETE

- Branch: feature/contract-void-correction
- Pre-acceptance HEAD: 02c0945
- Production-code changes in Task 11: none
- Database destructive actions in Task 11: none
- Acceptance record: docs/contract-void-correction-acceptance.md

## Scope and safety

- Used only compose project srms_test, container srms_test-mysql-1, port 13306, database srms_docker.
- Imported only the required local test-database values into test processes without displaying, recording, modifying or staging them.
- Explicitly unset CONTRACT_VOID_MUTATION_PROOF for all normal E2E.
- Did not repeat the authorized Task 10 DROP／CREATE rehearsal.
- Preserved normal COMPLETED E2E sources and append-only audits.
- Did not merge, push, create a PR or deploy production.

## Migration and backup evidence

Task 10 fix round 2 remains the actual rehearsal:

- Current database and uploads were backed up and hash verified.
- The 2026-08-25 baseline restored to 41 tables and 25 migrations.
- 20260826090000_contract_void_correction applied successfully.
- The migrated database had 45 tables and 26 migrations.
- T0, immediately after rebuild and migration: Task 10 marker／request／reversal counts were all 0.
- T1, subsequent normal GREEN／E2E runs: complete append-only source chains were intentionally retained.
- T2, the final read-only full-database snapshot recorded by Task 11: 32 correction requests, 127 reversals and 32 CONTRACT_VOID_COMPLETED audits.
- Marker `合同纠错测试-Task10-mtcgnnsdhthv54` requests 25–28 are four complete, valid chains within those 32 requests, not pollution.

These are timestamped evidence points rather than permanent shared-test-database count invariants; later normal GREEN E2E may append further complete chains.

Task 11 added read-only confirmation:

- prisma migrate status found 26 migrations and reported the schema up to date.
- The correction migration is APPLIED.
- All four new tables exist.
- The three correction tables expose 14 index／primary-key definitions and four RESTRICT foreign keys.
- Current and baseline database／uploads hashes matched the recorded values.

Rollback classification:

- `current-before-rebuild-20260828-094555` exactly captures the known polluted pre-rebuild state, including the incomplete mutation chain for marker `合同纠错测试-Task10-mtbw7plivhogqc` (request 115／contract 172, missing the PAYMENT_ALLOCATION -100.00 reversal and result category). It is forensic／original-state recovery material only, never a clean acceptance baseline.
- Any restore requires fresh, exact authorization for project／container／port／database and re-hashing both database.sql and uploads.tar.gz against the documented SHA-256 values before restoration.
- The preferred clean rebuild is `backup-before-clear-20260825-081647` database plus its hash-matched uploads, followed by migrations to HEAD.

## Automated verification

| Gate                                                          | Result                     |
| ------------------------------------------------------------- | -------------------------- |
| npm run db:validate                                           | PASS                       |
| npm run db:generate                                           | PASS; Prisma Client 7.8.0  |
| npm run lint                                                  | PASS                       |
| npm test -- --runInBand                                       | 79 suites / 480 tests PASS |
| npm --prefix backend run build                                | PASS                       |
| npm --prefix frontend run test:unit -- --testTimeout=15000    | 39 files / 221 tests PASS  |
| npm --prefix frontend run build                               | PASS                       |
| npm --prefix backend run test:e2e -- --runInBand              | 7 suites / 37 tests PASS   |
| Round 2 related contract-void unit suites                     | 3 suites / 25 tests PASS   |
| Round 2 new real MySQL／HTTP cases                            | 2 tests PASS               |
| Round 2 full target E2E file                                  | 1 suite / 8 tests PASS     |
| Focused frontend correction UI／permission／attachment client | 4 files / 76 tests PASS    |
| Focused backend controller／files                             | 2 suites / 44 tests PASS   |
| API health                                                    | HTTP 200                   |
| Web root                                                      | HTTP 200                   |

## Round 2: multi-period and prepayment-debit evidence

No production, schema or environment file changed. Every shared `srms_docker` run used normal production code with `CONTRACT_VOID_MUTATION_PROOF` unset.

Multi-period:

- The real contract API created two 100.00 monthly bills; the real payment API allocated 50.00 only to period 1, leaving period 1 PARTIAL and period 2 PENDING.
- In latest marker `合同纠错测试-Task10-mtcjzzi6wt39oz`, request 55／contract 111 completed with persisted sources intact. Bill sources 350／351 each have a RENT_BILL -100.00 reversal; payment source 123 has PAYMENT -50.00 and allocation source 146 has PAYMENT_ALLOCATION -50.00. Every monetary balanceAfter and the impact post-reversal net are 0.00; one completion audit exists.

Prepayment debit:

- The payment API recorded 160.00, allocated 100.00 to period 1 and the existing PaymentsService generated CREDIT_RECEIPT 60.00.
- There is no repository service／API that creates DEBIT_TO_BILL. The E2E fixture therefore uses only the existing Prisma enum and payment／bill foreign keys to assemble DEBIT_TO_BILL 40.00 with balanceAfter 20.00 plus a PREPAYMENT_AUTO allocation. This is test setup, not a new business entry point, and does not claim transfer／refund coverage.
- Request 56／contract 112 completed while preserving the CREDIT_RECEIPT／DEBIT_TO_BILL, payment source 124 and allocation sources 147／148. The PREPAYMENT reversal is only -20.00, its metadata points to the latest debit source, and its generated PREPAYMENT REVERSAL is 20.00 with balanceAfter 0.00. The consumed 40.00 is not reversed twice; impact post-reversal net is 0.00 and one completion audit exists.

RED／GREEN and regression:

- New hand-derived unit expectations were naturally GREEN against unchanged production. A temporary pure-unit mutation truncated bills to one and zeroed prepayment balance; the focused suite became 3 failed／10 passed, then the patch was reversed in the same command. Production hash and diff matched HEAD, and the restored suite passed 13/13.
- The new normal-mode E2E cases passed 2/2; the complete target file passed 8/8; related unit suites passed 25/25.
- Backend full initially exposed an unrelated 1 ms FilesService TTL assertion race. Eight focused reproductions yielded one failure with the same +1 ms boundary. The test now verifies the service clock sample lies between call start and finish; FilesService passed 35/35, backend full passed 480/480, lint and build passed. Production logic was unchanged.
- These normal runs appended eight complete chains. The later read-only full-database snapshot is 48 requests／193 reversals／48 completion audits: all requests COMPLETED, no nonzero post-reversal impact and no invalid completion-audit cardinality. This is a later timepoint than the original Task 11 32／127／32 snapshot.

## Four-flow acceptance

Used the normal real-API E2E marker 合同纠错测试-Task10-mtcgnnsdhthv54 and then queried the persisted rows read-only.

Requests 25–28 are the four-flow subset of Task 11's recorded 32-request／127-reversal／32-completion-audit full-database snapshot. Every one is complete and valid; none is pollution.

1. Simple unpaid: COMPLETED, contract VOIDED, original bill retained, post-reversal net 0.00, one audit.
2. Paid + auto deposit + prepayment: COMPLETED, original bill／three payments／allocation retained, deposit and prepayment latest balances 0.00, eight reversal rows, one audit.
3. Completed checkout: COMPLETED, original bill／payment／allocation／COMPLETED checkout retained, post-reversal net 0.00, one audit.
4. Active successor: historical contract VOIDED, successor remains ACTIVE, room remains RENTED before／after, post-reversal net 0.00, one audit.

Every persisted reversal with a non-null balanceAfter had balanceAfter 0.00. In the recorded 32／127／32 snapshot, the retained normal chains had no nonzero post-reversal result, no missing allocation reversal provenance and exactly one completion audit per request.

## Investigation note

An initial Chinese LIKE query returned no Task 10 rows even though E2E passed. Systematic debugging showed the Docker mysql client had not been started with utf8mb4, so Chinese literals and output were converted to question marks. Using --default-character-set=utf8mb4 and an ASCII Task10 filter exposed the expected rows. This was a diagnostic-client encoding issue, not a product or database defect; no code or data fix was made.

## UI smoke limitation

The in-app Browser controller could not initialize because of the existing Windows deny-read ACL helper error. The Web root itself returned HTTP 200. Chinese UI, role gates, exact confirmation, terminal read-only behavior and proof upload／download entry points are covered by the fresh full frontend suite plus 76 focused frontend and 44 focused backend tests.

## Known warnings

- Vite reports a minified chunk above 500 kB; build exits 0.
- The container mysql client prints its generic command-line password warning; no secret value appears.
- Frontend has no standalone lint script; vue-tsc runs in the successful frontend build.
- Prisma CLI reports the available 7.8.0 to 8.0.0-rc.12 upgrade; dependencies were intentionally unchanged and validate／generate passed.
- Two preliminary migrate-status invocations exited before connecting because of cwd／Prisma-config discovery; the corrected backend-directory invocation passed and no database write occurred.

## Files

- Added docs/contract-void-correction-acceptance.md.
- Added this report.
- Appended the Task 11 result to progress.md.
- Round 2 extended contract-void impact unit coverage and the real MySQL／HTTP correction E2E fixture; it also corrected the FilesService TTL test-only clock-window assertion.
- No production source, schema, migration or environment file changed.

## Commit

Independent documentation commit message:

docs: record contract void correction acceptance

Independent Round 2 test-and-evidence commit message:

test: cover contract void multi-period and prepayment debit
