import { PrismaClient } from '@prisma/client';
import { seedTestData, TEST_USER_EMAIL, TEST_USER_PASSWORD } from '../tests/sync/helpers/seed';

async function main() {
  const dbPath = process.env.DATABASE_URL || 'file:./tests/cloud-test.db';
  console.log(`[Seed] Seeding test database: ${dbPath}`);

  const prisma = new PrismaClient({
    datasources: { db: { url: dbPath } }
  });

  await prisma.$connect();

  const count = await prisma.zapeeraUser.count();
  if (count > 0) {
    console.log(`[Seed] Database already has ${count} users. Skipping seed (use --force to re-seed).`);
    if (!process.argv.includes('--force')) {
      await prisma.$disconnect();
      console.log('[Seed] Done (skipped).');
      return;
    }
    console.log('[Seed] Force mode: clearing existing data...');
    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'`
    );
    for (const { name } of tables) {
      try { await prisma.$executeRawUnsafe(`DELETE FROM "${name}"`); } catch { }
    }
  }

  const seed = await seedTestData(prisma);
  console.log(`[Seed] ✅ Created:`);
  console.log(`       User:      ${seed.userId} (${TEST_USER_EMAIL} / ${TEST_USER_PASSWORD})`);
  console.log(`       Business:  ${seed.businessId} (Test Business A)`);
  console.log(`       Branch:    ${seed.branchId}`);
  console.log(`       Product:   ${seed.productId}`);
  console.log(`       Customer:  ${seed.customerId}`);
  console.log(`       Token:     ${seed.token.substring(0, 40)}...`);

  await prisma.$disconnect();
  console.log('[Seed] ✅ Done.');
}

main().catch(e => {
  console.error('[Seed] ❌ Failed:', e.message);
  process.exit(1);
});
