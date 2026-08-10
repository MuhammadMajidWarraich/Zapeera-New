/**
 * Database Service - Handles SQLite (offline) with PostgreSQL sync
 *
 * DUAL MODE:
 * - Electron: SQLite primary, sync to PostgreSQL when online
 * - Website: Can use PostgreSQL directly with USE_POSTGRESQL=true
 */

import '../config/database.init';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { resolveDatabaseMode, isPostgresUrl as isPostgresUrlSafe } from '../config/database-mode';

function withPostgresConnectionLimit(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    if (!parsed.searchParams.has('connection_limit')) {
      // Use smaller connection pool to avoid exhausting PostgreSQL server limits
      // PostgreSQL default max_connections is usually 100, so we use 10-15 to leave room
      parsed.searchParams.set('connection_limit', process.env.PG_CONNECTION_LIMIT || '15');
    }
    if (!parsed.searchParams.has('pool_timeout')) {
      // Reasonable timeout for connection acquisition
      parsed.searchParams.set('pool_timeout', process.env.PG_POOL_TIMEOUT || '20');
    }
    return parsed.toString();
  } catch {
    return databaseUrl;
  }
}

export enum DatabaseType {
  SQLITE = 'sqlite',
  POSTGRESQL = 'postgresql'
}

export enum ConnectionStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  CHECKING = 'checking',
  ERROR = 'error'
}

class DatabaseService {
  private client: PrismaClient | null = null;
  private pgClient: Client | null = null;
  private connectionStatus: ConnectionStatus = ConnectionStatus.CHECKING;
  private isPostgreSQLMode: boolean;
  private postgresUrl: string | null;
  private lastSyncTime: Date | null = null;

  constructor() {
    const currentUrl = process.env.DATABASE_URL || '';
    this.isPostgreSQLMode = resolveDatabaseMode(process.env) === 'postgresql';
    const isPostgresUrl = isPostgresUrlSafe(currentUrl);

    // PostgreSQL URL - use DATABASE_URL if it's already postgres, otherwise check other env vars
    const postgresUrl = isPostgresUrl
      ? currentUrl
      : (process.env.REMOTE_DATABASE_URL || process.env.POSTGRESQL_URL);

    if (!postgresUrl && this.isPostgreSQLMode) {
      console.error('[Database] ❌ ERROR: No PostgreSQL URL found. Set DATABASE_URL, REMOTE_DATABASE_URL, or POSTGRESQL_URL.');
      throw new Error('No PostgreSQL URL available in PostgreSQL mode');
    }

    this.postgresUrl = postgresUrl ? withPostgresConnectionLimit(postgresUrl) : null;

    if (!this.postgresUrl) {
      console.warn('[Database] ⚠️ PostgreSQL URL not configured. Sync to PostgreSQL is disabled.');
    }

    if (this.isPostgreSQLMode) {
      console.log('[Database] 🌐 Website Mode - PostgreSQL direct');
    } else {
      console.log('[Database] 💻 Electron Mode - SQLite with PostgreSQL sync');
    }
  }

