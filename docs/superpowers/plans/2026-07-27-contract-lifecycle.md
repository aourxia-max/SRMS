# Contract Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically move confirmed contracts through the frozen lifecycle at their start and end dates, with synchronized room state and history.

**Architecture:** Add a focused `ContractLifecycleService` inside the existing contracts module. It performs idempotent transactional transitions on startup and once daily. It exposes no HTTP route and never changes money or billing data.

**Tech Stack:** NestJS 11, `@nestjs/schedule`, Prisma 7, MariaDB, Jest.

## Global Constraints

- Start-date transition: `PENDING_START` to `ACTIVE`, with `PENDING_MOVE_IN` room to `RENTED`.
- End-date transition: `ACTIVE` to `PENDING_CHECKOUT`, with `RENTED` room to `PENDING_CHECKOUT`.
- End-date rent remains in the existing snapshot; no monetary record is recalculated.
- Every room change writes exactly one history row; no manual lifecycle API and no automatic `ENDED` status.

---

### Task 1: Lifecycle service and unit tests

**Files:**
- Create: `backend/src/contracts/contract-lifecycle.service.ts`
- Create: `backend/src/contracts/contract-lifecycle.service.spec.ts`
- Modify: `backend/src/contracts/contracts.module.ts`

**Interfaces:**
- Produces: `ContractLifecycleService.run(now?: Date): Promise<{ activated: number; pendingCheckout: number }>`.
- Consumes: `PrismaService.db`, Nest `OnApplicationBootstrap`, and `@Cron`.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it('activates due contracts once and synchronizes the room', async () => {
  await expect(service.run(new Date('2026-07-27T00:05:00Z')))
    .resolves.toEqual({ activated: 1, pendingCheckout: 0 });
  expect(contract.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'ACTIVE', activatedAt: expect.any(Date) }),
  }));
  expect(room.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ roomStatus: 'RENTED' }),
  }));
  expect(roomStatusHistory.create).toHaveBeenCalledTimes(1);
});

it('moves an active contract ending today to pending checkout without touching bills', async () => {
  await expect(service.run(new Date('2026-07-27T00:05:00Z')))
    .resolves.toEqual({ activated: 0, pendingCheckout: 1 });
  expect(contract.update).toHaveBeenCalledWith(expect.objectContaining({
    data: { status: 'PENDING_CHECKOUT' },
  }));
  expect(rentBill.update).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify the test is red**

Run: `npm --prefix backend run test -- contract-lifecycle.service.spec.ts --runInBand`

Expected: failure because `contract-lifecycle.service` does not exist.

- [ ] **Step 3: Add the minimal service**

```ts
@Injectable()
export class ContractLifecycleService implements OnApplicationBootstrap {
  constructor(private readonly prisma: PrismaService) {}
  async onApplicationBootstrap() { await this.run(); }
  @Cron('0 5 0 * * *') async run(now = new Date()) {
    return { activated: 0, pendingCheckout: 0 };
  }
}
```

Use transaction-scoped queries for `PENDING_START/startDate <= day` and `ACTIVE/endDate <= day`. Update the room only if it has the expected prior lifecycle state. Create the history row with `businessType: 'CONTRACT'` and `businessId: contract.id`. Do not reference `rentBill` in the service.

- [ ] **Step 4: Register the provider**

```ts
@Module({
  controllers: [ContractsController],
  providers: [ContractsService, ContractLifecycleService],
})
export class ContractsModule {}
```

- [ ] **Step 5: Verify focused tests are green**

Run: `npm --prefix backend run test -- contract-lifecycle.service.spec.ts --runInBand`

Expected: activation, end-date, idempotence, non-overwrite and untouched-terminal-status cases pass.

- [ ] **Step 6: Commit the implementation**

Run: `git add backend/src/contracts/contract-lifecycle.service.ts backend/src/contracts/contract-lifecycle.service.spec.ts backend/src/contracts/contracts.module.ts`

Run: `git commit -m "feat: automate contract lifecycle"`

### Task 2: Regression and TEST-data verification

**Files:**
- Modify: `docs/manual-acceptance-checklist.md`
- Modify: `docs/task009-acceptance.md`
- Modify: `docs/task010-acceptance.md`

**Interfaces:**
- Consumes: `ContractLifecycleService.run(now)` and existing contract/room history APIs.
- Produces: acceptance records containing only `TEST-` contract and room identifiers.

- [ ] **Step 1: Run the full regression suite**

Run: `npm run build; npm run lint; npm run test; npm --prefix backend run test:e2e -- --runInBand; npm run db:validate`

Expected: all commands exit 0 and include the lifecycle test coverage.

- [ ] **Step 2: Verify TEST data through the service and existing APIs**

Run the lifecycle only against date-eligible `TEST-` contracts. Read final states through `/api/contracts/:id` and `/api/properties/rooms/:id/history`; do not directly change contract or room status in MySQL.

- [ ] **Step 3: Record acceptance evidence**

Update the checklist and Task009/Task010 records with contract number, room number, state transition and matching history entry. Mark any unrelated real-data scenarios still pending.

- [ ] **Step 4: Commit acceptance records**

Run: `git add docs/manual-acceptance-checklist.md docs/task009-acceptance.md docs/task010-acceptance.md`

Run: `git commit -m "docs: record lifecycle acceptance"`

## Plan Self-Review

- Task 1 covers startup catch-up, daily scheduling, both frozen transitions, idempotence, room history and monetary isolation.
- Task 2 covers repository regression and dedicated TEST-data acceptance without direct database status edits.
- All names and method signatures are consistent with the approved design.
