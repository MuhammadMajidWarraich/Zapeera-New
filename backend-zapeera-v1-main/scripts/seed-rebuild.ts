#!/usr/bin/env ts-node --transpile-only
/**
 * Seed SQLite database with default data using current schema models.
 * Creates business, branch, users, memberships, and backoffice admin.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import * as path from 'path';
import * as os from 'os';

const sqlitePath = path.join(os.homedir(), '.zapeera', 'data', 'zapeera.db');
process.env.DATABASE_URL = `file:${sqlitePath}`;

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding SQLite database...');
  console.log(`📁 Database: ${sqlitePath}`);

  try {
    // Check if any users exist
    const userCount = await prisma.zapeeraUser.count();
    if (userCount > 0) {
      console.log(`✅ Database already has ${userCount} users - skipping user seed`);
    } else {
      console.log('📝 No users found - creating default data...');

      const hashedPassword = await bcrypt.hash('admin123', 12);

      // Create business
      const business = await prisma.business.upsert({
        where: { id: 'default-business' },
        update: {},
        create: {
          id: 'default-business',
          name: 'My Pharmacy',
          description: 'Local pharmacy business',
          address: '123 Main Street',
          phone: '+1234567890',
          email: 'admin@pharmacy.local',
          businessType: 'PHARMACY',
          createdBy: null,
          isActive: true,
        },
      });
      console.log('✅ Business created:', business.name);

      // Create branch
      let branch = await prisma.branch.findFirst({
        where: { name: 'Main Branch', companyId: business.id },
      });
      if (!branch) {
        branch = await prisma.branch.create({
          data: {
            name: 'Main Branch',
            address: '123 Main Street',
            phone: '+1234567890',
            email: 'main@pharmacy.local',
            companyId: business.id,
            isActive: true,
          },
        });
      }
      console.log('✅ Branch created:', branch.name);

      // Create admin role
      let adminRole = await prisma.role.findFirst({
        where: { businessId: null, name: 'ADMIN' },
      });
      if (!adminRole) {
        adminRole = await prisma.role.create({
          data: { businessId: null, name: 'ADMIN' },
        });
      }
      console.log('✅ Admin role ready:', adminRole.name);

      // Create superadmin user
      const superadmin = await prisma.zapeeraUser.upsert({
        where: { username: 'superadmin' },
        update: { isActive: true },
        create: {
          username: 'superadmin',
          email: 'superadmin@pharmacy.local',
          password: hashedPassword,
          name: 'Super Admin',
          isActive: true,
        },
      });
      console.log('✅ Superadmin created:', superadmin.username);

      // Create membership for superadmin
      let superadminMembership = await prisma.membership.findUnique({
        where: { unique_user_business: { userId: superadmin.id, businessId: business.id } },
      });
      if (!superadminMembership) {
        superadminMembership = await prisma.membership.create({
          data: {
            userId: superadmin.id,
            businessId: business.id,
            roleId: adminRole.id,
            status: 'ACTIVE',
            invitedBy: null,
          },
        });
      }

      // Create membership branch for superadmin
      const superadminMB = await prisma.membershipBranch.findUnique({
        where: { unique_membership_branch: { membershipId: superadminMembership.id, branchId: branch.id } },
      });
      if (!superadminMB) {
        await prisma.membershipBranch.create({
          data: { membershipId: superadminMembership.id, branchId: branch.id },
        });
      }
      console.log('✅ Membership created for superadmin: ADMIN role');

      // Create admin user
      const admin = await prisma.zapeeraUser.upsert({
        where: { username: 'admin' },
        update: { isActive: true },
        create: {
          username: 'admin',
          email: 'admin@pharmacy.local',
          password: hashedPassword,
          name: 'Admin User',
          createdBy: superadmin.id,
          isActive: true,
        },
      });
      console.log('✅ Admin created:', admin.username);

      // Create membership for admin
      let adminMembership = await prisma.membership.findUnique({
        where: { unique_user_business: { userId: admin.id, businessId: business.id } },
      });
      if (!adminMembership) {
        adminMembership = await prisma.membership.create({
          data: {
            userId: admin.id,
            businessId: business.id,
            roleId: adminRole.id,
            status: 'ACTIVE',
            invitedBy: superadmin.id,
          },
        });
      }

      // Create membership branch for admin
      const adminMB = await prisma.membershipBranch.findUnique({
        where: { unique_membership_branch: { membershipId: adminMembership.id, branchId: branch.id } },
      });
      if (!adminMB) {
        await prisma.membershipBranch.create({
          data: { membershipId: adminMembership.id, branchId: branch.id },
        });
      }
      console.log('✅ Membership created for admin: ADMIN role');

      // Create a subscription for the business
      const plans = await prisma.plan.findMany({ take: 1 });
      if (plans.length > 0) {
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setDate(periodEnd.getDate() + 30);

        await prisma.businessSubscription.create({
          data: {
            businessId: business.id,
            planId: plans[0].id,
            status: 'ACTIVE',
            billingStatus: 'Paid',
            currentPeriodEnd: periodEnd,
          },
        });
        console.log(`✅ Subscription created: ${plans[0].name} plan`);
      }
    }

    // Always ensure backoffice admin exists
    const boAdminCount = await prisma.backOfficeUser.count();
    if (boAdminCount === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await prisma.backOfficeUser.create({
        data: {
          email: 'admin@zapeera.com',
          password: hashedPassword,
          role: 'SUPER_ADMIN',
        },
      });
      console.log('✅ Backoffice admin created: admin@zapeera.com / admin123');
    } else {
      console.log(`✅ Backoffice admin already exists (${boAdminCount} admins)`);
    }

    console.log('\n✅ Database seeded successfully!');
    console.log('\n📋 Default login credentials:');
    console.log('   App:     superadmin / admin123');
    console.log('   App:     admin / admin123');
    console.log('   Backoffice: admin@zapeera.com / admin123');
  } catch (error: any) {
    console.error('❌ Error seeding database:', error.message);
    console.error(error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