  /**
   * Initialize Prisma client (SQLite or PostgreSQL based on mode)
   */
  async initialize(): Promise<void> {
    try {
      console.log('[Database] 🔌 Connecting to database...');

      // For SQLite mode, ensure database and schema are properly initialized
      if (!this.isPostgreSQLMode) {
        const sqlitePath = path.join(os.homedir(), '.zapeera', 'data', 'zapeera.db');
        const sqliteDir = path.dirname(sqlitePath);

        // Ensure directory exists
        if (!fs.existsSync(sqliteDir)) {
          fs.mkdirSync(sqliteDir, { recursive: true });
          console.log('[Database] 📁 Created SQLite directory:', sqliteDir);
        }

        // Check if database file exists and is valid
        if (fs.existsSync(sqlitePath)) {
          try {
            // Try to connect and verify schema
            this.client = new PrismaClient();
            await this.client.$connect();

            // Enable foreign keys for SQLite (required for cascade deletes)
            await this.client.$executeRaw`PRAGMA foreign_keys = ON`;

            // Ensure newer user access columns exist on older SQLite databases.
            // This keeps staff/dashboard screens working after adding access control.
            try {
              const userColumns = await this.client.$queryRawUnsafe<Array<{ name: string }>>(
                'PRAGMA table_info(zapeera_users)'
              );
              const hasBusinessAccessGranted = userColumns.some(
                (column) => column.name === 'businessAccessGranted'
              );

              if (!hasBusinessAccessGranted) {
                await this.client.$executeRawUnsafe(
                  'ALTER TABLE zapeera_users ADD COLUMN businessAccessGranted BOOLEAN NOT NULL DEFAULT 1'
                );
                console.log('[Database] ✅ Added missing SQLite users.businessAccessGranted column');
              }
            } catch (columnError: any) {
              console.warn('[Database] ⚠️ Could not ensure SQLite business access column:', columnError.message);
            }

            // Quick schema check - try to query a table
            await this.client.$queryRaw`SELECT name FROM sqlite_master WHERE type='table' LIMIT 1`;
            console.log('[Database] ✅ SQLite database exists and is valid (foreign keys enabled)');
          } catch (schemaError: any) {
            console.log('[Database] ⚠️ SQLite database exists but schema may be invalid:', schemaError.message);
            console.log('[Database] 💡 Run: npm run db:push to fix schema');
            // Continue anyway - let Prisma handle the error
            this.client = new PrismaClient();
            await this.client.$connect();
            // Enable foreign keys
            await this.client.$executeRaw`PRAGMA foreign_keys = ON`.catch(() => {});
          }
        } else {
          // Database doesn't exist - will be created by Prisma on first operation
          console.log('[Database] 📝 SQLite database will be created on first operation');
          this.client = new PrismaClient();
          await this.client.$connect();
          // Enable foreign keys
          await this.client.$executeRaw`PRAGMA foreign_keys = ON`.catch(() => {});
        }
      } else {
        // PostgreSQL mode
        console.log('[Database] 🔄 Creating PostgreSQL Prisma client...');
        
        // CRITICAL: Reuse existing client if available to avoid creating multiple connection pools
        if (this.client) {
          try {
            // Test if existing client is still valid
            await this.client.$queryRaw`SELECT 1`;
            console.log('[Database] ✅ Reusing existing PostgreSQL client');
            return;
          } catch (testError) {
            // Client is invalid, disconnect and create new one
            console.log('[Database] ⚠️ Existing client invalid, creating new one...');
            try {
              await this.client.$disconnect();
            } catch (disconnectError) {
              // Ignore disconnect errors
            }
            this.client = null;
          }
        }
        
        this.client = new PrismaClient({
          log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        });
        
        try {
          console.log('[Database] 🔄 Connecting to PostgreSQL...');
          await this.client.$connect();
          console.log('[Database] ✅ PostgreSQL connection established');
          
          // Test connection with a simple query
          console.log('[Database] 🔄 Verifying PostgreSQL connection...');
          await this.client.$queryRaw`SELECT 1`;
          console.log('[Database] ✅ PostgreSQL connection verified');
        } catch (pgError: any) {
          console.error('[Database] ❌ PostgreSQL connection failed:', pgError.message);
          console.error('[Database] Error code:', pgError.code);
          console.error('[Database] Error name:', pgError.name);
          console.error('[Database] DATABASE_URL:', process.env.DATABASE_URL ? 'Set' : 'Not set');
          
          // Clean up failed client
          try {
            await this.client.$disconnect();
          } catch (disconnectError) {
            // Ignore disconnect errors
          }
          this.client = null;
          
          // Provide helpful error message
          if (pgError.code === 'P1001' || pgError.message?.includes('Can\'t reach database') || pgError.message?.includes('ECONNREFUSED')) {
            throw new Error('Cannot connect to PostgreSQL database. Please check if the database server is running and accessible.');
          } else if (pgError.code === 'P1000' || pgError.message?.includes('authentication') || pgError.message?.includes('password')) {
            throw new Error('PostgreSQL authentication failed. Please check your database credentials.');
          } else if (pgError.message?.includes('connection pool') || pgError.message?.includes('connection slots') || pgError.message?.includes('Too many database connections')) {
            throw new Error('PostgreSQL connection pool exhausted. The database server has reached its maximum connection limit. Please wait a moment and try again, or contact your database administrator to increase max_connections.');
          } else if (pgError.message?.includes('accelerate') || pgError.message?.includes('Invalid')) {
            throw new Error('PostgreSQL connection configuration error. Please check your DATABASE_URL and ensure Prisma client is properly generated.');
          }
          throw pgError;
        }
      }

      this.connectionStatus = ConnectionStatus.ONLINE;
      console.log('[Database] ✅ Connected to', this.isPostgreSQLMode ? 'PostgreSQL' : 'SQLite');

      // Check PostgreSQL connectivity for sync (only in Electron mode)
      if (!this.isPostgreSQLMode) {
        await this.checkPostgreSQLConnectivity();
      }
    } catch (error: any) {
      this.connectionStatus = ConnectionStatus.ERROR;
      console.error('[Database] ❌ Failed to connect:', error.message);

      // For SQLite, provide helpful error message
      if (!this.isPostgreSQLMode) {
        console.error('[Database] 💡 Make sure:');
        console.error('[Database]    1. Schema is set to SQLite: npm run db:switch-sqlite');
        console.error('[Database]    2. Database is initialized: npm run db:push');
        console.error('[Database]    3. Prisma client is generated: npm run db:generate');
      }

      throw error;
    }
  }

