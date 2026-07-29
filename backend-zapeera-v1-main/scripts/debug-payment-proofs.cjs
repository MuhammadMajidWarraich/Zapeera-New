const Database = require('better-sqlite3');
const db = new Database('C:/Users/Muhammad Majid/.zapeera/data/zapeera.db', { readonly: true });

try {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND (name='payment_proofs' OR name='companies' OR name='platform_plans')`).all();
  console.log('tables found:', tables);

  const cols = db.prepare(`PRAGMA table_info(payment_proofs)`).all();
  console.log('payment_proofs columns:', cols.map(c => c.name));

  const count = db.prepare(`SELECT COUNT(*) as n FROM payment_proofs`).get();
  console.log('payment_proofs row count:', count);

  const sql = `SELECT pp.id, pp."businessId", pp."planId", pp.amount, pp.currency,
       pp.method, pp."referenceNote", pp."screenshotUrl",
       pp.status, pp."rejectionReason", pp."reviewedBy", pp."reviewedAt",
       pp."createdAt",
       c.name  as "businessName",
       c.email as "businessEmail",
       p.name  as "planName",
       p.price as "planPrice"
FROM payment_proofs pp
JOIN companies      c ON c.id = pp."businessId"
JOIN platform_plans p ON p.id = pp."planId"
WHERE 1=1
ORDER BY pp."createdAt" DESC`;

  const rows = db.prepare(sql).all();
  console.log('JOIN query rows:', rows.length);
  console.log('first row:', rows[0]);
} catch (e) {
  console.error('ERR:', e.message);
}
