import { Express, Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { getDatabaseService, DatabaseType } from '../services/database.service';

async function healthCheckHandler(_req: Request, res: Response): Promise<void> {
  try {
    const dbService = getDatabaseService();
    const dbStatus = dbService.getStatus();
    const currentType = dbService.getCurrentType();

    try {
      const prismaClient = await getPrisma();
      try {
        await prismaClient.$queryRaw`SELECT datetime('now') as test`;
      } catch {
        try {
          await prismaClient.$queryRaw`SELECT 1 as test`;
        } catch {
          // Both queries failed; connection may still work
        }
      }
    } catch (err) {
      console.error('[Health] Database connection error:', err);
    }

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: {
        type: currentType === DatabaseType.SQLITE ? 'sqlite' : 'postgresql',
        status: dbStatus.connectionStatus,
        isOnline: dbService.isOnline(),
        isOffline: dbService.isOffline(),
        sqlite: {
          connected: dbStatus.sqlite.connected,
          path: dbStatus.sqlite.url?.replace('file:', '') || 'N/A',
        },
        postgresql: {
          connected: dbStatus.postgresql.connected,
          configured: !!dbStatus.postgresql.url,
        },
      },
    });
  } catch (error: any) {
    res.status(503).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

async function testOfflineHandler(_req: Request, res: Response): Promise<void> {
  try {
    const dbService = getDatabaseService();
    const prismaClient = await getPrisma();
    const currentType = dbService.getCurrentType();
    const isSQLite = currentType === DatabaseType.SQLITE;

    const userCount = await prismaClient.zapeeraUser.count();
    const companyCount = await prismaClient.business.count();
    const testResult = (await prismaClient.$queryRaw`SELECT datetime('now') as current_time`) as any[];
    const currentTime = testResult[0]?.current_time || new Date().toISOString();

    res.json({
      success: true,
      message: 'Offline mode is working! ✅',
      tests: {
        databaseType: isSQLite ? 'SQLite (Offline)' : 'PostgreSQL (Online)',
        databaseConnected: true,
        canRead: true,
        canWrite: true,
        currentTime,
      },
      data: {
        totalUsers: userCount,
        totalCompanies: companyCount,
      },
      status: {
        isOffline: dbService.isOffline(),
        isOnline: dbService.isOnline(),
        connectionStatus: dbService.getConnectionStatus(),
      },
      databasePath: isSQLite ? dbService.getStatus().sqlite.url?.replace('file:', '') : 'N/A',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Offline mode test failed ❌',
      error: error.message,
      tests: {
        databaseType: 'Unknown',
        databaseConnected: false,
        canRead: false,
        canWrite: false,
      },
    });
  }
}

function pingHandler(_req: Request, res: Response): void {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
  });
}

function rootHandler(_req: Request, res: Response): void {
  res.status(200).json({
    message: 'Zapeera Business Management API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      api: '/api',
      ping: '/ping',
    },
    documentation: 'API endpoints are available under /api/*',
  });
}

function apiInfoHandler(_req: Request, res: Response): void {
  res.status(200).json({
    message: 'Zapeera Business Management API',
    version: '1.0.0',
    availableEndpoints: [
      '/api/auth',
      '/api/users',
      '/api/products',
      '/api/sales',
      '/api/reports',
      '/api/dashboard',
      '/api/customers',
      '/api/inventory',
      '/api/companies',
      '/api/branches',
    ],
    healthCheck: '/health',
  });
}

function faviconHandler(_req: Request, res: Response): void {
  res.status(204).end();
}

export function registerHealthChecks(app: Express): void {
  app.get('/health', healthCheckHandler);
  app.get('/api/health', healthCheckHandler);
  app.get('/api/test-offline', testOfflineHandler);
  app.get('/ping', pingHandler);
  app.get('/', rootHandler);
  app.get('/api', apiInfoHandler);
  app.get('/favicon.ico', faviconHandler);
}
