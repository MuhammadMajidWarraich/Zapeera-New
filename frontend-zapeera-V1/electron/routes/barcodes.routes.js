/**
 * Barcode lookup / generate / validate / stats — embedded port of
 * backend-zapeera-v1-main/src/controllers/barcode.controller.ts +
 * services/barcode.service.ts (routes /api/barcodes, module sales —
 * core, applies to all business types).
 *
 * Lookup order mirrors the cloud exactly: (1) primary products.barcode,
 * FEFO batches (top 10 by expireDate, best batch = first), stock = batch
 * sum; (2) additionalBarcodes JSON array; (3) batch barcode (pinned to
 * that batch); (4) SKU. Missing product → 404 with
 * suggestion 'Create Product', as on the cloud.
 */
const { getDataFilter } = require('../utils/helpers');

const BARCODE_PATTERNS = {
  CODE128: /^[A-Za-z0-9\-\\. \\$\\/\\+\\%]{1,48}$/,
  EAN13: /^\d{13}$/,
  EAN8: /^\d{8}$/,
  UPC_A: /^\d{12}$/,
  UPC_E: /^\d{6,8}$/,
  CODE39: /^[A-Z0-9\-\\. \\$\\/\\+\\%]{1,48}$/,
  QR: /^.{1,2000}$/
};

function calculateEANCheckDigit(body) {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = parseInt(body[i], 10);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return String((10 - (sum % 10)) % 10);
}

function validateBarcode(barcode, type) {
  if (!barcode || !String(barcode).trim()) return { valid: false, format: type, message: 'Barcode cannot be empty' };
  if (/\s/.test(barcode)) return { valid: false, format: type, message: 'Barcode cannot contain spaces' };
  const pattern = BARCODE_PATTERNS[type];
  if (!pattern) return { valid: false, format: type, message: `Unsupported barcode type: ${type}` };
  if (!pattern.test(barcode)) return { valid: false, format: type, message: `Invalid ${type} format. Expected pattern: ${pattern.source}` };
  if (['EAN13', 'EAN8', 'UPC_A'].includes(type)) {
    const body = barcode.slice(0, -1);
    const checkDigit = barcode.slice(-1);
    const calculated = calculateEANCheckDigit(body);
    if (checkDigit !== calculated) return { valid: false, format: type, message: `Invalid check digit. Expected: ${calculated}, got: ${checkDigit}` };
  }
  return { valid: true, format: type };
}

