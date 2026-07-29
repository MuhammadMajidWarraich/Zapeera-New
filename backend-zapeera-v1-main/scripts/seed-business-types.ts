import { PrismaClient } from '@prisma/client';
import * as path from 'path';
import * as os from 'os';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `file:${path.join(os.homedir(), '.zapeera', 'data', 'zapeera.db')}`
    }
  }
});

async function main() {
  console.log('Seeding business types...');
  const defaultTypes = [
    { name: 'PHARMACY', description: 'Pharmacy and medical stores' },
    { name: 'DEPARTMENTAL_STORE', description: 'General retail and departmental stores' },
    { name: 'Pharmacy', description: 'Pharmacy and medical stores' },
    { name: 'Departmental Store', description: 'General retail and departmental stores' }
  ];

  for (const type of defaultTypes) {
    try {
      const result = await (prisma as any).businessType.upsert({
        where: { name: type.name },
        update: { description: type.description },
        create: {
          id: type.name.toUpperCase().replace(/\s+/g, '_'),
          name: type.name,
          description: type.description
        }
      });
      console.log(`✅ Upserted business type: ${type.name} (ID: ${result.id})`);
    } catch (error: any) {
      console.error(`❌ Failed to upsert ${type.name}:`, error.message);
    }
  }

  // Also check if they are in the database
  const allTypes = await prisma.businessType.findMany();
  console.log('Total business types in DB:', allTypes.length);
  allTypes.forEach(t => console.log(`- ${t.name} (${t.id})`));

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
