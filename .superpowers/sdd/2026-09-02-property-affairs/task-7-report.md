# Task 7 Report: Frontend foundation

## Files changed

- `frontend/src/types/property-affairs.ts` — property-affair JSON contract, payloads, relation summaries, pagination, and option types.
- `frontend/src/services/property-affairs.ts` — typed envelope-unwrapping API functions, FormData/blob helpers, Axios DELETE bodies, and Chinese backend error extraction.
- `frontend/src/services/property-affairs.spec.ts` — endpoint, payload, envelope, FormData/blob, DELETE, error, and upload-response type coverage.
- `frontend/src/utils/property-affair-labels.ts` and spec — centralized Chinese status, priority, relation, and availability labels with Chinese unknown fallbacks.
- `frontend/src/router/index.ts` — exported generic access seam and role-meta enforcement after existing auth/login semantics.
- `frontend/src/property-affair-access.spec.ts` — synthetic meta-route coverage for unauthenticated, allowed, disallowed, and login cases.

## TDD evidence

1. RED: `npm --prefix frontend run test:unit -- src/utils/property-affair-labels.spec.ts src/services/property-affairs.spec.ts` failed because the requested service and label modules did not yet exist.
2. RED: `npm --prefix frontend run test:unit -- src/property-affair-access.spec.ts` failed because `resolveRouteAccess` did not yet exist.
3. GREEN: focused suite passed with 20 tests after the initial implementation.
4. Contract correction: presenter detail files include `extension`, but the upload endpoint returns no `extension`; a compile-checked regression test was added first. RED build failed for the absent `PropertyAffairUploadFile` type, then the endpoint-specific result type made the build and focused suite green (21 tests).

## Verification

- Focused tests: 3 files, 21 tests passed.
- Full frontend unit suite: 54 files, 362 tests passed.
- No frontend lint script is defined in `frontend/package.json`; typechecking is part of the successful build.
- `npm --prefix frontend run build`: passed (`vue-tsc -b` and Vite build).
- `git diff --check`: passed.

## Self-review

- Types follow the presenter/controller JSON: ISO date strings, stringified attachment `sizeBytes`, numeric `version`, and relation snapshot/current/status/availability fields.
- Upload uses `FormData` field `file`; preview/download request `blob`; both DELETE mutation endpoints send `{ data: { version } }` through Axios config.
- Error arrays join with `；`; nonblank backend strings survive unchanged; fallbacks remain caller-provided Chinese.
- Known enum values always map to Chinese; unknown/null cases use Chinese fallbacks.
- Generic guard restores/checks authentication before role enforcement, retains login redirects, permits matching roles, and redirects mismatches to `session`.
- No backend, database, env, `App.vue`, concrete views, concrete property-affair routes, or navigation entries were changed.

## Concerns

- The existing Vite build emits its pre-existing large-chunk advisory, but exits successfully; no Task 7 code-splitting change is in scope.

## Commit

- `feat: add property affair frontend foundation`
