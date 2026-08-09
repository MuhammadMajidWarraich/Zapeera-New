import { Router, Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { getPrisma } from '../utils/db.util';

const router = Router();

// CRITICAL: Handle OPTIONS preflight for SSE endpoint
router.options('/events', (req: Request, res: Response) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://app.zapeera.com',
    'https://www.zapeera.com',
    'https://zapeera-new-six.vercel.app',
    'http://localhost:5173',
    'http://localhost:4200',
    'http://127.0.0.1:4100',
    'http://127.0.0.1:5173'
  ];
  
  const isAllowedOrigin = !origin || 
    allowedOrigins.includes(origin) || 
    process.env.NODE_ENV === 'development' ||
    (origin && origin.startsWith('file://'));
  
  if (isAllowedOrigin && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  
  res.status(200).end();
});

// Store active connections
const activeConnections = new Map<string, Response>();

// Store connections by createdBy for group notifications
const adminConnections = new Map<string, Set<string>>();

// Custom authentication for SSE (since EventSource doesn't support custom headers,
// but it DOES send cookies automatically on same-origin requests)
const authenticateSSE = async (req: Request): Promise<{ userId: string; createdBy: string } | null> => {
  try {
    // 1. Try query param token (legacy/Electron)
    let token = req.query.token as string;

    // 2. Fallback: read auth-token httpOnly cookie (sent automatically by EventSource)
    if (!token) {
      const cookies = (req.header('Cookie') || '').split(';').reduce<Record<string, string>>((acc, pair) => {
        const [key, ...rest] = pair.trim().split('=');
        if (key) acc[key.trim()] = rest.join('=').trim();
        return acc;
      }, {});
      token = cookies['auth-token'];
    }

    if (!token) {
      return null;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;

    // Get database client (works with SQLite or PostgreSQL)
    const prisma = await getPrisma();

    // Verify user still exists and is active
    const user = await prisma.zapeeraUser.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        username: true,
        createdBy: true,
        isActive: true
      }
    });

    if (!user || !user.isActive) {
      return null;
    }

    // If createdBy is null, use their own ID (self-referencing)
    let createdBy = user.createdBy;
    if (!createdBy || createdBy === '') {
      createdBy = user.id;
    }

    return {
      userId: user.id,
      createdBy: createdBy || user.id
    };
  } catch (error) {
    console.error('SSE authentication error:', error);
    return null;
  }
};

// SSE endpoint for real-time notifications
router.get('/events', async (req: Request, res: Response) => {
  // CRITICAL: Handle CORS for SSE - must set headers before authentication check
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://app.zapeera.com',
    'https://www.zapeera.com',
    'https://zapeera-new-six.vercel.app',
    'http://localhost:5173',
    'http://localhost:4200',
    'http://127.0.0.1:4100',
    'http://127.0.0.1:5173'
  ];
  
  // Allow origin if it's in the allowed list or in development
  const isAllowedOrigin = !origin || 
    allowedOrigins.includes(origin) || 
    process.env.NODE_ENV === 'development' ||
    (origin && origin.startsWith('file://'));
  
  if (!isAllowedOrigin) {
    res.status(403).json({ message: 'CORS: Origin not allowed' });
    return;
  }

  const auth = await authenticateSSE(req);

  if (!auth) {
    // Still set CORS headers even for 401
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const { userId, createdBy } = auth;

  // Set SSE headers with proper CORS
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Disable buffering in Nginx
  };
  
  // Set CORS headers - use specific origin, not wildcard (required for credentials)
  if (origin && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  } else if (process.env.NODE_ENV === 'development') {
    headers['Access-Control-Allow-Origin'] = origin || '*';
  }
  
  headers['Access-Control-Allow-Headers'] = 'Cache-Control, Authorization';
  
  res.writeHead(200, headers);

  // Store connection
  activeConnections.set(userId, res);

  // Add to admin group
  if (createdBy) {
    if (!adminConnections.has(createdBy)) {
      adminConnections.set(createdBy, new Set());
    }
    adminConnections.get(createdBy)!.add(userId);
  }

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Connected to real-time updates' })}\n\n`);

  // Handle client disconnect
  req.on('close', () => {
    activeConnections.delete(userId);

    // Remove from admin group
    if (createdBy && adminConnections.has(createdBy)) {
      adminConnections.get(createdBy)!.delete(userId);
      if (adminConnections.get(createdBy)!.size === 0) {
        adminConnections.delete(createdBy);
      }
    }

    console.log(`SSE connection closed for user ${userId}`);
  });

  // Keep connection alive
  const keepAlive = setInterval(() => {
    if (activeConnections.has(userId)) {
      res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
    } else {
      clearInterval(keepAlive);
    }
  }, 30000); // Send ping every 30 seconds
});

// Function to notify user of deactivation
export const notifyUserDeactivation = (userId: string) => {
  const connection = activeConnections.get(userId);
  if (connection) {
    try {
      (connection as any).write(`data: ${JSON.stringify({
        type: 'account_deactivated',
        message: 'Your account has been deactivated by Super Admin',
        timestamp: new Date().toISOString()
      })}\n\n`);
      console.log(`Notified user ${userId} of account deactivation`);
    } catch (error) {
      console.error('Error sending deactivation notification:', error);
      activeConnections.delete(userId);
    }
  }
};

