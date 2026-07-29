import { PrismaClient } from '@prisma/client';

/**
 * Ensure remote PostgreSQL schema has required columns.
 *
 * Background: some deployments were created without Prisma migrations history,
 * so schema can lag behind the current Prisma model. This causes runtime 500s
 * like P2022 "column does not exist".
 *
 * This function only performs ADD COLUMN / CREATE INDEX IF NOT EXISTS operations
 * (non-destructive, idempotent).
 */
export async function ensurePostgresSchemaCompatibility(prisma: PrismaClient): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL || '';
  if (!databaseUrl || databaseUrl.startsWith('file:')) return; // SQLite

  // ZAPEERA_USERS table (new business access control)
  // Some existing PostgreSQL databases were created before this column existed,
  // which causes runtime 500s when dashboards/zapeera_users screens query it.
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "zapeera_users" ADD COLUMN IF NOT EXISTS "businessAccessGranted" BOOLEAN NOT NULL DEFAULT true'
  );

  // SALES table (required by Prisma model + controllers)
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "invoiceNumber" TEXT'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "returnedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0'
  );
  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "sales_invoiceNumber_key" ON "sales" ("invoiceNumber")'
  );

  // SALE ITEMS table (optional fields in Prisma model still require DB columns to exist)
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "unitsDeducted" INTEGER'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "unitsPerBox" INTEGER'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "saleType" TEXT'
  );
}