function registerBarcodeRoutes(app, authMiddleware, { query, run, saveDatabase }) {
  function productWithBatches(product, companyFilter, branchId) {
    const params = [product.id];
    let sql = 'SELECT * FROM batches WHERE productId = ? AND companyId = ? AND isActive = 1';
    params.push(companyFilter);
    if (branchId) { sql += ' AND branchId = ?'; params.push(branchId); }
    sql += ' ORDER BY expireDate ASC LIMIT 10';
    const batches = query(sql, params);
    const stock = batches.reduce((s, b) => s + (Number(b.quantity) || 0), 0);
    return { product, batches, stock };
  }

  function shapeProduct(p) {
    return {
      ...p,
      isActive: !!p.isActive,
      isGenerated: !!p.isGenerated,
      isControlled: !!p.isControlled,
      isService: !!p.isService,
      requiresPrescription: !!p.requiresPrescription
    };
  }

  // POST /api/barcodes/lookup
  app.post('/api/barcodes/lookup', authMiddleware, (req, res) => {
    try {
      const { barcode } = req.body || {};
      if (!barcode) return res.status(400).json({ success: false, message: 'Barcode is required' });
      const trimmed = String(barcode).trim();
      const { companyFilter, branchFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const branchId = req.body.branchId || branchFilter || null;

      // 1. Primary barcode
      const primaryParams = [trimmed, companyFilter];
      let primarySql = 'SELECT * FROM products WHERE barcode = ? AND companyId = ? AND isActive = 1';
      if (branchId) { primarySql += ' AND branchId = ?'; primaryParams.push(branchId); }
      const primary = query(primarySql, primaryParams)[0];
      if (primary) {
        const { product, batches, stock } = productWithBatches(primary, companyFilter, branchId);
        return res.json({ success: true, data: { product: shapeProduct(product), batch: batches[0] || null, stock, matchType: 'primary' } });
      }

      // 2. Additional barcodes (JSON array stored as text)
      const addlParams = [companyFilter];
      let addlSql = 'SELECT * FROM products WHERE companyId = ? AND isActive = 1 AND additionalBarcodes IS NOT NULL';
      if (branchId) { addlSql += ' AND branchId = ?'; addlParams.push(branchId); }
      const candidates = query(addlSql, addlParams);
      for (const product of candidates) {
        try {
          const list = JSON.parse(product.additionalBarcodes);
          if (Array.isArray(list) && list.includes(trimmed)) {
            const { product: p, batches, stock } = productWithBatches(product, companyFilter, branchId);
            return res.json({ success: true, data: { product: shapeProduct(p), batch: batches[0] || null, stock, matchType: 'additional' } });
          }
        } catch { /* malformed JSON — skip, as on the cloud */ }
      }

      // 3. Batch barcode — pinned to that batch
      const batchParams = [trimmed, companyFilter];
      let batchSql = 'SELECT b.*, p.name AS productName FROM batches b JOIN products p ON p.id = b.productId WHERE b.barcode = ? AND b.companyId = ? AND b.isActive = 1 AND p.isActive = 1 AND p.companyId = ?';
      batchParams.push(companyFilter);
      if (branchId) { batchSql += ' AND b.branchId = ?'; batchParams.push(branchId); }
      batchSql += ' ORDER BY b.expireDate ASC LIMIT 1';
      const batchMatch = query(batchSql, batchParams)[0];
      if (batchMatch) {
        const product = query('SELECT * FROM products WHERE id = ?', [batchMatch.productId])[0];
        const { batches, stock } = productWithBatches(product, companyFilter, branchId);
        const { productName, ...pinnedBatch } = batchMatch;
        return res.json({ success: true, data: { product: shapeProduct(product), batch: pinnedBatch, stock, matchType: 'batch' } });
      }

      // 4. SKU
      const skuParams = [trimmed, companyFilter];
      let skuSql = 'SELECT * FROM products WHERE sku = ? AND companyId = ? AND isActive = 1';
      if (branchId) { skuSql += ' AND branchId = ?'; skuParams.push(branchId); }
      const skuMatch = query(skuSql, skuParams)[0];
      if (skuMatch) {
        const { product, batches, stock } = productWithBatches(skuMatch, companyFilter, branchId);
        return res.json({ success: true, data: { product: shapeProduct(product), batch: batches[0] || null, stock, matchType: 'sku' } });
      }

      return res.status(404).json({ success: false, message: 'Product not found', barcode, suggestion: 'Create Product' });
    } catch (e) {
      console.error('[Barcodes] Lookup error:', e.message);
      res.status(500).json({ success: false, message: 'Barcode lookup failed' });
    }
  });

  // POST /api/barcodes/generate
  app.post('/api/barcodes/generate', authMiddleware, (req, res) => {
    try {
      const { prefix, length, type } = req.body || {};
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const pfx = prefix || 'ZP';
      const barcodeType = type || 'CODE128';
      const count = query('SELECT COUNT(*) AS c FROM products WHERE companyId = ?', [companyFilter])[0].c;
      let candidate = null;
      for (let attempt = 0; attempt < 100; attempt++) {
        const sequence = String(count + attempt + 1).padStart(6, '0');
        if (barcodeType === 'EAN13') {
          const body = (String(pfx).replace(/\D/g, '').slice(0, 7) + sequence).slice(0, 12).padEnd(12, '0');
          candidate = body + calculateEANCheckDigit(body);
        } else if (barcodeType === 'EAN8') {
          const body = sequence.slice(0, 7).padEnd(7, '0');
          candidate = body + calculateEANCheckDigit(body);
        } else if (barcodeType === 'UPC_A') {
          const body = sequence.slice(0, 11).padEnd(11, '0');
          candidate = body + calculateEANCheckDigit(body);
        } else {
          candidate = `${pfx}${sequence}`;
        }
        const exists = query('SELECT id FROM products WHERE barcode = ? AND companyId = ?', [candidate, companyFilter])[0];
        if (!exists) break;
        candidate = null;
      }
      if (!candidate) return res.status(500).json({ success: false, message: 'Failed to generate a unique barcode' });
      res.json({ success: true, data: { barcode: candidate, type: barcodeType, prefix: pfx } });
    } catch (e) {
      console.error('[Barcodes] Generate error:', e.message);
      res.status(500).json({ success: false, message: 'Failed to generate barcode' });
    }
  });

  // POST /api/barcodes/validate
  app.post('/api/barcodes/validate', authMiddleware, (req, res) => {
    try {
      const { barcode, type, excludeProductId } = req.body || {};
      if (!barcode) return res.status(400).json({ success: false, message: 'Barcode is required' });
      const formatValidation = validateBarcode(barcode, type || 'CODE128');
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      let isUnique = true;
      if (companyFilter) {
        const params = [barcode, companyFilter];
        let sql = 'SELECT id FROM products WHERE barcode = ? AND companyId = ?';
        if (excludeProductId) { sql += ' AND id != ?'; params.push(excludeProductId); }
        isUnique = !query(sql, params)[0];
      }
      res.json({
        success: true,
        data: {
          formatValid: formatValidation.valid,
          isUnique,
          valid: formatValidation.valid && isUnique,
          format: formatValidation.format,
          message: !formatValidation.valid ? formatValidation.message : !isUnique ? 'Barcode already exists in this business' : 'Barcode is valid and available'
        }
      });
    } catch (e) {
      console.error('[Barcodes] Validate error:', e.message);
      res.status(500).json({ success: false, message: 'Validation failed' });
    }
  });

  // GET /api/barcodes/stats
  app.get('/api/barcodes/stats', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const totalProducts = query('SELECT COUNT(*) AS c FROM products WHERE companyId = ? AND isActive = 1', [companyFilter])[0].c;
      const withBarcode = query('SELECT COUNT(*) AS c FROM products WHERE companyId = ? AND isActive = 1 AND barcode IS NOT NULL AND barcode != ?', [companyFilter, ''])[0].c;
      const generated = query('SELECT COUNT(*) AS c FROM products WHERE companyId = ? AND isActive = 1 AND isGenerated = 1', [companyFilter])[0].c;
      res.json({
        success: true,
        data: {
          totalProducts,
          withBarcode,
          withoutBarcode: totalProducts - withBarcode,
          generated,
          manual: withBarcode - generated,
          coveragePercent: totalProducts > 0 ? Math.round((withBarcode / totalProducts) * 100) : 0
        }
      });
    } catch (e) {
      console.error('[Barcodes] Stats error:', e.message);
      res.status(500).json({ success: false, message: 'Failed to get barcode stats' });
    }
  });

  // GET /api/barcodes/product/:productId
  app.get('/api/barcodes/product/:productId', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const product = query('SELECT * FROM products WHERE id = ? AND companyId = ?', [req.params.productId, companyFilter])[0];
      if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
      let additional = [];
      try { additional = product.additionalBarcodes ? JSON.parse(product.additionalBarcodes) : []; } catch { additional = []; }
      res.json({ success: true, data: { productId: product.id, barcode: product.barcode, additionalBarcodes: additional, barcodeType: product.barcodeType || 'CODE128' } });
    } catch (e) {
      console.error('[Barcodes] Product barcodes error:', e.message);
      res.status(500).json({ success: false, message: 'Failed to get product barcodes' });
    }
  });

  // PUT /api/barcodes/product/:productId
  app.put('/api/barcodes/product/:productId', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const product = query('SELECT * FROM products WHERE id = ? AND companyId = ?', [req.params.productId, companyFilter])[0];
      if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
      const { barcode, additionalBarcodes, barcodeType } = req.body || {};
      if (barcode !== undefined && barcode !== null) {
        const v = validateBarcode(barcode, barcodeType || product.barcodeType || 'CODE128');
        if (!v.valid) return res.status(400).json({ success: false, message: v.message });
        const clash = query('SELECT id FROM products WHERE barcode = ? AND companyId = ? AND id != ?', [barcode, companyFilter, product.id])[0];
        if (clash) return res.status(400).json({ success: false, message: 'Barcode already exists in this business' });
      }
      const now = new Date().toISOString();
      run(
        'UPDATE products SET barcode = ?, additionalBarcodes = ?, barcodeType = ?, updatedAt = ? WHERE id = ?',
        [
          barcode !== undefined ? barcode : product.barcode,
          additionalBarcodes !== undefined ? JSON.stringify(additionalBarcodes) : product.additionalBarcodes,
          barcodeType || product.barcodeType || 'CODE128',
          now,
          product.id
        ]
      );
      saveDatabase();
      const updated = query('SELECT * FROM products WHERE id = ?', [product.id])[0];
      let additional = [];
      try { additional = updated.additionalBarcodes ? JSON.parse(updated.additionalBarcodes) : []; } catch { additional = []; }
      res.json({ success: true, data: { productId: updated.id, barcode: updated.barcode, additionalBarcodes: additional, barcodeType: updated.barcodeType || 'CODE128' } });
    } catch (e) {
      console.error('[Barcodes] Update product barcodes error:', e.message);
      res.status(500).json({ success: false, message: 'Failed to update product barcodes' });
    }
  });
}

module.exports = { registerBarcodeRoutes };
