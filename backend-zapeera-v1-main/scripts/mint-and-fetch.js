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
    console.log('Minted token:', token);

    // Now fetch users
    const base = 'http://localhost:4200/api/users?page=1&limit=200';
    const doFetch = async (hdrs) => {
      const res = await fetch(base, { method: 'GET', headers: hdrs });
      const txt = await res.text();
      try { return { status: res.status, body: JSON.parse(txt) }; } catch { return { status: res.status, body: txt }; }
    };

    console.log('--- SuperAdmin (no headers) ---');
    console.log(JSON.stringify(await doFetch({ Authorization: `Bearer ${token}` }), null, 2));

    console.log('\n--- SuperAdmin (with company/branch headers) ---');
    console.log(JSON.stringify(await doFetch({ Authorization: `Bearer ${token}`, 'x-company-id': 'cmnxuwtbl001k1c2ozx2dnxef', 'x-branch-id': 'cmo4qz7gx00011cl8ysjs4kly' }), null, 2));

  } catch (err) {
    console.error('ERROR', err && err.message ? err.message : err);
  } finally { await prisma.$disconnect(); }
})();
