import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Starting business type cleanup migration...\n');

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

  console.log(`📊 Found ${businessTypes.length} business types\n`);

  // Identify duplicates
  const pharmacyTypes = businessTypes.filter(bt => bt.name.toUpperCase().includes('PHARMACY'));
  const departmentalTypes = businessTypes.filter(bt => 
    bt.name.toUpperCase().includes('DEPARTMENTAL') || 
    bt.name.toUpperCase().includes('STORE') ||
    bt.name.toUpperCase().includes('RETAIL')
  );
  const testTypes = businessTypes.filter(bt => bt.name.toUpperCase().includes('TEST'));

  // 1. Delete Test business types
  console.log('🗑️  Step 1: Deleting Test business types...');
  for (const testType of testTypes) {
    console.log(`  - Deleting ${testType.name} (${testType.id})`);
    
    // Delete associated modules
    await prisma.businessTypeModule.deleteMany({
      where: { businessTypeId: testType.id },
    });
    
    // Delete the business type
    await prisma.businessType.delete({
      where: { id: testType.id },
    });
    
    console.log(`    ✅ Deleted`);
  }
  console.log(`\n✅ Deleted ${testTypes.length} Test business types\n`);

  // 2. Consolidate Pharmacy types
  console.log('🔄 Step 2: Consolidating Pharmacy business types...');
  if (pharmacyTypes.length > 1) {
    // Keep the first one, migrate others to it
    const keepPharmacy = pharmacyTypes[0];
    const duplicatePharmacies = pharmacyTypes.slice(1);
    
    console.log(`  - Keeping: ${keepPharmacy.name} (${keepPharmacy.id})`);
    console.log(`  - Migrating ${duplicatePharmacies.length} duplicates...`);
    
    for (const dup of duplicatePharmacies) {
      console.log(`    - Migrating from ${dup.name} (${dup.id}) to ${keepPharmacy.id}`);
      
      // Update companies using this business type
      const updatedCompanies = await prisma.company.updateMany({
        where: { businessType: dup.name },
        data: { businessType: keepPharmacy.name },
      });
      
      console.log(`      ✅ Updated ${updatedCompanies.count} companies`);
      
      // Delete associated modules
      await prisma.businessTypeModule.deleteMany({
        where: { businessTypeId: dup.id },
      });
      
      // Delete the duplicate business type
      await prisma.businessType.delete({
        where: { id: dup.id },
      });
      
      console.log(`      ✅ Deleted duplicate`);
    }
  } else {
    console.log('  ℹ️  No duplicate Pharmacy types found');
  }
  console.log('');

  // 3. Consolidate Departmental/Store types
  console.log('🔄 Step 3: Consolidating Departmental/Store business types...');
  if (departmentalTypes.length > 1) {
    // Keep DEPARTMENTAL_STORE if exists, otherwise keep the first one
    const keepDepartmental = departmentalTypes.find(bt => bt.name === 'DEPARTMENTAL_STORE') || departmentalTypes[0];
    const duplicateDepartmentals = departmentalTypes.filter(bt => bt.id !== keepDepartmental.id);
    
    console.log(`  - Keeping: ${keepDepartmental.name} (${keepDepartmental.id})`);
    console.log(`  - Migrating ${duplicateDepartmentals.length} duplicates...`);
    
    for (const dup of duplicateDepartmentals) {
      console.log(`    - Migrating from ${dup.name} (${dup.id}) to ${keepDepartmental.name}`);
      
      // Update companies using this business type
      const updatedCompanies = await prisma.company.updateMany({
        where: { businessType: dup.name },
        data: { businessType: keepDepartmental.name },
      });
      
      console.log(`      ✅ Updated ${updatedCompanies.count} companies`);
      
      // Delete associated modules
      await prisma.businessTypeModule.deleteMany({
        where: { businessTypeId: dup.id },
      });
      
      // Delete the duplicate business type
      await prisma.businessType.delete({
        where: { id: dup.id },
      });
      
      console.log(`      ✅ Deleted duplicate`);
    }
  } else {
    console.log('  ℹ️  No duplicate Departmental/Store types found');
  }
  console.log('');

  // 4. Ensure canonical business types exist and have correct modules
  console.log('🔧 Step 4: Ensuring canonical business types with correct modules...');
  const canonicalTypes = [
    { name: 'PHARMACY', description: 'Pharmacy and medical stores' },
    { name: 'DEPARTMENTAL_STORE', description: 'General retail and departmental stores' },
    { name: 'RETAIL_STORE', description: 'General retail stores' },
    { name: 'HOTEL', description: 'Hotels and hospitality' },
    { name: 'CLINIC', description: 'Medical clinics' },
  ];

  const standardModules = ['pos', 'inventory', 'reports', 'customers', 'staff'];
  const modules = await prisma.module.findMany({
    where: { name: { in: standardModules } },
  });

  for (const canonical of canonicalTypes) {
    console.log(`  - Ensuring ${canonical.name}...`);
    
    // Upsert the business type
    const businessType = await prisma.businessType.upsert({
      where: { name: canonical.name },
      update: { description: canonical.description },
      create: {
        id: canonical.name,
        name: canonical.name,
        description: canonical.description,
      },
    });
    
    console.log(`    ✅ Business type: ${businessType.id}`);
    
    // Ensure standard modules are assigned
    for (const mod of modules) {
      const existing = await prisma.businessTypeModule.findUnique({
        where: {
          businessTypeId_moduleId: {
            businessTypeId: businessType.id,
            moduleId: mod.id,
          },
        },
      });
      
      if (!existing) {
        await prisma.businessTypeModule.create({
          data: {
            businessTypeId: businessType.id,
            moduleId: mod.id,
          },
        });
        console.log(`    ✅ Added module: ${mod.name}`);
      }
    }
  }
  console.log('');

  // 5. Final verification
  console.log('✅ Step 5: Final verification...');
  const finalBusinessTypes = await prisma.businessType.findMany({
    include: { modules: { include: { module: true } } },
  });

  console.log(`📊 Final business types count: ${finalBusinessTypes.length}\n`);
  for (const bt of finalBusinessTypes) {
    console.log(`  - ${bt.name} (${bt.id})`);
    console.log(`    Modules: ${bt.modules.map(m => m.module?.name).join(', ')}`);
  }

  console.log('\n✅ Migration completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
