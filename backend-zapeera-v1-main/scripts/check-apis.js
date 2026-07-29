const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const http = require('http');
const url = require('url');
(async () => {
  const prisma = new PrismaClient();
  const userId = process.argv[2] || 'cmnqhy2df00051cr4v62f1go3';
  const companyId = process.argv[3] || 'cmnxuwtbl001k1c2ozx2dnxef';
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) { console.error('User not found'); process.exit(1); }
    const token = jwt.sign({ userId: user.id, username: user.username, role: user.role || 'SUPERADMIN', branchId: user.branchId || null, createdBy: user.createdBy || null, sessionToken: user.sessionToken || null }, process.env.JWT_SECRET || 'dev-only-secret', { expiresIn: '2h' });
    console.log('Using token for', user.username);
    const base = process.env.API_BASE || 'http://127.0.0.1:4200/api';
    
    // Helper to make HTTP requests
    const makeRequest = (path, headers) => {
      return new Promise((resolve, reject) => {
        const opts = url.parse(base + path);
        opts.headers = headers;
        opts.method = 'GET';
        const req = http.request(opts, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.end();
      });
    };

    console.log('GET', `${base}/companies/${companyId}/members`)
    let r = await makeRequest(`/companies/${companyId}/members`, { Authorization: `Bearer ${token}` });
    console.log('/companies/:id/members status', r.status);
    const cm = JSON.parse(r.body);
    console.log('Staff count:', cm.data?.length || 0);
    if (cm.data) console.log('Staff:', JSON.stringify(cm.data.slice(0, 2), null, 2));

    console.log('\nGET /users with X-Business-ID header')
    r = await makeRequest(`/users?limit=50`, { Authorization: `Bearer ${token}`, 'X-Business-ID': companyId });
    console.log('/users status', r.status);
    const users = JSON.parse(r.body);
    console.log('Users count:', users.data?.users?.length || 0);
    if (users.data?.users && users.data.users.length > 0) {
      console.log('First user full object:');
      console.log(JSON.stringify(users.data.users[0], null, 2));
    }
  } catch (err) { console.error(err); }
  finally { await prisma.$disconnect(); }
})();
