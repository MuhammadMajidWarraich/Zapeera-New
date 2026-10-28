/**
 * Gift cards — embedded port of
 * backend-zapeera-v1-main/src/controllers/giftcard.controller.ts +
 * utils/giftcard-kiosk.util.ts (routes /api/gift-cards).
 *
 * A gift-card purchase is a LIABILITY (prepaid value owed to the
 * holder), not a sale: no Sale row is written, and the purchase value
 * never lands in sales revenue. Redemption itself is NOT here: a gift
 * card is redeemed as TENDER on a POS sale (payment method GIFT_CARD)
 * — the sale engine's redemption is a separate hook, not ported here.
 *
 * Pack gate: the cloud gates on the GIFT_CARD_KIOSK_PACK add-on
 * (isGiftCardKioskEnabled). The desktop checks the same add-on in
 * its local subscription_addons table (type GIFT_CARD_KIOSK_PACK,
 * status ACTIVE) — 403 GIFT_CARD_KIOSK_NOT_ENABLED without it.
 * Codes are GC-XXXX-XXXX from an unambiguous alphabet (no 0/O, 1/I),
 * case-insensitive on input, stored upper-case.
 * LOCAL-ONLY (no cloud sync): gift_cards / gift_card_transactions
 * are not in the cloud pull feed / push map yet.
 */
const { getDataFilter } = require('../utils/helpers');
const { v4: uuid } = require('uuid');
const { mustRun } = require('../utils/db-write');

const GIFT_CARD_PAYMENT_METHODS = ['CASH', 'CARD', 'JAZZCASH', 'EASYPAISA', 'BANK_TRANSFER', 'MOBILE'];
const GIFT_CARD_KIOSK_ADDON = 'GIFT_CARD_KIOSK_PACK';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function normalizeGiftCardCode(code) {
  return String(code || '').trim().toUpperCase();
}

function generateGiftCardCode() {
  let suffix = '';
  for (let i = 0; i < 8; i++) suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return `GC-${suffix.slice(0, 4)}-${suffix.slice(4)}`;
}

