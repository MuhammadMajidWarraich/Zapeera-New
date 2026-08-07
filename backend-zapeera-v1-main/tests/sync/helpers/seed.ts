import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

export const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || 'test@zapeera.test';
export const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || 'testpassword123';

export interface SeedData {
  userId: string;
  businessId: string;
  branchId: string;
  categoryId: string;
  productId: string;
  customerId: string;
  token: string;
}

export async function seedTestData(prisma: PrismaClient): Promise<SeedData> {
  const password = await bcrypt.hash(TEST_USER_PASSWORD, 10);

  const user = await prisma.zapeeraUser.create({
    data: {
      id: 'test-user-001',
      username: 'testuser',
      email: TEST_USER_EMAIL,
      password,
      name: 'Test User',
      isActive: true,
      businessAccessGranted: true
    }
  });

  const business = await prisma.business.create({
    data: {
      id: 'test-biz-001',
      name: 'Test Business A',
      slug: 'test-business-a',
      businessType: 'PHARMACY',
      description: 'Test business for integration tests',
      address: '123 Test Street',
      phone: '555-0001',
      email: 'biz@zapeera.test',
      isActive: true
    }
  });

  const branch = await prisma.branch.create({
    data: {
      id: 'test-branch-001',
      name: 'Main Branch',
      address: '123 Test Street, Unit 1',
      phone: '555-0001',
      email: 'branch@zapeera.test',
      companyId: business.id,
      isActive: true
    }
  });

  const role = await prisma.role.create({
    data: {
      id: 'test-role-001',
      businessId: business.id,
      name: 'OWNER'
    }
  });

  await prisma.membership.create({
    data: {
      id: 'test-membership-001',
      userId: user.id,
      businessId: business.id,
      roleId: role.id,
      status: 'ACTIVE'
    }
  });

  await prisma.membershipBranch.create({
    data: {
      id: 'test-membranch-001',
      membershipId: 'test-membership-001',
      branchId: branch.id
    }
  });

  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET not set');
  const jwt = require('jsonwebtoken');
  const token = jwt.sign(
    { userId: user.id, email: user.email, sessionToken: 'test-session-001' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const category = await prisma.category.create({
    data: {
      id: 'test-cat-001',
      name: 'Medications',
      type: 'GENERAL',
      branchId: branch.id,
      companyId: business.id
    }
  });

  const manufacturer = await prisma.manufacturer.create({
    data: {
      id: 'test-mfr-001',
      name: 'Test Pharma Co',
      branchId: branch.id,
      companyId: business.id,
      isActive: true
    }
  });

  const supplier = await prisma.supplier.create({
    data: {
      id: 'test-supp-001',
      name: 'Test Supplier Co',
      contactPerson: 'John Supplier',
      phone: '555-1000',
      email: 'supplier@test.com',
      manufacturerId: manufacturer.id,
      branchId: branch.id,
      companyId: business.id,
      isActive: true
    }
  });

  const shelf = await prisma.shelf.create({
    data: {
      id: 'test-shelf-001',
      name: 'Shelf A1',
      location: 'Room 1',
      branchId: branch.id,
      companyId: business.id
    }
  });

  const product = await prisma.product.create({
    data: {
      id: 'test-prod-001',
      name: 'Paracetamol 500mg',
      sku: 'PARA-500-001',
      barcode: '8901234567890',
      categoryId: category.id,
      supplierId: supplier.id,
      branchId: branch.id,
      companyId: business.id,
      minStock: 10,
      maxStock: 1000,
      unitsPerPack: 10,
      isActive: true
    }
  });

  const customer = await prisma.customer.create({
    data: {
      id: 'test-cust-001',
      name: 'John Patient',
      phone: '555-2000',
      email: 'patient@test.com',
      branchId: branch.id,
      companyId: business.id,
      isActive: true
    }
  });

  return {
    userId: user.id,
    businessId: business.id,
    branchId: branch.id,
    categoryId: category.id,
    productId: product.id,
    customerId: customer.id,
    token
  };
}
