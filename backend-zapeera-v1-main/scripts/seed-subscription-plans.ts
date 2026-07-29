/**
 * Database Seeding Script for Subscription Plans
 * 
 * This script creates default subscription plans and seeds
 * module permissions for each plan.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Default subscription plans with their associated modules
const DEFAULT_PLANS = [
  {
    name: 'BASIC',
    description: 'Basic plan for small businesses',
    price: 29.99,
    durationDays: 30,
    billingPeriod: 'monthly',
    features: JSON.stringify([
      'Up to 100 products',
      'Up to 2 branches',
      'Up to 3 staff members',
      'Basic reports',
      'Email support'
    ]),
    moduleNames: ['dashboard', 'pos', 'inventory', 'customers', 'reports'],
    limits: JSON.stringify({
      maxProducts: 100,
      maxBranches: 2,
      maxStaff: 3,
      maxSuppliers: 10
    })
  },
  {
    name: 'PRO',
    description: 'Professional plan for growing businesses',
    price: 79.99,
    durationDays: 30,
    billingPeriod: 'monthly',
    features: JSON.stringify([
      'Unlimited products',
      'Up to 5 branches',
      'Up to 10 staff members',
      'Advanced reports',
      'Priority support',
      'Batch tracking',
      'Supplier management'
    ]),
    moduleNames: ['dashboard', 'pos', 'inventory', 'customers', 'reports', 'suppliers', 'purchases', 'batches'],
    limits: JSON.stringify({
      maxProducts: -1, // unlimited
      maxBranches: 5,
      maxStaff: 10,
      maxSuppliers: 50
    })
  },
  {
    name: 'ENTERPRISE',
    description: 'Enterprise plan for large businesses',
    price: 199.99,
    durationDays: 30,
    billingPeriod: 'monthly',
    features: JSON.stringify([
      'Unlimited everything',
      'Unlimited branches',
      'Unlimited staff',
      'Advanced analytics',
      '24/7 priority support',
      'Custom integrations',
      'Dedicated account manager'
    ]),
    moduleNames: ['dashboard', 'pos', 'inventory', 'customers', 'reports', 'suppliers', 'purchases', 'batches', 'staff', 'advanced-reports', 'settings'],
    limits: JSON.stringify({
      maxProducts: -1,
      maxBranches: -1,
      maxStaff: -1,
      maxSuppliers: -1
    })
  },
  {
    name: 'TRIAL',
    description: '14-day free trial with all features',
    price: 0,
    durationDays: 14,
    trialDurationDays: 14,
    isTrial: true,
    billingPeriod: 'trial',
    features: JSON.stringify([
      'All features for 14 days',
      'Up to 50 products',
      'Up to 2 branches',
      'Full feature access'
    ]),
    moduleNames: ['dashboard', 'pos', 'inventory', 'customers', 'reports', 'suppliers', 'purchases', 'batches'],
    limits: JSON.stringify({
      maxProducts: 50,
      maxBranches: 2,
      maxStaff: 5,
      maxSuppliers: 10,
      trialDays: 14
    })
  }
];

// All available modules in the system
const ALL_MODULES = [
  'dashboard',
  'pos',
  'inventory',
  'customers',
  'reports',
  'suppliers',
  'purchases',
  'batches',
  'staff',
  'advanced-reports',
  'settings',
  'expenses'
];

// Default modules for business types
const BUSINESS_TYPE_DEFAULTS: Record<string, string[]> = {
  'PHARMACY': ['dashboard', 'pos', 'inventory', 'customers', 'reports', 'suppliers', 'purchases', 'batches'],
  'RESTAURANT': ['dashboard', 'pos', 'inventory', 'customers', 'reports', 'staff', 'expenses'],
  'CLOTHING': ['dashboard', 'pos', 'inventory', 'customers', 'reports', 'staff'],
  'DEPARTMENTAL': ['dashboard', 'pos', 'inventory', 'customers', 'reports', 'suppliers', 'purchases', 'staff'],
  'CLINIC': ['dashboard', 'inventory', 'customers', 'reports', 'staff', 'settings']
};

async function main() {
  console.log('🌱 Starting database seeding...\n');

  try {
    // 1. Seed subscription plans
    console.log('📋 Seeding subscription plans...');
    for (const plan of DEFAULT_PLANS) {
      const existingPlan = await prisma.plan.findFirst({
        where: { name: plan.name }
      });

      let planId: string;
      
      if (existingPlan) {
        console.log(`  ✓ Plan "${plan.name}" already exists`);
        planId = existingPlan.id;
      } else {
        // Create plan without moduleNames (not in schema)
        const { moduleNames, ...planData } = plan;
        
        const newPlan = await prisma.plan.create({
          data: {
            ...planData,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        });
        console.log(`  ✓ Created plan "${plan.name}" (ID: ${newPlan.id})`);
        planId = newPlan.id;
      }
    }

    // 2. Seed plan module permissions
    console.log('\n🔐 Seeding plan module permissions...');
    const allPlans = await prisma.plan.findMany();
    
    for (const plan of allPlans) {
      // Get module names from DEFAULT_PLANS
      const planConfig = DEFAULT_PLANS.find(p => p.name === plan.name);
      const planModuleNames = planConfig?.moduleNames || [];
      
      for (const moduleName of ALL_MODULES) {
        const isEnabled = planModuleNames.includes(moduleName);
        
        const existingPerm = await prisma.$queryRaw`
          SELECT id FROM plan_module_permissions 
          WHERE planId = ${plan.id} AND moduleName = ${moduleName}
        `;

        if (!existingPerm || (existingPerm as any[]).length === 0) {
          await prisma.$queryRaw`
            INSERT INTO plan_module_permissions (planId, moduleName, enabled, createdAt, updatedAt)
            VALUES (${plan.id}, ${moduleName}, ${isEnabled ? 1 : 0}, datetime('now'), datetime('now'))
          `;
        } else {
          await prisma.$queryRaw`
            UPDATE plan_module_permissions 
            SET enabled = ${isEnabled ? 1 : 0}, updatedAt = datetime('now')
            WHERE planId = ${plan.id} AND moduleName = ${moduleName}
          `;
        }
      }
      console.log(`  ✓ Updated permissions for plan "${plan.name}"`);
    }

    // 3. Ensure all modules exist in modules table
    console.log('\n📦 Checking modules table...');
    for (const moduleName of ALL_MODULES) {
      const existingModule = await prisma.module.findFirst({
        where: { name: moduleName }
      });

      if (!existingModule) {
        await prisma.module.create({
          data: {
            name: moduleName,
            description: `${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)} module`,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        });
        console.log(`  ✓ Created module "${moduleName}"`);
      }
    }

    // 4. Seed business types
    console.log('\n🏢 Seeding business types...');
    for (const [typeName, modules] of Object.entries(BUSINESS_TYPE_DEFAULTS)) {
      const existingType = await prisma.businessType.findFirst({
        where: { name: typeName }
      });

      let businessTypeId: string;
      
      if (existingType) {
        console.log(`  ✓ Business type "${typeName}" already exists`);
        businessTypeId = existingType.id;
      } else {
        const newType = await prisma.businessType.create({
          data: {
            name: typeName,
            description: `${typeName} business type`,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        });
        console.log(`  ✓ Created business type "${typeName}"`);
        businessTypeId = newType.id;
      }

      // Link modules to business type
      const allDbModules = await prisma.module.findMany();
      
      for (const dbModule of allDbModules) {
        const isEnabled = modules.includes(dbModule.name);
        
        const existingLink = await prisma.$queryRaw`
          SELECT id FROM business_type_modules
          WHERE businessTypeId = ${businessTypeId} AND moduleId = ${dbModule.id}
        `;

        if (!existingLink || (existingLink as any[]).length === 0) {
          await prisma.$queryRaw`
            INSERT INTO business_type_modules (businessTypeId, moduleId, isEnabled, sortOrder, createdAt, updatedAt)
            VALUES (${businessTypeId}, ${dbModule.id}, ${isEnabled ? 1 : 0}, 99, datetime('now'), datetime('now'))
          `;
        }
      }
    }

    // 5. Seed role module permissions
    console.log('\n👤 Seeding role module permissions...');
    const roles = ['OWNER', 'MANAGER', 'CASHIER'];
    
    for (const roleName of roles) {
      for (const moduleName of ALL_MODULES) {
        // OWNER gets all modules, MANAGER gets most, CASHIER gets basic
        let isEnabled = false;
        if (roleName === 'OWNER') {
          isEnabled = true;
        } else if (roleName === 'MANAGER') {
          isEnabled = !['settings', 'advanced-reports'].includes(moduleName);
        } else if (roleName === 'CASHIER') {
          isEnabled = ['dashboard', 'pos', 'customers'].includes(moduleName);
        }

        const existingPerm = await prisma.$queryRaw`
          SELECT id FROM role_module_permissions 
          WHERE roleName = ${roleName} AND moduleName = ${moduleName}
        `;

        if (!existingPerm || (existingPerm as any[]).length === 0) {
          await prisma.$queryRaw`
            INSERT INTO role_module_permissions (roleName, moduleName, enabled, createdAt, updatedAt)
            VALUES (${roleName}, ${moduleName}, ${isEnabled ? 1 : 0}, datetime('now'), datetime('now'))
          `;
        } else {
          await prisma.$queryRaw`
            UPDATE role_module_permissions 
            SET enabled = ${isEnabled ? 1 : 0}, updatedAt = datetime('now')
            WHERE roleName = ${roleName} AND moduleName = ${moduleName}
          `;
        }
      }
      console.log(`  ✓ Updated permissions for role "${roleName}"`);
    }

    console.log('\n✅ Database seeding completed successfully!');
    console.log('\n📊 Seeded data:');
    console.log(`   - ${DEFAULT_PLANS.length} subscription plans`);
    console.log(`   - ${ALL_MODULES.length} modules`);
    console.log(`   - ${Object.keys(BUSINESS_TYPE_DEFAULTS).length} business types`);
    console.log(`   - ${roles.length} roles with module permissions`);

  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
