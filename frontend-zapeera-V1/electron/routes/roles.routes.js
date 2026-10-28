/**
 * Roles — embedded port of
 * backend-zapeera-v1-main/src/controllers/role.controller.ts
 * (routes /api/roles; the matrix is static config, not DB rows).
 *
 * GET /api/roles returns the ROLE_PERMISSIONS matrix keyed by role
 * name (the RoleManagement page reads this). getRolePermissions,
 * getUserPermissions, check-permission and resources/:resource/actions
 * read the same matrix. updateUserRole updates the caller's
 * MEMBERSHIP role (business-scoped) and upserts a business Role row
 * so the assignee is never denied everything by the authorization
 * layer; the business creator can never be demoted from OWNER.
 * All of these are OWNER-only except getUserPermissions / check /
 * resources (the caller's own role).
 */
const { getDataFilter } = require('../utils/helpers');
const { v4: uuid } = require('uuid');
const roles = require('../utils/role-permissions');

const ASSIGNABLE_ROLES = ['OWNER', 'USER', 'MANAGER', 'CASHIER'];

function registerRoleRoutes(app, authMiddleware, deps) {
  const { query, run, saveDatabase } = deps;

  function requireOwner(req, res) {
    const role = String(req.user?.role || '').toUpperCase();
    if (role !== 'OWNER' && role !== 'SUPERADMIN') {
      res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' });
      return false;
    }
    return true;
  }
  function membershipRole(req, companyFilter) {
    const m = query('SELECT role FROM memberships WHERE userId = ? AND businessId = ?', [req.user?.id, companyFilter])[0];
    return m ? String(m.role || '').toUpperCase() : String(req.user?.role || '').toUpperCase();
  }

  // GET /api/roles — the static matrix, keyed by role name
  app.get('/api/roles', authMiddleware, (req, res) => {
    try {
      if (!requireOwner(req, res)) return;
      const rolesObject = roles.ROLE_PERMISSIONS.reduce((acc, role) => {
        acc[role.role] = { ...role, moduleAccess: {} };
        return acc;
      }, {});
      res.json({ success: true, data: rolesObject });
    } catch (e) {
      console.error('[Roles] Get roles error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // GET /api/roles/permissions — the caller's own permissions
  app.get('/api/roles/permissions', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      const role = companyFilter ? membershipRole(req, companyFilter) : String(req.user?.role || '').toUpperCase();
      res.json({
        success: true,
        data: {
          user: { role, branchId: req.user?.branchId || null },
          permissions: roles.getRolePermissions(role),
          accessibleResources: roles.getAccessibleResources(role)
        }
      });
    } catch (e) {
      console.error('[Roles] Get user permissions error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // GET /api/roles/roles/:role/permissions
  app.get('/api/roles/roles/:role/permissions', authMiddleware, (req, res) => {
    try {
      if (!requireOwner(req, res)) return;
      const role = String(req.params.role || '').toUpperCase();
      if (!roles.ROLE_PERMISSIONS.some((r) => r.role === role)) {
        return res.status(404).json({ success: false, message: `Unknown role: ${role}` });
      }
      res.json({
        success: true,
        data: {
          role,
          permissions: roles.getRolePermissions(role),
          accessibleResources: roles.getAccessibleResources(role)
        }
      });
    } catch (e) {
      console.error('[Roles] Get role permissions error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // GET /api/roles/check-permission?resource=&action=
  app.get('/api/roles/check-permission', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      const role = companyFilter ? membershipRole(req, companyFilter) : String(req.user?.role || '').toUpperCase();
      const { resource, action } = req.query;
      if (!resource || !action) return res.status(400).json({ success: false, message: 'resource and action are required' });
      const allowed = roles.hasPermission(role, String(resource), String(action), req.user?.branchId || null, req.query.branchId ? String(req.query.branchId) : null);
      res.json({ success: true, data: { role, resource: String(resource), action: String(action), allowed } });
    } catch (e) {
      console.error('[Roles] Check permission error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // GET /api/roles/resources/:resource/actions
  app.get('/api/roles/resources/:resource/actions', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      const role = companyFilter ? membershipRole(req, companyFilter) : String(req.user?.role || '').toUpperCase();
      res.json({ success: true, data: { role, resource: req.params.resource, actions: roles.getAllowedActions(role, req.params.resource) } });
    } catch (e) {
      console.error('[Roles] Get allowed actions error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // PUT /api/roles/users/:userId/role — OWNER only; updates the membership role
  app.put('/api/roles/users/:userId/role', authMiddleware, (req, res) => {
    try {
      if (!requireOwner(req, res)) return;
      const b = req.body || {};
      const role = typeof b.role === 'string' ? b.role.trim().toUpperCase() : '';
      const businessId = b.businessId || req.query.companyId || (req.user && req.user.companyId) || null;
      if (!businessId) return res.status(400).json({ success: false, message: 'businessId is required in request body' });
      if (!ASSIGNABLE_ROLES.includes(role)) {
        return res.status(400).json({ success: false, message: 'Invalid role. Must be one of: OWNER, USER, MANAGER, CASHIER (business-scoped only)' });
      }
      const business = query('SELECT createdBy FROM companies WHERE id = ?', [businessId])[0];
      if (!business) return res.status(404).json({ success: false, message: 'Business not found' });
      if (role !== 'OWNER' && business.createdBy === req.params.userId) {
        return res.status(400).json({ success: false, message: 'The business creator cannot be demoted from OWNER' });
      }
      const membership = query('SELECT id FROM memberships WHERE userId = ? AND businessId = ?', [req.params.userId, businessId])[0];
      if (!membership) return res.status(404).json({ success: false, message: 'User is not a member of this business' });
      const now = new Date().toISOString();
      run('UPDATE memberships SET role = ?, updatedAt = ? WHERE id = ?', [role, now, membership.id]);
      // Keep the user's own role in step when this is their only business.
      const otherMemberships = query('SELECT id FROM memberships WHERE userId = ? AND businessId != ?', [req.params.userId, businessId]);
      if (otherMemberships.length === 0) run('UPDATE users SET role = ? WHERE id = ?', [role, req.params.userId]);
      // Ensure a business Role row with a policy exists for the role
      // (the cloud's ensureRoleWithPolicy equivalent, local form).
      const existingRole = query('SELECT id FROM roles WHERE businessId = ? AND name = ?', [businessId, role])[0];
      if (!existingRole) {
        run(
          'INSERT INTO roles (id, businessId, name, description, isSystem, isActive, permissionState, policyVersion, uuid, syncStatus, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [uuid(), businessId, role, `${role} role`, 1, 1, 'CONFIGURED', 1, uuid(), 'PENDING', now, now]
        );
      }
      saveDatabase();
      res.json({ success: true, data: { userId: req.params.userId, businessId, role }, message: 'User role updated successfully' });
    } catch (e) {
      console.error('[Roles] Update user role error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
}

module.exports = { registerRoleRoutes };
