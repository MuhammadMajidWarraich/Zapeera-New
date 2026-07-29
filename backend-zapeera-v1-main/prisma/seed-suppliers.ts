import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const supplierData = [
  { name: 'MedLine Distributors', contactPerson: 'Ali Hassan', phone: '+92-321-1234567', manufacturer: 'GlaxoSmithKline (GSK)' },
  { name: 'PharmaCare Supplies', contactPerson: 'Ahmed Khan', phone: '+92-300-2345678', manufacturer: 'Pfizer' },
  { name: 'HealthFirst Trading', contactPerson: 'Usman Tariq', phone: '+92-333-3456789', manufacturer: 'Novartis' },
  { name: 'PharmaLink Pakistan', contactPerson: 'Bilal Mehmood', phone: '+92-312-4567890', manufacturer: 'Roche' },
  { name: 'MedSource Lahore', contactPerson: 'Kamran Javed', phone: '+92-301-5678901', manufacturer: 'Sanofi' },
  { name: 'Zenith Medical Supplies', contactPerson: 'Faisal Iqbal', phone: '+92-345-6789012', manufacturer: 'Abbott Laboratories' },
  { name: 'National Drug House', contactPerson: 'Imran Malik', phone: '+92-322-7890123', manufacturer: 'Getz Pharma' },
  { name: 'Allied Pharma Traders', contactPerson: 'Waseem Akram', phone: '+92-302-8901234', manufacturer: 'Martin Dow' },
  { name: 'Prime Healthcare Dist.', contactPerson: 'Saad Rizvi', phone: '+92-311-9012345', manufacturer: 'Searle Pakistan' },
  { name: 'City Pharma Supply', contactPerson: 'Tariq Mahmood', phone: '+92-336-0123456', manufacturer: 'Ferozsons Laboratories' },
  { name: 'Metro Medical Traders', contactPerson: 'Naveed Shah', phone: '+92-303-1234567', manufacturer: 'Highnoon Laboratories' },
  { name: 'Punjab Drug House', contactPerson: 'Zubair Ahmed', phone: '+92-331-2345678', manufacturer: 'Hilton Pharma' },
  { name: 'Global Health Supplies', contactPerson: 'Shahid Aslam', phone: '+92-304-3456789', manufacturer: 'Sami Pharmaceuticals' },
  { name: 'Reliable Pharma Dist.', contactPerson: 'Junaid Siddiqui', phone: '+92-313-4567890', manufacturer: 'PharmEvo' },
  { name: 'Star Medical Trading', contactPerson: 'Rehan Qureshi', phone: '+92-342-5678901', manufacturer: 'AGP Limited' },
];

async function main() {
  const allBranches = await prisma.branch.findMany();
  const branch = allBranches.find(b => b.name.toLowerCase().includes('lahore'));

  if (!branch) {
    console.error('❌ Lahore branch not found.');
    return;
  }

  console.log(`✅ Branch: ${branch.name} [${branch.id}]`);

  const manufacturers = await prisma.manufacturer.findMany({
    where: { branchId: branch.id }
  });

  console.log(`📦 Found ${manufacturers.length} manufacturers`);

  const owner = await prisma.user.findFirst();
  let created = 0;
  let skipped = 0;

  for (const s of supplierData) {
    const mfr = manufacturers.find(m => m.name === s.manufacturer);
    if (!mfr) {
      console.log(`  ⚠ Manufacturer not found: ${s.manufacturer}`);
      continue;
    }

    const existing = await prisma.supplier.findFirst({
      where: { name: s.name, branchId: branch.id }
    });

    if (existing) {
      // Update existing supplier to link manufacturer if not linked
      if (!existing.manufacturerId) {
        await prisma.supplier.update({
          where: { id: existing.id },
          data: { manufacturerId: mfr.id }
        });
        console.log(`  🔗 Linked existing: ${s.name} → ${s.manufacturer}`);
      } else {
        console.log(`  ⏭ Skipped (exists): ${s.name}`);
      }
      skipped++;
      continue;
    }

    await prisma.supplier.create({
      data: {
        name: s.name,
        contactPerson: s.contactPerson,
        phone: s.phone,
        manufacturerId: mfr.id,
        branchId: branch.id,
        companyId: branch.companyId,
        createdBy: owner?.id || null,
        isActive: true,
      }
    });
    console.log(`  ✅ Created: ${s.name} → ${s.manufacturer}`);
    created++;
  }

  console.log(`\n📋 Done! Created: ${created}, Skipped: ${skipped}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
