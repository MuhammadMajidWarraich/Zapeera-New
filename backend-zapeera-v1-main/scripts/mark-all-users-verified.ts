/// <reference types="node" />
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function markAllUsersVerified() {
  try {
    console.log('Starting to mark all users as email verified...');
    
    const result = await prisma.zapeeraUser.updateMany({
      where: {
        emailVerified: false
      },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null
      }
    });
    
    console.log(`✅ Successfully marked ${result.count} users as email verified`);
    console.log(`✅ Cleared verification tokens for ${result.count} users`);
  } catch (error: any) {
    console.error('❌ Error marking users as verified:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

markAllUsersVerified()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
