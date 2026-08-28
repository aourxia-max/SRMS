# SDD ledger — plan: docs/superpowers/plans/2026-08-26-contract-void-correction.md

Workspace: `D:/Work/iwen-codex/codex-zhufang/srms/.worktrees/contract-void-correction`
Branch: `feature/contract-void-correction`
Plan start: `b5b27b6`
Preflight plan correction: `ff8585e`

## Pre-flight consistency scan

| Tasks | Producer / consumer or internal check | Finding |
|---|---|---|
| 1 | Schema models, enums, migration, schema test | Consistent after adding `FileCategory.CONTRACT_VOID_PROOF` and a dedicated execution idempotency key. |
| 2 | Pure calculator, canonical hash, balance tests | Consistent after separating current impact, planned reversal, and post-reversal zero. |
| 3 | Snapshot loader consumes Task 2 and supplies preview | Consistent; the executor must call the same loader inside its transaction. |
| 4 | DTO/controller/workflow consumes Task 3 | Consistent; attachments remain optional and backend roles are authoritative. |
| 5 | Executor consumes Tasks 1–4 | Corrected: rejected checkout records are terminal history, not pending records to cancel. |
| 6 | Room reconciliation and mutation guards consume Task 5 | Consistent; successor contracts and special room states take precedence. |
| 7 | Finance/dashboard/export consumes Task 1 and Task 5 results | Potential double-counting ruled below; operating totals and money-flow audit have different views. |
| 8 | Frontend types/API mirror backend Tasks 4–7 | Consistent; all monetary values stay strings. |
| 9 | Workspace UI consumes Task 8 | Consistent; fifth tab, detail entry, Chinese statuses, exact confirmation phrase. |
| 10 | E2E consumes Tasks 1–9 | Consistent after changing the invariant field to `postReversalNetImpact`. |
| 11 | Regression/migration/test environment consumes Tasks 1–10 | Consistent; no secrets may be printed or committed. |
| 12 | Review/integration consumes all prior tasks | Consistent; push, merge, and production deploy remain explicit user choices. |
| 1 → 4 | File category and join model → upload/link service | Compatible; upload must use the enum rather than a free-form category. |
| 1 → 5 | Request/reversal persistence → executor | Compatible; request stores `executionIdempotencyKey`, reversal rows store source idempotency keys. |
| 1 → 7 | Reversal rows/statuses → reporting | Compatible under the reporting ruling below. |
| 1 → 11 | Migration → rehearsal | Compatible; migration does not rewrite existing rows. |
| 2 → 3 | Impact functions → preview | Compatible; stable sorting is mandatory before hashing. |
| 2 → 5 | Impact functions → transactional recalculation | Compatible; no duplicated financial formula is allowed in executor. |
| 2 → 10 | Summary invariant → E2E | Compatible; E2E asserts post-reversal zero. |
| 3 → 4 | Preview/hash → submission | Compatible; submission rejects stale hashes. |
| 3 → 5 | Snapshot loader → locked execution | Compatible if executor supplies its transaction client. |
| 4 → 5 | Request service/controller → approval executor | Compatible; only super admin executes. |
| 4 → 8 | Endpoints/DTOs → frontend client | Compatible; response envelope remains unchanged. |
| 4 → 9 | Workflow operations → UI actions | Compatible; admin applies, super admin approves/rejects, submitter may cancel. |
| 5 → 6 | Contract VOIDED/result → room and guards | Compatible; room history is appended only on an actual state change. |
| 5 → 7 | Reversals/statuses → financial queries | Compatible under the no-double-count ruling. |
| 5 → 10 | Transaction/idempotency → E2E | Compatible; concurrent/repeated approval must share one stored result. |
| 6 → 7 | Contract/commission filters → reports | Compatible; voided sources leave operating totals while source detail remains queryable. |
| 6 → 9 | Backend guards → hidden actions | Compatible; frontend hiding is supplementary only. |
| 6 → 10 | Room resolution → scenario assertions | Compatible; successor room status must remain unchanged. |
| 7 → 8 | Backend presentation → frontend types | Compatible; include original and correction dates. |
| 7 → 9 | Contract detail status → tags/actions | Compatible; VOIDED is visible and read-only. |
| 7 → 10 | Reporting rules → financial invariants | Compatible under the reporting ruling. |
| 8 → 9 | Types/client/labels → panels | Compatible; no raw status code is shown without a Chinese label. |
| 9 → 10 | UI workflow → API E2E | Compatible; frontend unit tests and backend E2E have separate scopes. |
| 10 → 11 | Feature E2E → full regression | Compatible; Task 11 reruns the whole suite. |
| 11 → 12 | Acceptance evidence → final review | Compatible; final reviewer receives ledger and full branch diff. |

