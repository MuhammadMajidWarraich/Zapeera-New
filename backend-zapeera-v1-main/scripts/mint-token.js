(async()=>{
  const { PrismaClient } = require('@prisma/client');
  const jwt = require('jsonwebtoken');
  const prisma = new PrismaClient();
  try {
    const userId = process.argv[2] || 'cmnf5dfjk00011c885b4jq9dz';
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) { console.error('User not found'); process.exit(1); }
    const payload = {
      userId: user.id,
      username: user.username,
      role: 'SUPERADMIN',
      branchId: user.branchId || null,
      createdBy: user.createdBy || null,
      sessionToken: user.sessionToken || null
    };
    const secret = process.env.JWT_SECRET || 'dev-only-secret';
    const token = jwt.sign(payload, secret, { expiresIn: '2h' });
    console.log(token);
  } catch (err) { console.error('ERROR', err && err.message ? err.message : err); } finally { await prisma.$disconnect(); }
})();
