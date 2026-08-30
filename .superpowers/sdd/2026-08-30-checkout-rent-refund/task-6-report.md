# Task 6 Report — 收款详情、财务流水与合同纠错兼容

## Status

Completed and committed after verification.

## Implemented

- Payment details now return an `checkoutRentRefunds` read-only collection populated only from applied checkout rent refund allocations. Each record exposes its checkout settlement number, amount, completed Chinese status, final combined-refund reference, and proof-file metadata; it remains separate from ordinary payment-refund requests.
- Finance cash-flow reporting now uses each approved `DepositRefund` as the one external `CHECKOUT_COMBINED_REFUND` outflow, with a Chinese note containing deposit, prepayment, and rent splits. Deposit transaction entries remain internal-only, preventing duplicate external outflow counting.
- Contract-void impact inputs and snapshots retain applied checkout rent refund allocations, generated `CHECKOUT_RENT_REFUND` adjustments, checkout rent refundable snapshots, and combined-refund splits. Applied allocations are traced as refund impact rows exactly once.
- Contract-void reversal traces retain original sources and append correction records carrying adjustment linkage and all three combined-refund splits.
- Payment detail UI includes a read-only `退租租金退款` section with the settlement number, amount, completed status, and refund voucher reference. The section has no refund/delete action controls.

## TDD evidence

### RED

1. Command:

```text
npm --prefix backend test -- --runInBand payments.service.spec.ts finance.service.spec.ts contract-void-impact.spec.ts contract-void-reversal-writer.spec.ts contract-void-preview.service.spec.ts
```

Result: 5 suites failed as expected. The detail projection lacked `checkoutRentRefunds`; finance emitted no `CHECKOUT_COMBINED_REFUND`; and contract-void impact, preview snapshot, and reversal trace did not retain checkout rent refund data.

2. Command:

```text
npm --prefix frontend run test:unit -- payment-lifecycle-tags.spec.ts
```

Result: failed as expected because `[data-testid="checkout-rent-refunds"]` was absent. This mounted the actual payment detail view with an applied allocation fixture and verified the missing observable read-only section.

The inherited payment-detail RED test initially errored because it omitted the `Prisma` import; this was corrected before production implementation so it failed for the intended missing behavior. The inherited preview assertion also assumed an array contained only the new fixture record; it was corrected to assert inclusion, allowing the test to catch a missing record without depending on unrelated baseline entries.

### GREEN

```text
npm --prefix backend test -- --runInBand payments.service.spec.ts finance.service.spec.ts contract-void-impact.spec.ts contract-void-reversal-writer.spec.ts contract-void-preview.service.spec.ts
```

Result: 5/5 suites, 64/64 tests passing.

```text
npm --prefix frontend run test:unit -- payment-lifecycle-tags.spec.ts
```

Result: 1/1 file, 5/5 tests passing.

## Additional verification

```text
npm --prefix backend run prisma:generate
npm --prefix backend run build
npm --prefix frontend run build
npm run lint
git diff --check
```

All passed. The frontend build reports Vite's existing chunk-size advisory only; it does not fail the build.

## Files changed

- `backend/src/payments/payments.service.ts`
- `backend/src/payments/payments.service.spec.ts`
- `backend/src/finance/finance.service.ts`
- `backend/src/finance/finance.service.spec.ts`
- `backend/src/contracts/contract-void-impact.ts`
- `backend/src/contracts/contract-void-impact.spec.ts`
- `backend/src/contracts/contract-void-preview.service.ts`
- `backend/src/contracts/contract-void-preview.service.spec.ts`
- `backend/src/contracts/contract-void-reversal-writer.ts`
- `backend/src/contracts/contract-void-reversal-writer.spec.ts`
- `frontend/src/types/payments.ts`
- `frontend/src/views/payments/PaymentDetailView.vue`
- `frontend/src/views/payments/payment-lifecycle-tags.spec.ts`

## Self-review

- Finance overview was checked after an early text-edit mistake and restored to its original deposit/prepayment balance queries; the final production diff adds checkout refunds only inside `cashFlows`.
- Approved checkout allocations are filtered at the read boundary and represented separately from ordinary refunds.
- Contract-void amounts are included once as applied allocation refund rows; combined refund splits are trace metadata, not duplicate cash impact rows.
- No production environment, test database, secret, root main worktree, or Task 7+ files were touched.

## Concerns / risk

- No database-backed end-to-end test was run, per task scope and the instruction not to touch the test database. Prisma generation, compilation, focused unit regressions, frontend mount test, and builds cover the changed interfaces.
- The existing `PaymentDetailView.vue` had compact formatting. Project Prettier reformatted this task-owned file while fixing fallback-induced lint line-ending errors; this is non-functional but makes its diff larger than the semantic UI addition.