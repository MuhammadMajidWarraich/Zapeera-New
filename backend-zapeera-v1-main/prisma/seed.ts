import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Create users first (needed for createdBy)
  const hashedPassword = await bcrypt.hash('password123', 12);

  const users = await Promise.all([
    prisma.user.upsert({
      where: { username: 'admin' },
      update: { isActive: true },
      create: {
        username: 'admin',
        email: 'admin@zapeera.com',
        password: hashedPassword,
        name: 'Dr. Ahmed Khan',
        role: 'ADMIN',
        branchId: 'temp',
        createdBy: null,
        isActive: true // Ensure user is active
      }
    }),
    prisma.user.upsert({
      where: { username: 'manager' },
      update: { isActive: true },
      create: {
        username: 'manager',
        email: 'manager@zapeera.com',
        password: hashedPassword,
        name: 'Fatima Ali',
        role: 'MANAGER',
        branchId: 'temp',
        createdBy: null,
        isActive: true // Ensure user is active
      }
    }),
    prisma.user.upsert({
      where: { username: 'cashier' },
      update: { isActive: true },
      create: {
        username: 'cashier',
        email: 'cashier@zapeera.com',
        password: hashedPassword,
        name: 'Hassan Sheikh',
        role: 'CASHIER',
        branchId: 'temp',
        createdBy: null,
        isActive: true // Ensure user is active
      }
    })
  ]);

  // Create branches
  const branches = await Promise.all([
    prisma.branch.upsert({
      where: { name: 'Head Office' },
      update: {},
      create: {
        name: 'Head Office',
        address: '123 Main Street, Karachi',
        phone: '+92 21 1234567',
        email: 'headoffice@zapeera.com',
        createdBy: users[0].id
      }
    }),
    prisma.branch.upsert({
      where: { name: 'Main Branch' },
      update: {},
      create: {
        name: 'Main Branch',
        address: '456 Central Avenue, Lahore',
        phone: '+92 42 2345678',
        email: 'main@zapeera.com',
        createdBy: users[1].id
      }
    }),
    prisma.branch.upsert({
      where: { name: 'North Branch' },
      update: {},
      create: {
        name: 'North Branch',
        address: '789 North Road, Islamabad',
        phone: '+92 51 3456789',
        email: 'north@zapeera.com',
        createdBy: users[1].id
      }
    }),
    prisma.branch.upsert({
      where: { name: 'South Branch' },
      update: {},
      create: {
        name: 'South Branch',
        address: '321 South Street, Karachi',
        phone: '+92 21 4567890',
        email: 'south@zapeera.com',
        createdBy: users[1].id
      }
    })
  ]);

  // Update users with branchId
  await Promise.all([
    prisma.user.update({
      where: { id: users[0].id },
      data: { branchId: branches[0].id }
    }),
    prisma.user.update({
      where: { id: users[1].id },
      data: { branchId: branches[1].id, createdBy: users[1].id }
    }),
    prisma.user.update({
      where: { id: users[2].id },
      data: { branchId: branches[2].id, createdBy: users[1].id }
    }),
    prisma.user.update({
      where: { id: users[3].id },
      data: { branchId: branches[3].id, createdBy: users[1].id }
    })
  ]);

  // Create categories
  const categories = await Promise.all([
    prisma.category.upsert({
      where: { name: 'Analgesics' },
      update: {},
      create: {
        name: 'Analgesics',
        description: 'Pain relief medications',
        createdBy: users[1].id
      }
    }),
    prisma.category.upsert({
      where: { name: 'Antibiotics' },
      update: {},
      create: {
        name: 'Antibiotics',
        description: 'Antibacterial medications',
        createdBy: users[1].id
      }
    }),
    prisma.category.upsert({
      where: { name: 'Vitamins' },
      update: {},
      create: {
        name: 'Vitamins',
        description: 'Vitamin supplements',
        createdBy: users[1].id
      }
    }),
    prisma.category.upsert({
      where: { name: 'Gastric' },
      update: {},
      create: {
        name: 'Gastric',
        description: 'Gastrointestinal medications',
        createdBy: users[1].id
      }
    }),
    prisma.category.upsert({
      where: { name: 'Cough & Cold' },
      update: {},
      create: {
        name: 'Cough & Cold',
        description: 'Cold and cough medications',
        createdBy: users[1].id
      }
    }),
    prisma.category.upsert({
      where: { name: 'Ophthalmic' },
      update: {},
      create: {
        name: 'Ophthalmic',
        description: 'Eye care medications',
        createdBy: users[1].id
      }
    }),
    prisma.category.upsert({
      where: { name: 'Diabetes' },
      update: {},
      create: {
        name: 'Diabetes',
        description: 'Diabetes management medications',
        createdBy: users[1].id
      }
    })
  ]);

  // Create suppliers
  const suppliers = await Promise.all([
    prisma.supplier.upsert({
      where: { name: 'ABC Pharma' },
      update: {},
      create: {
        name: 'ABC Pharma',
        contactPerson: 'John Smith',
        phone: '+92 300 1111111',
        email: 'contact@abcpharma.com',
        address: 'Industrial Area, Karachi',
        createdBy: users[1].id
      }
    }),
    prisma.supplier.upsert({
      where: { name: 'XYZ Medical' },
      update: {},
      create: {
        name: 'XYZ Medical',
        contactPerson: 'Sarah Khan',
        phone: '+92 300 2222222',
        email: 'info@xyzmedical.com',
        address: 'Medical District, Lahore',
        createdBy: users[1].id
      }
    }),
    prisma.supplier.upsert({
      where: { name: 'Health Plus' },
      update: {},
      create: {
        name: 'Health Plus',
        contactPerson: 'Ahmed Ali',
        phone: '+92 300 3333333',
        email: 'sales@healthplus.com',
        address: 'Health Zone, Islamabad',
        createdBy: users[1].id
      }
    })
  ]);

  // Create sample products
  const products = await Promise.all([
    prisma.product.upsert({
      where: { barcode: '1234567890123' },
      update: {},
      create: {
        name: 'Paracetamol 500mg',
        description: 'Pain reliever and fever reducer',
        sku: 'PARACE123456',
        categoryId: categories[0].id,
        supplierId: suppliers[0].id,
        branchId: branches[1].id,
        createdBy: users[1].id,
        costPrice: 60,
        sellingPrice: 85,
        stock: 150,
        minStock: 50,
        unitType: 'tablets',
        unitsPerPack: 20,
        barcode: '1234567890123',
        requiresPrescription: false
      }
    }),
    prisma.product.upsert({
      where: { barcode: '2345678901234' },
      update: {},
      create: {
        name: 'Amoxicillin 250mg',
        description: 'Broad-spectrum antibiotic',
        sku: 'AMOXIL234567',
        categoryId: categories[1].id,
        supplierId: suppliers[1].id,
        branchId: branches[1].id,
        createdBy: users[1].id,
        costPrice: 80,
        sellingPrice: 120,
        stock: 25,
        minStock: 30,
        unitType: 'capsules',
        unitsPerPack: 10,
        barcode: '2345678901234',
        requiresPrescription: true
      }
    }),
    prisma.product.upsert({
      where: { barcode: '3456789012345' },
      update: {},
      create: {
        name: 'Vitamin D3 1000IU',
        description: 'Vitamin D supplement for bone health',
        sku: 'VITAMD345678',
        categoryId: categories[2].id,
        supplierId: suppliers[2].id,
        branchId: branches[1].id,
        createdBy: users[1].id,
        costPrice: 100,
        sellingPrice: 150,
        stock: 45,
        minStock: 25,
        unitType: 'tablets',
        unitsPerPack: 30,
        barcode: '3456789012345',
        requiresPrescription: false
      }
    })
  ]);

  // Create sample customers
  const customers = await Promise.all([
    prisma.customer.upsert({
      where: { phone: '+92 300 1234567' },
      update: {},
      create: {
        name: 'Ahmad Khan',
        phone: '+92 300 1234567',
        email: 'ahmad.khan@email.com',
        address: 'Block A, Gulberg, Lahore',
        branchId: branches[1].id,
        createdBy: users[1].id,
        totalPurchases: 45230,
        loyaltyPoints: 1250,
        isVIP: true,
        lastVisit: new Date()
      }
    }),
    prisma.customer.upsert({
      where: { phone: '+92 301 2345678' },
      update: {},
      create: {
        name: 'Fatima Ali',
        phone: '+92 301 2345678',
        email: 'fatima.ali@email.com',
        address: 'DHA Phase 5, Karachi',
        branchId: branches[3].id,
        createdBy: users[1].id,
        totalPurchases: 32100,
        loyaltyPoints: 890,
        isVIP: true,
        lastVisit: new Date()
      }
    })
  ]);

  // Create a sample company for sales
  const company = await prisma.company.upsert({
    where: { name: 'Zapeera Pharmacy' },
    update: {},
    create: {
      name: 'Zapeera Pharmacy',
      description: 'Premium Pharmacy Management System',
      address: 'Main Street, Lahore',
      phone: '+92 42 3333333',
      email: 'info@zapeera.com',
      businessType: 'PHARMACY',
      createdBy: users[1].id,
      isActive: true
    }
  }).catch(err => {
    console.warn('⚠️ Could not create company:', err.message);
    return null;
  });

  // DEPRECATED: Old user-level subscriptions table has been removed
  // Subscriptions are now tracked via BusinessSubscription table per business
  // const subscriptions = await Promise.all([...]) 

  // Create sample sales records
  const companyId = company?.id || 'default-company';
  const sales = await Promise.all([
    prisma.sale.create({
      data: {
        invoiceNumber: 'INV-2026-001',
        customerId: customers[0].id,
        userId: users[1].id,
        branchId: branches[1].id,
        companyId: companyId,
        createdBy: users[1].id,
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
    }),
    prisma.sale.create({
      data: {
        invoiceNumber: 'INV-2026-002',
        customerId: customers[1].id,
        userId: users[2].id,
        branchId: branches[3].id,
        companyId: companyId,
        createdBy: users[1].id,
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
    }),
    prisma.sale.create({
      data: {
        invoiceNumber: 'INV-2026-003',
        customerId: null,
        userId: users[1].id,
        branchId: branches[1].id,
        companyId: companyId,
        createdBy: users[1].id,
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
    }),
    prisma.sale.create({
      data: {
        invoiceNumber: 'INV-2026-004',
        customerId: customers[0].id,
        userId: users[2].id,
        branchId: branches[1].id,
        companyId: companyId,
        createdBy: users[1].id,
        subtotal: 18000,
        taxAmount: 1800,
        discountAmount: 0,
        discountPercentage: 0,
        totalAmount: 19800,
        paidAmount: 19800,
        returnedAmount: 0,
        paymentMethod: 'CASH',
        paymentStatus: 'COMPLETED',
        status: 'COMPLETED',
        saleDate: new Date(new Date().setDate(new Date().getDate() - 3))
      }
    })
  ]).catch(err => {
    console.warn('⚠️ Could not create sales (may already exist):', err.message);
    return [];
  });

  console.log('✅ Database seeded successfully!');
  console.log(`📊 Created:`);
  console.log(`   - ${categories.length} categories`);
  console.log(`   - ${suppliers.length} suppliers`);
  console.log(`   - ${branches.length} branches`);
  console.log(`   - ${users.length} users`);
  console.log(`   - ${products.length} products`);
  console.log(`   - ${customers.length} customers`);
  console.log(`   - ${subscriptions.length} subscriptions`);
  console.log(`   - ${sales.length} sales records`);
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
