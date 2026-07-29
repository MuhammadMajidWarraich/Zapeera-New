import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting operations dummy data seed...');

  // Target specific business ID
  const targetCompanyId = 'cmndiqqkv00041cd8b51arwyo';
  
  // Get the company
  const company = await prisma.company.findUnique({
    where: { id: targetCompanyId }
  });

  if (!company) {
    console.error('❌ Company not found with ID:', targetCompanyId);
    return;
  }

  console.log('✅ Found company:', company.name, 'ID:', company.id);

  // Get the branch
  const branch = await prisma.branch.findFirst({ where: { companyId: company.id } });
  if (!branch) {
    console.error('❌ Branch not found for company');
    return;
  }

  const branchId = branch.id;
  const companyId = company.id;

  // Get existing data
  const products = await prisma.product.findMany({ where: { branchId } });
  const suppliers = await prisma.supplier.findMany({ where: { branchId } });
  const batches = await prisma.batch.findMany({ where: { branchId } });
  const customers = await prisma.customer.findMany({ where: { branchId } });

  console.log('📦 Found', products.length, 'products');
  console.log('📦 Found', suppliers.length, 'suppliers');
  console.log('📦 Found', batches.length, 'batches');
  console.log('📦 Found', customers.length, 'customers');

  // Get a user for sales (first user with membership to this company)
  const membership = await prisma.membership.findFirst({
    where: { businessId: companyId },
    include: { user: true }
  });

  if (!membership) {
    console.error('❌ No user membership found for company');
    return;
  }

  const userId = membership.userId;
  console.log('✅ Using user ID:', userId);

  // Create Customers if none exist
  if (customers.length === 0) {
    const customersData = [
      { name: 'John Doe', phone: '03001234567', email: 'john@example.com', address: '123 Street, City', branchId, companyId },
      { name: 'Jane Smith', phone: '03007654321', email: 'jane@example.com', address: '456 Avenue, City', branchId, companyId },
      { name: 'Ahmed Khan', phone: '03009876543', email: 'ahmed@example.com', address: '789 Road, City', branchId, companyId },
      { name: 'Fatima Ali', phone: '03005432109', email: 'fatima@example.com', address: '321 Lane, City', branchId, companyId },
      { name: 'Sara Ahmed', phone: '03001234568', email: 'sara@example.com', address: '654 Street, City', branchId, companyId },
      { name: 'Muhammad Hassan', phone: '03009876544', email: 'hassan@example.com', address: '987 Avenue, City', branchId, companyId },
      { name: 'Ayesha Malik', phone: '03005432110', email: 'ayesha@example.com', address: '159 Road, City', branchId, companyId },
      { name: 'Ali Raza', phone: '03001234569', email: 'ali@example.com', address: '357 Lane, City', branchId, companyId },
      { name: 'Zainab Bibi', phone: '03009876545', email: 'zainab@example.com', address: '852 Street, City', branchId, companyId },
      { name: 'Usman Ghani', phone: '03005432111', email: 'usman@example.com', address: '456 Avenue, City', branchId, companyId },
    ];
    await prisma.customer.createMany({ data: customersData });
    console.log('✅ Created customers:', customersData.length);
    const createdCustomers = await prisma.customer.findMany({ where: { branchId } });
    customers.push(...createdCustomers);
  }

  // Create Sales
  const today = new Date();
  const salesData: any[] = [];
  for (let i = 0; i < 50; i++) {
    const customer = customers[Math.floor(Math.random() * customers.length)];
    const batch = batches[Math.floor(Math.random() * batches.length)];
    const quantity = Math.floor(Math.random() * 5) + 1;
    const unitPrice = batch.sellingPrice || 50;
    const subtotal = unitPrice * quantity;
    const taxAmount = subtotal * 0.1; // 10% tax
    const totalAmount = subtotal + taxAmount;
    
    const randomDate = new Date(today.getTime() - Math.random() * 30 * 24 * 60 * 60 * 1000);
    
    const isRefunded = Math.random() < 0.1; // 10% refund rate
    
    salesData.push({
      customerId: customer.id,
      userId,
      branchId,
      companyId,
      subtotal,
      taxAmount,
      totalAmount,
      status: isRefunded ? 'REFUNDED' : 'COMPLETED',
      paymentMethod: Math.random() > 0.5 ? 'CASH' : 'CARD',
      saleDate: randomDate,
      createdAt: randomDate,
      updatedAt: randomDate,
    });
  }

  await prisma.sale.createMany({ data: salesData });
  console.log('✅ Created sales:', salesData.length);

  const createdSales = await prisma.sale.findMany({ where: { branchId } });

  // Create Sale Items
  const saleItemsData: any[] = [];
  createdSales.forEach((sale) => {
    const numItems = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < numItems; i++) {
      const batch = batches[Math.floor(Math.random() * batches.length)];
      const quantity = Math.floor(Math.random() * 3) + 1;
      const unitPrice = batch.sellingPrice || 50;
      
      saleItemsData.push({
        saleId: sale.id,
        productId: batch.productId,
        batchId: batch.id,
        quantity,
        unitPrice,
        totalPrice: quantity * unitPrice,
        batchNumber: batch.batchNo,
      });
    }
  });

  await prisma.saleItem.createMany({ data: saleItemsData });
  console.log('✅ Created sale items:', saleItemsData.length);

  // Create Purchases (Purchase Orders)
  const purchasesData: any[] = [];
  for (let i = 0; i < 30; i++) {
    const supplier = suppliers[Math.floor(Math.random() * suppliers.length)];
    const randomDate = new Date(today.getTime() - Math.random() * 60 * 24 * 60 * 60 * 1000);
    const status = Math.random() > 0.7 ? 'COMPLETED' : (Math.random() > 0.5 ? 'PENDING' : 'CANCELLED');
    const totalAmount = parseFloat((Math.random() * 5000 + 1000).toFixed(2));
    
    purchasesData.push({
      supplierId: supplier.id,
      branchId,
      companyId,
      invoiceNo: `INV-${Date.now()}-${i}`,
      purchaseDate: randomDate,
      totalAmount,
      paidAmount: status === 'COMPLETED' ? totalAmount : 0,
      outstanding: status === 'COMPLETED' ? 0 : totalAmount,
      status,
      notes: `Purchase for stock replenishment`,
      createdAt: randomDate,
      updatedAt: randomDate,
    });
  }

  await prisma.purchase.createMany({ data: purchasesData });
  console.log('✅ Created purchases:', purchasesData.length);

  const createdPurchases = await prisma.purchase.findMany({ where: { branchId } });

  // Create Purchase Items
  const purchaseItemsData: any[] = [];
  createdPurchases.forEach((purchase) => {
    const numItems = Math.floor(Math.random() * 5) + 2;
    for (let i = 0; i < numItems; i++) {
      const batch = batches[Math.floor(Math.random() * batches.length)];
      const quantity = Math.floor(Math.random() * 50) + 10;
      const unitPrice = parseFloat((Math.random() * 30 + 5).toFixed(2));
      
      purchaseItemsData.push({
        purchaseId: purchase.id,
        productId: batch.productId,
        batchId: batch.id,
        quantity,
        unitPrice,
        totalPrice: quantity * unitPrice,
      });
    }
  });

  await prisma.purchaseItem.createMany({ data: purchaseItemsData });
  console.log('✅ Created purchase items:', purchaseItemsData.length);

  // Create Refunds
  const refundsData: any[] = [];
  for (let i = 0; i < 15; i++) {
    const sale = createdSales[Math.floor(Math.random() * createdSales.length)];
    const batch = batches[Math.floor(Math.random() * batches.length)];
    const quantity = Math.floor(Math.random() * 2) + 1;
    const unitPrice = batch.sellingPrice || 50;
    const refundAmount = quantity * unitPrice;
    const randomDate = new Date(today.getTime() - Math.random() * 30 * 24 * 60 * 60 * 1000);
    
    const refund = await prisma.refund.create({
      data: {
        originalSaleId: sale.id,
        refundReason: Math.random() > 0.5 ? 'DEFECTIVE' : 'WRONG_ITEM',
        refundAmount,
        refundedBy: userId,
        status: 'APPROVED',
        processedAt: randomDate,
        createdAt: randomDate,
        updatedAt: randomDate,
      }
    });
    refundsData.push(refund);

    // Create Refund Items
    await prisma.refundItem.create({
      data: {
        refundId: refund.id,
        productId: batch.productId,
        quantity,
        unitPrice,
        reason: Math.random() > 0.5 ? 'DEFECTIVE' : 'WRONG_ITEM',
      }
    });
  }

  console.log('✅ Created refunds:', refundsData.length);

  // Create Stock Movements
  const stockMovementsData: any[] = [];
  for (let i = 0; i < 100; i++) {
    const batch = batches[Math.floor(Math.random() * batches.length)];
    const quantity = Math.floor(Math.random() * 20) + 1;
    const randomDate = new Date(today.getTime() - Math.random() * 90 * 24 * 60 * 60 * 1000);
    const type = Math.random() > 0.3 ? 'IN' : 'OUT';
    
    stockMovementsData.push({
      productId: batch.productId,
      type,
      quantity: type === 'IN' ? quantity : -quantity,
      reason: type === 'IN' ? 'PURCHASE' : 'SALE',
      reference: `REF-${Date.now()}-${i}`,
      createdAt: randomDate,
      createdBy: userId,
    });
  }

  await prisma.stockMovement.createMany({ data: stockMovementsData });
  console.log('✅ Created stock movements:', stockMovementsData.length);

  console.log('🎉 Operations dummy data seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
