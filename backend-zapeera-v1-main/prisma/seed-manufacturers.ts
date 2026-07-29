import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const manufacturers = [
  { name: 'GlaxoSmithKline (GSK)', description: 'British multinational pharmaceutical and biotechnology company', website: 'https://www.gsk.com', country: 'United Kingdom' },
  { name: 'Pfizer', description: 'American multinational pharmaceutical and biotechnology corporation', website: 'https://www.pfizer.com', country: 'United States' },
  { name: 'Novartis', description: 'Swiss multinational pharmaceutical corporation', website: 'https://www.novartis.com', country: 'Switzerland' },
  { name: 'Roche', description: 'Swiss multinational healthcare company', website: 'https://www.roche.com', country: 'Switzerland' },
  { name: 'Sanofi', description: 'French multinational pharmaceutical and healthcare company', website: 'https://www.sanofi.com', country: 'France' },
  { name: 'Abbott Laboratories', description: 'American multinational medical devices and health care company', website: 'https://www.abbott.com', country: 'United States' },
  { name: 'Getz Pharma', description: 'Leading Pakistani pharmaceutical company with global presence', website: 'https://www.getzpharma.com', country: 'Pakistan' },
  { name: 'Martin Dow', description: 'One of the largest pharmaceutical groups in Pakistan', website: 'https://www.martindow.com', country: 'Pakistan' },
  { name: 'Searle Pakistan', description: 'Pakistani pharmaceutical company manufacturing a wide range of products', website: 'https://www.searlecompany.com', country: 'Pakistan' },
  { name: 'Ferozsons Laboratories', description: 'Pioneer pharmaceutical company in Pakistan since 1954', website: 'https://www.ferozsons-labs.com', country: 'Pakistan' },
  { name: 'Highnoon Laboratories', description: 'Pakistani pharmaceutical company focused on quality healthcare', website: 'https://www.highnoonlabs.com', country: 'Pakistan' },
  { name: 'Hilton Pharma', description: 'Pakistani pharmaceutical company with diverse product portfolio', website: 'https://www.hiltonpharma.com', country: 'Pakistan' },
  { name: 'Sami Pharmaceuticals', description: 'Leading pharmaceutical company in Pakistan with herbal expertise', website: 'https://www.samipharma.com', country: 'Pakistan' },
  { name: 'PharmEvo', description: 'Fast-growing Pakistani pharmaceutical company', website: 'https://www.pharmevo.biz', country: 'Pakistan' },
  { name: 'AGP Limited', description: 'Pakistani pharmaceutical company specializing in nutraceuticals', website: 'https://www.agp.com.pk', country: 'Pakistan' },
];

async function main() {
  // Find the Lahore branch under Gohar Pharma company
  // Find all branches and filter manually
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

  // Find any user for createdBy
  const owner = await prisma.user.findFirst();

  let created = 0;
  let skipped = 0;

  for (const mfr of manufacturers) {
    const existing = await prisma.manufacturer.findFirst({
      where: { name: mfr.name, branchId: branch.id }
    });

    if (existing) {
      console.log(`  ⏭ Skipped (exists): ${mfr.name}`);
      skipped++;
      continue;
    }

    await prisma.manufacturer.create({
      data: {
        name: mfr.name,
        description: mfr.description,
        website: mfr.website,
        country: mfr.country,
        branchId: branch.id,
        companyId: branch.companyId,
        createdBy: owner?.id || null,
        isActive: true,
      }
    });
    console.log(`  ✅ Created: ${mfr.name}`);
    created++;
  }

  console.log(`\n🏭 Done! Created: ${created}, Skipped: ${skipped}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
