const { PrismaClient } = require('@prisma/client');
(async () => {
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany({ where: { email: 'apitest_staff_1@test.local' } });
    console.log(JSON.stringify(users, null, 2));
  } catch (err) {
    console.error('ERROR', err && err.message ? err.message : err);
  } finally {
    await prisma.$disconnect();
  }
})();
