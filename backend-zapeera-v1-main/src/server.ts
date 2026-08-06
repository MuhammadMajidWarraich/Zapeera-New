// CRITICAL: Import CommonJS database URL initialization FIRST
// This MUST be CommonJS (not ES6) to ensure it runs synchronously before ES6 imports
// ES6 imports are hoisted, so we need CommonJS to set DATABASE_URL before Prisma loads
require('./config/database-url-init');

// Now import the TypeScript database initialization (for additional setup)
import './config/database.init';

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Verify DATABASE_URL is set before importing PrismaClient
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set! This should have been set by database-url-init.ts');
}

// Auto-detect PostgreSQL from DATABASE_URL (e.g. Railway, Heroku, Neon set this automatically)
const isPostgresUrl = process.env.DATABASE_URL.startsWith('postgresql://') || process.env.DATABASE_URL.startsWith('postgres://');
if (!isPostgresUrl && process.env.USE_POSTGRESQL !== 'true' && !process.env.DATABASE_URL.startsWith('file:')) {
  const sqlitePath = path.join(os.homedir(), '.zapeera', 'data', 'zapeera.db');
  console.warn('[Server] ⚠️ DATABASE_URL is not a valid postgres or file: URL, falling back to SQLite...');
  process.env.DATABASE_URL = `file:${sqlitePath}`;
}

// Auto-set USE_POSTGRESQL if DATABASE_URL is already postgres
if (isPostgresUrl && process.env.USE_POSTGRESQL !== 'true') {
  process.env.USE_POSTGRESQL = 'true';
  console.log('[Server] 🔍 Auto-detected PostgreSQL DATABASE_URL, enabling PostgreSQL mode');
}

console.log('[Server] ✅ Database mode:', process.env.USE_POSTGRESQL === 'true' ? 'PostgreSQL (Web)' : 'SQLite (Electron)');
console.log('[Server] ✅ DATABASE_URL:', process.env.DATABASE_URL ? (process.env.DATABASE_URL.startsWith('file:') ? 'file:...' : 'postgresql://...') : 'NOT SET');

// Ensure JWT_SECRET is set (required for authentication)
if (!process.env.JWT_SECRET) {
  console.warn('⚠️ JWT_SECRET is not set in environment variables');
  console.warn('⚠️ Attempting to load from .env file...');
  // Try to load from .env file if not set
  try {
    const dotenv = require('dotenv');
    const fs = require('fs');
    // Priority: .env.production (if NODE_ENV=production and file exists) → .env (always as fallback)
    if (process.env.NODE_ENV === 'production' && fs.existsSync('.env.production')) {
      dotenv.config({ path: '.env.production' });
    }
    // Always load .env as base/fallback (won't override existing vars)
    dotenv.config({ override: false });
    if (!process.env.JWT_SECRET) {
      console.error('❌ JWT_SECRET is still not set after loading .env file');
      console.error('❌ Please set JWT_SECRET in your .env file');
      throw new Error('JWT_SECRET is required but not set. Please add JWT_SECRET to your .env file.');
    } else {
      console.log('✅ JWT_SECRET loaded from .env file');
    }
  } catch (err) {
    console.error('❌ Failed to load JWT_SECRET:', err);
    throw new Error('JWT_SECRET is required but could not be loaded. Please set JWT_SECRET in your .env file or environment variables.');
  }
} else {
  console.log('[Server] ✅ JWT_SECRET is set');
}

// Now import Prisma and other modules AFTER DATABASE_URL is set
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';