function registerGiftcardsRoutes(app, authMiddleware, deps) {
  const { query, run, saveDatabase } = deps;

  function requireKiosk(req, res, companyFilter) {
    const addon = query("SELECT id FROM subscription_addons WHERE businessId = ? AND type = ? AND status = 'ACTIVE'", [companyFilter, GIFT_CARD_KIOSK_ADDON])[0];
    if (!addon) {
      res.status(403).json({ success: false, code: 'GIFT_CARD_KIOSK_NOT_ENABLED', message: 'Gift cards, eWallet & Kiosk are not enabled for this business. Enable the add-on to use them.' });
      return false;
    }
    return true;
  }
  function nullIfEmpty(v) {
    if (v === undefined || v === null) return null;
    const t = String(v).trim();
    return t === '' ? null : t;
  }
  function shapeCard(row, withTransactions) {
    const out = { ...row, initialValue: Number(row.initialValue) || 0, balance: Number(row.balance) || 0 };
    if (withTransactions) {
      out.transactions = query('SELECT * FROM gift_card_transactions WHERE giftCardId = ? ORDER BY createdAt DESC LIMIT 50', [row.id]);
    }
    return out;
  }
  function pageParams(req, def = 50) {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || def));
    return { page, limit, offset: (page - 1) * limit };
  }

  // POST /api/gift-cards — sell a new gift card at the counter
  app.post('/api/gift-cards', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required.' });
      if (!requireKiosk(req, res, companyFilter)) return;
      const b = req.body || {};
      if (!b.branchId) return res.status(400).json({ success: false, message: 'branchId is required' });
      if (typeof b.value !== 'number' || b.value <= 0) return res.status(400).json({ success: false, message: 'value must be a positive number' });
      if (b.recipientName !== undefined && b.recipientName !== null && String(b.recipientName).length > 120) return res.status(400).json({ success: false, message: 'recipientName cannot exceed 120 characters' });
      if (b.recipientPhone !== undefined && b.recipientPhone !== null && String(b.recipientPhone).length > 40) return res.status(400).json({ success: false, message: 'recipientPhone cannot exceed 40 characters' });
      if (b.paymentMethod !== undefined && b.paymentMethod !== null && !GIFT_CARD_PAYMENT_METHODS.includes(b.paymentMethod)) {
        return res.status(400).json({ success: false, message: `paymentMethod must be one of: ${GIFT_CARD_PAYMENT_METHODS.join(', ')}` });
      }
      const branch = query('SELECT id FROM branches WHERE id = ? AND companyId = ?', [b.branchId, companyFilter])[0];
      if (!branch) return res.status(400).json({ success: false, message: 'The branch was not found in this business.' });
      if (b.purchasedBy) {
        const customer = query('SELECT id FROM customers WHERE id = ? AND companyId = ?', [b.purchasedBy, companyFilter])[0];
        if (!customer) return res.status(400).json({ success: false, message: 'The purchasing customer was not found in this business.' });
      }
      const value = Math.round(b.value * 100) / 100;
      let code = null;
      for (let attempt = 0; attempt < 10 && !code; attempt++) {
        const candidate = generateGiftCardCode();
        if (!query('SELECT id FROM gift_cards WHERE code = ?', [candidate])[0]) code = candidate;
      }
      if (!code) return res.status(500).json({ success: false, message: 'Failed to generate a unique gift card code' });
      const id = uuid();
      const now = new Date().toISOString();
      try {
        mustRun(run,
          'INSERT INTO gift_cards (id, code, companyId, branchId, initialValue, balance, recipientName, recipientPhone, purchasedBy, paymentMethod, status, expiresAt, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, code, companyFilter, b.branchId, value, value, nullIfEmpty(b.recipientName), nullIfEmpty(b.recipientPhone), b.purchasedBy || null, b.paymentMethod || null, 'ACTIVE', b.expiresAt ? new Date(b.expiresAt).toISOString() : null, req.user?.id || null, now, now]
        );
        mustRun(run,
          'INSERT INTO gift_card_transactions (id, giftCardId, companyId, type, amount, balanceAfter, note, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [uuid(), id, companyFilter, 'PURCHASE', value, value, 'Gift card purchased', req.user?.id || null, now]
        );
      } catch (e) {
        // Compensating rollback: a card without its PURCHASE ledger
        // row is a liability with no audit trail — remove the card.
        run('DELETE FROM gift_card_transactions WHERE giftCardId = ?', [id]);
        run('DELETE FROM gift_cards WHERE id = ?', [id]);
        saveDatabase();
        throw e;
      }
      saveDatabase();
      const card = query('SELECT * FROM gift_cards WHERE id = ?', [id])[0];
      res.status(201).json({ success: true, data: shapeCard(card, true) });
    } catch (e) {
      console.error('[GiftCards] Purchase error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // GET /api/gift-cards — list (branchId/status/search filters)
  app.get('/api/gift-cards', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required.' });
      if (!requireKiosk(req, res, companyFilter)) return;
      const { page, limit, offset } = pageParams(req);
      const where = ['companyId = ?'];
      const params = [companyFilter];
      if (req.query.branchId) { where.push('branchId = ?'); params.push(String(req.query.branchId)); }
      if (req.query.status) { where.push('status = ?'); params.push(String(req.query.status).toUpperCase()); }
      if (req.query.search) {
        const q = `%${String(req.query.search).trim()}%`;
        where.push('(code LIKE ? OR recipientName LIKE ? OR recipientPhone LIKE ?)'); params.push(q, q, q);
      }
      const total = query(`SELECT COUNT(*) AS c FROM gift_cards WHERE ${where.join(' AND ')}`, params)[0].c;
      const rows = query(`SELECT * FROM gift_cards WHERE ${where.join(' AND ')} ORDER BY createdAt DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
      res.json({ success: true, data: { giftCards: rows.map((r) => shapeCard(r, false)), pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
    } catch (e) {
      console.error('[GiftCards] List error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // GET /api/gift-cards/code/:code — look a card up by code (POS tender lookup)
  app.get('/api/gift-cards/code/:code', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required.' });
      if (!requireKiosk(req, res, companyFilter)) return;
      const code = normalizeGiftCardCode(req.params.code);
      const card = query('SELECT * FROM gift_cards WHERE code = ? AND companyId = ?', [code, companyFilter])[0];
      if (!card) return res.status(404).json({ success: false, code: 'GIFT_CARD_NOT_FOUND', message: 'No gift card with this code was found in this business.' });
      res.json({ success: true, data: shapeCard(card, true) });
    } catch (e) {
      console.error('[GiftCards] Lookup error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // GET /api/gift-cards/:id — one card with its recent ledger rows
  app.get('/api/gift-cards/:id', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required.' });
      if (!requireKiosk(req, res, companyFilter)) return;
      const card = query('SELECT * FROM gift_cards WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!card) return res.status(404).json({ success: false, message: 'Gift card not found.' });
      res.json({ success: true, data: shapeCard(card, true) });
    } catch (e) {
      console.error('[GiftCards] Get error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // POST /api/gift-cards/:id/void — void a card (OWNER/MANAGER/ADMIN)
  app.post('/api/gift-cards/:id/void', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required.' });
      if (!requireKiosk(req, res, companyFilter)) return;
      const role = String(req.user?.role || '').toUpperCase();
      if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
        return res.status(403).json({ success: false, message: 'Only the owner or a manager can void a gift card.' });
      }
      const card = query('SELECT id, balance, status FROM gift_cards WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!card) return res.status(404).json({ success: false, message: 'Gift card not found.' });
      if (String(card.status).toUpperCase() === 'VOIDED') {
        return res.status(409).json({ success: false, code: 'GIFT_CARD_ALREADY_VOIDED', message: 'This gift card is already voided.' });
      }
      const balance = Math.round((Number(card.balance) || 0) * 100) / 100;
      const now = new Date().toISOString();
      try {
        mustRun(run, 'UPDATE gift_cards SET balance = 0, status = ?, updatedAt = ? WHERE id = ?', ['VOIDED', now, card.id]);
        if (balance > 0) {
          mustRun(run,
            'INSERT INTO gift_card_transactions (id, giftCardId, companyId, type, amount, balanceAfter, note, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [uuid(), card.id, companyFilter, 'ADJUSTMENT', -balance, 0, 'Card voided — remaining balance written off', req.user?.id || null, now]
          );
        }
      } catch (e) {
        // Compensating rollback: restore the card — a voided card with
        // no write-off ledger row would hide the liability.
        run('UPDATE gift_cards SET balance = ?, status = ?, updatedAt = ? WHERE id = ?', [balance, card.status, now, card.id]);
        run('DELETE FROM gift_card_transactions WHERE giftCardId = ? AND type = ? AND amount = ?', [card.id, 'ADJUSTMENT', -balance]);
        saveDatabase();
        throw e;
      }
      saveDatabase();
      const voided = query('SELECT * FROM gift_cards WHERE id = ?', [card.id])[0];
      res.json({ success: true, data: shapeCard(voided, true) });
    } catch (e) {
      console.error('[GiftCards] Void error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
}

module.exports = {
  registerGiftcardsRoutes
};
