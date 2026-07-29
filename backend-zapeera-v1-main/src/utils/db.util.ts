/**
 * Database Utility - Provides Prisma client
 * Supports both SQLite (Electron) and PostgreSQL (Web) modes
 */

import '../config/database.init';
import { PrismaClient } from '@prisma/client';
import { getDatabaseService } from '../services/database.service';

let cachedClient: PrismaClient | null = null;

/**
 * Check if we're using SQLite
 */
export function isSQLite(): boolean {
  const dbUrl = process.env.DATABASE_URL || '';
  return dbUrl.startsWith('file:');
}

/**
 * Check if we're using PostgreSQL
 */
export function isPostgreSQL(): boolean {
  return !isSQLite();
}

/**
 * Get Prisma client
 */
export async function getPrisma(): Promise<PrismaClient> {
  try {
    if (cachedClient) {
      // Verify client is still connected
      try {
        await cachedClient.$queryRaw`SELECT 1`;
        return cachedClient;
      } catch (verifyError: any) {
        console.warn('[DB Util] ⚠️ Cached client disconnected, reconnecting...');
        cachedClient = null;
      }
    }

    const dbService = getDatabaseService();
    
    // Ensure database service is initialized - getClient() will initialize if needed
    const client = await dbService.getClient();
    
    if (!client) {
      throw new Error('Database client is null after initialization');
    }

    cachedClient = client;
    console.log('[DB Util] ✅ Connected to database');

    return client;
  } catch (error: any) {
    console.error('[DB Util] ❌ Failed to get database client:', error.message);
    console.error('[DB Util] Error details:', {
      code: error.code,
      message: error.message,
      stack: error.stack?.substring(0, 500)
    });
    
    // Provide more helpful error message
    let errorMessage = 'Database connection failed. Please check if the database is running.';
    if (error.message?.includes('P1001') || error.message?.includes('Can\'t reach database')) {
      errorMessage = 'Cannot connect to database server. Please check your database connection settings.';
    } else if (error.message?.includes('P2021') || error.message?.includes('does not exist')) {
      errorMessage = 'Database table does not exist. Please run database migrations.';
    } else if (error.message?.includes('authentication') || error.message?.includes('password')) {
      errorMessage = 'Database authentication failed. Please check your database credentials.';
    } else if (error.message?.includes('connection pool') || error.message?.includes('connection slots')) {
      errorMessage = 'Database connection pool exhausted. Please try again in a moment.';
    } else if (error.message?.includes('accelerate') || error.message?.includes('Invalid')) {
      errorMessage = 'Database connection error. Please check your database configuration and ensure the database server is running.';
    }
    
    throw new Error(errorMessage);
  }
}

/**
 * Synchronous version - returns cached client
 */
export function getPrismaSync(): PrismaClient {
  if (cachedClient) {
    return cachedClient;
  }

  // Create new client
  cachedClient = new PrismaClient();
  return cachedClient;
}

/**
 * Disconnect from database
 */
export async function disconnectPrisma(): Promise<void> {
  if (cachedClient) {
    await cachedClient.$disconnect();
    cachedClient = null;
    console.log('[DB Util] 🔌 Disconnected from database');
  }
}
