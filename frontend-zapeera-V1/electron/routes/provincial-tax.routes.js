/**
 * Provincial tax config — embedded port of
 * backend-zapeera-v1-main/src/controllers/provincial-tax.controller.ts
 * (routes /api/provincial-tax; module sales — core).
 *
 * · Writes are OWNER ONLY (stricter than tax classes). Reads are
 *   OWNER/MANAGER/ADMIN.
 * · DELETE is a retire (enabled = false): past sales snapshot
 *   authority/rate onto their SaleProvincialTaxLine rows.
 * · At most one ENABLED config per (company, branchId) scope:
 *   enabling a config disables its enabled siblings in the same
 *   scope in the same write.
 * · The summary aggregates SaleProvincialTaxLine rows. The embedded
 *   sale engine does not write those rows yet, so the summary reads
 *   the table only when it exists and otherwise reports empty
 *   aggregates — the config surface is fully live; the sale-time
 *   provincial-tax snapshot is a follow-up.
 * LOCAL-ONLY (no cloud sync): provincial_tax_configs is not in the
 * cloud pull feed / push map yet.
 */
const { getDataFilter } = require('../utils/helpers');
const { v4: uuid } = require('uuid');

const PROVINCIAL_AUTHORITIES = ['PRA', 'SRB', 'KPRA', 'BRA'];
const PROVINCIAL_AUTHORITY_NAMES = {
  PRA: 'Punjab Revenue Authority',
  SRB: 'Sindh Revenue Board',
  KPRA: 'Khyber Pakhtunkhwa Revenue Authority',
  BRA: 'Balochistan Revenue Authority'
};
const PROVINCIAL_AUTHORITY_PROVINCES = {
  PRA: 'Punjab',
  SRB: 'Sindh',
  KPRA: 'Khyber Pakhtunkhwa',
  BRA: 'Balochistan'
};
const PROVINCE_TO_AUTHORITY = {
  punjab: 'PRA',
  sindh: 'SRB',
  'khyber pakhtunkhwa': 'KPRA',
  'khyber-pakhtunkhwa': 'KPRA',
  kp: 'KPRA',
  balochistan: 'BRA',
  baluchistan: 'BRA'
};

function authorityForProvince(province) {
  if (!province) return null;
  return PROVINCE_TO_AUTHORITY[String(province).trim().toLowerCase()] || null;
}

