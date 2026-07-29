import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { startTestApp, stopTestApp, getPrisma, agent, cleanDatabase } from './helpers/test-app';
import { seedTestData, SeedData } from './helpers/seed';

let seed: SeedData;

beforeAll(async () => {
  await startTestApp();
  await cleanDatabase();
  seed = await seedTestData(getPrisma());
});

afterAll(async () => {
  await stopTestApp();
});

describe('Cloud Sync API — Full Integration', () => {

  describe('Auth Endpoints', () => {
    it('should login and return JWT token', async () => {
      const res = await agent()
        .post('/api/auth/login')
        .send({ email: 'test@zapeera.test', password: 'testpassword123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(typeof res.body.token).toBe('string');
    });

    it('should reject invalid credentials', async () => {
      const res = await agent()
        .post('/api/auth/login')
        .send({ email: 'test@zapeera.test', password: 'wrongpassword' });

      expect(res.status).toBe(401);
    });

    it('should reject unauthenticated requests to sync endpoints', async () => {
      const res = await agent()
        .post('/api/sync/account');

      expect(res.status).toBe(401);
    });
  });

  describe('Sync Account', () => {
    it('should return user account data with memberships', async () => {
      const res = await agent()
        .post('/api/sync/account')
        .set('Authorization', `Bearer ${seed.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.email).toBe('test@zapeera.test');
      expect(res.body.data.memberships).toBeInstanceOf(Array);
      expect(res.body.data.memberships.length).toBe(1);
      expect(res.body.data.memberships[0].businessName).toBe('Test Business A');
      expect(res.body.data.businesses).toBeInstanceOf(Array);
    });
  });

  describe('Business Provisioning', () => {
    it('should return full business data for provisioning', async () => {
      const res = await agent()
        .post('/api/sync/business/provision')
        .set('Authorization', `Bearer ${seed.token}`)
        .send({ businessId: seed.businessId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.business).toBeDefined();
      expect(res.body.data.business.name).toBe('Test Business A');
      expect(res.body.data.branches).toBeInstanceOf(Array);
      expect(res.body.data.branches.length).toBe(1);
      expect(res.body.data.roles).toBeInstanceOf(Array);
    });

    it('should reject provisioning without businessId', async () => {
      const res = await agent()
        .post('/api/sync/business/provision')
        .set('Authorization', `Bearer ${seed.token}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('should reject provisioning a non-existent business', async () => {
      const res = await agent()
        .post('/api/sync/business/provision')
        .set('Authorization', `Bearer ${seed.token}`)
        .send({ businessId: 'non-existent-id' });

      expect(res.status).toBe(404);
    });
  });

  describe('Push Operations', () => {
    it('should accept CREATE operations', async () => {
      const res = await agent()
        .post('/api/sync/operations/push')
        .set('Authorization', `Bearer ${seed.token}`)
        .send({
          businessId: seed.businessId,
          operations: [{
            id: 'op-create-001',
            entityType: 'category',
            entityId: 'test-cat-push-001',
            operation: 'CREATE',
            payload: {
              name: 'Push Created Category',
              branchId: seed.branchId,
              companyId: seed.businessId
            }
          }]
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.results).toBeInstanceOf(Array);
      expect(res.body.data.results[0].status).toBe('ACCEPTED');
    });

    it('should accept UPDATE operations', async () => {
      const res = await agent()
        .post('/api/sync/operations/push')
        .set('Authorization', `Bearer ${seed.token}`)
        .send({
          businessId: seed.businessId,
          operations: [{
            id: 'op-update-001',
            entityType: 'product',
            entityId: seed.productId,
            operation: 'UPDATE',
            payload: {
              id: seed.productId,
              name: 'Paracetamol 500mg (Updated)',
              minStock: 20
            }
          }]
        });

      expect(res.status).toBe(200);
      expect(res.body.data.results[0].status).toBe('ACCEPTED');

      const product = await getPrisma().product.findUnique({ where: { id: seed.productId } });
      expect(product?.name).toBe('Paracetamol 500mg (Updated)');
      expect(product?.minStock).toBe(20);
    });

    it('should accept DELETE operations', async () => {
      const res = await agent()
        .post('/api/sync/operations/push')
        .set('Authorization', `Bearer ${seed.token}`)
        .send({
          businessId: seed.businessId,
          operations: [{
            id: 'op-delete-001',
            entityType: 'customer',
            entityId: seed.customerId,
            operation: 'DELETE',
            payload: {}
          }]
        });

      expect(res.status).toBe(200);
      expect(res.body.data.results[0].status).toBe('ACCEPTED');

      const customer = await getPrisma().customer.findUnique({ where: { id: seed.customerId } });
      expect(customer).toBeNull();
    });

    it('should reject invalid operations', async () => {
      const res = await agent()
        .post('/api/sync/operations/push')
        .set('Authorization', `Bearer ${seed.token}`)
        .send({
          businessId: seed.businessId,
          operations: [{
            id: 'op-bad-001',
            entityType: 'product',
            entityId: 'nonexistent',
            operation: 'UNKNOWN',
            payload: {}
          }]
        });

      expect(res.status).toBe(200);
      expect(res.body.data.results[0].status).toBe('REJECTED');
    });

    it('should require businessId and operations', async () => {
      const res = await agent()
        .post('/api/sync/operations/push')
        .set('Authorization', `Bearer ${seed.token}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('Pull Changes', () => {
    it('should return changes for a business', async () => {
      const res = await agent()
        .get('/api/sync/changes')
        .set('Authorization', `Bearer ${seed.token}`)
        .query({ businessId: seed.businessId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.changes).toBeInstanceOf(Array);
      expect(res.body.data.nextCursor).toBeDefined();
    });

    it('should reject without businessId', async () => {
      const res = await agent()
        .get('/api/sync/changes')
        .set('Authorization', `Bearer ${seed.token}`);

      expect(res.status).toBe(400);
    });
  });

  describe('Full Sync Lifecycle', () => {
    it('should complete a full login → account sync → provision → push → pull cycle', async () => {
      const loginRes = await agent()
        .post('/api/auth/login')
        .send({ email: 'test@zapeera.test', password: 'testpassword123' });

      expect(loginRes.status).toBe(200);
      const authToken = loginRes.body.token;

      const accountRes = await agent()
        .post('/api/sync/account')
        .set('Authorization', `Bearer ${authToken}`);

      expect(accountRes.body.data.user.email).toBe('test@zapeera.test');
      const memberships = accountRes.body.data.memberships;

      const bizId = memberships[0].businessId;

      const provisionRes = await agent()
        .post('/api/sync/business/provision')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ businessId: bizId });

      expect(provisionRes.body.data.business.name).toBe('Test Business A');

      const pushRes = await agent()
        .post('/api/sync/operations/push')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          businessId: bizId,
          operations: [{
            id: 'lifecycle-push-001',
            entityType: 'customer',
            entityId: 'lifecycle-cust-001',
            operation: 'CREATE',
            payload: {
              name: 'Lifecycle Customer',
              phone: '555-9999',
              branchId: seed.branchId,
              companyId: bizId
            }
          }]
        });

      expect(pushRes.body.data.results[0].status).toBe('ACCEPTED');

      const pullRes = await agent()
        .get('/api/sync/changes')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ businessId: bizId });

      expect(pullRes.body.data.changes.length).toBeGreaterThanOrEqual(0);
      expect(pullRes.body.data.nextCursor).toBeDefined();
    });
  });

  describe('Status and Health', () => {
    it('should return sync status', async () => {
      const res = await agent()
        .get('/api/sync/status')
        .set('Authorization', `Bearer ${seed.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });

    it('should return connectivity status', async () => {
      const res = await agent()
        .get('/api/sync/connectivity')
        .set('Authorization', `Bearer ${seed.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });
  });
});
