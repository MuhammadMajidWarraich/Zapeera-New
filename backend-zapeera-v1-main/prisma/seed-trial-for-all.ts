import { PrismaClient } from '@prisma/client';
import { assignBusinessPlan, loadPricingPlans } from '../src/utils/subscription-entitlements.util';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Starting trial subscription assignment for all businesses...');

  // Load pricing plans
  const plans = await loadPricingPlans(prisma);
  const trialPlan = plans.find(p => p.id === 'single-trial');
  
  if (!trialPlan) {
    console.error('❌ Trial plan not found in pricing plans');
    process.exit(1);
  }

  console.log(`✅ Found trial plan: ${trialPlan.name} (ID: ${trialPlan.id})`);

  // Get all companies
  const companies = await prisma.company.findMany({
    select: {
      id: true,
      name: true,
      createdBy: true,
      businessType: true,
    },
  });

  console.log(`📊 Found ${companies.length} companies`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const company of companies) {
    try {
      // Check if already has a business subscription
      const existing = await prisma.businessSubscription.findUnique({
        where: { businessId: company.id },
      });

      if (existing) {
        console.log(`⏭️  Skipping ${company.name} (${company.id}) - already has subscription: ${existing.status}`);
        skipped++;
        continue;
      }

      // Get owner user ID
      const ownerUserId = company.createdBy ? String(company.createdBy) : null;
      if (!ownerUserId) {
        console.warn(`⚠️  Skipping ${company.name} (${company.id}) - no owner found`);
        skipped++;
        continue;
      }

      // Assign trial plan (this will create business_subscription with TRIAL status)
      await assignBusinessPlan(prisma, company.id, trialPlan.id, ownerUserId);

      // Update the business_subscription to set trial end date (30 days from now)
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 30);

      await prisma.businessSubscription.update({
        where: { businessId: company.id },
        data: {
          status: 'TRIAL',
          trialEndsAt,
          currentPeriodEnd: trialEndsAt,
        },
      });

      console.log(`✅ Applied trial to ${company.name} (${company.id}) - trial ends: ${trialEndsAt.toISOString()}`);
      updated++;
    } catch (error) {
      console.error(`❌ Error processing ${company.name} (${company.id}):`, error);
      errors++;
    }
  }

  console.log('\n📋 Summary:');
  console.log(`✅ Updated: ${updated}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`❌ Errors: ${errors}`);
  console.log(`📊 Total: ${companies.length}`);
}

main()
  .catch((e) => {
    console.error('❌ Fatal error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
