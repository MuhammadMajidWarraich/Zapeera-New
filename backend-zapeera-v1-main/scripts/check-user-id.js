const { PrismaClient } = require('@prisma/client');
(async () => {
  const prisma = new PrismaClient();
  const id = process.argv[2] || 'cmo64c1lp00121c743c0n2tb4';
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    console.log('USER:', JSON.stringify(user, null, 2));

    const companyMembers = await prisma.companyMember.findMany({ where: { userId: id } });
    console.log('COMPANY_MEMBERS:', JSON.stringify(companyMembers, null, 2));

    const memberships = await prisma.$queryRaw('SELECT * FROM memberships WHERE user_id = ?', id);
    console.log('MEMBERSHIPS_RAW:', JSON.stringify(memberships, null, 2));

    const membershipBranches = await prisma.$queryRaw('SELECT * FROM membership_branches WHERE membership_id IN (SELECT id FROM memberships WHERE user_id = ?)', id);
    console.log('MEMBERSHIP_BRANCHES:', JSON.stringify(membershipBranches, null, 2));
  } catch (err) {
    console.error('ERROR', err && err.message ? err.message : err);
  } finally {
    await prisma.$disconnect();
  }
})();