// Import routes
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import companyRoutes from './routes/company.routes';
import branchRoutes from './routes/branch.routes';
import productRoutes from './routes/product.routes';
import customerRoutes from './routes/customer.routes';
import saleRoutes from './routes/sale.routes';
import reportRoutes from './routes/report.routes';
import dashboardRoutes from './routes/dashboard.routes';
import adminRoutes from './routes/admin.routes';
import categoryRoutes from './routes/category.routes';
import supplierRoutes from './routes/supplier.routes';
import manufacturerRoutes from './routes/manufacturer.routes';
import shelfRoutes from './routes/shelf.routes';
import staffRoutes from './routes/staff.routes';
import attendanceRoutes from './routes/attendance.routes';
import shiftRoutes from './routes/shift.routes';
import scheduledShiftRoutes from './routes/scheduledShift.routes';
import commissionRoutes from './routes/commission.routes';
import roleRoutes from './routes/role.routes';
import refundRoutes from './routes/refund.routes';
import subscriptionRoutes from './routes/subscription.routes';
import billingProfileRoutes from './routes/billing-profile.routes';
import batchRoutes from './routes/batch.routes';
import purchaseRoutes from './routes/purchase.routes';
import inventoryRoutes from './routes/inventory.routes';
import sseRoutes from './routes/sse.routes';
import settingsRoutes from './routes/settings.routes';
import invitationRoutes from './routes/invitation.routes';
import syncRoutes from './routes/sync.routes';
import syncCloudApiRoutes from './routes/sync-cloud-api.routes';
import moduleRoutes from './routes/module.routes';
import moduleAccessRoutes from './routes/module-access.routes';
import businessTypeRoutes from './routes/business-type.routes';
import backofficeRoutes from './routes/backoffice.routes';
import paymentProofRoutes from './routes/payment-proof.routes';
import ocrRoutes from './routes/ocr.routes';
import notificationRoutes from './routes/notification.routes';
import expenseRoutes from './routes/expense.routes';
import barcodeRoutes from './routes/barcode.routes';
import { startSubscriptionCron } from './jobs/subscription-cron';
import { getDatabaseService, DatabaseType } from './services/database.service';
import { getSyncService } from './services/sync.service';
import { getPrisma } from './utils/db.util';
import { validateCSRF } from './middleware/csrf.middleware';
import { applyUniversalModuleProtection } from './middleware/universal-module-protection.middleware';
import { ensurePostgresSchemaCompatibility } from './utils/postgres-schema-compat';
import { ensureModulesExist, ensureBusinessTypesExist, ensureDefaultPlansExist } from './utils/modules.util';

// Import middleware
import { errorHandler } from './middleware/error.middleware';
import { notFound } from './middleware/notFound.middleware';

// DATABASE_URL is already set above - no need to check again

const app = express();

// Trust proxy for correct client IP detection (needed for rate limiting behind proxies)
app.set('trust proxy', true);

// Initialize Database Service for offline/online switching
let dbService: ReturnType<typeof getDatabaseService> | undefined;
let syncService: ReturnType<typeof getSyncService> | undefined;

try {
  dbService = getDatabaseService();
  syncService = getSyncService();

  // Initialize prisma client after database service is ready (async)
  initializePrismaClient()
    .then(async () => {
      try {
        console.log('[Server] ✅ Platform RBAC removed - using BackOfficeUser only');
        // Ensure standard modules and business types exist globally
        try {
          await ensureModulesExist();
          await ensureBusinessTypesExist();
          await ensureDefaultPlansExist();
          console.log('[Server] ✅ Standard modules, business types, and plans ensured');
          startSubscriptionCron();
        } catch (modErr) {
          console.warn('[Server] ⚠️ Failed to ensure standard modules or business types:', modErr);
        }
      } catch (platformError) {
        console.warn('[Server] ⚠️ Failed to ensure platform RBAC defaults:', platformError);
      }
    })
    .catch(err => {
      console.error('[Server] ❌ Failed to initialize Prisma Client:', err);
    });

  // Initialize connectivity check
  if (dbService) {
    dbService.checkConnectivity().then(status => {
      if (!dbService || !syncService) {
        console.error('[Database] Database service or sync service not available');
        return;
      }

      console.log(`[Database] Initial connectivity: ${status}`);
      console.log(`[Database] Current database type: ${dbService.getCurrentType()}`);

      // CRITICAL: Check database health and rebuild if needed (e.g., after reinstall)
      // This ensures SQLite database exists and has data before any operations
      if (syncService) {
        console.log('[Sync] 🔍 Initializing database...');
        syncService.initializeDatabase().then(initialized => {
          if (!initialized) {
            console.error('[Sync] ⚠️ Database initialization had issues - some features may not work offline');
          }

          // After initialization, do regular sync if online
          // CRITICAL FIX: Don't sync users FROM PostgreSQL - users should only sync TO PostgreSQL
          // Local SQLite users take precedence to prevent newly created users from disappearing
          if (status === 'online' && syncService) {
            // ⚠️ SKIPPED: User sync from PostgreSQL - users should only sync TO PostgreSQL, not FROM
            // This prevents local users from being overwritten by empty/old PostgreSQL data
            // console.log('[Sync] 🔄 Syncing users from PostgreSQL...');
            // syncService.syncUsersFromPostgreSQL().then(result => {
            //   console.log(`[Sync] ✅ User sync: ${result.synced} users synced`);
            // }).catch(err => {
            //   console.error('[Sync] ❌ User sync failed:', err.message);
            // });

            // Sync ALL tables EXCEPT users from PostgreSQL to SQLite
            // Users are handled separately - they only sync TO PostgreSQL, not FROM
            console.log('[Sync] 🔄 Starting incremental sync of all tables (excluding users)...');
            syncService.syncAllTablesFromPostgreSQL().then(result => {
              console.log(`[Sync] ✅ Sync complete: ${result.synced} records synced, ${result.failed} failed`);
              if (result.errors.length > 0) {
                console.log(`[Sync] ⚠️ Sync errors: ${result.errors.slice(0, 3).join(', ')}`);
              }
            }).catch(err => {
              console.error('[Sync] ❌ Sync failed:', err.message);
            });
          }
        }).catch(err => {
          console.error('[Sync] ❌ Database initialization failed:', err.message);
        });
      }

      // Start periodic connectivity monitoring (every 2 minutes to reduce logs)
      dbService.startConnectivityMonitoring(120000); // Check every 2 minutes

      // Start centralized sync scheduler (replaces 4 inline setInterval blocks)
      import('./services/sync-scheduler').then(({ SyncScheduler }) => {
        if (dbService && syncService) {
          const scheduler = new SyncScheduler(dbService, syncService);
          return scheduler.start();
        }
        return Promise.resolve();
      }).catch(err => {
        console.error('[Server] Failed to start SyncScheduler:', err);
      });
    }).catch(err => {
      console.error('[Database] Failed to initialize database service:', err);
    });
  }
} catch (error: any) {
  console.error('❌ Failed to initialize Database Service:', error.message);
}

