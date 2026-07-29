import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const dbPath = path.resolve(__dirname, '..', 'tests', 'cloud-test.db');
  console.log(`[Reset] Target: ${dbPath}`);

  if (fs.existsSync(dbPath)) {
    try {
      fs.unlinkSync(dbPath);
      console.log('[Reset] ✅ Deleted cloud-test.db');
    } catch (e: any) {
      console.error('[Reset] Could not delete:', e.message);
    }
  }

  const journalPath = dbPath + '-journal';
  if (fs.existsSync(journalPath)) {
    try { fs.unlinkSync(journalPath); } catch { }
  }

  const walPath = dbPath + '-wal';
  if (fs.existsSync(walPath)) {
    try { fs.unlinkSync(walPath); } catch { }
  }

  const shmPath = dbPath + '-shm';
  if (fs.existsSync(shmPath)) {
    try { fs.unlinkSync(shmPath); } catch { }
  }

  try {
    const prisma = new PrismaClient({
      datasources: { db: { url: `file:${dbPath}` } }
    });
    await prisma.$connect();
    console.log('[Reset] ✅ Connected to fresh database');
    await prisma.$disconnect();
  } catch (e: any) {
    console.warn('[Reset] Connect warning:', e.message);
  }

  console.log('[Reset] ✅ Done. Database is ready for re-seeding.');
}

main().catch(e => {
  console.error('[Reset] ❌ Failed:', e.message);
  process.exit(1);
});
