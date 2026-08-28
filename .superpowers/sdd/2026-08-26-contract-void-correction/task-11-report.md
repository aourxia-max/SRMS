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

- `current-before-rebuild-20260828-094555` exactly captures the known polluted pre-rebuild state, including the incomplete mutation chain for marker `合同纠错测试-mtbw7plivhogqc` (request 115／contract 172, missing the PAYMENT_ALLOCATION -100.00 reversal and result category). It is forensic／original-state recovery material only, never a clean acceptance baseline.
- Any restore requires fresh, exact authorization for project／container／port／database and re-hashing both database.sql and uploads.tar.gz against the documented SHA-256 values before restoration.
- The preferred clean rebuild is `backup-before-clear-20260825-081647` database plus its hash-matched uploads, followed by migrations to HEAD.

## Automated verification

| Gate                                                          | Result                     |
| ------------------------------------------------------------- | -------------------------- |
| npm run db:validate                                           | PASS                       |
| npm run db:generate                                           | PASS; Prisma Client 7.8.0  |
| npm run lint                                                  | PASS                       |
| npm test -- --runInBand                                       | 79 suites / 478 tests PASS |
| npm --prefix backend run build                                | PASS                       |
| npm --prefix frontend run test:unit -- --testTimeout=15000    | 39 files / 221 tests PASS  |
| npm --prefix frontend run build                               | PASS                       |
| npm --prefix backend run test:e2e -- --runInBand              | 7 suites / 37 tests PASS   |
| Focused frontend correction UI／permission／attachment client | 4 files / 76 tests PASS    |
| Focused backend controller／files                             | 2 suites / 44 tests PASS   |
| API health                                                    | HTTP 200                   |
| Web root                                                      | HTTP 200                   |

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
- No production or test source changed.

## Commit

Independent documentation commit message:

docs: record contract void correction acceptance