// Legacy Prisma client - will be initialized after database service
// This ensures it works with both SQLite and PostgreSQL
let prisma: PrismaClient | undefined;

// Initialize prisma client after database service is ready
async function initializePrismaClient(): Promise<void> {
  try {
    // Use database service to get the correct client (SQLite or PostgreSQL)
    if (dbService) {
      // Get client from database service (handles SQLite/PostgreSQL switching)
      try {
        prisma = await dbService.getClient();
        console.log('[Server] ✅ Prisma client initialized via database service');
      } catch (err: any) {
        console.error('[Server] ❌ Failed to get client from database service:', err);
        // Fallback: try to create with DATABASE_URL if set
        if (process.env.DATABASE_URL) {
          prisma = new PrismaClient();
        } else {
          // Last resort: create with SQLite default
          const sqlitePath = path.join(os.homedir(), '.zapeera', 'data', 'zapeera.db');
          process.env.DATABASE_URL = `file:${sqlitePath}`;
          prisma = new PrismaClient();
        }
      }
    } else {
      // Fallback if database service not available
      if (process.env.DATABASE_URL) {
        prisma = new PrismaClient();
      } else {
        // Use SQLite as default
        const sqlitePath = path.join(os.homedir(), '.zapeera', 'data', 'zapeera.db');
        process.env.DATABASE_URL = `file:${sqlitePath}`;
        prisma = new PrismaClient();
      }
    }

    // Ensure remote PostgreSQL schema has required columns (idempotent).
    // This prevents runtime 500s like P2022 "column does not exist" when DB is behind.
    if (prisma) {
      try {
        await ensurePostgresSchemaCompatibility(prisma);
        console.log('[DB] ✅ PostgreSQL schema compatibility ensured');
      } catch (schemaErr: any) {
        console.warn('[DB] ⚠️  Could not ensure PostgreSQL schema compatibility:', schemaErr?.message || schemaErr);
      }
    }
  } catch (error: any) {
    console.error('❌ Failed to initialize Prisma Client:', error.message);
    // Last resort: try with SQLite
    try {
      const sqlitePath = path.join(os.homedir(), '.zapeera', 'data', 'zapeera.db');
      process.env.DATABASE_URL = `file:${sqlitePath}`;
      prisma = new PrismaClient();
    } catch (e: any) {
      console.error('❌ Failed to initialize Prisma Client with SQLite:', e.message);
      // Create a client anyway - it might work
      prisma = new PrismaClient();
    }
  }
}

