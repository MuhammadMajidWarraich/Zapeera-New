/**
 * Hotel pack — embedded port of the cloud's room-type / room /
 * reservation / folio controllers (routes /api/room-types,
 * /api/rooms, /api/reservations, /api/folios; module gates: rooms,
 * reservations, folios — HOTEL only, via requireModule).
 *
 * Conventions mirror the cloud:
 * · Every query is scoped to the caller's business; an id from
 *   another tenant reads as "not found".
 * · No hard delete: DELETE deactivates (isActive = false) and is
 *   OWNER/MANAGER/ADMIN only.
 * · Room status machine (hotel.util): AVAILABLE → OCCUPIED is owned
 *   by check-in/check-out only; the status endpoint refuses to set
 *   or clear OCCUPIED by hand.
 * · A reservation books ONE room for a normalized date range;
 *   creation refuses an overlap with a BOOKED/CHECKED_IN reservation
 *   of the same room (409 RESERVATION_CONFLICT, half-open so a
 *   same-day turnover is fine).
 * · Check-in opens the folio at the room type's current rate
 *   (snapshotted), posts the first night's ROOM_NIGHT charge, flips
 *   the room to OCCUPIED and links reservation ↔ folio.
 * · The folio is the stay's bill: balance = Σ charges − Σ payments,
 *   computed on every read, never stored. Check-out settles it and
 *   produces ONE checkout invoice (folio-NATIVE charges only) through
 *   the service-sale helper; POS sales charged to the room are never
 *   re-billed.
 * · Document upload/serve endpoints return an honest 501: the
 *   embedded server has no upload store (multer); reservations can
 *   still be created without document refs.
 * Sync: room_types/rooms/reservations/folios/folio_charges/
 * folio_payments are in the cloud pull feed + push map, so writes
 * enqueue via handleDataChange.
 */
const { getDataFilter } = require('../utils/helpers');
const { v4: uuid } = require('uuid');
const { mustRun } = require('../utils/db-write');
const hotel = require('../utils/hotel.util');
const { requireModule } = require('../utils/module-applicability');
const { ensureServiceProduct, createServiceSale } = require('../utils/service-sale');

const SALE_PAYMENT_METHODS = ['CASH', 'CARD', 'JAZZCASH', 'EASYPAISA', 'BANK_TRANSFER', 'MOBILE', 'GIFT_CARD', 'EWALLET'];

