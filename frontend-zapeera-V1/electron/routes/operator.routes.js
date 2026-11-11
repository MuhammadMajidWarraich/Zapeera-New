/**
 * Operator Routes (v1.0.19 — staff PIN layer)
 *
 * The till OPERATOR endpoints: list a business's staff with PIN state,
 * verify a PIN locally and bind the operator, manager-override PIN
 * verification, and lock (clear). All local — no cloud calls — so shift
 * changes work fully offline on a provisioned device.
 *
 * This module also installs the operator-resolution middleware
 * (x-operator-token → req.operator). registerAllRoutes calls it FIRST
 * (right after auth routes) so downstream route handlers — sales,
 * shifts, refunds — can read req.operator.
 */

function registerOperatorRoutes(app, authMiddleware, deps) {
  const { query } = deps;
  const operatorService = deps.operatorService || require('../services/operator.service');

  const resolveBusinessId = (req) =>
    req.headers['x-business-id'] ||
    req.headers['x-company-id'] ||
    (req.query && req.query.businessId) ||
    (req.body && req.body.businessId) ||
    null;

  const publicOperator = (op) => ({
    staffProfileId: op.staffProfileId,
    membershipId: op.membershipId,
    userId: op.userId,
    businessId: op.businessId,
    name: op.name,
    role: op.role || null,
    boundAt: op.boundAt || null
  });

  // ── Operator resolution middleware ──────────────────────────────────
  // A valid x-operator-token attaches req.operator for every downstream
  // handler. An absent/invalid token is NOT an error — most requests
  // legitimately run as the device account (operator = session user).
  app.use((req, res, next) => {
    try {
      const token = req.headers['x-operator-token'];
      if (token) {
        const binding = operatorService.getBindingByToken(String(token));
        if (binding) req.operator = binding;
      }
    } catch { /* operator resolution must never break a request */ }
    next();
  });

  // GET /api/operator/staff?businessId= — lock-screen roster + PIN state.
  app.get('/api/operator/staff', authMiddleware, (req, res) => {
    try {
      const businessId = resolveBusinessId(req);
      if (!businessId) {
        return res.status(400).json({ success: false, message: 'businessId is required' });
      }
      const result = operatorService.listStaffForBusiness(String(businessId));
      res.json({ success: true, data: result });
    } catch (e) {
      console.error('[Operator] Staff list error:', e.message);
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // POST /api/operator/verify-pin — verify locally, bind the operator.
  app.post('/api/operator/verify-pin', authMiddleware, async (req, res) => {
    try {
      const businessId = resolveBusinessId(req);
      const { staffProfileId, pin } = req.body || {};
      if (!businessId || !staffProfileId) {
        return res.status(400).json({ success: false, message: 'businessId and staffProfileId are required' });
      }
      const result = await operatorService.verifyPin(String(businessId), String(staffProfileId), pin);
      if (!result.ok) {
        const status = result.reason === 'PIN_LOCKED' ? 429 : result.reason === 'STAFF_NOT_FOUND' ? 404 : 401;
        return res.status(status).json({ success: false, code: result.reason, message: pinFailureMessage(result.reason), retryAfterMs: result.retryAfterMs || undefined });
      }
      const binding = operatorService.bindOperator(result.profile);
      res.json({
        success: true,
        data: { operatorToken: binding.operatorToken, operator: publicOperator(binding) }
      });
    } catch (e) {
      console.error('[Operator] Verify PIN error:', e.message);
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // POST /api/operator/verify-manager-pin — same local verification, but
  // the profile must hold a privileged role; issues a one-action
  // override grant (5 min, consumed by the guarded action).
  app.post('/api/operator/verify-manager-pin', authMiddleware, async (req, res) => {
    try {
      const businessId = resolveBusinessId(req);
      const { staffProfileId, pin } = req.body || {};
      if (!businessId || !staffProfileId) {
        return res.status(400).json({ success: false, message: 'businessId and staffProfileId are required' });
      }
      const result = await operatorService.verifyPin(String(businessId), String(staffProfileId), pin);
      if (!result.ok) {
        const status = result.reason === 'PIN_LOCKED' ? 429 : result.reason === 'STAFF_NOT_FOUND' ? 404 : 401;
        return res.status(status).json({ success: false, code: result.reason, message: pinFailureMessage(result.reason), retryAfterMs: result.retryAfterMs || undefined });
      }
      if (!operatorService.isPrivilegedRole(result.profile.role)) {
        return res.status(403).json({ success: false, code: 'NOT_PRIVILEGED', message: 'This action needs a manager or owner PIN' });
      }
      const overrideToken = operatorService.issueOverrideGrant(result.profile);
      res.json({
        success: true,
        data: {
          overrideToken,
          authoriser: {
            staffProfileId: result.profile.staffProfileId,
            userId: result.profile.userId,
            name: result.profile.name,
            role: result.profile.role || null
          }
        }
      });
    } catch (e) {
      console.error('[Operator] Verify manager PIN error:', e.message);
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // GET /api/operator/current?businessId= — the binding proven by the
  // caller's operator token (or, for UI restore after a renderer reload,
  // the binding row for the business when the session matches its
  // account — the token is returned so the UI can re-adopt it).
  app.get('/api/operator/current', authMiddleware, (req, res) => {
    try {
      if (req.operator) {
        return res.json({ success: true, data: { operator: publicOperator(req.operator) } });
      }
      const businessId = resolveBusinessId(req);
      if (!businessId) {
        return res.json({ success: true, data: { operator: null } });
      }
      const row = operatorService.getBindingForBusiness(String(businessId));
      if (!row) {
        return res.json({ success: true, data: { operator: null } });
      }
      const binding = operatorService.getBindingByToken(row.operatorToken);
      if (!binding) {
        return res.json({ success: true, data: { operator: null } });
      }
      res.json({
        success: true,
        data: { operator: publicOperator(binding), operatorToken: row.operatorToken }
      });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // POST /api/operator/clear — lock the till (operator unbound). The
  // account session is untouched: locking is an operator-layer act.
  app.post('/api/operator/clear', authMiddleware, (req, res) => {
    try {
      const businessId = resolveBusinessId(req) || (req.operator && req.operator.businessId);
      if (businessId) {
        operatorService.clearBinding(String(businessId));
      }
      res.json({ success: true, message: 'Operator cleared' });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });
}

function pinFailureMessage(reason) {
  switch (reason) {
    case 'PIN_MISMATCH': return 'Incorrect PIN';
    case 'NO_PIN_SET': return 'No PIN is set for this staff member yet';
    case 'PIN_LOCKED': return 'Too many incorrect attempts. Try again in a few minutes.';
    case 'INVALID_PIN_FORMAT': return 'PIN must be 4 to 6 digits';
    case 'STAFF_NOT_FOUND': return 'Staff member not found for this business';
    default: return 'PIN verification failed';
  }
}

module.exports = { registerOperatorRoutes };