// Helper function to get prisma client (async, uses database service)
export async function getPrismaClient(): Promise<PrismaClient> {
  if (dbService) {
    try {
      return await dbService.getClient();
    } catch (err) {
      console.error('[Server] Failed to get client from database service, using legacy client');
      if (!prisma) {
        // Initialize prisma if not already initialized
        await initializePrismaClient();
      }
      if (!prisma) {
        throw new Error('Prisma client is not available');
      }
      return prisma;
    }
  }
  if (!prisma) {
    // Initialize prisma if not already initialized
    await initializePrismaClient();
  }
  if (!prisma) {
    throw new Error('Prisma client is not available');
  }
  return prisma;
}

// BigInt serialization will be handled in individual controllers

// Database connection test function
async function testDatabaseConnection() {
  try {
    console.log('='.repeat(60));
    console.log('🔍 CHECKING DATABASE CONNECTION STATUS');
    console.log('='.repeat(60));
    console.log('📊 Database URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');

    // Check if it's SQLite
    const databaseUrl = process.env.DATABASE_URL;
    const isSQLite = databaseUrl?.startsWith('file:');
    if (isSQLite && databaseUrl) {
      const dbPath = databaseUrl.replace('file:', '').split('?')[0];
      const fs = require('fs');
      const path = require('path');

      if (fs.existsSync(dbPath)) {
        const stats = fs.statSync(dbPath);
        console.log('📁 Database Path:', dbPath);
        console.log('📦 Database Size:', `${(stats.size / 1024).toFixed(2)} KB`);
        console.log('🗄️  Database Type: SQLite');
      } else {
        console.log('📁 Database Path:', dbPath);
        console.log('⚠️  Database file does not exist yet (will be created on first use)');
        console.log('🗄️  Database Type: SQLite');
      }
    } else {
      console.log('🗄️  Database Type:', databaseUrl?.split(':')[0] || 'Unknown');
    }

    console.log('⏳ Attempting to connect...');

    // CRITICAL: Use getPrismaClient() instead of prisma variable
    // prisma might not be initialized yet (it's async)
    // Wait a bit for prisma to initialize if it's not ready
    let prismaClient: PrismaClient;
    if (!prisma) {
      console.log('⏳ Waiting for Prisma client to initialize...');
      // Wait up to 5 seconds for prisma to be initialized
      for (let i = 0; i < 50; i++) {
        if (prisma) {
          prismaClient = prisma;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // If still not initialized, use getPrismaClient()
      if (!prisma) {
        console.log('⏳ Prisma not initialized yet, using getPrismaClient()...');
        prismaClient = await getPrismaClient();
      } else {
        prismaClient = prisma;
      }
    } else {
      prismaClient = prisma;
    }

    await prismaClient.$connect();

    // Test a simple query - use database-agnostic query
    // Try SQLite first, then fallback to PostgreSQL
    let result: any;
    const isSQLiteUrl = (process.env.DATABASE_URL || '').startsWith('file:');
    try {
      // Try SQLite compatible query first
      if (isSQLiteUrl) {
        result = await prismaClient.$queryRaw`SELECT datetime('now') as current_time` as any[];
        console.log('='.repeat(60));
        console.log('✅ DATABASE CONNECTION: SUCCESSFUL');
        console.log('='.repeat(60));
        console.log('📋 Database Type: SQLite');
        console.log('🕐 Connection Time:', result[0].current_time);
        console.log('🔗 Status: CONNECTED');
        console.log('='.repeat(60));
      } else {
        throw new Error('PostgreSQL mode - skip SQLite query');
      }
    } catch (sqliteError: any) {
      // If SQLite query fails, try PostgreSQL
      try {
        result = await prismaClient.$queryRaw`SELECT NOW() as current_time, current_database() as db_name` as any[];
        console.log('='.repeat(60));
        console.log('✅ DATABASE CONNECTION: SUCCESSFUL');
        console.log('='.repeat(60));
        console.log('📋 Database Name:', result[0].db_name);
        console.log('🕐 Connection Time:', result[0].current_time);
        console.log('🔗 Status: CONNECTED');
        console.log('='.repeat(60));
      } catch (pgError: any) {
        // If both fail, connection still works (just can't test query)
        console.log('='.repeat(60));
        console.log('✅ DATABASE CONNECTION: SUCCESSFUL');
        console.log('='.repeat(60));
        console.log('⚠️  Could not execute test query, but connection is established');
        console.log('🔗 Status: CONNECTED');
        console.log('='.repeat(60));
      }
    }

    return true;
  } catch (error: any) {
    console.log('='.repeat(60));
    console.log('❌ DATABASE CONNECTION: FAILED');
    console.log('='.repeat(60));
    console.log('🚨 Error:', error.message);
    console.log('🔗 Status: NOT CONNECTED');
    console.log('='.repeat(60));
    return false;
  }
}

// CORS — consolidated into a single clean middleware (replaces 3 duplicate handlers)
import { configureCors } from './middleware/cors.middleware';
configureCors(app);

// Security middleware (AFTER CORS to prevent conflicts)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  crossOriginEmbedderPolicy: false
}));

