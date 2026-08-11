import { describe, it, expect } from '@jest/globals';
import { isBusinessCreator, upsertMembership } from '../src/utils/membership-bridge.util';

// ── Fake Prisma ────────────────────────────────────────────────────────────

interface FakeDbState {
  business: { id: string; createdBy: string | null };
  memberships: Array<{ id: string; userId: string; businessId: string; roleId: string | null }>;
  roles: Array<{ id: string; businessId: string | null; name: string }>;
}

function fakeDb(state: FakeDbState) {
  const executed: Array<{ sql: string; values: unknown[] }> = [];

  const prisma = {
    business: {
      findUnique: async ({ where }: any) =>
        state.business && where.id === state.business.id ? state.business : null,
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]): Promise<any[]> => {
      const sql = strings.join('?');
      if (sql.includes('FROM memberships')) {
        return state.memberships.filter(
          (m) => String(m.userId) === String(values[0]) && String(m.businessId) === String(values[1]),
        );
      }
      if (sql.includes('FROM roles')) {
        const id = String(values[0]);
        const role = state.roles.find((r) => r.id === id);
        return role ? [{ name: role.name }] : [];
      }
      return [];
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]): Promise<number> => {
      executed.push({ sql: strings.join('?'), values });
      return 1;
    },
  };

  return { prisma: prisma as any, executed };
}

const managerRole = { id: 'r-manager', businessId: 'b1', name: 'MANAGER' };
const ownerRole = { id: 'r-owner', businessId: 'b1', name: 'OWNER' };

function baseDb(extra?: Partial<FakeDbState>): FakeDbState {
  return {
    business: { id: 'b1', createdBy: 'u-owner' },
    memberships: [{ id: 'mem-1', userId: 'u-owner', businessId: 'b1', roleId: 'r-owner' }],
    roles: [managerRole, ownerRole],
    ...extra,
  };
}

// ── isBusinessCreator ──────────────────────────────────────────────────────

describe('isBusinessCreator (owner-demotion guard)', () => {
  it('returns true for the user who created the business', async () => {
    const { prisma } = fakeDb(baseDb());
    expect(await isBusinessCreator(prisma, 'b1', 'u-owner')).toBe(true);
  });

  it('returns false for other members', async () => {
    const { prisma } = fakeDb(baseDb());
    expect(await isBusinessCreator(prisma, 'b1', 'u-manager')).toBe(false);
  });

  it('returns false when the business does not exist', async () => {
    const { prisma } = fakeDb(baseDb({ business: { id: 'other', createdBy: 'u-owner' } }));
    expect(await isBusinessCreator(prisma, 'missing', 'u-owner')).toBe(false);
  });

  it('returns false when createdBy is null', async () => {
    const { prisma } = fakeDb(baseDb({ business: { id: 'b1', createdBy: null } }));
    expect(await isBusinessCreator(prisma, 'b1', 'u-owner')).toBe(false);
  });
});

// ── upsertMembership owner protection ─────────────────────────────────────

describe('upsertMembership (never demotes the business creator)', () => {
  it('keeps the creator OWNER when a generic upsert passes a MANAGER role', async () => {
    const { prisma, executed } = fakeDb(baseDb());

    await upsertMembership(prisma, {
      userId: 'u-owner',
      businessId: 'b1',
      roleId: managerRole.id,
      status: 'ACTIVE',
    });

    const updateSql = executed.map((e) => e.sql).join('\n');
    expect(updateSql).toContain('UPDATE memberships');
    expect(updateSql).not.toContain('"roleId"');
  });

  it('still updates status/invitedBy while refusing the role change', async () => {
    const { prisma, executed } = fakeDb(baseDb());

    await upsertMembership(prisma, {
      userId: 'u-owner',
      businessId: 'b1',
      roleId: managerRole.id,
      status: 'INVITED',
    });

    const updateSql = executed.map((e) => e.sql).join('\n');
    expect(updateSql).toContain('status = ?');
    expect(updateSql).toContain('"invitedBy"');
  });

  it('allows a MANAGER role for a member who is not the creator', async () => {
    const { prisma, executed } = fakeDb(
      baseDb({
        memberships: [{ id: 'mem-2', userId: 'u-manager', businessId: 'b1', roleId: null }],
      }),
    );

    await upsertMembership(prisma, {
      userId: 'u-manager',
      businessId: 'b1',
      roleId: managerRole.id,
      status: 'ACTIVE',
    });

    const updateSql = executed.map((e) => e.sql).join('\n');
    expect(updateSql).toContain('"roleId"');
    expect(updateSql).toContain('UPDATE memberships');
  });

  it('allows re-assigning the creator to the OWNER role (no-op is safe)', async () => {
    const { prisma, executed } = fakeDb(baseDb());

    await upsertMembership(prisma, {
      userId: 'u-owner',
      businessId: 'b1',
      roleId: ownerRole.id,
      status: 'ACTIVE',
    });

    const updateSql = executed.map((e) => e.sql).join('\n');
    expect(updateSql).toContain('"roleId"');
  });

  it('creates a membership (no existing row) with the given role', async () => {
    const { prisma, executed } = fakeDb(baseDb({ memberships: [] }));

    await upsertMembership(prisma, {
      userId: 'u-new',
      businessId: 'b1',
      roleId: managerRole.id,
      status: 'ACTIVE',
    });

    const insertSql = executed.map((e) => e.sql).join('\n');
    expect(insertSql).toContain('INSERT INTO memberships');
    expect(insertSql).toContain('"roleId"');
  });
});