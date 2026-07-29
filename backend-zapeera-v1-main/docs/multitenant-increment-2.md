# Multitenant Increment 2 (Membership-First Read Paths + Context Persistence)

This increment extends Increment 1 without breaking existing APIs/routes.

## Backend

- Switched shared-business listing to `memberships` (v2) first, with legacy `companyMember` fallback:
  - `getCompanies`
  - `getMyCompanies`
- Added reusable v2 membership lookup helpers in `company.controller.ts`:
  - `listUserSharedMembershipsV2`
  - `getBusinessMembershipContextV2`
- Updated member-removal permission resolution to use membership context (v2) first, then legacy fallback.
- Updated branch role-context resolution in `getBranches` to use `memberships + roles` first, then legacy fallback.

## Frontend

- Extended Admin business/branch selection persistence to remember branch selection per business:
  - Reads branch from `selected_branch_<userId>_<companyId>` first.
  - Falls back to `selected_branch_<userId>` for backward compatibility.
  - Saves scoped key when branch changes in a selected business.
  - Restores scoped branch when switching business.

## Compatibility

- Legacy `companyMember` paths remain as fallback.
- Existing routes and request/response shapes remain unchanged.
