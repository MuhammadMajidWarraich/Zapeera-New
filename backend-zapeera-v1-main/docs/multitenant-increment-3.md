# Multitenant Increment 3 (Branch-Level Access Enforcement + Scoped Branch Cache)

This increment focuses on enforcing `membership_branches` branch access and making the frontend branch cache business-scoped.

## Backend

- Branch routes now resolve business + membership context for reads:
  - `backend-zapeera-v1-main/src/routes/branch.routes.ts`
- `resolveBranch` now verifies the branch belongs to the selected business when `req.business_id` is present:
  - `backend-zapeera-v1-main/src/middleware/multitenancy.middleware.ts`
- Branch listing is restricted by `membership_branches` for non-owner, non-superadmin memberships:
  - `backend-zapeera-v1-main/src/controllers/branch.controller.ts`
- `getBranch` now enforces business isolation + membership branch access (v2) with legacy fallback:
  - `backend-zapeera-v1-main/src/controllers/branch.controller.ts`

## Frontend

- Branch cache is now business-scoped to avoid overwriting branch lists when switching businesses:
  - `frontend-zapeera-V1/src/contexts/AdminContext.tsx`
  - `frontend-zapeera-V1/src/components/layout/MainLayout.tsx`
- Company selection no longer clears branch selection manually; AdminContext owns persistence:
  - `frontend-zapeera-V1/src/components/admin/CompanyManagement.tsx`

## Notes

- Frontend build remains blocked in this environment by `esbuild spawn EPERM` (runtime/sandbox). Backend TypeScript build passes.