## Rulings

Ruling: Store approval retry identity in `ContractVoidRequest.executionIdempotencyKey`, separate from the human-readable `executionBatchNo` — repeated and concurrent confirmation cannot be proven idempotent from reversal keys alone — if wrong, the schema gains one nullable unique field that can be removed before production migration.

Ruling: Preserve `CheckoutSettlementStatus.REJECTED`; only `DRAFT` and `PENDING` checkout records are auto-cancelled — the specification says pending workflows are cancelled and all history is preserved — if wrong, a rejected record remains rejected instead of being relabelled cancelled.

Ruling: The current SRMS has no financial-period or period-closing model, so “current open period” means the execution timestamp and `originalOccurredAt` preserves the historical date; do not invent a new finance-period module in this feature — if wrong, period-level enforcement must be added later and historical corrections made meanwhile will be dated at execution time.

Ruling: Operating totals exclude VOIDED contracts/bills/payments; cash-flow audit detail shows the retained original row and exactly one signed correction row. Reversal rows are not added a second time to rent-collection, deposit, or prepayment balances — if wrong, financial reports could overstate reversals and the Task 7 tests must be rewritten before merge.

## Progress

Baseline setup: complete — root/backend/frontend dependencies installed; Prisma validate/generate passed; backend 64 suites / 316 tests passed; frontend 33 files / 163 tests passed.

Task 1 Ruling: Use MySQL `ENUM(...)` for the new Prisma enum columns and the extended `FileCategory`, matching existing generated migrations; the plan phrase “enum-compatible VARCHAR columns” was imprecise — if wrong, migration SQL would need conversion before deployment.

Task 1 Ruling: When built-in `apply_patch` fails with the reproduced Windows deny-read ACL error, use a narrowly scoped escalated `git apply` patch and verify with `git diff --check` — if wrong, the editing mechanism changes but the resulting diff remains reviewable and reversible in Git.

Task 1: implementation submitted (commit `5aa09e4`, Prisma validate/generate passed, focused 2/2, backend full 318/318); task review pending.

Task 1: fix round 1/5 (1 addressed, 0 open — aligned `FileCategory` ENUM order and added exact-order regression test; commits `5aa09e4..168682a`).
Task 1: complete (commits `ff8585e..168682a`, review clean).

Task 2 Ruling: Monetary rows carry signed planned reversals and satisfy `balanceBefore + amount = balanceAfter`; PAYMENT uses gross receipt, REFUND carries the opposite approved refund effect, RENT_BILL and workflow/room/checkout indicators do not affect net cash impact, and the summary counts effective payment only once — if wrong, later preview/executor adapters must change the row contract and their tests before Task 5.

Task 2: fix round 1/5 (1 addressed, 0 open — recursively canonicalized nested impact arrays; commits `483be3d..6968d46`).
Task 2: complete (commits `168682a..6968d46`, review clean).
Task 1: fix round 2/5 after integration lint (1 addressed, 0 open — repository formatting restored; commit `95fa29f`; scoped review clean).

Task 3 Ruling: `loadInput` returns a structural subtype with a minimal `sourceSnapshot` for members, allocations, adjustments, rebates, checkout and commissions; none may be queried then discarded, and the combined snapshot participates in the canonical preview hash, while Task 2 remains the only calculator for already-defined non-duplicated effects — if wrong, Task 5 would lack source traceability or Task 3 would prematurely double-count categories.

Task 3: minor (deferred): allocation-order test reverses a one-element allocation array; generic canonicalization and other multi-element relation arrays cover correctness, final review should decide whether to strengthen it.
Task 3: complete (commits `95fa29f..f7fe920`, review clean with 1 deferred minor).

