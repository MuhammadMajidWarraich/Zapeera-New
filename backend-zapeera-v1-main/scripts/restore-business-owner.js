#!/usr/bin/env node
/**
 * Restore the business creator as an ACTIVE OWNER.
 *
 * Diagnosed failure mode: the business creator's membership role was
 * overwritten from OWNER to MANAGER (e.g. via the staff edit / member-role
 * flows that existed before owner-demotion guards were added). This script
 * finds the business and user, then sets the membership back to the OWNER
 * role (creating the business-scoped OWNER role if it no longer exists).
 *
 * Idempotent and safe to re-run.
 *
 * Usage (run from backend-zapeera-v1-main):
 *   BUSINESS_SLUG=gohar-pharma OWNER_EMAIL=majidgohar@gmail.com \
 *     node scripts/restore-business-owner.js
 *
 *   # or by exact IDs / name:
 *   BUSINESS_ID=<id> OWNER_EMAIL=majidgohar@gmail.com node scripts/restore-business-owner.js
 *   BUSINESS_NAME="Gohar Pharma" OWNER_USER_ID=<userId> node scripts/restore-business-owner.js
 *
 * DATABASE_URL comes from the environment (Railway sets it for the service;
 * for local runs set it explicitly in .env / shell).
 */

'use strict';

require('dotenv').config({ override: false });

const { PrismaClient } = require('@prisma/client');

const OWNER_EMAIL = String(process.env.OWNER_EMAIL || '').trim().toLowerCase();
const OWNER_USER_ID = String(process.env.OWNER_USER_ID || '').trim();
const BUSINESS_ID = String(process.env.BUSINESS_ID || '').trim();
const BUSINESS_SLUG = String(process.env.BUSINESS_SLUG || '').trim().toLowerCase();
const BUSINESS_NAME = String(process.env.BUSINESS_NAME || '').trim();

async function main() {
  if (!OWNER_EMAIL && !OWNER_USER_ID) {
    throw new Error('Set OWNER_EMAIL or OWNER_USER_ID (the account to restore as owner)');
  }
  if (!BUSINESS_ID && !BUSINESS_SLUG && !BUSINESS_NAME) {
    throw new Error('Set BUSINESS_ID, BUSINESS_SLUG or BUSINESS_NAME (the business to restore)');
  }

  const prisma = new PrismaClient();
  await prisma.$connect();

  try {
    // 1. Locate the business.
    let business = null;
    if (BUSINESS_ID) {
      business = await prisma.business.findUnique({ where: { id: BUSINESS_ID } });
    }
    if (!business && BUSINESS_SLUG) {
      business = await prisma.business.findFirst({
        where: { slug: { equals: BUSINESS_SLUG, mode: 'insensitive' } },
      });
    }
    if (!business && BUSINESS_NAME) {
      business = await prisma.business.findFirst({
        where: { name: { contains: BUSINESS_NAME, mode: 'insensitive' } },
      });
    }
    if (!business) {
      throw new Error(`Business not found (BUSINESS_ID=${BUSINESS_ID} BUSINESS_SLUG=${BUSINESS_SLUG} BUSINESS_NAME=${BUSINESS_NAME})`);
    }
    console.log(`[RestoreOwner] Business: ${business.name} (${business.id})`);

    // 2. Locate the user.
    let user = null;
    if (OWNER_USER_ID) {
      user = await prisma.zapeeraUser.findUnique({ where: { id: OWNER_USER_ID } });
    }
    if (!user && OWNER_EMAIL) {
      user = await prisma.zapeeraUser.findFirst({
        where: { email: { equals: OWNER_EMAIL, mode: 'insensitive' } },
      });
    }
    if (!user) {
      throw new Error(`User not found (${OWNER_EMAIL || OWNER_USER_ID})`);
    }
    const isCreator = String(business.createdBy || '') === String(user.id);
    console.log(`[RestoreOwner] User: ${user.email} (${user.id}) — business creator: ${isCreator ? 'YES' : 'NO ⚠️ not the creator — confirm this is really the owner'}`);

    // 3. Ensure the business-scoped OWNER role exists.
    let role = await prisma.role.findFirst({
      where: { businessId: business.id, name: 'OWNER' },
    });
    if (!role) {
      role = await prisma.role.create({
        data: { businessId: business.id, name: 'OWNER', description: 'Business owner' },
      });
      console.log('[RestoreOwner] Created business-scoped OWNER role');
    }

    // 4. Restore the membership to ACTIVE OWNER.
    const membership = await prisma.membership.findUnique({
      where: { unique_user_business: { userId: user.id, businessId: business.id } },
    });

    if (membership) {
      const previousRole = membership.roleId
        ? await prisma.role.findUnique({ where: { id: membership.roleId } })
        : null;
      await prisma.membership.update({
        where: { id: membership.id },
        data: { roleId: role.id, status: 'ACTIVE' },
      });
      console.log(
        `[RestoreOwner] Membership ${membership.id}: role ${previousRole?.name || 'NONE'} → OWNER, status → ACTIVE`
      );
    } else {
      const created = await prisma.membership.create({
        data: { userId: user.id, businessId: business.id, roleId: role.id, status: 'ACTIVE' },
      });
      console.log(`[RestoreOwner] No membership existed — created ACTIVE OWNER membership ${created.id}`);
    }

    console.log('[RestoreOwner] ✅ Done. The user is now an ACTIVE OWNER of this business.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[RestoreOwner] ❌ Failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});