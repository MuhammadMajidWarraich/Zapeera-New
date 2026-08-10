import { PrismaClient } from '@prisma/client';
import express from 'express';
import supertest from 'supertest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const DB_DIR = path.resolve(os.tmpdir(), 'zapeera-cloud-test');
const DB_FILE = 'cloud-test.db';
const DB_PATH = path.resolve(DB_DIR, DB_FILE);
const DB_URL = `file:${DB_PATH.replace(/\\/g, '/')}`;

let _app: express.Express | null = null;
let _prisma: PrismaClient | null = null;

async function pushSchema(): Promise<void> {
  const { execSync } = require('child_process');
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string' && !v.includes('\0')) env[k] = v;
  }
  execSync('npx prisma db push --schema prisma/schema.sqlite.prisma --skip-generate --accept-data-loss', {
    cwd: path.resolve(__dirname, '..', '..', '..'),
    env: { ...env, DATABASE_URL: DB_URL },
    stdio: 'pipe',
    timeout: 60000
  });
}

export async function startTestApp(): Promise<express.Express> {
  process.env.DATABASE_URL = DB_URL;
  process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests-only';

  try { fs.unlinkSync(DB_PATH); } catch {}
  try { fs.unlinkSync(DB_PATH + '-journal'); } catch {}
  try { fs.unlinkSync(DB_PATH + '-wal'); } catch {}
  try { fs.unlinkSync(DB_PATH + '-shm'); } catch {}

  await pushSchema();

  _prisma = new PrismaClient({
    datasources: { db: { url: DB_URL } }
  });
  await _prisma.$connect();

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const jwt = require('jsonwebtoken');

  const authenticate: express.RequestHandler = (req: any, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
    try {
      req.user = jwt.verify(authHeader.replace('Bearer ', ''), process.env.JWT_SECRET);
      next();
    } catch {
      res.status(401).json({ success: false, message: 'Invalid token' });
    }
  };

  const remoteAuth: express.RequestHandler = async (req: any, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
    try {
      const decoded = jwt.verify(authHeader.replace('Bearer ', ''), process.env.JWT_SECRET);
      const user = await _prisma!.zapeeraUser.findUnique({ where: { id: decoded.userId } });
      if (!user || !user.isActive) { res.status(403).json({ success: false, message: 'Forbidden' }); return; }
      req.user = { id: user.id, username: user.username, email: user.email, name: user.name };
      next();
    } catch {
      res.status(401).json({ success: false, message: 'Invalid token' });
    }
  };

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', serverReady: true, database: 'sqlite' });
  });

  app.post('/api/auth/login', async (req: any, res: any) => {
    try {
      const { email, password } = req.body;
      const bcrypt = require('bcryptjs');
      const user = await _prisma!.zapeeraUser.findUnique({ where: { email } });
      if (!user || !(await bcrypt.compare(password, user.password))) {
        res.status(401).json({ success: false, message: 'Invalid credentials' }); return;
      }
      if (!user.isActive) {
        res.status(403).json({ success: false, message: 'Account deactivated' }); return;
      }
      const token = jwt.sign(
        { userId: user.id, email: user.email, sessionToken: 'test-session' },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );
      res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email } });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.post('/api/sync/account', remoteAuth, async (req: any, res: any) => {
    try {
      const user = await _prisma!.zapeeraUser.findUnique({
        where: { id: req.user.id },
        select: { id: true, username: true, email: true, name: true, isActive: true, createdAt: true }
      });
      const memberships = await _prisma!.membership.findMany({
        where: { userId: req.user.id, status: 'ACTIVE' },
        include: {
          business: { select: { id: true, name: true, businessType: true } },
          role: { select: { name: true } },
          branches: { include: { branch: { select: { id: true, name: true } } } }
        }
      });
      res.json({
        success: true,
        data: {
          user: { id: user!.id, username: user!.username, email: user!.email, name: user!.name, displayName: user!.name, isActive: user!.isActive, createdAt: user!.createdAt },
          memberships: memberships.map((m: any) => ({
            id: m.id, userId: m.userId, businessId: m.businessId,
            role: m.role?.name || 'OWNER', businessName: m.business.name,
            businessType: m.business.businessType || '', status: m.status,
            branchIds: m.branches.map((b: any) => b.branch.id),
            branches: m.branches.map((b: any) => ({ id: b.branch.id, name: b.branch.name }))
          })),
          businesses: memberships.map((m: any) => ({ id: m.business.id, name: m.business.name, businessType: m.business.businessType || '' }))
        }
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.post('/api/sync/business/provision', remoteAuth, async (req: any, res: any) => {
    try {
      const { businessId } = req.body;
      if (!businessId) { res.status(400).json({ success: false, message: 'businessId is required' }); return; }
      const business = await _prisma!.business.findUnique({
        where: { id: businessId },
        include: {
          branches: { where: { isActive: true } },
          roles: true,
          businessSubscription: true,
          businessModules: { include: { module: true } },
          memberships: { where: { userId: req.user.id }, include: { role: { select: { name: true } } } }
        }
      });
      if (!business) { res.status(404).json({ success: false, message: 'Business not found' }); return; }
      res.json({
        success: true,
        data: {
          business: { id: business.id, name: business.name, slug: business.slug, description: business.description, address: business.address, phone: business.phone, email: business.email, businessType: business.businessType, isActive: business.isActive, createdAt: business.createdAt },
          branches: business.branches.map((b: any) => ({ id: b.id, name: b.name, address: b.address, phone: b.phone, email: b.email, isActive: b.isActive })),
          roles: business.roles.map((r: any) => ({ id: r.id, name: r.name })),
          subscription: business.businessSubscription ? { planId: business.businessSubscription.planId, status: business.businessSubscription.status, trialEndsAt: business.businessSubscription.trialEndsAt } : null,
          modules: business.businessModules.map((bm: any) => ({ moduleId: bm.moduleId, key: bm.module ? bm.module.key : bm.moduleId, enabled: bm.enabled })),
          memberships: business.memberships.map((m: any) => ({ id: m.id, userId: m.userId, role: m.role?.name || 'OWNER' }))
        }
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.post('/api/sync/operations/push', remoteAuth, async (req: any, res: any) => {
    try {
      const { businessId, operations } = req.body;
      if (!businessId || !operations || !Array.isArray(operations)) {
        res.status(400).json({ success: false, message: 'businessId and operations[] are required' }); return;
      }
      const results: any[] = [];
      for (const op of operations) {
        try {
          const { entityType, entityId, operation, payload } = op;
          const prismaModel = (_prisma as any)[entityType === 'category' ? 'category' : entityType === 'categories' ? 'category' : entityType];
          if (operation === 'DELETE') {
            if (prismaModel?.delete) await prismaModel.delete({ where: { id: entityId } });
            results.push({ id: op.id, status: 'ACCEPTED' });
          } else if (operation === 'CREATE' || operation === 'create') {
            if (prismaModel?.create && payload) {
              const data = { ...payload };
              delete data.id;
              await prismaModel.create({ data: { ...data, id: entityId, companyId: businessId } });
            }
            results.push({ id: op.id, status: 'ACCEPTED' });
          } else if (operation === 'UPDATE' || operation === 'update') {
            if (prismaModel?.update && payload) {
              const { id, ...updateData } = payload;
              delete (updateData as any).id;
              await prismaModel.update({ where: { id: entityId }, data: updateData });
            }
            results.push({ id: op.id, status: 'ACCEPTED' });
          } else {
            results.push({ id: op.id, status: 'REJECTED', message: `Unknown operation: ${operation}` });
          }
        } catch (opError: any) {
          results.push({ id: op.id, status: 'FAILED', message: opError.message });
        }
      }
      res.json({ success: true, data: { results } });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get('/api/sync/changes', remoteAuth, async (req: any, res: any) => {
    try {
      const businessId = req.query.businessId as string;
      if (!businessId) { res.status(400).json({ success: false, message: 'businessId is required' }); return; }
      const cursor = req.query.cursor as string | undefined;
      const sinceDate = cursor ? new Date(cursor) : new Date(Date.now() - 86400000);
      const changes: any[] = [];
      const tables = ['product', 'customer', 'sale', 'purchase', 'batch', 'category', 'supplier', 'manufacturer', 'shelf', 'stockMovement'];
      for (const table of tables) {
        try {
          const model = (_prisma as any)[table];
          if (!model?.findMany) continue;
          const records = await model.findMany({
            where: { companyId: businessId, updatedAt: { gte: sinceDate } },
            take: 100
          });
          for (const record of records) {
            changes.push({ entityType: table, entityId: record.id, operation: 'UPSERT', data: record, timestamp: record.updatedAt });
          }
        } catch { }
      }
      const nextCursor = changes.length > 0
        ? new Date(Math.max(...changes.map((c: any) => new Date(c.timestamp).getTime()))).toISOString()
        : cursor;
      res.json({ success: true, data: { changes, nextCursor } });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get('/api/sync/status', remoteAuth, async (req: any, res: any) => {
    res.json({ success: true, data: { connectionState: 'ONLINE', lastSync: null, pendingChanges: 0, status: 'ONLINE' } });
  });

  app.get('/api/sync/connectivity', remoteAuth, async (req: any, res: any) => {
    res.json({ success: true, data: { status: 'online', isOnline: true } });
  });

  _app = app;
  return app;
}

export async function stopTestApp(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect();
    _prisma = null;
  }
  _app = null;
}

export function getPrisma(): PrismaClient {
  if (!_prisma) throw new Error('Test app not started');
  return _prisma;
}

export function getApp(): express.Express {
  if (!_app) throw new Error('Test app not started');
  return _app;
}

export function agent() {
  return supertest(getApp());
}

export async function cleanDatabase(): Promise<void> {
  const prisma = getPrisma();
  const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' ORDER BY name`
  );
  for (const { name } of tables) {
    try { await prisma.$executeRawUnsafe(`DELETE FROM "${name}"`); } catch { }
  }
}
