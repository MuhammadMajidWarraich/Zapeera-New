/**
 * Product Repository
 * Data access layer for product operations
 * Extracted from embedded-server.js
 */

const { uuid, now } = require('../../utils/helpers');

const TABLE_NAME = 'products';

/**
 * Find all products
 */
function findAll(deps, filter = {}, options = {}) {
  const { query } = deps;
  const { page = 1, limit = 50, search = '' } = options;
  
  let sql = `SELECT * FROM ${TABLE_NAME} WHERE 1=1`;
  const params = [];
  
  if (filter.branchId) {
    sql += ' AND branchId = ?';
    params.push(filter.branchId);
  }
  if (filter.companyId) {
    sql += ' AND companyId = ?';
    params.push(filter.companyId);
  }
  if (search) {
    sql += ' AND (name LIKE ? OR id LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  
  sql += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
  params.push(limit, (page - 1) * limit);
  
  const results = query(sql, params);
  const total = query(`SELECT COUNT(*) as count FROM ${TABLE_NAME} WHERE 1=1`, [])[0]?.count || 0;
  
  return {
    data: results,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    }
  };
}

/**
 * Find product by ID
 */
function findById(id, deps) {
  const { query } = deps;
  const results = query(`SELECT * FROM ${TABLE_NAME} WHERE id = ?`, [id]);
  return results[0] || null;
}

/**
 * Create product
 */
function create(data, deps) {
  const { run, handleDataChange } = deps;
  
  const id = data.id || uuid();
  const record = {
    id,
    ...data,
    createdAt: now(),
    updatedAt: now()
  };
  
  const columns = Object.keys(record).join(', ');
  const values = Object.values(record);
  const placeholders = values.map(() => '?').join(', ');
  
  run(`INSERT INTO ${TABLE_NAME} (${columns}) VALUES (${placeholders})`, values);
  
  if (handleDataChange) {
    handleDataChange(TABLE_NAME, 'create', record);
  }
  
  return record;
}

/**
 * Update product
 */
function update(id, data, deps) {
  const { run, handleDataChange } = deps;
  
  const record = {
    ...data,
    id,
    updatedAt: now()
  };
  
  const setClause = Object.keys(record)
    .filter(key => key !== 'id')
    .map(key => `${key} = ?`)
    .join(', ');
  const values = Object.values(record).filter((_, idx) => Object.keys(record)[idx] !== 'id');
  
  run(`UPDATE ${TABLE_NAME} SET ${setClause} WHERE id = ?`, [...values, id]);
  
  if (handleDataChange) {
    handleDataChange(TABLE_NAME, 'update', record);
  }
  
  return record;
}

/**
 * Delete product
 */
function deleteRecord(id, deps) {
  const { run, handleDataChange } = deps;
  
  run(`DELETE FROM ${TABLE_NAME} WHERE id = ?`, [id]);
  
  if (handleDataChange) {
    handleDataChange(TABLE_NAME, 'delete', { id });
  }
  
  return { success: true };
}

module.exports = {
  findAll,
  findById,
  create,
  update,
  delete: deleteRecord
};