Task 1/4 Ruling: Add unique `submissionIdempotencyKey` separately from `executionIdempotencyKey`, because Task 4 mandates a submit idempotency key and network retries must return the original application — if wrong, one nullable/required unique request field and its Task 4 retry behavior must be removed before migration deployment.

Task 1: fix round 3/5 after Task 4 interface preflight (1 addressed, 0 open — added distinct submission idempotency key; commit 7c5ccaa; scoped review clean).

Task 4: fix round 1/5 (5 addressed, 0 important open — concurrency, tenant selector, proof claim/ownership, Chinese envelope, P2002 routing; commits 4977e95..3b80ca5).
Task 4: minor (deferred): cancel/reject response synthesizes stale updatedAt although the persisted terminal transition is correct.
Task 4: complete (commits 7c5ccaa..3b80ca5, review clean with 1 deferred minor).

Task 5 Ruling: Run correction transactions at READ COMMITTED and acquire deterministic locking reads for contract plus every hashed/reversed source before reload/hash; this avoids MySQL repeatable-read stale snapshots — if wrong, isolation/lock tests and production concurrency safety fail.
Task 5 Ruling: Add a singleton security-audit-chain head row and lock/update it inside every audit append transaction; unlocked tail reads cannot guarantee a linear hash chain — if wrong, the extra table can be removed only after another proven global serialization mechanism exists.
Task 5 Ruling: DepositRefund participates in pending preview hash; fully refunded payment/refund pairs receive zero-net append-only trace rows; cancellation traces are written only after exact successful conditional updates — if wrong, preview scope or trace categorization requires migration-safe rework before deployment.

Task 5: fix round 1/5 (8 addressed, 0 open — isolation/locks, audit head, DepositRefund hash, exact cancellations, full-refund traces, real MySQL rollback/concurrency, P2002; commits 533852e..4222ed3).
Task 5: complete (commits 3b80ca5..4222ed3, review clean; real MySQL E2E 2/2).

Task 6 Ruling: Include deposit-refunds.service and its tests in VOIDED contract guards; the plan file list omitted this separate mutation service even though deposit refunds are explicitly in the protected workflow — if wrong, this adds only a redundant guard to an already invalid contract state.

Task 6: fix round 1/5 (1 addressed, 1 open — production concurrency gaps fixed; mutation lock-order assertion coverage incomplete; commits a969041..20c3a2c)

Task 6: fix round 2/5 (1 addressed, 0 open — 31/31 mutation lock-order assertions complete; commits 20c3a2c..3ea844c)
Task 6: complete (commits 4222ed3..3ea844c, review clean; full unit 439/439; real MySQL concurrency E2E 4/4)

Task 7 Ruling: The payment effective-selector requirement permits the smallest frontend payment-service/view filter even though Task 7's file list omitted frontend files; the generic contract audit list stays unfiltered — if wrong, Task 8 must relocate these two small guards without changing stored data.
Task 7: minor (deferred): high-risk Prisma relation filters rely mainly on mock argument assertions; ensure real-database coverage in Task 10 E2E.
Task 7: minor (deferred): non-external cash-flow wording says internal offset for every flow type; use a generic or type-specific Chinese label before final delivery.

Task 7: fix round 1/5 (5 addressed, 0 open — full-refund pairing, Shanghai end-date boundary, voided checkout count, payment selector guard, Chinese export semantics; commits ef47437..4477b7e)
Task 7: complete (commits 3ea844c..4477b7e, review clean; backend unit 451/451; frontend unit 165/165)

Task 8 Ruling: Contract-void reversals are loaded only by the detail endpoint, not list; the frontend request type uses optional reversals while detail guarantees an array — if wrong, a later separate reversals endpoint can replace this without data migration.
Task 8: minor (deferred): add explicit null/undefined/empty-string presentation tests and settle whether empty renders the exact generic unknown format.
Task 8: minor (deferred): API tests use any, weakening compile-time DTO drift detection; replace with direct typed calls or satisfies before final delivery if final review prioritizes it.
Task 8: minor (deferred): add trailing newlines to frontend contract service/type files; Task 8 initial report self-review section was incomplete.

Task 8: fix round 1/5 (1 addressed, 0 open — detail-only reversal loading and serialized frontend contract; commits 3701d12..11a419b)
Task 8: complete (commits 4477b7e..11a419b, review clean; backend unit 453/453; frontend unit 171/171)

