# Authorization Redesign — Final Report

## [SUMMARY]

Replaced the legacy, inconsistent module-permission checks with a unified, fail-closed authorization system:

- **Canonical schema**: new additive tables (ModuleDefinition, ModulePage, Operation, PlanEntitlement, RolePermissionV2, BusinessTypeModule, BusinessTypePage, PolicyAuditLog) with capability-type enums; both Prisma providers (sqlite/postgresql) stay byte-identical in the model section.
- **One resolver**: `authorization.service.ts` computes effective access = business type ∩ plan entitlement ∩ business override ∩ active membership ∩ role permission (exact module+page+operation) ∩ data scope, with layered reasons for deny decisions.
- **Route registry**: `route-policy.registry.ts` maps every API route to a module/page/action; unknown routes fail closed (403) in production; the `/api` catch-all that previously made every route "public" was removed.
- **Global enforcement**: `universal-module-protection.middleware.ts` runs on all `/api` routes (mounted in `server.ts`); cache auto-invalidates via `@updatedAt` fingerprints (TTL 60s).
- **Atomic backoffice publishing**: one-click full-state saves for plans, roles, and business types under `/backoffice/policies/*`, replacing the legacy partial module-permissions endpoints (kept as deprecated).
- **Frontend wired**: Plans, Roles, and Business Types backoffice pages now publish the full atomic policy in a single request.
- **Idempotent data migration**: `scripts/migrate-auth-policies.js` converts existing legacy configuration into the canonical models with automatic SQLite backup.

## [FILES CHANGED]

Backend (`backend-zapeera-v1-main/`):

| File | Change |
| --- | --- |
| `prisma/schema.sqlite.prisma` / `prisma/schema.postgresql.prisma` | New capability tables + enums (additive, identical across providers) |
| `src/services/authorization.service.ts` | NEW canonical resolver (evaluateAccess, module/operation grants, data scopes, layered reasons, subscription/whitelist logic) |
| `src/config/route-policy.registry.ts` | NEW API route → policy map with longest-prefix matching; unknown routes fail closed |
| `src/middleware/universal-module-protection.middleware.ts` | NEW/rewritten global enforcement using registry + resolver |
| `src/utils/auth-policy-cache.ts` | NEW shared fingerprint-based cache (TTL 60s, MAX_SIZE 20000) |
| `src/controllers/module-permissions.controller.ts` | Legacy endpoints preserved (deprecated); NEW atomic endpoints: `publishPlanPolicy`, `publishRolePolicy`, `publishBusinessTypePolicy`, `previewEffectiveAccess`, `listPolicyRoles` + helpers (`loadPolicyCatalog`, `writePolicyAudit`, `MANDATORY_OWNER_RESOURCES`) |
| `src/routes/backoffice.routes.ts` | NEW canonical atomic policy routes, all admin-guarded |
| `src/controllers/admin.controller.ts` | `businessSubscription.updateMany` now bumps `updatedAt` so fingerprint cache invalidates |
| `src/utils/modules-v2.util.ts` | Cache invalidation hooks on every mutation; `FULL_OPERATION_SET` re-exported; `clearModuleCache` exported |
| `src/config/module-route-protection.config.ts` | `MODULE_PAGES` gains `prescriptions` page (matches hierarchy) |
| `src/server.ts` | Global protection middleware mounted |
| `src/services/sync.service.ts`, `src/middleware/module-access.middleware.ts`, `src/utils/modules.util.ts` (incl. seed) | Canonical seeding (module definitions/pages/operations), legacy guard removed |
| `scripts/migrate-auth-policies.js` | NEW idempotent legacy→canonical migration with SQLite backup + JSON dump option |
| `scripts/run-tests.js` | NEW test runner (sqlite client, provider restore) |
| `scripts/check-generated-provider.js`, `scripts/init-sqlite-db.js`, `scripts/fix-sqlite-setup.js`, `package.json` | Test/env tooling for sqlite |
| `tests/*` | `authorization-service.test.ts` (NEW, ~40 tests incl. middleware integration), `route-inventory.test.ts`, `module-page-permissions.test.ts` rewritten; suite infrastructure (`test-runner`, `port-manager`, `prisma-mode-assert`, `no-destructive-push`, `schema-sync`) |

Frontend (`frontend-zapeera-V1/`):

