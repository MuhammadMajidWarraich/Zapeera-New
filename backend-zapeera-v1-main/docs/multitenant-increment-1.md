# Multi-Tenant Upgrade - Increment 1

This increment adds the **foundation** for the Identity/Business/Access/Capability split without breaking existing APIs.

## What was added

- SQL migration: `prisma/migrations/20260417_multitenant_increment_1_foundation/migration.sql`
- New middleware chain components:
  - `resolveBusiness`
  - `resolveMembership`
  - `resolveBranch`
  - `checkPermission`
  - `checkModule`
- Module endpoint:
  - `GET /api/modules/enabled`
- Sales + Reports routes now run through business/membership/branch/module context middleware.

## Middleware chain (Increment 1)

1. `authenticate`
2. `resolveBusiness` (reads `X-Company-ID`)
3. `resolveMembership` (user + business)
4. `resolveBranch` (reads `X-Branch-ID`)
5. `checkPermission(...)` (where configured)
6. `checkModule(...)`

Request context now carries:

- `req.user`
- `req.business_id`
- `req.membership`
- `req.branch_id`

## Updated API examples

### 1) Create Sale (module + permission aware)

`POST /api/sales`

Headers:

- `Authorization: Bearer <token>`
- `X-Company-ID: <business_id>`
- `X-Branch-ID: <branch_id>`

Body (unchanged shape, now context-aware):

```json
{
  "customerId": "cus_123",
  "branchId": "br_01",
  "items": [
    {
      "productId": "prod_01",
      "quantity": 2,
      "saleType": "UNIT",
      "unitPrice": 350
    }
  ],
  "paymentMethod": "CASH"
}
```

### 2) Sales Report

`GET /api/reports/sales?startDate=2026-04-01&endDate=2026-04-17`

Headers:

- `Authorization: Bearer <token>`
- `X-Company-ID: <business_id>`
- `X-Branch-ID: <branch_id>` (optional, for branch-specific report)

### 3) Enabled Modules for active business

`GET /api/modules/enabled`

Headers:

- `Authorization: Bearer <token>`
- `X-Company-ID: <business_id>`

Response:

```json
{
  "success": true,
  "data": [
    { "name": "dashboard", "enabled": true },
    { "name": "sales", "enabled": true },
    { "name": "inventory", "enabled": false }
  ]
}
```

## Frontend adjustments in this increment

- Added module-aware UI gating hook:
  - `src/hooks/useBusinessModules.ts`
- Sidebar now conditionally shows items by module enablement:
  - `src/components/layout/RoleBasedSidebar.tsx`
- Existing business switcher and branch selector remain unchanged and backward compatible.

## Compatibility notes

- If new tables are not migrated yet, middleware uses legacy-safe fallbacks.
- Existing route URLs and payloads are preserved.
- This increment is additive and does not remove legacy role/staff paths yet.

## Next increment (planned)

1. Replace staff endpoints with membership-backed endpoints.
2. Enforce limits from `user_subscriptions` / `business_subscriptions` on:
   - business creation
   - branch creation
   - member invites
3. Persist `membership_id` as actor in create/update flows (sales, inventory, etc.).