Task 9 Ruling: Historical contract-void proof preview/download requires a dedicated authorized request-file download endpoint; local object URLs are only an immediate-upload preview fallback — if wrong, this adds one narrowly scoped read endpoint that can be retired without data migration.

Task 9 Ruling: Super-admin direct execution remains the frozen submit-then-approve boundary, made recoverable with stable submission and execution idempotency keys plus visible pending state; no new atomic endpoint — if wrong, a later atomic endpoint is required, but these keys and recovery state remain reusable.
Task 9 Ruling: A pending request gets an explicit contract-first transactional snapshot-refresh endpoint for stale approval recovery, with no automatic re-approval — if wrong, the fallback is manual cancellation and resubmission without data migration.
Task 9 Ruling: Unlocked staged CONTRACT_VOID_PROOF assets expire after 24 hours via opportunistic cleanup and can be deleted only by their uploader before locking; DB-create failure unlinks the physical file — if wrong, only the centralized TTL constant and cleanup policy need adjustment.
Task 9: minor (deferred): harden Content-Disposition filename-star to full RFC 5987 encoding and cover quote, parenthesis, star, and CR/LF filenames unless naturally fixed in the current file-safety round.
Task 9: minor (deferred): initial tests omitted direct-step partial failures, approve stale, parent refresh, physical-file missing, and special filenames; fix-round tests must cover the Important paths, with remaining filename cases deferred.

Task 9 authorization: user explicitly authorized implementing the protected pending-request snapshot-refresh endpoint and transactional snapshot/hash update.
Task 9 authorization: user explicitly authorized deleting only unsubmitted, unlocked staged proof files/records under the controlled remove, reset, 24-hour TTL, and DB-create rollback lifecycle; submitted or historical attachments remain immutable.

Task 9: fix round 1/5 (3 addressed, 3 open — snapshot refresh, staged-proof lifecycle and Chinese file errors fixed; timeout/reload recovery, fail-closed parent refresh and same-room lock cycle remain; commits 0ac14c5..198afe0)
Task 9 Ruling: Contract-void exclusive refresh and execute paths supersede their local contract-first order with identity-only room lookup, then room lock and all room contracts locked by ascending id, followed by request/related rows; ordinary single-contract mutations never wait on room — if wrong, the whole lock protocol must be unified again before deployment.
Task 9: minor (deferred): TTL cleanup isolates unlink failures but claim recovery or DB delete failures can still abort the opportunistic cleanup and block the triggering upload.
Task 9: minor (deferred): fix round 1 retained a moderate formatted diff surface; keep subsequent fixes semantic-only.
Task 9: minor (deferred): complete RFC 5987 filename-star hardening remains pending unless final review promotes it.

Task 9: fix round 2/5 (0 addressed, 3 open — production lock order improved, but user-scope/terminal recovery, async fail-closed generation guard and barrier-backed E2E evidence remain; commits 198afe0..6af2921)
Task 9: minor (deferred): shared-room MySQL E2E fixtures were not cleaned; fix naturally in round 3 test work where safe.

Task 9: fix round 3/5 (2 addressed, 2 important open — user-scoped terminal recovery and parent generation guard fixed; exact persisted hash/status assertions remain incomplete, and user switching must also invalidate in-memory draft/attachments/async role state; commits 6af2921..afd5745).
Task 9: minor (deferred): invalidating an in-flight selected-contract request can leave the workspace loading flag set; fix naturally with the round 4 user-switch fail-closed work.
Task 9: fix round 4/5 (2 important + 1 minor addressed, 0 important open — exact persisted hash/status assertions, reactive role/auth fail-close, user-bound async invalidation and loading reset; base afd5745, implementation commit contains this ledger entry).

Task 9: fix round 4/5 review correction (1 important open — global Element Plus risk-confirmation prompt can outlive panel unmount after logout or downgrade; commit 2564525).
Task 9: final fix round 5/5 required: close any global contract-void confirmation prompt during panel unmount and prove downgrade/logout fail-closed behavior.

Task 9: fix round 5/5 implementation (1 important addressed — component-owned Element Plus prompt close on auth reset/unmount; stale resolve/reject remains API-inert; base 2564525, implementation commit contains this ledger entry).

