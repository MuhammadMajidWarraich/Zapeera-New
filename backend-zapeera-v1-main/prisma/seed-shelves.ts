import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const shelves = [
  { name: 'Shelf A1', description: 'Main warehouse cold storage shelf', location: 'Warehouse A - Cold Section' },
  { name: 'Shelf A2', description: 'Main warehouse room temperature shelf', location: 'Warehouse A - Room Temp' },
  { name: 'Shelf A3', description: 'Main warehouse over-the-counter shelf', location: 'Warehouse A - OTC Area' },
  { name: 'Shelf B1', description: 'Secondary warehouse storage', location: 'Warehouse B - Section 1' },
  { name: 'Shelf B2', description: 'Secondary warehouse bulk storage', location: 'Warehouse B - Section 2' },
  { name: 'Shelf C1', description: 'Retail display backup shelf', location: 'Retail Area - Back Storage' },
  { name: 'Shelf C2', description: 'Retail display fast-moving items', location: 'Retail Area - Front Storage' },
  { name: 'Shelf D1', description: 'Expired goods quarantine shelf', location: 'Quarantine Area' },
  { name: 'Shelf D2', description: 'Returns and damaged goods', location: 'Returns Area' },
  { name: 'Shelf E1', description: 'High-value items secure storage', location: 'Secure Vault' },
  { name: 'Shelf F1', description: 'Vaccines and biologics storage', location: 'Refrigerated Vault' },
  { name: 'Shelf F2', description: 'Insulin and temperature-sensitive', location: 'Refrigerated Vault - Section 2' },
];

async function main() {
  const allBranches = await prisma.branch.findMany();
  const branch = allBranches.find(b => 
    b.name.toLowerCase().includes('lahore')
  );

  if (!branch) {
    console.error('❌ Lahore branch not found. Available branches:');
    allBranches.forEach(b => console.log(`  - ${b.name} [${b.id}]`));
    return;
  }

  console.log(`✅ Found branch: ${branch.name} [${branch.id}], companyId: ${branch.companyId}`);

  const owner = await prisma.user.findFirst();
  if (!owner) {
    console.error('❌ No user found for createdBy');
    return;
  }

  let created = 0;
  let skipped = 0;

  for (const shelf of shelves) {
    const existing = await prisma.shelf.findFirst({
      where: {
        name: shelf.name,
        branchId: branch.id,
      },
    });

    if (existing) {
      console.log(`  ⏭ Skipped (exists): ${shelf.name}`);
      skipped++;
      continue;
    }

    await prisma.shelf.create({
      data: {
        name: shelf.name,
        description: shelf.description,
        location: shelf.location,
        branchId: branch.id,
        companyId: branch.companyId,
        createdBy: owner.id,
      },
    });

    console.log(`  ✅ Created: ${shelf.name}`);
    created++;
  }

  console.log(`\n🏭 Done! Created: ${created}, Skipped: ${skipped}`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
