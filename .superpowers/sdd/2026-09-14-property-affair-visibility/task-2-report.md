# Task 2 Report: Property Affair Visibility DTO and Presenter Contracts

## Implementation

- Added `visibilityScope` and `viewerUserIds` request fields to create and update DTOs.
- Create defaults omitted visibility payloads to `ALL` with `viewerUserIds: []`.
- Added class-validator checks for visibility enum values, viewer array shape, uniqueness, and positive integer IDs.
- Added a cross-field validator requiring at least one viewer whenever `visibilityScope` is `RESTRICTED`.
- Extended `propertyAffairInclude` to select viewer user `id`, `displayName`, `role`, and `status`, ordered by display name.
- Presenter returns `visibilityScope` from the affair and serializes only explicit viewers as `{ id, displayName }`.
- Preserved compatibility with legacy unit-test fixtures that do not yet contain the newly included viewer relation by returning an empty viewer list for an absent relation.

## TDD evidence

### RED

Command:

```text
npm --prefix backend test -- --runInBand src/property-affairs/dto/property-affair-dto.spec.ts
```

Before implementation: 1 suite failed; 3 newly added tests failed while 31 existing tests passed. The failures showed absent `visibilityScope` / `viewerUserIds` defaults and missing numeric transformation/validation.

### GREEN

Command:

```text
npm --prefix backend test -- --runInBand src/property-affairs/dto/property-affair-dto.spec.ts src/property-affairs/property-affairs.service.spec.ts
```

Result: 2 suites passed, 92 tests passed.

Additional verification:

```text
npm --prefix backend run build
```

Result: succeeded.

## Files changed

- `backend/src/property-affairs/dto/create-property-affair.dto.ts`
- `backend/src/property-affairs/dto/update-property-affair.dto.ts`
- `backend/src/property-affairs/dto/property-affair-dto.spec.ts`
- `backend/src/property-affairs/property-affair-presenter.ts`
- `backend/src/property-affairs/property-affairs.service.spec.ts`
- `.superpowers/sdd/2026-09-14-property-affair-visibility/task-2-report.md`

## Self-review

- Confirmed `ALL` remains the create default and produces no requested explicit viewer IDs.
- Confirmed `RESTRICTED` is rejected without a viewer list and all supplied IDs are unique positive integers.
- Confirmed update accepts a scope change together with a complete viewer replacement payload; persistence is intentionally deferred.
- Confirmed the presenter does not synthesize creator or super-admin identities, and exposes only `id` and `displayName` for selected viewers.
- Confirmed no authorization filtering, viewer persistence, migration, environment, deployment, or unrelated tracked files were changed.

## Concerns / follow-up ownership

Task 4 must validate requested viewers against active ADMIN/SUPER_ADMIN user records and persist/reconcile viewer associations. Authorization filtering remains intentionally out of scope for this task.