Task 9: complete (commits 11a419b..e8bbc6a, final review clean; frontend unit 221/221; backend unit 477/477; real MySQL concurrency E2E 6/6).

Task 10 Ruling: The real API E2E may import only `MYSQL_*` from `deploy/.env.test` into its process and construct a localhost `DATABASE_URL`; values must never be printed, logged, modified or committed — if wrong, the E2E bootstrap must be replaced before any shared-database use.
Task 10 Ruling: Deliberately inconsistent VOIDED relation-filter sentinels are deleted only because they have no completed correction or append-only security audit; COMPLETED four-scenario chains retain their uniquely prefixed business provenance because deleting them would orphan immutable audit evidence — if wrong, a dedicated append-only test-data archival policy is required before cleanup.
Task 10 RED/GREEN: valid real-MySQL red was Excel contract-void rows showing `否（内部抵扣）` instead of `否（内部纠错）`; focused unit reproduced the exact mismatch, and a type-specific presentation-only mapping made focused finance 4/4 plus target E2E 6/6 pass without changing financial calculations.
Task 10: complete (implementation commit is the commit containing this ledger entry; real MySQL API E2E 6/6; related unit 85/85; backend full unit 477/477; lint/build/diff check clean).

Task 10 fix round 1 Ruling: E2E financial proof must compare a hand-derived persisted reversal table (category, source type/id, signed amount and balances), preserved payment/allocation sources and an independent persisted net-impact recomputation; preview/result constants and executor reversal counts are supplementary only — if wrong, the round 1 assertions can be narrowed without production or schema changes.
Task 10 fix round 1 Ruling: Register cleanup before the first fixture write, append each created ID immediately, then hydrate missing IDs only from the run's unique Chinese prefix and scenario label before deleting incomplete/no-audit chains; any COMPLETED request preserves the whole provenance chain — if wrong, only the test cleanup policy changes.
Task 10 fix round 1 RED/GREEN: existing production naturally passed the strengthened E2E 6/6; a temporary writer mutation omitting allocation reversals made the paid scenario fail on the exact missing PAYMENT_ALLOCATION source and -100.00 amount (1 failed, 5 skipped), then the fully restored production passed the same scenario 1/1 with no writer diff.
Task 10 fix round 1: 3 Important + 1 Minor addressed, 0 open — persisted reversal/payment/allocation/generated-ledger evidence, automatic-deposit provenance, progressive prefix-backed cleanup and non-correction internal-offset wording regression; no new production gap and no round 1 production change; real MySQL E2E 6/6, focused finance 5/5, backend unit 478/478, lint/build/diff check clean (base 84a3ea8, implementation commit contains this ledger entry).
Task 10 fix round 2 Ruling: Mutation-sensitivity proof must never run against the persistent shared srms_test database; CONTRACT_VOID_MUTATION_PROOF is allowed only for a localhost disposable database named srms_contract_void_mutation_<unique>, and all other targets fail before App initialization or fixture writes — if wrong, the guard can be relaxed only with an equivalent disposable database boundary.
Task 10 fix round 2 authorization: User explicitly authorized backing up and wholly DROP/CREATE rebuilding only compose project srms_test / container srms_test-mysql-1 / port 13306 / database srms_docker, accepting loss of current test data and using current-before-rebuild-20260828-094555 as rollback; production, other databases and env files remained out of scope.
Task 10 fix round 2: 1 Important addressed, 0 open — current DB and uploads backed up and hash-verified; the shared test DB was wholly rebuilt from the verified 20260825 baseline, migrated from 25 to 26 migrations, and verified at 45 tables with Task10 marker 0; mutation guard RED/GREEN 4/4, shared-DB rejection before writes, normal guard+E2E 10/10, related 86/86, backend full 478/478, Prisma validate/lint/build and test-environment health checks clean (base 5607cb4, implementation commit contains this ledger entry).
Task 10: complete after fix round 2 (independent re-review pending; shared-test pollution removed without row-level audit mutation).
Task 10 fix round 3 RED/GREEN: table-driven guard boundaries exposed malformed percent pathname leaking URIError and case-insensitive disposable names accepting uppercase prefix/identifier (3 failed, 6 passed); decode moved into the fixed-error catch and `/i` removed; focused guard 9/9, normal guard+target E2E 15/15, backend full 478/478, lint/build/diff check clean.
Task 10: complete after fix round 3 (1 Minor addressed, 0 open; no production/DB-schema/env-file changes; normal target E2E retains complete append-only provenance, while mutation proof remains disposable-DB-only).
Task 10 fix round 4: 1 Minor addressed, 0 open — added explicit 127.0.0.1 + strict lowercase disposable database allow regression; existing guard passed naturally with no implementation/production/DB-schema/env-file change; focused guard 10/10, normal guard+target E2E 16/16, backend full 478/478, lint/build/diff check clean.

