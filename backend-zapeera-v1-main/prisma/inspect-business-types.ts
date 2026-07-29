import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Inspecting current business types...\n');

  // Get all business types
  const businessTypes = await prisma.businessType.findMany({
    include: {
      modules: {
        include: {
          module: true,
        },
      },
    },
  });

  console.log(`📊 Found ${businessTypes.length} business types:\n`);
  for (const bt of businessTypes) {
    console.log(`  - ID: ${bt.id}`);
    console.log(`    Name: ${bt.name}`);
    console.log(`    Description: ${bt.description}`);
    console.log(`    UUID: ${bt.uuid}`);
    console.log(`    Modules: ${bt.modules.map(m => m.module?.name).join(', ') || 'None'}`);
    console.log('');
  }

  // Get all companies and their business types
  const companies = await prisma.company.findMany({
    select: {
      id: true,
      name: true,
      businessType: true,
    },
  });

  console.log(`\n🏢 Found ${companies.length} companies:\n`);
  const businessTypeCounts: Record<string, number> = {};
  for (const company of companies) {
    const bt = company.businessType || 'NULL';
    businessTypeCounts[bt] = (businessTypeCounts[bt] || 0) + 1;
  }

  console.log('Business type distribution:');
  for (const [bt, count] of Object.entries(businessTypeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${bt}: ${count} companies`);
  }

  // Identify potential duplicates
  console.log('\n🔍 Potential duplicates:');
  const pharmacyTypes = businessTypes.filter(bt => bt.name.toUpperCase().includes('PHARMACY'));
  const departmentalTypes = businessTypes.filter(bt => bt.name.toUpperCase().includes('DEPARTMENTAL') || bt.name.toUpperCase().includes('STORE'));
  const testTypes = businessTypes.filter(bt => bt.name.toUpperCase().includes('TEST'));

  if (pharmacyTypes.length > 1) {
    console.log(`  - PHARMACY duplicates: ${pharmacyTypes.map(bt => bt.id).join(', ')}`);
  }
  if (departmentalTypes.length > 1) {
    console.log(`  - DEPARTMENTAL/STORE duplicates: ${departmentalTypes.map(bt => bt.id).join(', ')}`);
  }
  if (testTypes.length > 0) {
    console.log(`  - TEST types: ${testTypes.map(bt => bt.id).join(', ')}`);
  }
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
