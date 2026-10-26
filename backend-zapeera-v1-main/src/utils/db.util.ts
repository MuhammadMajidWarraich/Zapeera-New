/**
 * Database Utility - Provides Prisma client
 * Supports both SQLite (Electron) and PostgreSQL (Web) modes
 */

import '../config/database.init';
import { PrismaClient } from '@prisma/client';
import { getDatabaseService } from '../services/database.service';
import { isPostgreSQLMode, isSQLiteMode } from '../config/database-mode';
import { buildPrismaUrl } from '../config/prisma-url';

let cachedClient: PrismaClient | null = null;
// True only when cachedClient was created by getPrismaSync() below (db.util
// owns its lifecycle). Clients borrowed from DatabaseService are owned by
// the service and must never be disconnected from here.
// (Port of the Oct 24 connfix, which was committed but never merged to
// release — the live backend still drops a dead cached client without
// disconnecting it, leaking its whole pool.)
let cachedClientOwnedByDbUtil = false;

/**
 * Check if we're using SQLite
 */
export function isSQLite(): boolean {
  return isSQLiteMode();
}

/**
 * Check if we're using PostgreSQL
 */
export function isPostgreSQL(): boolean {
  return isPostgreSQLMode();
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
        // If db.util created this client itself (getPrismaSync), disconnect
        // it before dropping the reference — otherwise its connection pool
        // leaks: the connections stay open in PostgreSQL with nothing left
        // that can close them. A DatabaseService client is only uncached
        // here; the service owns it and disconnects before recreating.
        if (cachedClientOwnedByDbUtil) {
          try { await cachedClient.$disconnect(); } catch { /* already closed */ }
          cachedClientOwnedByDbUtil = false;
        }
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
    cachedClientOwnedByDbUtil = false;
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

  // Create new client (owned by db.util — see the reconnect path in
  // getPrisma(), which disconnects it before dropping the reference)
  cachedClient = new PrismaClient({ datasources: { db: { url: buildPrismaUrl() } } });
  cachedClientOwnedByDbUtil = true;
  return cachedClient;
}

/**
 * Disconnect from database
 */
export async function disconnectPrisma(): Promise<void> {
  if (cachedClient) {
    await cachedClient.$disconnect();
    cachedClient = null;
    cachedClientOwnedByDbUtil = false;
    console.log('[DB Util] 🔌 Disconnected from database');
  }
}