Task 11 Ruling: Reuse the explicitly authorized Task 10 whole-database rebuild as the destructive migration rehearsal; Task 11 performs only read-only migrate status, schema/index/FK and backup-hash verification, because repeating DROP/CREATE would add risk without new acceptance evidence — if wrong, a new destructive rehearsal requires separate explicit authorization.
Task 11 Ruling: The four manual acceptance flows are satisfied by the normal AppModule/Supertest/Prisma E2E plus persisted read-only MySQL evidence under one unique Chinese prefix; do not create a second synthetic or mutation-backed data chain merely to duplicate the same append-only provenance — if wrong, browser/API manual data creation requires a separately reviewed fixture plan.
Task 11: complete — Prisma validate/generate passed; migration status found 26 applied migrations and schema up to date; 45 tables, 14 correction-table index/PK definitions and 4 RESTRICT FKs verified; backend lint + 79/79 unit suites (478/478) + build passed; frontend 39/39 files (221/221) + build passed; all backend E2E 7/7 suites (37/37) passed with CONTRACT_VOID_MUTATION_PROOF unset; focused UI/permission/attachment client 76/76 and controller/files 44/44 passed; Docker API/Web returned 200; four persisted normal-flow requests under 合同纠错测试-Task10-mtcgnnsdhthv54 completed with post-reversal net 0, retained sources/audits and unchanged ACTIVE-successor room state. No production defect or production-code change; acceptance documentation is included in the independent Task 11 documentation commit.
Task 11 fix round 1: 1 Important + 2 Minor addressed, 0 open — distinguished the immediate post-rebuild／migration 0 marker-request-reversal checkpoint from subsequent append-only GREEN E2E and the Task 11 recorded final read-only full-DB snapshot of 32 requests／127 reversals／32 CONTRACT_VOID_COMPLETED audits; confirmed marker `合同纠错测试-Task10-mtcgnnsdhthv54` requests 25–28 are four complete valid chains within that snapshot, not pollution; added the Spec §15 coverage／boundary matrix; classified `current-before-rebuild-20260828-094555` as polluted forensic-only rollback material and `backup-before-clear-20260825-081647` plus migrations to HEAD as the preferred clean rebuild, both with pre-restore database／uploads SHA-256 recheck and exact test-scope authorization; documentation only.
Task 11 fix round 2 Ruling: The repository has no DEBIT_TO_BILL creation service／API, so the E2E may use only the existing Prisma enum and foreign keys to assemble that source chain as test setup; it must preserve the source and reverse only the current remaining balance, and must not claim transfer／refund coverage — if wrong, add the real business entry point under a separately reviewed feature task before broadening acceptance claims.
Task 11 fix round 2: 1 Important + 1 Minor addressed, 0 open — real API／MySQL coverage now creates two rent periods, partially pays only the first and hand-verifies every source id／signed reversal／net-zero result; a real API CREDIT_RECEIPT 60.00 plus fixture-only DEBIT_TO_BILL 40.00／PREPAYMENT_AUTO chain proves only the remaining 20.00 is reversed while all sources remain append-only. New units were naturally GREEN and a pure-unit mutation made 3 tests fail before full restoration; new E2E 2/2, full target file 8/8, related units 25/25, backend full 79/79 suites／480/480 tests, lint and build passed. The unrelated FilesService 1 ms test-clock race was corrected test-only. Normal runs appended eight complete chains; the later read-only snapshot is 48 requests／193 reversals／48 CONTRACT_VOID_COMPLETED audits, all complete with zero nonzero post-reversal impacts and zero audit-cardinality anomalies. No production source, schema, migration or environment change.