function registerHotelRoutes(app, authMiddleware, deps) {
  const { query, run, saveDatabase, handleDataChange } = deps;

  function nullIfEmpty(v) {
    if (v === undefined || v === null) return null;
    const t = String(v).trim();
    return t === '' ? null : t;
  }
  function pageParams(req, def = 100) {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || def));
    return { page, limit, offset: (page - 1) * limit };
  }
  function pagination(page, limit, total) {
    return { page, limit, total, pages: Math.ceil(total / limit) };
  }
  function requireManager(req, res, action) {
    const role = String(req.user?.role || '').toUpperCase();
    if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
      res.status(403).json({ success: false, message: `Only the owner or a manager can ${action}` });
      return false;
    }
    return true;
  }
  function enqueue(entityType, op, row) {
    try { if (typeof handleDataChange === 'function') handleDataChange(entityType, op, row); } catch (e) { console.error('[Hotel] sync enqueue failed:', e.message); }
  }
  const gateRooms = requireModule('rooms', { query, getDataFilter });
  const gateReservations = requireModule('reservations', { query, getDataFilter });
  const gateFolios = requireModule('folios', { query, getDataFilter });

  function shapeRoomType(r) {
    return { ...r, isActive: !!r.isActive, ratePerNight: Number(r.ratePerNight) || 0 };
  }
  function shapeRoom(r) {
    const roomType = r.roomTypeId ? query('SELECT id, name, ratePerNight, capacity FROM room_types WHERE id = ?', [r.roomTypeId])[0] : null;
    return { ...r, isActive: !!r.isActive, roomType: roomType ? shapeRoomType(roomType) : null };
  }
  function shapeReservation(r) {
    const room = r.roomId ? query('SELECT * FROM rooms WHERE id = ?', [r.roomId])[0] : null;
    let guestPhotoUrls = [];
    try { guestPhotoUrls = r.guestPhotoUrls ? JSON.parse(r.guestPhotoUrls) : []; } catch { guestPhotoUrls = []; }
    return {
      ...r,
      guestPhotoUrls,
      adults: r.adults === null ? null : Number(r.adults),
      children: r.children === null ? null : Number(r.children),
      room: room ? shapeRoom(room) : null
    };
  }
  function folioSummary(folioId) {
    const charges = query('SELECT * FROM folio_charges WHERE folioId = ?', [folioId]);
    const payments = query('SELECT * FROM folio_payments WHERE folioId = ?', [folioId]);
    return hotel.summarizeFolioCharges(charges, payments);
  }
  function shapeFolio(r, withRows) {
    const room = r.roomId ? query('SELECT * FROM rooms WHERE id = ?', [r.roomId])[0] : null;
    const reservation = r.reservationId ? query('SELECT id, checkInDate, checkOutDate, status, source FROM reservations WHERE id = ?', [r.reservationId])[0] : null;
    const out = {
      ...r,
      rateSnapshot: Number(r.rateSnapshot) || 0,
      writeOffAmount: r.writeOffAmount === null ? null : Number(r.writeOffAmount),
      room: room ? shapeRoom(room) : null,
      reservation: reservation || null,
      summary: folioSummary(r.id)
    };
    if (withRows) {
      out.charges = query('SELECT * FROM folio_charges WHERE folioId = ? ORDER BY chargeDate ASC', [r.id]);
      out.payments = query('SELECT * FROM folio_payments WHERE folioId = ? ORDER BY paidAt ASC', [r.id]);
      if (r.saleId) {
        out.checkoutSale = query('SELECT id, invoiceNumber, totalAmount, paymentStatus FROM sales WHERE id = ?', [r.saleId])[0] || null;
      }
    }
    return out;
  }

  // ── Room types ──────────────────────────────────────────────────
  app.post('/api/room-types', authMiddleware, gateRooms, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      if (!b.name || !String(b.name).trim() || String(b.name).trim().length > 120) return res.status(400).json({ success: false, message: 'Room type name is required (max 120 characters)' });
      const rate = b.ratePerNight === undefined ? 0 : Number(b.ratePerNight);
      if (Number.isNaN(rate) || rate < 0) return res.status(400).json({ success: false, message: 'ratePerNight must be 0 or more' });
      if (b.capacity !== undefined && b.capacity !== null && (!Number.isInteger(b.capacity) || b.capacity < 1 || b.capacity > 50)) return res.status(400).json({ success: false, message: 'capacity must be an integer between 1 and 50' });
      const id = uuid();
      const now = new Date().toISOString();
      run(
        'INSERT INTO room_types (id, companyId, name, ratePerNight, capacity, description, isActive, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
        [id, companyFilter, String(b.name).trim(), rate, b.capacity ?? null, nullIfEmpty(b.description), req.user?.id || null, now, now]
      );
      saveDatabase();
      const row = query('SELECT * FROM room_types WHERE id = ?', [id])[0];
      enqueue('roomType', 'create', row);
      res.status(201).json({ success: true, data: shapeRoomType(row), message: 'Room type created successfully' });
    } catch (e) {
      console.error('[Hotel] Create room type error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/room-types', authMiddleware, gateRooms, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const { page, limit, offset } = pageParams(req);
      const where = ['companyId = ?'];
      const params = [companyFilter];
      if (req.query.search) { where.push('name LIKE ?'); params.push(`%${req.query.search}%`); }
      if (req.query.isActive !== undefined) { where.push('isActive = ?'); params.push(req.query.isActive === 'true' ? 1 : 0); }
      const total = query(`SELECT COUNT(*) AS c FROM room_types WHERE ${where.join(' AND ')}`, params)[0].c;
      const rows = query(`SELECT * FROM room_types WHERE ${where.join(' AND ')} ORDER BY name ASC LIMIT ? OFFSET ?`, [...params, limit, offset]);
      res.json({ success: true, data: rows.map(shapeRoomType), pagination: pagination(page, limit, total) });
    } catch (e) {
      console.error('[Hotel] Get room types error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/room-types/:id', authMiddleware, gateRooms, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM room_types WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Room type not found' });
      res.json({ success: true, data: shapeRoomType(row) });
    } catch (e) {
      console.error('[Hotel] Get room type error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.put('/api/room-types/:id', authMiddleware, gateRooms, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM room_types WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Room type not found' });
      const b = req.body || {};
      const sets = [];
      const params = [];
      const setStr = (col, v) => { sets.push(`${col} = ?`); params.push(v); };
      if (b.name !== undefined) {
        if (!String(b.name).trim() || String(b.name).trim().length > 120) return res.status(400).json({ success: false, message: 'Room type name is required (max 120 characters)' });
        setStr('name', String(b.name).trim());
      }
      if (b.ratePerNight !== undefined) {
        const rate = Number(b.ratePerNight);
        if (Number.isNaN(rate) || rate < 0) return res.status(400).json({ success: false, message: 'ratePerNight must be 0 or more' });
        setStr('ratePerNight', rate);
      }
      if (b.capacity !== undefined) {
        if (b.capacity !== null && (!Number.isInteger(b.capacity) || b.capacity < 1 || b.capacity > 50)) return res.status(400).json({ success: false, message: 'capacity must be an integer between 1 and 50' });
        setStr('capacity', b.capacity);
      }
      if (b.description !== undefined) setStr('description', nullIfEmpty(b.description));
      if (b.isActive !== undefined) setStr('isActive', b.isActive ? 1 : 0);
      if (sets.length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });
      setStr('updatedAt', new Date().toISOString());
      params.push(req.params.id);
      run(`UPDATE room_types SET ${sets.join(', ')} WHERE id = ?`, params);
      saveDatabase();
      const updated = query('SELECT * FROM room_types WHERE id = ?', [req.params.id])[0];
      enqueue('roomType', 'update', updated);
      res.json({ success: true, data: shapeRoomType(updated), message: 'Room type updated successfully' });
    } catch (e) {
      console.error('[Hotel] Update room type error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // DELETE = soft deactivate (OWNER/MANAGER/ADMIN), as on the cloud
  app.delete('/api/room-types/:id', authMiddleware, gateRooms, (req, res) => {
    try {
      if (!requireManager(req, res, 'deactivate a room type')) return;
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM room_types WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Room type not found' });
      if (!row.isActive) return res.status(400).json({ success: false, message: 'This room type is already inactive', code: 'ROOM_TYPE_INACTIVE' });
      run('UPDATE room_types SET isActive = 0, updatedAt = ? WHERE id = ?', [new Date().toISOString(), req.params.id]);
      saveDatabase();
      const updated = query('SELECT * FROM room_types WHERE id = ?', [req.params.id])[0];
      enqueue('roomType', 'update', updated);
      res.json({ success: true, data: shapeRoomType(updated), message: 'Room type deactivated' });
    } catch (e) {
      console.error('[Hotel] Deactivate room type error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // ── Rooms ───────────────────────────────────────────────────────
  app.post('/api/rooms', authMiddleware, gateRooms, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      if (!b.roomTypeId || !b.number || !String(b.number).trim() || String(b.number).trim().length > 20) return res.status(400).json({ success: false, message: 'roomTypeId and number (max 20 characters) are required' });
      const roomType = query('SELECT id FROM room_types WHERE id = ? AND companyId = ?', [b.roomTypeId, companyFilter])[0];
      if (!roomType) return res.status(404).json({ success: false, message: 'Room type not found' });
      const dup = query('SELECT id FROM rooms WHERE companyId = ? AND number = ?', [companyFilter, String(b.number).trim()])[0];
      if (dup) return res.status(409).json({ success: false, message: 'A room with this number already exists in this business', code: 'ROOM_NUMBER_TAKEN' });
      if (b.branchId && !query('SELECT id FROM branches WHERE id = ? AND companyId = ?', [b.branchId, companyFilter])[0]) {
        return res.status(400).json({ success: false, message: 'Branch not found in this business' });
      }
      const id = uuid();
      const now = new Date().toISOString();
      run(
        'INSERT INTO rooms (id, companyId, branchId, roomTypeId, number, floor, status, isActive, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
        [id, companyFilter, b.branchId || null, b.roomTypeId, String(b.number).trim(), nullIfEmpty(b.floor), 'AVAILABLE', req.user?.id || null, now, now]
      );
      saveDatabase();
      const row = query('SELECT * FROM rooms WHERE id = ?', [id])[0];
      enqueue('room', 'create', row);
      res.status(201).json({ success: true, data: shapeRoom(row), message: 'Room created successfully' });
    } catch (e) {
      console.error('[Hotel] Create room error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/rooms', authMiddleware, gateRooms, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const { page, limit, offset } = pageParams(req);
      const where = ['companyId = ?'];
      const params = [companyFilter];
      if (req.query.roomTypeId) { where.push('roomTypeId = ?'); params.push(String(req.query.roomTypeId)); }
      if (req.query.branchId) { where.push('branchId = ?'); params.push(String(req.query.branchId)); }
      if (req.query.status) { where.push('status = ?'); params.push(String(req.query.status).toUpperCase()); }
      if (req.query.isActive !== undefined) { where.push('isActive = ?'); params.push(req.query.isActive === 'true' ? 1 : 0); }
      const total = query(`SELECT COUNT(*) AS c FROM rooms WHERE ${where.join(' AND ')}`, params)[0].c;
      const rows = query(`SELECT * FROM rooms WHERE ${where.join(' AND ')} ORDER BY number ASC LIMIT ? OFFSET ?`, [...params, limit, offset]);
      res.json({ success: true, data: rows.map(shapeRoom), pagination: pagination(page, limit, total) });
    } catch (e) {
      console.error('[Hotel] Get rooms error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/rooms/:id', authMiddleware, gateRooms, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM rooms WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Room not found' });
      res.json({ success: true, data: shapeRoom(row) });
    } catch (e) {
      console.error('[Hotel] Get room error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.put('/api/rooms/:id', authMiddleware, gateRooms, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM rooms WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Room not found' });
      const b = req.body || {};
      const sets = [];
      const params = [];
      const setStr = (col, v) => { sets.push(`${col} = ?`); params.push(v); };
      if (b.roomTypeId !== undefined) {
        if (!query('SELECT id FROM room_types WHERE id = ? AND companyId = ?', [b.roomTypeId, companyFilter])[0]) return res.status(404).json({ success: false, message: 'Room type not found' });
        setStr('roomTypeId', b.roomTypeId);
      }
      if (b.number !== undefined) {
        if (!String(b.number).trim() || String(b.number).trim().length > 20) return res.status(400).json({ success: false, message: 'number is required (max 20 characters)' });
        const dup = query('SELECT id FROM rooms WHERE companyId = ? AND number = ? AND id != ?', [companyFilter, String(b.number).trim(), req.params.id])[0];
        if (dup) return res.status(409).json({ success: false, message: 'A room with this number already exists in this business', code: 'ROOM_NUMBER_TAKEN' });
        setStr('number', String(b.number).trim());
      }
      if (b.floor !== undefined) setStr('floor', nullIfEmpty(b.floor));
      if (b.branchId !== undefined) setStr('branchId', b.branchId || null);
      if (b.isActive !== undefined) setStr('isActive', b.isActive ? 1 : 0);
      if (sets.length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });
      setStr('updatedAt', new Date().toISOString());
      params.push(req.params.id);
      run(`UPDATE rooms SET ${sets.join(', ')} WHERE id = ?`, params);
      saveDatabase();
      const updated = query('SELECT * FROM rooms WHERE id = ?', [req.params.id])[0];
      enqueue('room', 'update', updated);
      res.json({ success: true, data: shapeRoom(updated), message: 'Room updated successfully' });
    } catch (e) {
      console.error('[Hotel] Update room error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.patch('/api/rooms/:id/status', authMiddleware, gateRooms, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM rooms WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Room not found' });
      const status = String(req.body?.status || '').trim().toUpperCase();
      if (!hotel.isRoomStatus(status)) return res.status(400).json({ success: false, message: `Invalid status: ${status}` });
      if (!hotel.canTransitionRoomStatus(row.status, status)) {
        return res.status(400).json({ success: false, message: `A room in status ${row.status} cannot move to ${status} by hand — OCCUPIED is set only by check-in/check-out`, code: 'ROOM_BAD_TRANSITION' });
      }
      run('UPDATE rooms SET status = ?, updatedAt = ? WHERE id = ?', [status, new Date().toISOString(), req.params.id]);
      saveDatabase();
      const updated = query('SELECT * FROM rooms WHERE id = ?', [req.params.id])[0];
      enqueue('room', 'update', updated);
      res.json({ success: true, data: shapeRoom(updated) });
    } catch (e) {
      console.error('[Hotel] Update room status error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // DELETE = soft deactivate (OWNER/MANAGER/ADMIN), as on the cloud
  app.delete('/api/rooms/:id', authMiddleware, gateRooms, (req, res) => {
    try {
      if (!requireManager(req, res, 'deactivate a room')) return;
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM rooms WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Room not found' });
      if (!row.isActive) return res.status(400).json({ success: false, message: 'This room is already inactive', code: 'ROOM_INACTIVE' });
      run('UPDATE rooms SET isActive = 0, updatedAt = ? WHERE id = ?', [new Date().toISOString(), req.params.id]);
      saveDatabase();
      const updated = query('SELECT * FROM rooms WHERE id = ?', [req.params.id])[0];
      enqueue('room', 'update', updated);
      res.json({ success: true, data: shapeRoom(updated), message: 'Room deactivated' });
    } catch (e) {
      console.error('[Hotel] Deactivate room error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // ── Reservations ────────────────────────────────────────────────
  function findBlockingOverlaps(companyId, roomId, checkIn, checkOut, excludeReservationId) {
    const candidates = query(
      "SELECT id, guestName, checkInDate, checkOutDate, status FROM reservations WHERE companyId = ? AND roomId = ? AND status IN ('BOOKED', 'CHECKED_IN')",
      [companyId, roomId]
    );
    return candidates.filter((r) => {
      if (excludeReservationId && r.id === excludeReservationId) return false;
      return hotel.rangesOverlap(checkIn, checkOut, r.checkInDate, r.checkOutDate);
    });
  }
  function conflictError(res, conflicts) {
    return res.status(409).json({
      success: false,
      message: `This room is already booked for part of that range (${conflicts.map((c) => `${c.guestName}, ${String(c.checkInDate).slice(0, 10)} → ${String(c.checkOutDate).slice(0, 10)}`).join('; ')})`,
      code: 'RESERVATION_CONFLICT',
      data: { conflicts }
    });
  }
  function validateReservationDocs(b) {
    // The embedded server has no document upload store: refs must be
    // absent (the upload endpoint is 501). A reservation created
    // offline simply carries no document refs.
    if (b.cnicDocumentUrl !== undefined && b.cnicDocumentUrl !== null && String(b.cnicDocumentUrl).trim() !== '') {
      return { ok: false, message: 'Document upload is not available on the desktop — create the reservation without document refs', code: 'DOCUMENTS_UNAVAILABLE' };
    }
    if (b.guestPhotoUrls !== undefined && b.guestPhotoUrls !== null && Array.isArray(b.guestPhotoUrls) && b.guestPhotoUrls.length > 0) {
      return { ok: false, message: 'Document upload is not available on the desktop — create the reservation without document refs', code: 'DOCUMENTS_UNAVAILABLE' };
    }
    return { ok: true };
  }

  app.get('/api/reservations/availability', authMiddleware, gateReservations, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const { from, to, roomTypeId } = req.query;
      if (!from || !to) return res.status(400).json({ success: false, message: 'Both from and to dates are required', code: 'DATES_REQUIRED' });
      const checkInDate = hotel.normalizeHotelDate(String(from));
      const checkOutDate = hotel.normalizeHotelDate(String(to));
      if (!hotel.isValidStayRange(checkInDate, checkOutDate)) {
        return res.status(400).json({ success: false, message: 'Check-out must be at least one night after check-in', code: 'INVALID_STAY_RANGE' });
      }
      const where = ['companyId = ?', 'isActive = 1'];
      const params = [companyFilter];
      if (roomTypeId) { where.push('roomTypeId = ?'); params.push(String(roomTypeId)); }
      const rooms = query(`SELECT * FROM rooms WHERE ${where.join(' AND ')} ORDER BY floor ASC, number ASC`, params);
      const includesToday = hotel.rangeIncludesDay(checkInDate, checkOutDate, new Date());
      const data = rooms.map((room) => {
        const conflicts = findBlockingOverlaps(companyFilter, room.id, checkInDate, checkOutDate, null);
        const { ...roomData } = shapeRoom(room);
        return {
          ...roomData,
          bookable: hotel.isRoomBookable({ status: room.status, isActive: !!room.isActive, hasBlockingOverlap: conflicts.length > 0, rangeIncludesToday: includesToday }),
          conflicts
        };
      });
      res.json({
        success: true,
        data,
        range: {
          from: checkInDate.toISOString().slice(0, 10),
          to: checkOutDate.toISOString().slice(0, 10),
          nights: hotel.nightsBetween(checkInDate, checkOutDate)
        }
      });
    } catch (e) {
      console.error('[Hotel] Get availability error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // Document upload/serve — honest 501 (no upload store on the desktop)
  app.post('/api/reservations/documents/upload', authMiddleware, gateReservations, (req, res) => {
    res.status(501).json({ success: false, message: 'Document upload is not available on the desktop — upload documents from the cloud dashboard', code: 'NOT_SUPPORTED_LOCAL' });
  });
  app.get('/api/reservations/:id/documents/:filename', authMiddleware, gateReservations, (req, res) => {
    res.status(501).json({ success: false, message: 'Document serving is not available on the desktop', code: 'NOT_SUPPORTED_LOCAL' });
  });

  app.post('/api/reservations', authMiddleware, gateReservations, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      if (!b.guestName || !String(b.guestName).trim() || String(b.guestName).trim().length > 160) return res.status(400).json({ success: false, message: 'guestName is required (max 160 characters)' });
      if (!b.roomId || !b.checkInDate || !b.checkOutDate) return res.status(400).json({ success: false, message: 'roomId, checkInDate and checkOutDate are required' });
      const docs = validateReservationDocs(b);
      if (!docs.ok) return res.status(400).json({ success: false, message: docs.message, code: docs.code });
      const room = query('SELECT * FROM rooms WHERE id = ? AND companyId = ?', [b.roomId, companyFilter])[0];
      if (!room) return res.status(404).json({ success: false, message: 'Room not found' });
      if (!room.isActive) return res.status(400).json({ success: false, message: 'This room is inactive and cannot be booked', code: 'ROOM_INACTIVE' });
      const checkInDate = hotel.normalizeHotelDate(b.checkInDate);
      const checkOutDate = hotel.normalizeHotelDate(b.checkOutDate);
      if (!hotel.isValidStayRange(checkInDate, checkOutDate)) {
        return res.status(400).json({ success: false, message: 'Check-out must be at least one night after check-in', code: 'INVALID_STAY_RANGE' });
      }
      const conflicts = findBlockingOverlaps(companyFilter, room.id, checkInDate, checkOutDate, null);
      if (conflicts.length > 0) return conflictError(res, conflicts);
      if (b.branchId && !query('SELECT id FROM branches WHERE id = ? AND companyId = ?', [b.branchId, companyFilter])[0]) {
        return res.status(400).json({ success: false, message: 'Branch not found in this business' });
      }
      const id = uuid();
      const now = new Date().toISOString();
      run(
        'INSERT INTO reservations (id, companyId, branchId, guestName, guestPhone, guestCnic, cnicDocumentUrl, guestPhotoUrls, roomId, checkInDate, checkOutDate, adults, children, source, status, notes, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, companyFilter, b.branchId || null, String(b.guestName).trim(), nullIfEmpty(b.guestPhone), nullIfEmpty(b.guestCnic), null, '[]', room.id, checkInDate.toISOString(), checkOutDate.toISOString(), b.adults ?? null, b.children ?? null, nullIfEmpty(b.source), 'BOOKED', nullIfEmpty(b.notes), req.user?.id || null, now, now]
      );
      saveDatabase();
      const row = query('SELECT * FROM reservations WHERE id = ?', [id])[0];
      enqueue('reservation', 'create', row);
      res.status(201).json({ success: true, data: shapeReservation(row), message: 'Reservation created successfully' });
    } catch (e) {
      console.error('[Hotel] Create reservation error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/reservations', authMiddleware, gateReservations, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const { page, limit, offset } = pageParams(req);
      const where = ['companyId = ?'];
      const params = [companyFilter];
      if (req.query.roomId) { where.push('roomId = ?'); params.push(String(req.query.roomId)); }
      if (req.query.status) { where.push('status = ?'); params.push(String(req.query.status).toUpperCase()); }
      if (req.query.branchId) { where.push('branchId = ?'); params.push(String(req.query.branchId)); }
      if (req.query.search) { where.push('(guestName LIKE ? OR guestPhone LIKE ? OR guestCnic LIKE ?)'); params.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`); }
      if (req.query.date) {
        const day = hotel.normalizeHotelDate(String(req.query.date));
        const next = new Date(day.getTime() + hotel.DAY_MS).toISOString();
        where.push('checkInDate >= ? AND checkInDate < ?'); params.push(day.toISOString(), next);
      } else {
        if (req.query.from) { where.push('checkInDate >= ?'); params.push(hotel.normalizeHotelDate(String(req.query.from)).toISOString()); }
        if (req.query.to) { where.push('checkInDate < ?'); params.push(new Date(hotel.normalizeHotelDate(String(req.query.to)).getTime() + hotel.DAY_MS).toISOString()); }
      }
      const total = query(`SELECT COUNT(*) AS c FROM reservations WHERE ${where.join(' AND ')}`, params)[0].c;
      const rows = query(`SELECT * FROM reservations WHERE ${where.join(' AND ')} ORDER BY checkInDate ASC, createdAt ASC LIMIT ? OFFSET ?`, [...params, limit, offset]);
      res.json({ success: true, data: rows.map(shapeReservation), pagination: pagination(page, limit, total) });
    } catch (e) {
      console.error('[Hotel] Get reservations error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/reservations/:id', authMiddleware, gateReservations, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM reservations WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Reservation not found' });
      res.json({ success: true, data: shapeReservation(row) });
    } catch (e) {
      console.error('[Hotel] Get reservation error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.put('/api/reservations/:id', authMiddleware, gateReservations, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM reservations WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Reservation not found' });
      if (['CHECKED_IN', 'COMPLETED'].includes(row.status)) {
        return res.status(400).json({ success: false, message: `A reservation in status ${row.status} cannot be edited — its stay is already under way`, code: 'RESERVATION_LOCKED' });
      }
      const b = req.body || {};
      const docs = validateReservationDocs(b);
      if (!docs.ok) return res.status(400).json({ success: false, message: docs.message, code: docs.code });
      const sets = [];
      const params = [];
      const setStr = (col, v) => { sets.push(`${col} = ?`); params.push(v); };
      let newRoomId = row.roomId;
      let newCheckIn = row.checkInDate;
      let newCheckOut = row.checkOutDate;
      if (b.guestName !== undefined) {
        if (!String(b.guestName).trim() || String(b.guestName).trim().length > 160) return res.status(400).json({ success: false, message: 'guestName is required (max 160 characters)' });
        setStr('guestName', String(b.guestName).trim());
      }
      if (b.guestPhone !== undefined) setStr('guestPhone', nullIfEmpty(b.guestPhone));
      if (b.guestCnic !== undefined) setStr('guestCnic', nullIfEmpty(b.guestCnic));
      if (b.roomId !== undefined) {
        const room = query('SELECT * FROM rooms WHERE id = ? AND companyId = ?', [b.roomId, companyFilter])[0];
        if (!room) return res.status(404).json({ success: false, message: 'Room not found' });
        newRoomId = room.id;
        setStr('roomId', room.id);
      }
      if (b.checkInDate !== undefined) { newCheckIn = hotel.normalizeHotelDate(b.checkInDate).toISOString(); setStr('checkInDate', newCheckIn); }
      if (b.checkOutDate !== undefined) { newCheckOut = hotel.normalizeHotelDate(b.checkOutDate).toISOString(); setStr('checkOutDate', newCheckOut); }
      if (!hotel.isValidStayRange(newCheckIn, newCheckOut)) {
        return res.status(400).json({ success: false, message: 'Check-out must be at least one night after check-in', code: 'INVALID_STAY_RANGE' });
      }
      const conflicts = findBlockingOverlaps(companyFilter, newRoomId, newCheckIn, newCheckOut, req.params.id);
      if (conflicts.length > 0) return conflictError(res, conflicts);
      if (b.adults !== undefined) setStr('adults', b.adults);
      if (b.children !== undefined) setStr('children', b.children);
      if (b.source !== undefined) setStr('source', nullIfEmpty(b.source));
      if (b.notes !== undefined) setStr('notes', nullIfEmpty(b.notes));
      if (b.branchId !== undefined) setStr('branchId', b.branchId || null);
      if (sets.length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });
      setStr('updatedAt', new Date().toISOString());
      params.push(req.params.id);
      run(`UPDATE reservations SET ${sets.join(', ')} WHERE id = ?`, params);
      saveDatabase();
      const updated = query('SELECT * FROM reservations WHERE id = ?', [req.params.id])[0];
      enqueue('reservation', 'update', updated);
      res.json({ success: true, data: shapeReservation(updated), message: 'Reservation updated successfully' });
    } catch (e) {
      console.error('[Hotel] Update reservation error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.patch('/api/reservations/:id/status', authMiddleware, gateReservations, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM reservations WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Reservation not found' });
      const status = String(req.body?.status || '').trim().toUpperCase();
      if (!hotel.isReservationStatus(status)) return res.status(400).json({ success: false, message: `Invalid status: ${status}` });
      if (!hotel.canTransitionReservation(row.status, status)) {
        return res.status(400).json({ success: false, message: `A reservation in status ${row.status} cannot move to ${status} — check-in/out are flows, not statuses`, code: 'RESERVATION_BAD_TRANSITION' });
      }
      run('UPDATE reservations SET status = ?, updatedAt = ? WHERE id = ?', [status, new Date().toISOString(), req.params.id]);
      saveDatabase();
      const updated = query('SELECT * FROM reservations WHERE id = ?', [req.params.id])[0];
      enqueue('reservation', 'update', updated);
      res.json({ success: true, data: shapeReservation(updated) });
    } catch (e) {
      console.error('[Hotel] Update reservation status error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post('/api/reservations/:id/check-in', authMiddleware, gateReservations, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const reservation = query('SELECT * FROM reservations WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found' });
      if (reservation.status !== 'BOOKED') {
        return res.status(400).json({ success: false, message: `A reservation in status ${reservation.status} cannot be checked in`, code: 'RESERVATION_NOT_BOOKED' });
      }
      const room = query('SELECT * FROM rooms WHERE id = ?', [reservation.roomId])[0];
      if (!room) return res.status(404).json({ success: false, message: 'Room not found' });
      if (!room.isActive) return res.status(400).json({ success: false, message: 'This room is inactive and cannot be occupied', code: 'ROOM_INACTIVE' });
      if (room.status === 'OCCUPIED') return res.status(409).json({ success: false, message: `Room ${room.number} is occupied — check the current guest out first`, code: 'ROOM_OCCUPIED' });
      if (room.status === 'MAINTENANCE') return res.status(400).json({ success: false, message: `Room ${room.number} is under maintenance and cannot be occupied`, code: 'ROOM_MAINTENANCE' });
      const roomType = room.roomTypeId ? query('SELECT * FROM room_types WHERE id = ?', [room.roomTypeId])[0] : null;
      const rateSnapshot = hotel.round2(roomType ? roomType.ratePerNight : 0);
      const branchId = reservation.branchId || room.branchId || null;
      const createdBy = req.user?.id || null;
      const now = new Date().toISOString();
      const folioId = uuid();
      const firstNightId = uuid();
      try {
        mustRun(run,
          'INSERT INTO folios (id, companyId, branchId, reservationId, roomId, guestName, guestPhone, rateSnapshot, status, openedAt, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [folioId, companyFilter, branchId, reservation.id, room.id, reservation.guestName, reservation.guestPhone || null, rateSnapshot, 'OPEN', now, createdBy, now, now]
        );
        const checkInDay = hotel.normalizeHotelDate(reservation.checkInDate).toISOString().slice(0, 10);
        mustRun(run,
          'INSERT INTO folio_charges (id, folioId, description, amount, kind, chargeDate, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [firstNightId, folioId, `Room night — ${roomType ? roomType.name : 'Room'} ${room.number} (${checkInDay})`, rateSnapshot, 'ROOM_NIGHT', hotel.normalizeHotelDate(reservation.checkInDate).toISOString(), createdBy, now]
        );
        mustRun(run, 'UPDATE reservations SET status = ?, folioId = ?, updatedAt = ? WHERE id = ?', ['CHECKED_IN', folioId, now, reservation.id]);
        mustRun(run, 'UPDATE rooms SET status = ?, updatedAt = ? WHERE id = ?', ['OCCUPIED', now, room.id]);
      } catch (e) {
        // Compensating rollback (see utils/db-write.js): a half-opened
        // folio strands the room and the reservation, so undo it all.
        run('DELETE FROM folio_charges WHERE folioId = ?', [folioId]);
        run('DELETE FROM folios WHERE id = ?', [folioId]);
        run("UPDATE reservations SET status = 'BOOKED', folioId = NULL, updatedAt = ? WHERE id = ?", [now, reservation.id]);
        run('UPDATE rooms SET status = ?, updatedAt = ? WHERE id = ?', [room.status, now, room.id]);
        saveDatabase();
        throw e;
      }
      saveDatabase();
      const folio = query('SELECT * FROM folios WHERE id = ?', [folioId])[0];
      const firstNight = query('SELECT * FROM folio_charges WHERE id = ?', [firstNightId])[0];
      enqueue('folio', 'create', folio);
      enqueue('folioCharge', 'create', firstNight);
      enqueue('reservation', 'update', query('SELECT * FROM reservations WHERE id = ?', [reservation.id])[0]);
      enqueue('room', 'update', query('SELECT * FROM rooms WHERE id = ?', [room.id])[0]);
      res.status(201).json({
        success: true,
        data: { folio: shapeFolio(folio, true), firstNight, reservation: shapeReservation(query('SELECT * FROM reservations WHERE id = ?', [reservation.id])[0]) },
        message: `Checked in — folio opened for room ${room.number}`
      });
    } catch (e) {
      console.error('[Hotel] Check-in error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // ── Folios ──────────────────────────────────────────────────────
  app.get('/api/folios/night-audit', authMiddleware, gateFolios, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const day = hotel.normalizeHotelDate(String(req.query.date || new Date().toISOString().slice(0, 10)));
      const dayEnd = new Date(day.getTime() + hotel.DAY_MS);
      const tomorrow = new Date(day.getTime() + hotel.DAY_MS);
      const tomorrowEnd = new Date(tomorrow.getTime() + hotel.DAY_MS);
      const dayIso = day.toISOString();
      const dayEndIso = dayEnd.toISOString();
      const tomorrowIso = tomorrow.toISOString();
      const tomorrowEndIso = tomorrowEnd.toISOString();
      const dayFolios = query('SELECT roomId FROM folios WHERE companyId = ? AND openedAt < ? AND (closedAt IS NULL OR closedAt >= ?)', [companyFilter, dayEndIso, dayIso]);
      const arrivals = query("SELECT COUNT(*) AS c FROM reservations WHERE companyId = ? AND checkInDate >= ? AND checkInDate < ? AND status IN ('CHECKED_IN', 'COMPLETED')", [companyFilter, dayIso, dayEndIso])[0].c;
      const departures = query('SELECT COUNT(*) AS c FROM folios WHERE companyId = ? AND closedAt >= ? AND closedAt < ?', [companyFilter, dayIso, dayEndIso])[0].c;
      const openFolios = query("SELECT COUNT(*) AS c FROM folios WHERE companyId = ? AND status = 'OPEN'", [companyFilter])[0].c;
      const chargesPosted = query('SELECT amount FROM folio_charges WHERE folioId IN (SELECT id FROM folios WHERE companyId = ?) AND chargeDate >= ? AND chargeDate < ?', [companyFilter, dayIso, dayEndIso]);
      const paymentsReceived = query('SELECT amount FROM folio_payments WHERE folioId IN (SELECT id FROM folios WHERE companyId = ?) AND paidAt >= ? AND paidAt < ?', [companyFilter, dayIso, dayEndIso]);
      const expectedDepartures = query("SELECT COUNT(*) AS c FROM reservations WHERE companyId = ? AND checkOutDate >= ? AND checkOutDate < ? AND status = 'CHECKED_IN'", [companyFilter, tomorrowIso, tomorrowEndIso])[0].c;
      res.json({
        success: true,
        data: {
          date: day.toISOString().slice(0, 10),
          occupiedRooms: new Set(dayFolios.map((f) => f.roomId)).size,
          arrivals,
          departures,
          openFolios,
          folioRevenuePosted: hotel.round2(chargesPosted.reduce((s, c) => s + (Number(c.amount) || 0), 0)),
          paymentsReceived: hotel.round2(paymentsReceived.reduce((s, p) => s + (Number(p.amount) || 0), 0)),
          expectedDepartures
        }
      });
    } catch (e) {
      console.error('[Hotel] Night audit error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post('/api/folios/post-night-charges-bulk', authMiddleware, gateFolios, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const nightDate = hotel.normalizeHotelDate(req.body?.date || new Date());
      const createdBy = req.user?.id || null;
      const now = new Date().toISOString();
      const folios = query("SELECT * FROM folios WHERE companyId = ? AND status = 'OPEN'", [companyFilter]);
      const posted = [];
      const skipped = [];
      for (const folio of folios) {
        const charges = query("SELECT * FROM folio_charges WHERE folioId = ? AND kind = 'ROOM_NIGHT'", [folio.id]);
        const already = charges.some((c) => hotel.sameUtcDay(new Date(c.chargeDate), nightDate));
        if (already) { skipped.push({ folioId: folio.id, reason: 'NIGHT_ALREADY_POSTED' }); continue; }
        const room = query('SELECT * FROM rooms WHERE id = ?', [folio.roomId])[0];
        const roomType = room && room.roomTypeId ? query('SELECT name FROM room_types WHERE id = ?', [room.roomTypeId])[0] : null;
        const roomLabel = room ? `${roomType ? roomType.name : 'Room'} ${room.number}` : 'Room';
        const chargeId = uuid();
        run(
          'INSERT INTO folio_charges (id, folioId, description, amount, kind, chargeDate, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [chargeId, folio.id, `Room night — ${roomLabel} (${nightDate.toISOString().slice(0, 10)})`, hotel.round2(folio.rateSnapshot), 'ROOM_NIGHT', nightDate.toISOString(), createdBy, now]
        );
        const charge = query('SELECT * FROM folio_charges WHERE id = ?', [chargeId])[0];
        enqueue('folioCharge', 'create', charge);
        posted.push({ folioId: folio.id, chargeId, amount: charge.amount });
      }
      saveDatabase();
      res.json({
        success: true,
        data: {
          date: nightDate.toISOString().slice(0, 10),
          posted,
          skipped,
          postedCount: posted.length,
          skippedCount: skipped.length,
          postedTotal: hotel.round2(posted.reduce((s, p) => s + p.amount, 0))
        },
        message: `Night charges posted for ${posted.length} folio(s)`
      });
    } catch (e) {
      console.error('[Hotel] Bulk night charges error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/folios', authMiddleware, gateFolios, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const { page, limit, offset } = pageParams(req);
      const where = ['companyId = ?'];
      const params = [companyFilter];
      if (req.query.status) { where.push('status = ?'); params.push(String(req.query.status).toUpperCase()); }
      if (req.query.roomId) { where.push('roomId = ?'); params.push(String(req.query.roomId)); }
      if (req.query.search) { where.push('guestName LIKE ?'); params.push(`%${req.query.search}%`); }
      const total = query(`SELECT COUNT(*) AS c FROM folios WHERE ${where.join(' AND ')}`, params)[0].c;
      const rows = query(`SELECT * FROM folios WHERE ${where.join(' AND ')} ORDER BY CASE status WHEN 'OPEN' THEN 0 ELSE 1 END, openedAt DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
      res.json({ success: true, data: rows.map((r) => shapeFolio(r, false)), pagination: pagination(page, limit, total) });
    } catch (e) {
      console.error('[Hotel] Get folios error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/folios/:id', authMiddleware, gateFolios, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM folios WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Folio not found' });
      res.json({ success: true, data: shapeFolio(row, true) });
    } catch (e) {
      console.error('[Hotel] Get folio error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  function loadOpenFolio(req, res, companyFilter) {
    const folio = query('SELECT * FROM folios WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
    if (!folio) { res.status(404).json({ success: false, message: 'Folio not found' }); return null; }
    if (folio.status !== 'OPEN') {
      res.status(400).json({ success: false, message: 'This folio is closed — its bill is final', code: 'FOLIO_CLOSED' });
      return null;
    }
    return folio;
  }

  app.post('/api/folios/:id/charges', authMiddleware, gateFolios, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      if (!b.description || !String(b.description).trim() || String(b.description).trim().length > 300) return res.status(400).json({ success: false, message: 'description is required (max 300 characters)' });
      if (typeof b.amount !== 'number' || b.amount <= 0) return res.status(400).json({ success: false, message: 'amount must be a positive number' });
      const kind = b.kind || 'MANUAL';
      if (!['SERVICE', 'MANUAL'].includes(kind)) return res.status(400).json({ success: false, message: 'kind must be SERVICE or MANUAL' });
      const folio = loadOpenFolio(req, res, companyFilter);
      if (!folio) return;
      const id = uuid();
      const now = new Date().toISOString();
      run(
        'INSERT INTO folio_charges (id, folioId, description, amount, kind, chargeDate, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, folio.id, String(b.description).trim(), hotel.round2(b.amount), kind, now, req.user?.id || null, now]
      );
      saveDatabase();
      const charge = query('SELECT * FROM folio_charges WHERE id = ?', [id])[0];
      enqueue('folioCharge', 'create', charge);
      res.status(201).json({ success: true, data: charge, message: 'Charge added to the folio' });
    } catch (e) {
      console.error('[Hotel] Add folio charge error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post('/api/folios/:id/payments', authMiddleware, gateFolios, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      if (typeof b.amount !== 'number' || b.amount === 0) return res.status(400).json({ success: false, message: 'amount is required and must not be zero' });
      if (!SALE_PAYMENT_METHODS.includes(String(b.method || '').toUpperCase())) return res.status(400).json({ success: false, message: `method must be one of: ${SALE_PAYMENT_METHODS.join(', ')}` });
      if (b.amount < 0) {
        if (!requireManager(req, res, 'refund money from a folio')) return;
        if (!b.note || !String(b.note).trim()) return res.status(400).json({ success: false, message: 'A refund payment (negative amount) must carry a note saying why', code: 'REFUND_NOTE_REQUIRED' });
      }
      const folio = loadOpenFolio(req, res, companyFilter);
      if (!folio) return;
      const id = uuid();
      const now = new Date().toISOString();
      run(
        'INSERT INTO folio_payments (id, folioId, amount, method, paidAt, note, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, folio.id, hotel.round2(b.amount), String(b.method).toUpperCase(), now, nullIfEmpty(b.note), req.user?.id || null, now]
      );
      saveDatabase();
      const payment = query('SELECT * FROM folio_payments WHERE id = ?', [id])[0];
      enqueue('folioPayment', 'create', payment);
      res.status(201).json({ success: true, data: payment, message: b.amount < 0 ? 'Refund recorded on the folio' : 'Payment recorded on the folio' });
    } catch (e) {
      console.error('[Hotel] Add folio payment error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post('/api/folios/:id/post-night-charge', authMiddleware, gateFolios, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const folio = loadOpenFolio(req, res, companyFilter);
      if (!folio) return;
      const nightDate = hotel.normalizeHotelDate(req.body?.date || new Date());
      const charges = query("SELECT * FROM folio_charges WHERE folioId = ? AND kind = 'ROOM_NIGHT'", [folio.id]);
      if (charges.some((c) => hotel.sameUtcDay(new Date(c.chargeDate), nightDate))) {
        return res.status(400).json({ success: false, message: `The room night for ${nightDate.toISOString().slice(0, 10)} is already posted on this folio`, code: 'NIGHT_ALREADY_POSTED' });
      }
      const room = query('SELECT * FROM rooms WHERE id = ?', [folio.roomId])[0];
      const roomType = room && room.roomTypeId ? query('SELECT name FROM room_types WHERE id = ?', [room.roomTypeId])[0] : null;
      const roomLabel = room ? `${roomType ? roomType.name : 'Room'} ${room.number}` : 'Room';
      const id = uuid();
      const now = new Date().toISOString();
      run(
        'INSERT INTO folio_charges (id, folioId, description, amount, kind, chargeDate, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, folio.id, `Room night — ${roomLabel} (${nightDate.toISOString().slice(0, 10)})`, hotel.round2(folio.rateSnapshot), 'ROOM_NIGHT', nightDate.toISOString(), req.user?.id || null, now]
      );
      saveDatabase();
      const charge = query('SELECT * FROM folio_charges WHERE id = ?', [id])[0];
      enqueue('folioCharge', 'create', charge);
      res.status(201).json({ success: true, data: charge, message: 'Room night posted' });
    } catch (e) {
      console.error('[Hotel] Post night charge error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post('/api/folios/:id/check-out', authMiddleware, gateFolios, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      const folio = query('SELECT * FROM folios WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!folio) return res.status(404).json({ success: false, message: 'Folio not found' });
      if (folio.status !== 'OPEN') return res.status(400).json({ success: false, message: 'This folio is already closed', code: 'FOLIO_CLOSED' });
      const charges = query('SELECT * FROM folio_charges WHERE folioId = ? ORDER BY chargeDate ASC', [folio.id]);
      let payments = query('SELECT * FROM folio_payments WHERE folioId = ? ORDER BY paidAt ASC', [folio.id]);
      const createdBy = req.user?.id || null;
      const now = new Date().toISOString();

      // 1) The settling payment, if the desk took one now.
      if (b.payment) {
        if (typeof b.payment.amount !== 'number' || b.payment.amount <= 0) return res.status(400).json({ success: false, message: 'payment.amount must be a positive number' });
        if (!SALE_PAYMENT_METHODS.includes(String(b.payment.method || '').toUpperCase())) return res.status(400).json({ success: false, message: `payment.method must be one of: ${SALE_PAYMENT_METHODS.join(', ')}` });
        const pid = uuid();
        // NOTE: the payment is recorded BEFORE the balance gate on
        // purpose — it is money the desk actually took. If the gate
        // then refuses check-out (balance still due / in credit), the
        // payment stays on the open folio and the desk retries; the
        // retry re-reads the balance including this payment.
        mustRun(run,
          'INSERT INTO folio_payments (id, folioId, amount, method, paidAt, note, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [pid, folio.id, hotel.round2(b.payment.amount), String(b.payment.method).toUpperCase(), now, nullIfEmpty(b.payment.note) || 'Paid at check-out', createdBy, now]
        );
        const payment = query('SELECT * FROM folio_payments WHERE id = ?', [pid])[0];
        if (!payment) throw new Error('Settling payment did not persist');
        enqueue('folioPayment', 'create', payment);
        payments = [...payments, payment];
      }
      const summary = hotel.summarizeFolioCharges(charges, payments);

      // 2) Balance gate: settle, or write off explicitly.
      let writeOffAmount = null;
      let writeOffNote = null;
      if (summary.balance > 0.01) {
        if (!b.writeOff) {
          return res.status(400).json({ success: false, message: `This folio still has a balance of PKR ${summary.balance.toFixed(2)} — record a payment, or write it off explicitly to check out`, code: 'FOLIO_BALANCE_DUE', data: { balance: summary.balance } });
        }
        if (!requireManager(req, res, 'write off a folio balance')) return;
        if (!b.writeOffNote || !String(b.writeOffNote).trim()) {
          return res.status(400).json({ success: false, message: 'A write-off must carry a note saying why the balance was forgiven', code: 'WRITE_OFF_NOTE_REQUIRED' });
        }
        writeOffAmount = summary.balance;
        writeOffNote = String(b.writeOffNote).trim();
      } else if (summary.balance < -0.01) {
        return res.status(400).json({ success: false, message: `This folio is PKR ${Math.abs(summary.balance).toFixed(2)} in credit — refund the guest (a negative payment on the folio) before check-out`, code: 'FOLIO_IN_CREDIT', data: { balance: summary.balance } });
      }

      // 3) The checkout invoice for the folio-NATIVE charges.
      let sale = null;
      if (summary.nativeTotal > 0) {
        const branchId = folio.branchId || (req.user?.selectedBranchId ? String(req.user.selectedBranchId) : null);
        if (!branchId) return res.status(400).json({ success: false, message: 'No branch context for this folio — open the hotel from a branch first', code: 'NO_BRANCH_CONTEXT' });
        const nativeCharges = charges.filter((c) => !c.saleId);
        const room = query('SELECT * FROM rooms WHERE id = ?', [folio.roomId])[0];
        const roomType = room && room.roomTypeId ? query('SELECT * FROM room_types WHERE id = ?', [room.roomTypeId])[0] : null;
        const saleItems = [];
        if (summary.roomNightCount > 0 && roomType) {
          const nightProduct = ensureServiceProduct({ query, run }, { companyId: companyFilter, branchId, sku: hotel.roomNightProductSku(roomType.id), name: hotel.roomNightProductName(roomType.name), description: `Room nights for ${roomType.name} (auto-managed service item)`, createdBy });
          saleItems.push({ productId: nightProduct.id, quantity: summary.roomNightCount, unitPrice: hotel.round2(folio.rateSnapshot) });
        }
        for (const charge of nativeCharges) {
          if (charge.kind === 'ROOM_NIGHT') continue;
          const chargeProduct = ensureServiceProduct({ query, run }, { companyId: companyFilter, branchId, sku: hotel.folioChargeProductSku(charge.id), name: hotel.folioChargeProductName(charge.description), description: `Folio charge from folio ${folio.id} (auto-managed service item)`, createdBy });
          saleItems.push({ productId: chargeProduct.id, quantity: 1, unitPrice: hotel.round2(charge.amount) });
        }
        const lastPayment = payments.length > 0 ? payments[payments.length - 1] : null;
        try {
          sale = createServiceSale({ query, run, saveDatabase, handleDataChange }, {
            companyId: companyFilter, branchId, customerId: null, items: saleItems,
            paymentMethod: (b.payment && b.payment.method) || (lastPayment && lastPayment.method) || 'CASH',
            paymentStatus: writeOffAmount !== null ? 'PENDING' : 'COMPLETED',
            paidAmount: writeOffAmount !== null ? hotel.round2(Math.max(0, summary.nativeTotal - writeOffAmount)) : undefined,
            notes: `Hotel check-out — folio ${folio.id}`,
            createdBy, userId: req.user?.id
          });
        } catch (e) {
          console.error('[Hotel] Check-out billing failed:', e.message);
          return res.status(500).json({ success: false, message: 'Check-out billing failed: ' + e.message });
        }
      }

      // 4) Close the stay: folio CLOSED, room to housekeeping (DIRTY), reservation completes.
      try {
        mustRun(run,
          'UPDATE folios SET status = ?, closedAt = ?, saleId = ?, writeOffAmount = ?, writeOffNote = ?, updatedAt = ? WHERE id = ?',
          ['CLOSED', now, sale ? sale.id : null, writeOffAmount, writeOffNote, now, folio.id]
        );
        mustRun(run, 'UPDATE rooms SET status = ?, updatedAt = ? WHERE id = ?', ['DIRTY', now, folio.roomId]);
        if (folio.reservationId) {
          mustRun(run, "UPDATE reservations SET status = ?, updatedAt = ? WHERE id = ? AND status = 'CHECKED_IN'", ['COMPLETED', now, folio.reservationId]);
        }
      } catch (e) {
        // Compensating rollback: re-open the folio and the room so the
        // desk can retry. The checkout sale (if created) is left
        // standing but unlinked — a retry creates a fresh one; the
        // orphan is visible in the sales list rather than silently
        // double-billing the folio.
        run("UPDATE folios SET status = 'OPEN', closedAt = NULL, saleId = NULL, writeOffAmount = NULL, writeOffNote = NULL, updatedAt = ? WHERE id = ?", [now, folio.id]);
        run('UPDATE rooms SET status = ?, updatedAt = ? WHERE id = ?', ['OCCUPIED', now, folio.roomId]);
        saveDatabase();
        throw e;
      }
      saveDatabase();
      const closed = query('SELECT * FROM folios WHERE id = ?', [folio.id])[0];
      enqueue('folio', 'update', closed);
      enqueue('room', 'update', query('SELECT * FROM rooms WHERE id = ?', [folio.roomId])[0]);
      if (folio.reservationId) enqueue('reservation', 'update', query('SELECT * FROM reservations WHERE id = ?', [folio.reservationId])[0]);
      res.status(201).json({ success: true, data: { folio: shapeFolio(closed, true), sale }, message: 'Checked out — folio closed' });
    } catch (e) {
      console.error('[Hotel] Check-out error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
}

module.exports = { registerHotelRoutes };
