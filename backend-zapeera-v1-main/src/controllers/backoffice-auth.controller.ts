import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getPrisma } from '../utils/db.util';
import { logAdminLogin } from '../middleware/admin-auth.middleware';
import { isLocked, recordFailedAttempt, clearFailedAttempts } from '../utils/account-lockout.util';
import { generateCSRFToken } from '../middleware/csrf.middleware';

/**
 * Admin login controller
 * Separate from regular user login - uses BackOfficeUser model
 */
export const adminLogin = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Account lockout check
    if (isLocked(email)) {
      return res.status(429).json({
        success: false,
        message: 'Account temporarily locked due to too many failed login attempts. Please try again later.',
        error: 'ACCOUNT_LOCKED'
      });
    }

    const prisma = await getPrisma();

    // Find admin user by email
    const admin = await prisma.backOfficeUser.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if admin account is active
    if (!admin.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Admin account is inactive'
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      recordFailedAttempt(email);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Password correct — reset lockout counter
    clearFailedAttempts(email);

    // Generate JWT token with admin flag
    const token = jwt.sign(
      {
        adminId: admin.id,
        email: admin.email,
        role: admin.role,
        isAdmin: true // Flag to distinguish from user tokens
      },
      process.env.JWT_SECRET!,
      { expiresIn: '24h' }
    );

    // Update last login
    await prisma.backOfficeUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() }
    });

    // Log login
    await logAdminLogin(
      admin.id,
      req.ip,
      req.get('user-agent')
    );

    // Set httpOnly cookie for backoffice admin token
    res.cookie('backoffice-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/'
    });

    // Generate and set CSRF token for backoffice mutating requests
    const csrfToken = generateCSRFToken();
    res.cookie('csrf-token', csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 1000, // 1 hour
      path: '/'
    });

    return res.json({
      success: true,
      message: 'Login successful',
      data: {
        admin: {
          id: admin.id,
          email: admin.email,
          role: admin.role
        }
      }
    });
  } catch (error: any) {
    console.error('Admin login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Create initial admin user (for initial setup only).
 * SECURED: Only works when no admin exists yet AND a setup token is provided.
 */
export const createInitialAdmin = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();

    // SECURITY: Check if any admin already exists — block if so
    const adminCount = await prisma.backOfficeUser.count();
    if (adminCount > 0) {
      return res.status(403).json({
        success: false,
        message: 'Admin setup is no longer available. Admin accounts already exist.'
      });
    }

    // SECURITY: Require a setup token that must match an env var
    const { email, password, role, setupToken } = req.body;
    const expectedToken = process.env.ADMIN_SETUP_TOKEN;
    if (!expectedToken) {
      return res.status(403).json({
        success: false,
        message: 'Admin setup is not configured on this server.'
      });
    }
    if (!setupToken || setupToken !== expectedToken) {
      return res.status(403).json({
        success: false,
        message: 'Invalid setup token.'
      });
    }

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create admin user
    const admin = await prisma.backOfficeUser.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
        role: role || 'SUPER_ADMIN'
      }
    });

    return res.status(201).json({
      success: true,
      message: 'Admin user created successfully',
      data: {
        id: admin.id,
        email: admin.email,
        role: admin.role
      }
    });
  } catch (error: any) {
    console.error('Create admin error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Admin logout handler
 */
export const adminLogout = async (req: Request, res: Response) => {
  try {
    res.clearCookie('backoffice-token', { path: '/' });
    res.clearCookie('csrf-token', { path: '/' });

    return res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error: any) {
    console.error('Admin logout error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Get current admin profile
 */
export const getAdminProfile = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const adminId = (req as any).admin?.id;

    if (!adminId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const admin = await prisma.backOfficeUser.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true
      }
    });

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    return res.json({
      success: true,
      data: admin
    });
  } catch (error: any) {
    console.error('Get admin profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