  /**
   * Check if PostgreSQL is available for sync
   */
  async checkPostgreSQLConnectivity(): Promise<boolean> {
    if (!this.postgresUrl) {
      return false;
    }

    try {
      const pgClient = new Client({ connectionString: this.postgresUrl });
      await pgClient.connect();
      await pgClient.query('SELECT 1');
      await pgClient.end();
      console.log('[Database] ✅ PostgreSQL available for sync');
      return true;
    } catch (error: any) {
      console.log('[Database] ⚠️ PostgreSQL not available:', error.message);
      return false;
    }
  }

  /**
   * Get Prisma client
   * CRITICAL: Always returns the same client instance to ensure connection pool reuse
   */
  async getClient(): Promise<PrismaClient> {
    if (!this.client) {
      await this.initialize();
    }
    
    // Verify client is still valid before returning
    if (this.client) {
      try {
        // Quick health check - use a lightweight query
        await this.client.$queryRaw`SELECT 1`.catch(() => {
          // If query fails, client might be disconnected
          // Don't throw here, let the caller handle it
        });
      } catch (error) {
        // Client might be invalid, but return it anyway
        // The caller will handle connection errors
      }
    }
    
    if (!this.client) {
      throw new Error('Database client is not available. Please check your database connection.');
    }
    
    return this.client;
  }

