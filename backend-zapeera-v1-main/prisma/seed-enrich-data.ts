import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting data enrichment seed...');

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
  const batches = await prisma.batch.findMany({ where: { branchId } });
  const customers = await prisma.customer.findMany({ where: { branchId } });

  console.log('📦 Found', products.length, 'products');
  console.log('📦 Found', batches.length, 'batches');
  console.log('📦 Found', customers.length, 'customers');

  // Get a user for sales
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

  const today = new Date();

  // Update batches to create variety
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let expiredCount = 0;

  for (const batch of batches) {
    const random = Math.random();
    
    // 30% low stock (5-10 units)
    if (random < 0.30) {
      const newQuantity = Math.floor(Math.random() * 6) + 5;
      await prisma.batch.update({
        where: { id: batch.id },
        data: { quantity: newQuantity }
      });
      lowStockCount++;
    }
    // 15% out of stock
    else if (random < 0.45) {
      await prisma.batch.update({
        where: { id: batch.id },
        data: { quantity: 0 }
      });
      outOfStockCount++;
    }
    // 20% expired (set expiry date in the past)
    else if (random < 0.65) {
      const daysAgo = Math.floor(Math.random() * 180) + 1;
      const expiredDate = new Date(today.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      await prisma.batch.update({
        where: { id: batch.id },
        data: { 
          expireDate: expiredDate,
          isReported: true,
          reportReason: 'Expired batch'
        }
      });
      expiredCount++;
    }
    // Rest keep normal stock (50-200 units)
    else {
      const newQuantity = Math.floor(Math.random() * 151) + 50;
      await prisma.batch.update({
        where: { id: batch.id },
        data: { quantity: newQuantity }
      });
    }
  }

  console.log('✅ Updated batches:', lowStockCount, 'low stock,', outOfStockCount, 'out of stock,', expiredCount, 'expired');

  // Update product minStock to create more low stock alerts
  let productUpdateCount = 0;
  for (const product of products) {
    if (Math.random() < 0.4) {
      // Set minStock higher than current stock to trigger alert
      const productBatches = await prisma.batch.findMany({
        where: { productId: product.id }
      });
      const totalStock = productBatches.reduce((sum, b) => sum + b.quantity, 0);
      
      if (totalStock > 0) {
        const newMinStock = Math.floor(totalStock * 1.5) + 10;
        await prisma.product.update({
          where: { id: product.id },
          data: { minStock: newMinStock }
        });
        productUpdateCount++;
      }
    }
  }

  console.log('✅ Updated', productUpdateCount, 'products with higher minStock');

  // Create more sales to establish most/slow selling patterns
  const salesData: any[] = [];
  const productSalesCount: Record<string, number> = {};

  // Initialize sales count for all products
  products.forEach(p => productSalesCount[p.id] = 0);

  // Create 200 more sales with varying patterns
  for (let i = 0; i < 200; i++) {
    const customer = customers[Math.floor(Math.random() * customers.length)];
    const batch = batches[Math.floor(Math.random() * batches.length)];
    const quantity = Math.floor(Math.random() * 5) + 1;
    const unitPrice = batch.sellingPrice || 50;
    const subtotal = unitPrice * quantity;
    const taxAmount = subtotal * 0.1;
    const totalAmount = subtotal + taxAmount;
    
    const randomDate = new Date(today.getTime() - Math.random() * 90 * 24 * 60 * 60 * 1000);
    
    salesData.push({
      customerId: customer.id,
      userId,
      branchId,
      companyId,
      subtotal,
      taxAmount,
      totalAmount,
      status: 'COMPLETED',
      paymentMethod: Math.random() > 0.5 ? 'CASH' : 'CARD',
      saleDate: randomDate,
      createdAt: randomDate,
      updatedAt: randomDate,
    });

    // Track sales per product
    productSalesCount[batch.productId] = (productSalesCount[batch.productId] || 0) + quantity;
  }

  await prisma.sale.createMany({ data: salesData });
  console.log('✅ Created additional sales:', salesData.length);

  const createdSales = await prisma.sale.findMany({ where: { branchId } });

  // Create Sale Items with specific patterns for most/slow selling
  const saleItemsData: any[] = [];
  
  // Get top 20% products as most selling (sell them more frequently)
  const sortedProducts = Object.entries(productSalesCount)
    .sort(([,a], [,b]) => b - a)
    .slice(0, Math.floor(products.length * 0.2))
    .map(([id]) => id);
  
  const mostSellingProductIds = new Set(sortedProducts);

  createdSales.forEach((sale) => {
    const numItems = Math.floor(Math.random() * 4) + 1;
    for (let i = 0; i < numItems; i++) {
      // Bias towards most selling products
      let batch;
      if (Math.random() < 0.6 && mostSellingProductIds.size > 0) {
        const mostSellingBatches = batches.filter(b => mostSellingProductIds.has(b.productId));
        if (mostSellingBatches.length > 0) {
          batch = mostSellingBatches[Math.floor(Math.random() * mostSellingBatches.length)];
        } else {
          batch = batches[Math.floor(Math.random() * batches.length)];
        }
      } else {
        batch = batches[Math.floor(Math.random() * batches.length)];
      }
      
      const quantity = Math.floor(Math.random() * 5) + 1;
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
  console.log('✅ Created additional sale items:', saleItemsData.length);

  // Create additional expired batches
  const additionalExpiredBatches = 15;
  const expiredBatchesData: any[] = [];
  
  for (let i = 0; i < additionalExpiredBatches; i++) {
    const product = products[Math.floor(Math.random() * products.length)];
    const daysAgo = Math.floor(Math.random() * 365) + 1;
    const expiredDate = new Date(today.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    const productionDate = new Date(expiredDate.getTime() - 365 * 24 * 60 * 60 * 1000);
    
    expiredBatchesData.push({
      batchNo: `EXP-${Date.now()}-${i}`,
      productId: product.id,
      branchId,
      companyId,
      quantity: 0,
      purchasePrice: parseFloat((Math.random() * 50 + 10).toFixed(2)),
      sellingPrice: parseFloat((Math.random() * 80 + 20).toFixed(2)),
      stockPurchasePrice: 0,
      expireDate: expiredDate,
      productionDate,
      isActive: true,
      isReported: true,
      reportReason: 'Expired batch',
    });
  }

  await prisma.batch.createMany({ data: expiredBatchesData });
  console.log('✅ Created additional expired batches:', additionalExpiredBatches);

  console.log('🎉 Data enrichment seed completed successfully!');
  console.log('📊 Summary:');
  console.log('  - Low stock batches:', lowStockCount);
  console.log('  - Out of stock batches:', outOfStockCount);
  console.log('  - Expired batches:', expiredCount + additionalExpiredBatches);
  console.log('  - Additional sales:', salesData.length);
  console.log('  - Additional sale items:', saleItemsData.length);
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
