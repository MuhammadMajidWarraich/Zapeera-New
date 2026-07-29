import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const cnt: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as n FROM payment_proofs`);
  console.log('payment_proofs row count:', cnt);

  const cols: any[] = await prisma.$queryRawUnsafe(`PRAGMA table_info(payment_proofs)`);
  console.log('columns:', cols.map((c: any) => c.name));

  try {
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

    const rows: any[] = await prisma.$queryRawUnsafe(sql);
    console.log('JOIN query rows:', rows.length);
    if (rows.length) console.log('first row:', rows[0]);
  } catch (e: any) {
    console.error('JOIN ERR:', e.message);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
