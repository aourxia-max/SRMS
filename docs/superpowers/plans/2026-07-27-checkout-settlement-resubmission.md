# Checkout Settlement Resubmission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a rejected checkout settlement to return to draft and be corrected on the original record before resubmission.

**Architecture:** Add a guarded backend transition that only accepts `REJECTED` settlements and retains all financial records and review fields. Expose it in the existing checkout view only for rejected rows, then load the persisted items into the current edit form so an administrator can correct and resubmit the original record.

**Tech Stack:** NestJS, Prisma, Jest, Vue 3, TypeScript, Element Plus.

## Global Constraints

- Preserve frozen payment, deposit, checkout, and role rules.
- The backend enforces JWT and ADMIN/SUPER_ADMIN authorization.
- No database schema change and no new checkout settlement is created.
- All implementation follows test-first development.

---

### Task 1: Backend rejected-to-draft transition

**Files:**
- Modify: `backend/src/checkout/checkout.service.ts`
- Modify: `backend/src/checkout/checkout.controller.ts`
- Create: `backend/src/checkout/checkout.service.spec.ts`

**Interfaces:**
- Produces `CheckoutService.returnToDraft(id: number, user: AuthUser)`.
- Produces `POST /api/checkout-settlements/:id/return-to-draft` for ADMIN and SUPER_ADMIN.

- [x] **Step 1: Write the failing service test**

```ts
it('returns a rejected settlement to draft without deleting its items', async () => {
  const result = await service.returnToDraft(1, adminUser);
  expect(result.status).toBe('DRAFT');
  expect(update).toHaveBeenCalledWith({
    where: { id: 1 },
    data: { status: 'DRAFT' },
  });
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm --prefix backend run test -- checkout.service.spec.ts --runInBand`

- [x] **Step 3: Add the minimal service method and guarded controller route**

```ts
if (settlement.status !== 'REJECTED') {
  throw new BadRequestException('只有已驳回结算单可以退回草稿');
}
return this.prisma.db.checkoutSettlement.update({
  where: { id },
  data: { status: 'DRAFT' },
});
```

Add the controller route with `@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)`.

- [x] **Step 4: Run the focused test and verify it passes**

Run: `npm --prefix backend run test -- checkout.service.spec.ts --runInBand`

### Task 2: Checkout view correction entry

**Files:**
- Modify: `frontend/src/views/CheckoutView.vue`

**Interfaces:**
- Consumes `POST /checkout-settlements/:id/return-to-draft`.
- Produces a rejected-row action that restores its stored items to `settlementForm`.

- [x] **Step 1: Add `returnToDraft(row)` to call the endpoint, clone `row.items`, then reload data**

```ts
async function returnToDraft(row: any) {
  await http.post(`/checkout-settlements/${row.id}/return-to-draft`)
  settlementForm.items = row.items.map((item: any) => ({ ...item }))
  await load()
}
```

- [x] **Step 2: Add a button only when `row.status === 'REJECTED'`**

```vue
<el-button v-if="row.status === 'REJECTED'" size="small" @click="returnToDraft(row)">
  退回草稿并修改
</el-button>
```

- [x] **Step 3: Build the frontend**

Run: `npm --prefix frontend run build`

### Task 3: Verify and document the complete correction flow

**Files:**
- Modify: `docs/task010-acceptance.md`

- [x] **Step 1: Exercise the local TEST settlement**

Reject settlement ID 1, return it to draft, add the existing 500-yuan arrears item and 200-yuan repair item, resubmit, then confirm the settlement.

- [x] **Step 2: Verify financial results**

Confirm that deposit 1,000 equals arrears offset 500 plus repair offset 200 plus refundable deposit 300; verify future unpaid bills are voided only after settlement confirmation.

- [x] **Step 3: Run full verification**

Run: `npm run build; npm run lint; npm run test; npm --prefix backend run test:e2e -- --runInBand; npm run db:validate`

- [x] **Step 4: Update acceptance record and commit**

Document TEST contract, settlement, amounts, permissions, and verification output. Commit with `fix: allow rejected checkout settlement resubmission`.