  /**
   * Get current database type
   */
  getCurrentType(): DatabaseType {
    return this.isPostgreSQLMode ? DatabaseType.POSTGRESQL : DatabaseType.SQLITE;
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  /**
   * Check if online (database connected)
   */
  isOnline(): boolean {
    return this.connectionStatus === ConnectionStatus.ONLINE;
  }

  /**
   * Check if offline
   */
  isOffline(): boolean {
    return this.connectionStatus !== ConnectionStatus.ONLINE;
  }

  /**
   * Get database status for health checks
   */
  getStatus(): {
    currentType: DatabaseType;
    connectionStatus: ConnectionStatus;
    sqlite: { url: string | null; isConnected: boolean; connected: boolean };
    postgres: { url: string; isConnected: boolean; connected: boolean };
    postgresql: { url: string; isConnected: boolean; connected: boolean };
    syncEnabled: boolean;
    lastSync: Date | null;
  } {
    const isConnected = this.connectionStatus === ConnectionStatus.ONLINE;
    const sqliteUrl = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL : null;
    const postgresInfo = {
      url: this.postgresUrl ? this.postgresUrl.replace(/:[^:@]+@/, ':****@') : 'not configured',
      isConnected: this.isPostgreSQLMode ? isConnected : false,
      connected: this.isPostgreSQLMode ? isConnected : false
    };

    return {
      currentType: this.getCurrentType(),
      connectionStatus: this.connectionStatus,
      sqlite: {
        url: sqliteUrl,
        isConnected: !this.isPostgreSQLMode && isConnected,
        connected: !this.isPostgreSQLMode && isConnected
      },
      postgres: postgresInfo,
      postgresql: postgresInfo,
      syncEnabled: !this.isPostgreSQLMode,
      lastSync: this.lastSyncTime
    };
  }

  /**
   * Check connectivity
   */
  async checkConnectivity(): Promise<ConnectionStatus> {
    try {
      if (!this.client) {
        this.client = new PrismaClient();
      }
      await this.client.$queryRaw`SELECT 1`;
      this.connectionStatus = ConnectionStatus.ONLINE;
      return ConnectionStatus.ONLINE;
    } catch (error: any) {
      console.error('[Database] Connectivity check failed:', error.message);
      this.connectionStatus = ConnectionStatus.ERROR;
      return ConnectionStatus.ERROR;
    }
  }

  /**
   * Start connectivity monitoring
   */
  startConnectivityMonitoring(intervalMs: number = 60000): void {
    console.log('[Database] Starting connectivity monitoring');
    setInterval(async () => {
      try {
        await this.checkConnectivity();

        // If in Electron mode and online, try to sync
        if (!this.isPostgreSQLMode && this.connectionStatus === ConnectionStatus.ONLINE) {
          const pgAvailable = await this.checkPostgreSQLConnectivity();
          if (pgAvailable) {
            console.log('[Database] 🔄 PostgreSQL available, ready for sync');
          }
        }
      } catch (e) {
        // Ignore monitoring errors
      }
    }, intervalMs);
  }

  /**
   * Force reconnect
   */
  async forceReconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.$disconnect();
      } catch (e) {}
      this.client = null;
    }
    await this.initialize();
  }

  /**
   * Disconnect
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.$disconnect();
      this.client = null;
      this.connectionStatus = ConnectionStatus.OFFLINE;
      console.log('[Database] 🔌 Disconnected');
    }
  }

  /**
   * Get PostgreSQL client for direct operations (sync)
   */
  async getPostgreSQLClient(): Promise<PrismaClient | null> {
    if (this.isPostgreSQLMode) {
      return this.client;
    }

    // For Electron mode, return null (use raw pg client for sync)
    return null;
  }

  /**
   * Get raw PostgreSQL client for sync operations
   */
  async getRawPostgreSQLClient(): Promise<Client | null> {
    if (!this.postgresUrl) {
      return null;
    }

    try {
      const client = new Client({ connectionString: this.postgresUrl });
      await client.connect();
      return client;
    } catch (error: any) {
      console.log('[Database] Could not connect to PostgreSQL:', error.message);
      return null;
    }
  }

  // Compatibility methods
  getSQLiteClient(): PrismaClient | null {
    return this.isPostgreSQLMode ? null : this.client;
  }

  getPostgresClient(): PrismaClient | null {
    return this.isPostgreSQLMode ? this.client : null;
  }

  /**
   * Get PostgreSQL URL for sync operations
   */
  getPostgreSQLUrl(): string {
    return this.postgresUrl || '';
  }

  async syncNow(): Promise<void> {
    if (this.isPostgreSQLMode) {
      console.log('[Database] ℹ️ Sync not needed - using PostgreSQL directly');
      return;
    }
    console.log('[Database] 🔄 Manual sync requested');
    // Trigger sync through sync service
  }

  async switchToOnline(): Promise<void> {
    console.log('[Database] ℹ️ Mode switching not supported at runtime');
  }

  async switchToOffline(): Promise<void> {
    console.log('[Database] ℹ️ Mode switching not supported at runtime');
  }
}

// Singleton instance
let databaseServiceInstance: DatabaseService | null = null;

export function getDatabaseService(): DatabaseService {
  if (!databaseServiceInstance) {
    databaseServiceInstance = new DatabaseService();
  }
  return databaseServiceInstance;
}

export async function initializeDatabaseService(): Promise<DatabaseService> {
  const service = getDatabaseService();
  await service.initialize();
  return service;
}