// Rate limiting - Strict for auth endpoints (login, register, etc.)
const authLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes default
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS || '50'), // 50 login attempts per 15 min per IP
  message: { success: false, message: 'Too many login attempts from this IP, please try again later.', error: 'RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Successful logins don't count against the limit
  validate: false,
});

// Apply rate limiter to auth endpoints
app.use('/api/auth', authLimiter);

// Rate limiting - Strict for backoffice admin login (no brute-force)
const backofficeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per 15 min per IP
  message: { success: false, message: 'Too many admin login attempts from this IP, please try again later.', error: 'RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  validate: false,
});
app.use('/api/backoffice/auth', backofficeLimiter);

// Rate limiting - General API usage
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes default
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '1000'), // 1000 requests per 15 min
  message: { success: false, message: 'Too many requests from this IP, please try again later.', error: 'RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: process.env.MAX_FILE_SIZE || '10mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.MAX_FILE_SIZE || '10mb' }));

// Compression middleware
app.use(compression());

// Logging middleware
if (process.env.ENABLE_REQUEST_LOGGING === 'true') {
  if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
  } else {
    app.use(morgan('combined'));
  }
}

// Health checks, info routes, and favicon — extracted to dedicated module
import { registerHealthChecks } from './middleware/health-checks';
registerHealthChecks(app);

// Apply universal module protection before protected API route handlers.
// Public/auth/backoffice routes are skipped by the middleware config.
applyUniversalModuleProtection(app);

// CSRF validation on all state-changing API routes (after auth, before route handlers).
// Safe methods (GET/HEAD/OPTIONS) are skipped by the middleware itself.
app.use('/api', validateCSRF);
app.use('/api/v1', validateCSRF);