| File | Change |
| --- | --- |
| `src/backoffice/services/api.ts` | NEW `publishPlanPolicy`, `publishRolePolicy`, `publishBusinessTypePolicy`, `previewEffectiveAccess`, `getPolicyRoles` |
| `src/backoffice/pages/platform/plans/PlansPage.tsx` | Save → atomic `publishPlanPolicy` (module FULL / page FULL|NONE) |
| `src/backoffice/pages/platform/roles/RolesPage.tsx` | Save → atomic `publishRolePolicy` (roleId via `getPolicyRoles`, full operation matrix per enabled page) |
| `src/backoffice/pages/platform/business-types/BusinessTypesPage.tsx` | Save → atomic `publishBusinessTypePolicy` (module/page enablement in one PUT) |
| `scripts/check-lint-baseline.js` + `lint-baseline.json`, `eslint.config.js`, `package.json` | Lint gate infra |

## [BEHAVIOR CHANGES]

- **Fail-closed**: unmatched routes and unconfigured roles/plans deny by default (were permissive). CONFIGURED role with zero permission rows → full deny.
- OWNER role retains full access via code path (`MANDATORY_OWNER_RESOURCES` read grants preserved when publishing roles).
- Subscription gating unchanged in spirit but now enforced centrally with reasons (`upgradeUrl` returned for plan-denied requests).
- Legacy `/module-permissions/*` partial-save endpoints still work but are deprecated — the atomic `/policies/*` endpoints are the single source of truth.
- Sidebar/module visibility (`modules-v2.util`) is driven by the same canonical data.

## [MIGRATION STEPS]

> Schema changes are now applied automatically: the server runs a
> non-destructive `prisma db push` (PostgreSQL mode only) at startup
> (`src/config/schema-heal.ts`), so a fresh deploy self-migrates.

1. Optional manual run: `cd backend-zapeera-v1-main && node scripts/migrate-auth-policies.js`
   - SQLite: full DB file backup written to `backups/auth-policies-*.db`.
   - Postgres: JSON dump of the five legacy tables to `backups/auth-policies-*.json`.
   - Seed data is re-derived from the new canonical definitions; legacy rows converted to PlanEntitlement / RolePermissionV2 / BusinessTypeModule / BusinessTypePage.
   - System platform roles (OWNER/MANAGER/CASHIER) and ACTIVE OWNER memberships are ensured idempotently; each business gets a `PolicyAuditLog` MIGRATED_FROM_LEGACY entry.
2. Restart the backend. `db push` applies the new additive tables; the migration script is safe to re-run.

## [TEST RESULTS]

- Backend: **14 suites / 192 tests passing** via `npm test` (provider restored to sqlite; `npx tsc --noEmit` clean).
- Frontend: `npm run build:typecheck` clean; `npm run lint:gate` passes (0 new problems, 1145 baseline); `npm run build:prod` succeeds.
- Coverage highlights: effective subscription states, billing whitelist, owner/manager/cashier/custom roles, UNCONFIGURED deny, cross-tenant isolation, business-type and plan gating, data scopes, cache invalidation, dependency check + cycle fail-closed, middleware enforcement (cashier operation denial, plan-denied 403 with upgradeUrl, stranger 401).

## [KNOWN LIMITATIONS / DEFERRED]

- `previewEffectiveAccess` endpoint is implemented (POST `/backoffice/policies/preview`) but the backoffice preview UI is not yet built.
- The plan/business-type enable-toggle row in legacy sidebar config (`module-access.middleware`) is deprecated; remove it in a follow-up.
- Postgres migration path relies on the JSON dump (no live DB connection writer) — extend to direct postgres writes if live-migrating a hosted DB.
- Chunk-size warning on frontend build pre-exists (single 2.7 MB chunk).

## [QA CHECKLIST (manual)]

1. Fresh install: `/api/products` for a stranger → 401 NO_ACTIVE_MEMBERSHIP.
2. OWNER sees every module, full CRUD (business_management.settings, staff.staff read mandatory).
3. CASHIER: POS read/create allowed; purchases/reports denied (403 with logged warning).
4. Disable a module in Business Types → users of that type lose the module + 403 (reasons: BUSINESS_TYPE_MODULE_DENIED).
5. Switch plan to one without `sales` → sales unavailable with `upgradeUrl` (elenit).
6. Publish a role with zero pages → all denied (fail-closed).
7. Backoffice: edit Plan/Role/Business Type and Save → one PUT; audit entry in PolicyAuditLog.
8. Re-run `migrate-auth-policies.js` → no-op (idempotent).