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

  // Unit engine (Wave C2): strip size on products, selling-level
  // snapshot on sale items. The Prisma models carry these fields, so
  // databases created before C2 need the columns added idempotently
  // (same pattern as the sale_items columns above).
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "unitsPerStrip" INTEGER'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "unitLevel" TEXT'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "unitFactor" INTEGER'
  );

  // Auto-reorder (Wave C3): opt-in reorder point + fixed reorder
  // quantity on products (nullable — only set products participate in
  // reorder suggestions).
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "reorderLevel" INTEGER'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "reorderQuantity" INTEGER'
  );

  // Retail pack (Wave C6): variant pool on batches, the variant
  // snapshot on sale lines, and salesperson attribution on sales.
  // All nullable — pre-C6 rows stay null and every read path treats
  // null exactly as it did before. (The new tables — product_variants,
  // stock_takes, stock_take_lines — arrive via schema heal like the
  // C4/C5 tables did.)
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "variantId" TEXT'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "variantId" TEXT'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "variantName" TEXT'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "salespersonId" TEXT'
  );

  // White-label partners (Feature 3): businesses gain the nullable
  // partner attribution column. The partners table itself arrives via
  // schema heal like the C4/C5 tables did. Pre-existing businesses
  // stay null (= sold direct under the Zapeera brand).
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "partnerId" TEXT'
  );
}