// API v1 routes — canonical versioned paths.
// All routes are mounted under /api/v1 in addition to /api for backward compatibility.
// New clients should use /api/v1/*.
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/companies', companyRoutes);
app.use('/api/v1/branches', branchRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use('/api/v1/sales', saleRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/suppliers', supplierRoutes);
app.use('/api/v1/manufacturers', manufacturerRoutes);
app.use('/api/v1/shelves', shelfRoutes);
app.use('/api/v1/staff', staffRoutes);
app.use('/api/v1/attendance', attendanceRoutes);
app.use('/api/v1/shifts', shiftRoutes);
app.use('/api/v1/scheduled-shifts', scheduledShiftRoutes);
app.use('/api/v1/commissions', commissionRoutes);
app.use('/api/v1/roles', roleRoutes);
app.use('/api/v1/refunds', refundRoutes);
app.use('/api/v1/subscription', subscriptionRoutes);
app.use('/api/v1/billing-profiles', billingProfileRoutes);
app.use('/api/v1/batches', batchRoutes);
app.use('/api/v1/purchases', purchaseRoutes);
app.use('/api/v1/inventory', inventoryRoutes);
app.use('/api/v1/sse', sseRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/sync', syncRoutes);
app.use('/api/v1/sync', syncCloudApiRoutes);
app.use('/api/v1/modules', moduleRoutes);
app.use('/api/v1/module-access', moduleAccessRoutes);
app.use('/api/v1/invitations', invitationRoutes);
app.use('/api/v1/business-types', businessTypeRoutes);
app.use('/api/v1/payments/manual', paymentProofRoutes);
app.use('/api/v1/ocr', ocrRoutes);
  app.use('/api/v1/expenses', expenseRoutes);
  app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/barcodes', barcodeRoutes);
app.use('/api/v1/backoffice', backofficeRoutes);

// Legacy /api/* routes — kept for backward compatibility; new clients should use /api/v1/*
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/products', productRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/manufacturers', manufacturerRoutes);
app.use('/api/shelves', shelfRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/scheduled-shifts', scheduledShiftRoutes);
app.use('/api/commissions', commissionRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/refunds', refundRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/billing-profiles', billingProfileRoutes);
app.use('/api/batches', batchRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/sse', sseRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/sync', syncCloudApiRoutes);
app.use('/api/modules', moduleRoutes);
app.use('/api/module-access', moduleAccessRoutes);
app.use('/api/invitations', invitationRoutes);
app.use('/api/business-types', businessTypeRoutes);
app.use('/api/payments/manual', paymentProofRoutes);
app.use('/api/ocr', ocrRoutes);
  app.use('/api/expenses', expenseRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/barcodes', barcodeRoutes);

// Static: serve uploaded receipt screenshots
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Backoffice routes (separate admin portal)
app.use('/api/backoffice', backofficeRoutes);

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  if (prisma) {
    await prisma.$disconnect();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  if (prisma) {
    await prisma.$disconnect();
  }
  process.exit(0);
});

// Ensure PORT is always a valid number
const DEFAULT_PORT: number = (() => {
  const portEnv = process.env.PORT;
  if (!portEnv) return 4200;

  const parsed = parseInt(portEnv, 10);
  if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
    console.warn(`Invalid PORT value: ${portEnv}. Using default port 4200.`);
    return 4200;
  }

  return parsed;
})();

// Check if PORT was explicitly set (not default)
const PORT_EXPLICITLY_SET = !!process.env.PORT;

// Function to check if a port is available
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net');
    const server = net.createServer();

    server.listen(port, () => {
      server.once('close', () => resolve(true));
      server.close();
    });

    server.on('error', () => resolve(false));
  });
}

// Function to kill process using a port (macOS/Linux)
async function killProcessOnPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const { execSync } = require('child_process');
      if (process.platform === 'darwin' || process.platform === 'linux') {
        try {
          const pids = execSync(`lsof -ti:${port}`, { encoding: 'utf8', timeout: 2000 }).trim();
          if (pids) {
            const pidArray = pids.split('\n').filter((p: string) => p.trim());
            pidArray.forEach((pid: string) => {
              try {
                execSync(`kill -9 ${pid.trim()}`, { timeout: 1000 });
                console.log(`✅ Killed process ${pid.trim()} using port ${port}`);
              } catch (e) {
                // Ignore errors
              }
            });
            setTimeout(() => resolve(true), 1000);
          } else {
            resolve(false);
          }
        } catch (e) {
          resolve(false);
        }
      } else if (process.platform === 'win32') {
        try {
          const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', timeout: 2000 });
          const lines = result.split('\n').filter((line: string) => line.includes('LISTENING'));
          lines.forEach((line: string) => {
            const pid = line.trim().split(/\s+/).pop();
            if (pid) {
              try {
                execSync(`taskkill /F /PID ${pid}`, { timeout: 1000 });
                console.log(`✅ Killed process ${pid} using port ${port}`);
              } catch (e) {
                // Ignore errors
              }
            }
          });
          setTimeout(() => resolve(true), 1000);
        } catch (e) {
          resolve(false);
        }
      } else {
        resolve(false);
      }
    } catch (error) {
      resolve(false);
    }
  });
}

