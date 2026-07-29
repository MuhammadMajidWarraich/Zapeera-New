const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const user = await prisma.zapeeraUser.update({
    where: { email: 'loginuser@test.com' },
    data: { emailVerified: true, isActive: true }
  });
  console.log('Updated:', user.email, 'emailVerified:', user.emailVerified, 'isActive:', user.isActive);
}
main().catch(console.error).finally(() => prisma.$disconnect());
