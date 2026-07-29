import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function addTestData() {
  try {
    console.log('📊 Adding test subscriptions and sales data...');

    // Get existing users
    const users = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      take: 3
    });

    // Get existing branches
    const branches = await prisma.branch.findMany({
      take: 2
    });

    // Get or create a company
    let company = await prisma.company.findFirst();
   
    if (!company) {
      company = await prisma.company.create({
        data: {
          name: 'MediBill Pulse Pharmacy',
          description: 'Premium Pharmacy Management System',
          address: 'Main Street, Lahore',
          phone: '+92 42 3333333',
          email: 'info@medibillpulse.com',
          businessType: 'PHARMACY',
          createdBy: users[0]?.id || 'seed',
          isActive: true
        }
      });
      console.log('✅ Created test company');
    }

    // Get or create a customer
    let customer = await prisma.customer.findFirst();
    if (!customer && branches[0]) {
      customer = await prisma.customer.create({
        data: {
          name: 'Test Customer',
          phone: '+92 300 9999999',
          email: 'customer@test.com',
          address: 'Test Address',
          branchId: branches[0].id,
          companyId: company.id,
          createdBy: users[0]?.id || 'seed',
          totalPurchases: 0,
          loyaltyPoints: 0,
          isVIP: false,
          lastVisit: new Date()
        }
      });
      console.log('✅ Created test customer');
    }

    // Add subscriptions
    if (users.length > 0) {
      const subscription1 = await prisma.subscriptions.upsert({
        where: { id: `sub_test_${users[0].id}` },
        update: {},
        create: {
          id: `sub_test_${users[0].id}`,
          userId: users[0].id,
          planName: 'Premium Annual',
          status: 'ACTIVE',
          startDate: new Date(2026, 0, 1),
          endDate: new Date(2027, 0, 1),
          amount: 50000,
          currency: 'PKR',
          autoRenew: true,
          nextBillingDate: new Date(2027, 0, 1),
          updatedAt: new Date()
        }
      });
      console.log('✅ Created subscription 1');

      if (users.length > 1) {
        const subscription2 = await prisma.subscriptions.upsert({
          where: { id: `sub_test_${users[1].id}` },
          update: {},
          create: {
            id: `sub_test_${users[1].id}`,
            userId: users[1].id,
            planName: 'Enterprise Annual',
            status: 'ACTIVE',
            startDate: new Date(2025, 6, 15),
            endDate: new Date(2026, 6, 15),
            amount: 100000,
            currency: 'PKR',
            autoRenew: true,
            nextBillingDate: new Date(2026, 6, 15),
            updatedAt: new Date()
          }
        });
        console.log('✅ Created subscription 2');
      }

      if (users.length > 2) {
        const subscription3 = await prisma.subscriptions.upsert({
          where: { id: `sub_test_${users[2].id}` },
          update: {},
          create: {
            id: `sub_test_${users[2].id}`,
            userId: users[2].id,
            planName: 'Pro Monthly',
            status: 'PENDING',
            startDate: new Date(),
            endDate: new Date(new Date().setMonth(new Date().getMonth() + 1)),
            amount: 5000,
            currency: 'PKR',
            autoRenew: false,
            nextBillingDate: new Date(new Date().setMonth(new Date().getMonth() + 1)),
            updatedAt: new Date()
          }
        });
        console.log('✅ Created subscription 3');
      }
    }

    // Add sales records
    if (users.length > 0 && branches.length > 0 && customer) {
      const sale1 = await prisma.sale.create({
        data: {
          invoiceNumber: `INV-${Date.now()}-001`,
          customerId: customer.id,
          userId: users[0].id,
          branchId: branches[0].id,
          companyId: company.id,
          createdBy: users[0].id,
          subtotal: 15000,
          taxAmount: 1500,
          discountAmount: 500,
          discountPercentage: 2.5,
          totalAmount: 16000,
          paidAmount: 16000,
          returnedAmount: 0,
          paymentMethod: 'CASH',
          paymentStatus: 'COMPLETED',
          status: 'COMPLETED',
          saleDate: new Date()
        }
      });
      console.log('✅ Created sale 1');

      const sale2 = await prisma.sale.create({
        data: {
          invoiceNumber: `INV-${Date.now()}-002`,
          customerId: customer.id,
          userId: users[users.length > 1 ? 1 : 0].id,
          branchId: branches[branches.length > 1 ? 1 : 0].id,
          companyId: company.id,
          createdBy: users[0].id,
          subtotal: 22500,
          taxAmount: 2250,
          discountAmount: 1000,
          discountPercentage: 3.5,
          totalAmount: 23750,
          paidAmount: 23750,
          returnedAmount: 0,
          paymentMethod: 'CARD',
          paymentStatus: 'COMPLETED',
          status: 'COMPLETED',
          saleDate: new Date(new Date().setDate(new Date().getDate() - 1))
        }
      });
      console.log('✅ Created sale 2');

      const sale3 = await prisma.sale.create({
        data: {
          invoiceNumber: `INV-${Date.now()}-003`,
          customerId: null,
          userId: users[0].id,
          branchId: branches[0].id,
          companyId: company.id,
          createdBy: users[0].id,
          subtotal: 8500,
          taxAmount: 850,
          discountAmount: 0,
          discountPercentage: 0,
          totalAmount: 9350,
          paidAmount: 9350,
          returnedAmount: 0,
          paymentMethod: 'MOBILE',
          paymentStatus: 'COMPLETED',
          status: 'COMPLETED',
          saleDate: new Date(new Date().setDate(new Date().getDate() - 2))
        }
      });
      console.log('✅ Created sale 3');
    }

    console.log('✅ Test data added successfully!');
    console.log('📊 Summary:');
    console.log(`   - 3 subscriptions (150,000 PKR revenue)`);
    console.log(`   - 3 sales records (49,100 PKR total)`);
  } catch (error) {
    console.error('❌ Error adding test data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

addTestData();