// Start server with database connection check and automatic port selection
async function startServer(): Promise<void> {
  let currentPort = DEFAULT_PORT;
  let attempts = 0;
  // If PORT is explicitly set, keep trying the same port (for Electron)
  // Otherwise, try alternative ports
  const maxAttempts = PORT_EXPLICITLY_SET ? 20 : 10; // More attempts if port is explicitly set
  let server: any = null;

  while (attempts < maxAttempts) {
    // Try to kill any process using the port first (especially important if PORT is explicitly set)
    await killProcessOnPort(currentPort);

    // Wait a bit for port to be released (longer wait if port is explicitly set)
    await new Promise(resolve => setTimeout(resolve, PORT_EXPLICITLY_SET ? 1000 : 500));

    // Check if port is available
    const available = await isPortAvailable(currentPort);

    if (available) {
      try {
        // Start the server on this port
        server = app.listen(currentPort, '0.0.0.0', () => {
          console.log('='.repeat(60));
          console.log('🚀 ZAPEERA BACKEND SERVER STARTED');
          console.log('='.repeat(60));
          console.log(`🌐 Server running on port: ${currentPort}`);
          console.log(`📊 Environment: ${process.env.NODE_ENV || 'production'}`);
          console.log(`🔗 Health check: http://0.0.0.0:${currentPort}/health`);
          console.log(`📋 API Base URL: http://0.0.0.0:${currentPort}/api`);
          console.log('='.repeat(60));

          // Emit ready signal for Electron detection
          console.log('✅ Server is ready to accept connections');

          // Update process.env.PORT so other parts of the app know the actual port
          process.env.PORT = currentPort.toString();
        });

        // Handle server startup errors
        server.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            if (PORT_EXPLICITLY_SET) {
              // If port is explicitly set, keep trying the same port
              console.log(`⚠️  Port ${currentPort} is still in use. Killing processes and retrying...`);
              if (server) {
                server.close();
              }
              attempts++;
              // Retry with same port after killing processes
              setTimeout(() => startServer(), 2000);
            } else {
              // If port is not explicitly set, try next port
              console.log(`⚠️  Port ${currentPort} is already in use. Trying next port...`);
              if (server) {
                server.close();
              }
              attempts++;
              currentPort++;
              // Retry with next port
              setTimeout(() => startServer(), 1000);
            }
          } else if (error.code === 'EACCES') {
            console.error(`❌ Permission denied to bind to port ${currentPort}. Please use a port above 1024.`);
            process.exit(1);
          } else {
            console.error('❌ Server startup error:', error.message);
            process.exit(1);
          }
        });

        // Test database connection in background (non-blocking)
        // Wait longer to ensure prisma is initialized
        setTimeout(async () => {
          // Wait for prisma to be initialized
          let waitCount = 0;
          while (!prisma && waitCount < 30) {
            await new Promise(resolve => setTimeout(resolve, 200));
            waitCount++;
          }

          const dbConnected = await testDatabaseConnection();
          if (!dbConnected) {
            console.log('⚠️  Database connection issues detected...');
            console.log('💡 Server is running but database may not be accessible');
            console.log('💡 Check your DATABASE_URL environment variable');
          }
          
          // Initialize subscription reminder scheduler (only in production/scheduled mode)
          if (process.env.ENABLE_SUBSCRIPTION_REMINDERS !== 'false') {
            try {
              const { initializeReminderScheduler } = await import('./services/subscription-reminder.service');
              initializeReminderScheduler();
              console.log('✅ Subscription reminder scheduler initialized');
            } catch (err: any) {
              console.error('❌ Failed to initialize subscription reminder scheduler:', err.message);
            }
          }
        }, 3000); // Wait 3 seconds after server starts to ensure prisma is initialized

        return; // Successfully started
      } catch (error: any) {
        if (error.code === 'EADDRINUSE') {
          if (PORT_EXPLICITLY_SET) {
            // Keep trying the same port
            console.log(`⚠️  Port ${currentPort} is still in use. Retrying...`);
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          } else {
            console.log(`⚠️  Port ${currentPort} is already in use. Trying next port...`);
            attempts++;
            currentPort++;
            continue;
          }
        } else {
          throw error;
        }
      }
    } else {
      if (PORT_EXPLICITLY_SET) {
        // Keep trying the same port
        console.log(`⚠️  Port ${currentPort} is not available. Killing processes and retrying...`);
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.log(`⚠️  Port ${currentPort} is not available. Trying next port...`);
        attempts++;
        currentPort++;
      }
    }
  }

  // If we've exhausted all attempts
  if (PORT_EXPLICITLY_SET) {
    console.error(`❌ Could not start server on port ${DEFAULT_PORT} after ${maxAttempts} attempts.`);
    console.error(`❌ Port ${DEFAULT_PORT} is in use and could not be freed.`);
    console.error(`❌ Please close other applications using port ${DEFAULT_PORT}.`);
  } else {
    console.error(`❌ Could not find an available port after ${maxAttempts} attempts.`);
    console.error(`❌ Tried ports ${DEFAULT_PORT} to ${currentPort - 1}.`);
  }
  process.exit(1);
}

// In test mode, do NOT auto-start the server — the test harness calls startServer() manually.
if (process.env.TEST_MODE !== 'true') {
  startServer();
}

export default app;
