#!/usr/bin/env ts-node
/**
 * Create test user with membership for smoke tests
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import * as path from 'path';
import * as os from 'os';

const sqlitePath = path.join(os.homedir(), '.zapeera', 'data', 'zapeera.db');
process.env.DATABASE_URL = `file:${sqlitePath}`;

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Creating test user...');
  console.log(`📁 Database: ${sqlitePath}`);

  try {
    // Create or get company
    let company = await prisma.company.findFirst({});
    
    if (!company) {
      company = await prisma.company.create({
        data: {
          name: 'Test Company',
          description: 'Test company for smoke tests',
          address: '123 Test Street',
          phone: '+1234567890',
          email: 'test@test.com',
          businessType: 'PHARMACY',
          isActive: true
        }
      });
      console.log('✅ Company created:', company.name);
    } else {
      console.log('✅ Company found:', company.name);
    }

    // Create or get branch
    let branch = await prisma.branch.findFirst({
      where: { companyId: company.id }
    });

    if (!branch) {
      branch = await prisma.branch.create({
        data: {
          name: 'Test Branch',
          address: '123 Test Street',
          phone: '+1234567890',
          email: 'test@test.com',
          companyId: company.id,
          isActive: true
        }
      });
      console.log('✅ Branch created:', branch.name);
    } else {
      console.log('✅ Branch found:', branch.name);
    }

    // Create or get admin role
    let adminRole = await prisma.role.findFirst({
      where: {
        businessId: null,
        name: 'ADMIN'
      }
    });
    
    if (!adminRole) {
      adminRole = await prisma.role.create({
        data: {
          businessId: null,
          name: 'ADMIN'
        }
      });
      console.log('✅ Admin role created');
    } else {
      console.log('✅ Admin role found');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash('admin123', 12);

    // Create or update admin user
    let adminUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username: 'admin' },
          { email: 'admin@test.com' }
        ]
      }
    });

    if (!adminUser) {
      adminUser = await prisma.user.create({
        data: {
          username: 'admin',
          email: 'admin@test.com',
          password: hashedPassword,
          name: 'Admin User',
          branchId: branch.id,
          companyId: company.id,
          isActive: true
        }
      });
      console.log('✅ Admin user created:', adminUser.username);
    } else {
      // Update password
      adminUser = await prisma.user.update({
        where: { id: adminUser.id },
        data: {
          password: hashedPassword,
          isActive: true
        }
      });
      console.log('✅ Admin user updated:', adminUser.username);
    }

    // Create or update membership
    let membership = await prisma.membership.findUnique({
      where: { unique_user_business: { userId: adminUser.id, businessId: company.id } }
    });

    if (!membership) {
      membership = await prisma.membership.create({
        data: {
          userId: adminUser.id,
          businessId: company.id,
          roleId: adminRole.id,
          status: 'ACTIVE'
        }
      });
      console.log('✅ Membership created');
    } else {
      console.log('✅ Membership found');
    }

    // Create or update membership branch
    let membershipBranch = await prisma.membershipBranch.findUnique({
      where: { unique_membership_branch: { membershipId: membership.id, branchId: branch.id } }
    });

    if (!membershipBranch) {
      membershipBranch = await prisma.membershipBranch.create({
        data: {
          membershipId: membership.id,
          branchId: branch.id
        }
      });
      console.log('✅ Membership branch created');
    } else {
      console.log('✅ Membership branch found');
    }

    console.log('\n✅ Test user ready!');
    console.log('\n📋 Login credentials:');
    console.log('   Username: admin');
    console.log('   Password: admin123');
    console.log('   Email: admin@test.com');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error('❌ Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