function registerProvincialTaxRoutes(app, authMiddleware, deps) {
  const { query, run, saveDatabase } = deps;

  function requireOwner(req, res) {
    if (String(req.user?.role || '').toUpperCase() !== 'OWNER') {
      res.status(403).json({ success: false, message: 'Only the business owner can manage provincial tax settings' });
      return false;
    }
    return true;
  }
  function requireManager(req, res) {
    const role = String(req.user?.role || '').toUpperCase();
    if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
      res.status(403).json({ success: false, message: 'Only the owner or a manager can view provincial tax settings' });
      return false;
    }
    return true;
  }
  function nullIfEmpty(v) {
    if (v === undefined || v === null) return null;
    const t = String(v).trim();
    return t === '' ? null : t;
  }
  function serializeConfig(row) {
    return {
      ...row,
      rate: Number(row.rate) || 0,
      enabled: !!row.enabled,
      authorityName: PROVINCIAL_AUTHORITY_NAMES[row.authority] || row.authority,
      province: PROVINCIAL_AUTHORITY_PROVINCES[row.authority] || null
    };
  }
  function disableScopeSiblings(companyId, branchId, exceptId) {
    const params = [companyId];
    let sql = 'UPDATE provincial_tax_configs SET enabled = 0 WHERE companyId = ? AND enabled = 1';
    if (branchId === null || branchId === undefined) sql += ' AND branchId IS NULL';
    else { sql += ' AND branchId = ?'; params.push(branchId); }
    if (exceptId) { sql += ' AND id != ?'; params.push(exceptId); }
    run(sql, params);
  }

  app.get('/api/provincial-tax/summary', authMiddleware, (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const { from, to, branchId } = req.query;
      let lines = [];
      try {
        const where = ['s.companyId = ?'];
        const params = [companyFilter];
        if (branchId) { where.push('s.branchId = ?'); params.push(String(branchId)); }
        if (from) { where.push('s.createdAt >= ?'); params.push(new Date(String(from)).toISOString()); }
        if (to) { where.push('s.createdAt <= ?'); params.push(new Date(String(to)).toISOString()); }
        lines = query(
          `SELECT l.saleId, l.authority, l.authorityName, l.registrationNumber, l.rate, l.taxableAmount, l.taxAmount
           FROM sale_provincial_tax_lines l JOIN sales s ON s.id = l.saleId WHERE ${where.join(' AND ')}`,
          params
        );
      } catch (e) {
        // The embedded sale engine does not write provincial tax lines
        // yet (and the table may not exist on older local DBs): the
        // summary is empty rather than an error.
        lines = [];
      }
      const byAuthority = new Map();
      for (const line of lines) {
        let entry = byAuthority.get(line.authority);
        if (!entry) {
          entry = { authority: line.authority, authorityName: line.authorityName, registrationNumber: line.registrationNumber || null, rates: [], saleIds: new Set(), taxableAmount: 0, taxAmount: 0 };
          byAuthority.set(line.authority, entry);
        }
        entry.saleIds.add(line.saleId);
        if (!entry.rates.includes(Number(line.rate))) entry.rates.push(Number(line.rate));
        entry.taxableAmount += Number(line.taxableAmount) || 0;
        entry.taxAmount += Number(line.taxAmount) || 0;
      }
      const round2 = (n) => Math.round(n * 100) / 100;
      const byAuthorityOut = [...byAuthority.values()]
        .map((e) => ({ authority: e.authority, authorityName: e.authorityName, registrationNumber: e.registrationNumber, rates: e.rates, salesCount: e.saleIds.size, taxableAmount: round2(e.taxableAmount), taxAmount: round2(e.taxAmount) }))
        .sort((a, b) => a.authority.localeCompare(b.authority));
      res.json({
        success: true,
        data: {
          from: from ? String(from) : null,
          to: to ? String(to) : null,
          branchId: branchId ? String(branchId) : null,
          byAuthority: byAuthorityOut,
          totals: {
            salesCount: new Set(lines.map((l) => l.saleId)).size,
            taxableAmount: round2(byAuthorityOut.reduce((s, e) => s + e.taxableAmount, 0)),
            taxAmount: round2(byAuthorityOut.reduce((s, e) => s + e.taxAmount, 0))
          }
        }
      });
    } catch (e) {
      console.error('[ProvincialTax] Summary error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/provincial-tax/suggest-authority', authMiddleware, (req, res) => {
    const province = typeof req.query.province === 'string' ? req.query.province : '';
    const authority = authorityForProvince(province);
    res.json({ success: true, data: { province, authority, authorityName: authority ? PROVINCIAL_AUTHORITY_NAMES[authority] : null } });
  });

  app.post('/api/provincial-tax', authMiddleware, (req, res) => {
    try {
      if (!requireOwner(req, res)) return;
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      if (!PROVINCIAL_AUTHORITIES.includes(b.authority)) return res.status(400).json({ success: false, message: `authority must be one of: ${PROVINCIAL_AUTHORITIES.join(', ')}` });
      if (typeof b.rate !== 'number' || b.rate < 0 || b.rate > 100) return res.status(400).json({ success: false, message: 'rate must be a number between 0 and 100' });
      if (b.registrationNumber !== undefined && b.registrationNumber !== null && String(b.registrationNumber).length > 64) return res.status(400).json({ success: false, message: 'registrationNumber cannot exceed 64 characters' });
      const branchId = b.branchId || null;
      if (branchId && !query('SELECT id FROM branches WHERE id = ? AND companyId = ?', [branchId, companyFilter])[0]) {
        return res.status(400).json({ success: false, message: 'Branch not found in this business' });
      }
      const enabled = b.enabled === undefined ? true : !!b.enabled;
      if (enabled) disableScopeSiblings(companyFilter, branchId, null);
      const id = uuid();
      const now = new Date().toISOString();
      run(
        'INSERT INTO provincial_tax_configs (id, companyId, branchId, authority, registrationNumber, rate, enabled, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, companyFilter, branchId, b.authority, nullIfEmpty(b.registrationNumber), b.rate, enabled ? 1 : 0, req.user?.id || null, now, now]
      );
      saveDatabase();
      const row = query('SELECT * FROM provincial_tax_configs WHERE id = ?', [id])[0];
      res.status(201).json({ success: true, data: serializeConfig(row) });
    } catch (e) {
      console.error('[ProvincialTax] Create error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/provincial-tax', authMiddleware, (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const where = ['companyId = ?'];
      const params = [companyFilter];
      if (req.query.branchId) { where.push('branchId = ?'); params.push(String(req.query.branchId)); }
      if (req.query.authority) { where.push('authority = ?'); params.push(String(req.query.authority).toUpperCase()); }
      if (req.query.enabled !== undefined) { where.push('enabled = ?'); params.push(req.query.enabled === 'true' ? 1 : 0); }
      const rows = query(`SELECT * FROM provincial_tax_configs WHERE ${where.join(' AND ')} ORDER BY createdAt DESC`, params);
      res.json({ success: true, data: rows.map(serializeConfig) });
    } catch (e) {
      console.error('[ProvincialTax] List error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/provincial-tax/:id', authMiddleware, (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM provincial_tax_configs WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Provincial tax config not found' });
      res.json({ success: true, data: serializeConfig(row) });
    } catch (e) {
      console.error('[ProvincialTax] Get error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.put('/api/provincial-tax/:id', authMiddleware, (req, res) => {
    try {
      if (!requireOwner(req, res)) return;
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM provincial_tax_configs WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Provincial tax config not found' });
      const b = req.body || {};
      const sets = [];
      const params = [];
      const setStr = (col, v) => { sets.push(`${col} = ?`); params.push(v); };
      let newBranchId = row.branchId;
      if (b.authority !== undefined) {
        if (!PROVINCIAL_AUTHORITIES.includes(b.authority)) return res.status(400).json({ success: false, message: `authority must be one of: ${PROVINCIAL_AUTHORITIES.join(', ')}` });
        setStr('authority', b.authority);
      }
      if (b.registrationNumber !== undefined) {
        if (b.registrationNumber !== null && String(b.registrationNumber).length > 64) return res.status(400).json({ success: false, message: 'registrationNumber cannot exceed 64 characters' });
        setStr('registrationNumber', nullIfEmpty(b.registrationNumber));
      }
      if (b.rate !== undefined) {
        if (typeof b.rate !== 'number' || b.rate < 0 || b.rate > 100) return res.status(400).json({ success: false, message: 'rate must be a number between 0 and 100' });
        setStr('rate', b.rate);
      }
      if (b.branchId !== undefined) {
        newBranchId = b.branchId || null;
        if (newBranchId && !query('SELECT id FROM branches WHERE id = ? AND companyId = ?', [newBranchId, companyFilter])[0]) return res.status(400).json({ success: false, message: 'Branch not found in this business' });
        setStr('branchId', newBranchId);
      }
      if (b.enabled !== undefined) setStr('enabled', b.enabled ? 1 : 0);
      if (sets.length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });
      const willBeEnabled = b.enabled === undefined ? !!row.enabled : !!b.enabled;
      if (willBeEnabled) disableScopeSiblings(companyFilter, newBranchId, req.params.id);
      setStr('updatedAt', new Date().toISOString());
      params.push(req.params.id);
      run(`UPDATE provincial_tax_configs SET ${sets.join(', ')} WHERE id = ?`, params);
      saveDatabase();
      const updated = query('SELECT * FROM provincial_tax_configs WHERE id = ?', [req.params.id])[0];
      res.json({ success: true, data: serializeConfig(updated) });
    } catch (e) {
      console.error('[ProvincialTax] Update error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // DELETE = retire (enabled = false), as on the cloud
  app.delete('/api/provincial-tax/:id', authMiddleware, (req, res) => {
    try {
      if (!requireOwner(req, res)) return;
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM provincial_tax_configs WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Provincial tax config not found' });
      if (!row.enabled) return res.status(400).json({ success: false, message: 'This config is already disabled', code: 'PROVINCIAL_TAX_DISABLED' });
      run('UPDATE provincial_tax_configs SET enabled = 0, updatedAt = ? WHERE id = ?', [new Date().toISOString(), req.params.id]);
      saveDatabase();
      const updated = query('SELECT * FROM provincial_tax_configs WHERE id = ?', [req.params.id])[0];
      res.json({ success: true, data: serializeConfig(updated), message: 'Provincial tax config retired' });
    } catch (e) {
      console.error('[ProvincialTax] Delete error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
}

module.exports = { registerProvincialTaxRoutes };