// Function to notify user of reactivation
export const notifyUserReactivation = (userId: string) => {
  const connection = activeConnections.get(userId);
  if (connection) {
    try {
      (connection as any).write(`data: ${JSON.stringify({
        type: 'account_reactivated',
        message: 'Your account has been reactivated by Super Admin',
        timestamp: new Date().toISOString()
      })}\n\n`);
      console.log(`Notified user ${userId} of account reactivation`);
    } catch (error) {
      console.error('Error sending reactivation notification:', error);
      activeConnections.delete(userId);
    }
  }
};

// Function to notify all users of the same admin about data changes
export const notifyAdminGroup = (createdBy: string, eventType: string, data: any) => {
  const userConnections = adminConnections.get(createdBy);
  if (userConnections) {
    userConnections.forEach(userId => {
      const connection = activeConnections.get(userId);
      if (connection) {
        try {
          (connection as any).write(`data: ${JSON.stringify({
            type: eventType,
            data: data,
            timestamp: new Date().toISOString()
          })}\n\n`);
          console.log(`Notified user ${userId} of ${eventType}`);
        } catch (error) {
          console.error(`Error sending ${eventType} notification to user ${userId}:`, error);
          activeConnections.delete(userId);
          userConnections.delete(userId);
        }
      }
    });
  }
};

// Specific notification functions for different data types
export const notifyProductChange = (createdBy: string, action: 'created' | 'updated' | 'deleted', product: any) => {
  notifyAdminGroup(createdBy, 'product_change', {
    action,
    product,
    message: `Product ${action}: ${product.name}`
  });
};

export const notifySaleChange = (createdBy: string, action: 'created' | 'updated' | 'deleted', sale: any) => {
  // Create a simplified sale object for notifications to avoid BigInt serialization issues
  const notificationSale = {
    id: sale.id?.toString(),
    totalAmount: typeof sale.totalAmount === 'bigint' ? Number(sale.totalAmount) : sale.totalAmount,
    discountPercentage: sale.discountPercentage,
    discountAmount: typeof sale.discountAmount === 'bigint' ? Number(sale.discountAmount) : sale.discountAmount,
    paymentMethod: sale.paymentMethod,
    status: sale.status,
    customerName: sale.customer?.name || 'Walk-in Customer',
    createdAt: sale.createdAt?.toISOString?.() || sale.createdAt,
    updatedAt: sale.updatedAt?.toISOString?.() || sale.updatedAt
  };

  notifyAdminGroup(createdBy, 'sale_change', {
    action,
    sale: notificationSale,
    message: `Sale ${action}: ${sale.id}`
  });
};

export const notifyRefundChange = (createdBy: string, action: 'created' | 'updated' | 'deleted', refund: any) => {
  notifyAdminGroup(createdBy, 'refund_change', {
    action,
    refund,
    message: `Refund ${action}: ${refund.id}`
  });
};

export const notifyCustomerChange = (createdBy: string, action: 'created' | 'updated' | 'deleted', customer: any) => {
  notifyAdminGroup(createdBy, 'customer_change', {
    action,
    customer,
    message: `Customer ${action}: ${customer.name}`
  });
};

export const notifyInventoryChange = (createdBy: string, action: 'stock_updated' | 'product_added' | 'product_removed', data: any) => {
  notifyAdminGroup(createdBy, 'inventory_change', {
    action,
    data,
    message: `Inventory ${action}: ${data.productName || data.name || 'Unknown'}`
  });
};

// Notify specific user by userId
export const notifyUser = (userId: string, eventType: string, data: any) => {
  const connection = activeConnections.get(userId);
  if (connection) {
    try {
      (connection as any).write(`data: ${JSON.stringify({
        type: eventType,
        data: data,
        timestamp: new Date().toISOString()
      })}\n\n`);
      console.log(`Notified user ${userId} of ${eventType}`);
    } catch (error) {
      console.error(`Error sending ${eventType} notification to user ${userId}:`, error);
      activeConnections.delete(userId);
    }
  }
};

// Notify business owner about payment proof status change
export const notifyPaymentProofStatusChange = (businessId: string, status: 'APPROVED' | 'REJECTED', proof: any, rejectionReason?: string) => {
  // Get business owner (first user with this businessId via Membership)
  const prisma = getPrisma();
  prisma.then(async (prisma) => {
    try {
      const membership = await prisma.membership.findFirst({
        where: {
          businessId: businessId,
          status: 'ACTIVE'
        },
        select: {
          user: {
            select: { id: true }
          }
        }
      });
      
      if (membership?.user) {
        const message = status === 'APPROVED' 
          ? `Your payment proof has been approved and subscription activated`
          : `Your payment proof has been rejected. Reason: ${rejectionReason || 'No reason provided'}`;
        
        notifyUser(membership.user.id, 'payment_proof_status_change', {
          status,
          proofId: proof.id,
          businessId,
          planName: proof.planName,
          amount: proof.amount,
          rejectionReason,
          message
        });
      }
    } catch (error) {
      console.error('Error notifying business owner of payment proof status change:', error);
    }
  });
};

export default router;
