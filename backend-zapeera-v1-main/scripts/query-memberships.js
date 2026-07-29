const { PrismaClient } = require('@prisma/client');
(async () => {
  const prisma = new PrismaClient();
  const id = process.argv[2] || 'cmo67444q00101c5wfn7hrn25';
  try {
    const rows = await prisma.$queryRaw`SELECT * FROM memberships WHERE userId = ${id}`;
    console.log('MEMBERSHIPS_RAW:', JSON.stringify(rows, null, 2));

    const mb = await prisma.$queryRaw`SELECT * FROM membership_branches WHERE membershipId IN (SELECT id FROM memberships WHERE userId = ${id})`;
    console.log('MEMBERSHIP_BRANCHES:', JSON.stringify(mb, null, 2));
  } catch (err) {
    console.error('ERROR', err && err.message ? err.message : err);
  } finally {
    await prisma.$disconnect();
  }
})();
