// CRITICAL: Import database initialization FIRST to ensure DATABASE_URL is set
// This prevents Prisma schema validation errors when PrismaClient is imported
import '../config/database.init';

import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { LoginData, CreateUserData } from '../models/user.model';
import { validate } from '../middleware/validation.middleware';
import { getPrisma } from '../utils/db.util';
import { getDatabaseService } from '../services/database.service';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
import { generateCSRFToken } from '../middleware/csrf.middleware';
import { isLocked, recordFailedAttempt, clearFailedAttempts } from '../utils/account-lockout.util';
import logger from '../utils/logger';
import Joi from 'joi';

// Generate unique session token
const generateSessionToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

const normalizeAppRole = (role: string | null | undefined): string => {
  const normalized = String(role || '').toUpperCase();
  if (normalized === 'ADMIN') return 'OWNER';
  if (normalized === 'PRODUCT_OWNER' || normalized === 'PHARMACIST') return 'USER';
  return normalized || 'USER';
};

// Validation schemas
const loginSchema = Joi.object({
  usernameOrEmail: Joi.string().required(),
  password: Joi.string().required()
});

const registerSchema = Joi.object({
  username: Joi.string().min(3).max(30).required(),
  email: Joi.string().email().required(),
  password: Joi.string()
    .min(8)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).*$/)
    .required()
    .messages({
      'string.min': 'Password must be at least 8 characters long',
      'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
    }),
  name: Joi.string().required(),
  branchId: Joi.string().allow('', null).optional(),
  branchData: Joi.object({
    name: Joi.string().required(),
    address: Joi.string().required(),
    phone: Joi.string().required()
  }).optional()
});

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { error } = loginSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
      return;
    }

    const { usernameOrEmail, password }: { usernameOrEmail: string; password: string } = req.body;

    // Account lockout check
    if (isLocked(usernameOrEmail)) {
      res.status(429).json({
        success: false,
        message: 'Account temporarily locked due to too many failed login attempts. Please try again later.',
        error: 'ACCOUNT_LOCKED'
      });
      return;
    }

    // Get database client (works with SQLite or PostgreSQL)
    let prisma;
    try {
      prisma = await getPrisma();
    } catch (dbError: any) {
      console.error('❌ Database connection error:', dbError.message);
      console.error('❌ Database error details:', {
        message: dbError.message,
        code: dbError.code,
        stack: dbError.stack?.substring(0, 500)
      });
      
      // Provide helpful error message based on error type
      let errorMessage = 'Database connection failed. Please check if the database is running.';
      if (dbError.message?.includes('P1001') || dbError.message?.includes('Can\'t reach database')) {
        errorMessage = 'Cannot connect to database server. Please check your database connection settings.';
      } else if (dbError.message?.includes('P2021') || dbError.message?.includes('does not exist')) {
        errorMessage = 'Database table does not exist. Please run database migrations.';
      } else if (dbError.message?.includes('authentication') || dbError.message?.includes('password')) {
        errorMessage = 'Database authentication failed. Please check your database credentials.';
      } else if (dbError.message?.includes('connection pool') || dbError.message?.includes('connection slots')) {
        errorMessage = 'Database connection pool exhausted. Please try again in a moment.';
      }
      
      res.status(500).json({
        success: false,
        message: errorMessage,
        error: process.env.NODE_ENV === 'development' ? dbError.message : undefined
      });
      return;
    }

    // CRITICAL FIX: Normalize username/email to lowercase for case-insensitive search
    const normalizedInput = usernameOrEmail.toLowerCase().trim();
    const originalInput = usernameOrEmail.trim();

    // CRITICAL FIX: For SQLite, use raw query with LOWER() for case-insensitive search
    // For PostgreSQL, Prisma's OR works fine
    const isSQLite = process.env.DATABASE_URL?.startsWith('file:');
    
    let user: any;
    if (isSQLite) {
      // SQLite: Use raw query with LOWER() for case-insensitive search
      // Use Prisma.$queryRawUnsafe for dynamic values
      // CRITICAL FIX: Also try original input (in case user types exact case)
      const users = await prisma.$queryRawUnsafe<Array<{
        id: string;
        username: string;
        email: string;
        password: string;
        name: string;
        role: string;
        branchId: string | null;
        companyId: string | null;
        isActive: number; // SQLite stores boolean as integer (0 or 1)
        businessAccessGranted?: number;
        sessionToken: string | null;
        lastLoginAt: string | null;
        createdAt: string;
        updatedAt: string;
      }>>(
        `SELECT * FROM zapeera_users 
         WHERE LOWER(username) = LOWER(?) 
            OR LOWER(email) = LOWER(?)
            OR username = ?
            OR email = ?
         LIMIT 1`,
        normalizedInput,
        normalizedInput,
        originalInput,
        originalInput
      );
      
      console.log('🔍 SQLite query result:', users?.length || 0, 'users found');
      if (users && users.length > 0) {
        console.log('✅ User found in SQLite:', users[0].username, users[0].email);
      }
      
      if (users && users.length > 0) {
        const rawUser = users[0];
        // Convert SQLite integer boolean to boolean
        const isActiveValue = typeof rawUser.isActive === 'number' 
          ? rawUser.isActive === 1 
          : Boolean(rawUser.isActive);
        const businessAccessGrantedValue = typeof rawUser.businessAccessGranted === 'number'
          ? rawUser.businessAccessGranted === 1
          : rawUser.businessAccessGranted === undefined
            ? true
            : Boolean(rawUser.businessAccessGranted);
        
        user = {
          ...rawUser,
          isActive: isActiveValue,
          businessAccessGranted: businessAccessGrantedValue,
          createdAt: new Date(rawUser.createdAt),
          updatedAt: new Date(rawUser.updatedAt),
          lastLoginAt: rawUser.lastLoginAt ? new Date(rawUser.lastLoginAt) : null,
          branch: null as any // Will be set below
        } as any;
        
        // Fetch branch separately for SQLite
        if (user.branchId) {
          const branch = await prisma.branch.findUnique({
            where: { id: user.branchId },
            select: { id: true, name: true, phone: true }
          });
          user.branch = branch;
        } else {
          user.branch = null;
        }
      }
    } else {
      // PostgreSQL: Use Prisma's OR query
      // Note: mode: 'insensitive' is only available in PostgreSQL, but Prisma StringFilter doesn't support it directly
      // Use LOWER() in raw query or just use equals (PostgreSQL is case-sensitive by default)
      user = await prisma.zapeeraUser.findFirst({
        where: {
          OR: [
            { username: { equals: normalizedInput } },
            { email: { equals: normalizedInput } },
            { username: originalInput },
            { email: originalInput }
          ]
        },
        include: {
        }
      });
    }

    // CRITICAL FIX: If user not found in SQLite, check PostgreSQL and sync
    if (!user && isSQLite) {
      console.log('⚠️ User not found in SQLite, checking PostgreSQL...');
      console.log('🔍 Searching for:', normalizedInput, 'or', originalInput);
      try {
        const dbService = getDatabaseService();
        const pgClient = await dbService.getRawPostgreSQLClient();
        
        if (pgClient) {
          // Query PostgreSQL for user - try both normalized and original input
          const pgResult = await pgClient.query(
            `SELECT * FROM zapeera_users 
             WHERE LOWER(username) = LOWER($1) 
                OR LOWER(email) = LOWER($1)
                OR username = $2
                OR email = $2
             LIMIT 1`,
            [normalizedInput, originalInput]
          );
          
          console.log('🔍 PostgreSQL query result:', pgResult.rows?.length || 0, 'users found');
          
          if (pgResult.rows && pgResult.rows.length > 0) {
            const pgUser = pgResult.rows[0];
            console.log('✅ User found in PostgreSQL:', pgUser.username, pgUser.email, 'isActive:', pgUser.isActive);
            console.log('🔄 Syncing user to SQLite...');
            
            // Sync user from PostgreSQL to SQLite
            const sqlitePrisma = await getPrisma();
            const syncedUser = await sqlitePrisma.zapeeraUser.upsert({
              where: { id: pgUser.id },
              update: {
                username: pgUser.username,
                email: pgUser.email,
                password: pgUser.password, // CRITICAL: Keep PostgreSQL password hash
                name: pgUser.name,
                branchId: pgUser.branchId,
                companyId: pgUser.companyId,
                isActive: pgUser.isActive,
                businessAccessGranted: pgUser.businessAccessGranted ?? true,
                emailVerified: pgUser.emailVerified ?? false,
                emailVerificationToken: pgUser.emailVerificationToken,
                emailVerificationExpires: pgUser.emailVerificationExpires ? new Date(pgUser.emailVerificationExpires) : null,
                welcomeEmailSent: pgUser.welcomeEmailSent ?? false,
                createdBy: pgUser.createdBy,
                lastLoginAt: pgUser.lastLoginAt ? new Date(pgUser.lastLoginAt) : null,
                updatedAt: new Date()
              } as any,
              create: {
                id: pgUser.id,
                username: pgUser.username,
                email: pgUser.email,
                password: pgUser.password, // CRITICAL: Keep PostgreSQL password hash
                name: pgUser.name,
                branchId: pgUser.branchId,
                companyId: pgUser.companyId,
                isActive: pgUser.isActive,
                businessAccessGranted: pgUser.businessAccessGranted ?? true,
                emailVerified: pgUser.emailVerified ?? false,
                emailVerificationToken: pgUser.emailVerificationToken,
                emailVerificationExpires: pgUser.emailVerificationExpires ? new Date(pgUser.emailVerificationExpires) : null,
                welcomeEmailSent: pgUser.welcomeEmailSent ?? false,
                createdBy: pgUser.createdBy,
                lastLoginAt: pgUser.lastLoginAt ? new Date(pgUser.lastLoginAt) : null,
                createdAt: pgUser.createdAt ? new Date(pgUser.createdAt) : new Date(),
                updatedAt: new Date()
              } as any
            });
            
            // Fetch branch for the user
            let branchData = null;
            // branchData = await sqlitePrisma.branch.findUnique({
            //   where: { id: syncedUser.branchId },
            //   select: { id: true, name: true, phone: true }
            // });
            
            branchData = null;
            
            user = {
              ...syncedUser,
              branch: branchData
            } as any;
            console.log('✅ User synced from PostgreSQL to SQLite successfully');
          } else {
            console.log('❌ User not found in PostgreSQL either');
          }
          
          await pgClient.end();
        } else {
          console.log('⚠️ PostgreSQL client not available');
        }
      } catch (pgError: any) {
        console.error('⚠️ Error checking PostgreSQL for user:', pgError.message);
        console.error('⚠️ Error stack:', pgError.stack);
        // Continue - don't block login if PostgreSQL check fails
      }
    }

    if (!user) {
      console.log('❌ User not found for username/email:', usernameOrEmail);
      res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
      return;
    }

    // Check if user account is active
    // ALL users MUST be activated before they can login
    // This applies to both online (PostgreSQL) and offline (SQLite) modes
    if (!user.isActive) {
      res.status(403).json({
        success: false,
        message: 'Your account is not activated yet. Please contact the administrator to activate your account.',
        accountDisabled: true,
        pendingActivation: true,
        userId: user.id
      });
      return;
    }

    // Check if email is verified (NEW: required verification before login)
    const isEmailVerified = (user as any).emailVerified === true || (user as any).emailVerified === 1;
    if (!isEmailVerified) {
      res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in. Check your inbox for the verification link, or request a new one.',
        emailNotVerified: true,
        pendingActivation: true,
        userId: user.id
      });
      return;
    }

    // Check password
    const trimmedPassword = password.trim();

    // Check if password is already hashed (shouldn't be, but check anyway)
    if (!user.password || user.password.length < 10) {
      res.status(500).json({
        success: false,
        message: 'Database error: Invalid password format. Please contact administrator.'
      });
      return;
    }

    const isPasswordValid = await bcrypt.compare(trimmedPassword, user.password);

    if (!isPasswordValid) {
      recordFailedAttempt(usernameOrEmail);
      res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
      return;
    }

    // Password correct — reset lockout counter
    clearFailedAttempts(usernameOrEmail);

    // Generate unique session token for single-session enforcement
    const sessionToken = generateSessionToken();

    // Update user with new session token (invalidates any previous sessions)
    await prisma.zapeeraUser.update({
      where: { id: user.id },
      data: {
        sessionToken,
        lastLoginAt: new Date()
      }
    });

    // Note: concurrent session enforcement is handled per-business via Settings-based tracking in auth middleware.

    const activeMemberships = await prisma.membership.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      include: {
        business: { select: { name: true, createdBy: true } },
        role: { select: { name: true } },
        branches: { select: { branchId: true } }
      }
    });

    const membershipList = activeMemberships.map((m) => {
      const fallbackRoleName =
        m.business?.createdBy && String(m.business.createdBy) === String(user.id)
          ? 'OWNER'
          : null;

      return {
        id: m.id,
        businessId: m.businessId,
        businessName: m.business?.name || 'Unknown Business',
        roleId: m.roleId,
        roleName: m.role?.name || fallbackRoleName,
        branchIds: Array.isArray(m.branches) ? m.branches.map((b) => b.branchId) : [],
        status: m.status
      };
    });

    // Find membership for currently selected company (if any)
    const selectedCompanyId = req.headers['x-company-id'] as string;
    const currentMembership = selectedCompanyId 
      ? membershipList.find(m => m.businessId === selectedCompanyId)
      : membershipList[0]; // Default to first membership if none selected

    const membershipRole = currentMembership?.roleName ? String(currentMembership.roleName).toUpperCase() : null;
    const effectiveRole = membershipRole || 'USER';

    // Generate JWT token with session token included
    if (!process.env.JWT_SECRET) {
      console.error('❌ JWT_SECRET is not defined in environment variables');
      throw new Error('JWT_SECRET is not defined. Please set JWT_SECRET in your .env file or environment variables.');
    }

    const tokenPayload: any = {
      userId: user.id,
      username: user.username,
      branchId: user.branchId,
      createdBy: user.createdBy,
      sessionToken // Include session token in JWT for validation
    };
    const token = (jwt.sign as any)(
      tokenPayload,
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    console.log('✅ Login successful for user:', usernameOrEmail);

    // Generate CSRF token
    const csrfToken = generateCSRFToken();

    // Set JWT token in httpOnly cookie for enhanced security
    res.cookie('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/'
    });

    // Set CSRF token in cookie (accessible to frontend)
    res.cookie('csrf-token', csrfToken, {
      httpOnly: false, // Client needs to read this
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 1000, // 1 hour
      path: '/'
    });

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          isActive: user.isActive,
          email: user.email,
          role: effectiveRole, // Backward compatibility
          membership: currentMembership || null, // Nests for frontend expectation
          memberships: membershipList // Nests for frontend expectation
        },
        accessToken: token
      }
    });
  } catch (error: any) {
    console.error('❌ Login error:', error);
    console.error('❌ Login error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      meta: error.meta
    });

    // Provide more specific error messages
    let errorMessage = 'Internal server error';
    if (error.message?.includes('connect')) {
      errorMessage = 'Database connection failed. Please check if the database is running.';
    } else if (error.message?.includes('Prisma')) {
      errorMessage = 'Database error. Please check database configuration.';
    } else if (error.message) {
      errorMessage = error.message;
    }

    res.status(500).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { error } = registerSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
      return;
    }

    const { username, email, password, name } = req.body;

    // Get database client (works with SQLite or PostgreSQL)
    const prisma = await getPrisma();

    // Check if username already exists
    const existingUsername = await prisma.zapeeraUser.findUnique({
      where: { username }
    });

    if (existingUsername) {
      res.status(400).json({
        success: false,
        message: 'Username already exists',
        field: 'username'
      });
      return;
    }

    // Check if email already exists
    const existingEmail = await prisma.zapeeraUser.findUnique({
      where: { email }
    });

    if (existingEmail) {
      res.status(400).json({
        success: false,
        message: 'Email already exists',
        field: 'email'
      });
      return;
    }

let user: any;

// Hash password
const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'));

// Generate email verification token (24h expiry)
const verificationToken = crypto.randomBytes(32).toString('hex');
const verificationExpires = new Date();
verificationExpires.setHours(verificationExpires.getHours() + 24);

// Default user registration: neutral USER account with no branch/company assignment yet.
// emailVerified defaults to false in schema - user must verify before login.
user = await prisma.zapeeraUser.create({
  data: {
    username,
    email,
    password: hashedPassword,
    name,
    isActive: true,
    emailVerified: false,
    emailVerificationToken: verificationToken,
    emailVerificationExpires: verificationExpires,
    createdBy: null
  } as any
});

console.log('✅ Account created successfully:', username);
console.log('📧 Verification token generated for:', email);

// 🔄 IMMEDIATE BIDIRECTIONAL SYNC
syncAfterOperation('user', 'create', user).catch(err => {
  console.error('[Sync] User registration sync failed:', err.message);
});

// Send verification email asynchronously (don't block response)
(async () => {
  try {
    const { emailService } = await import('../services/email.service');
    const emailSent = await emailService.sendVerificationEmail(email, name, verificationToken);
    if (emailSent) {
      console.log(`✅ Verification email sent to ${email}`);
    } else {
      console.error(`❌ Failed to send verification email to ${email}`);
    }
  } catch (emailErr: any) {
    console.error('❌ Error sending verification email:', emailErr.message);
  }
})();

    res.status(201).json({
      success: true,
      pendingActivation: true,
      message: 'Account created successfully! Please check your email to verify your account before logging in.',
      data: {
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          role: 'USER',
          isActive: true,
          email: user.email,
          membership: null
        }
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : 'Unknown'
    });
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : 'Unknown error') : undefined
    });
  }
};

export const getProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id;

    // Get database client (works with SQLite or PostgreSQL)
    const prisma = await getPrisma();

    const user = await prisma.zapeeraUser.findUnique({
      where: { id: userId }
    });

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    const activeMemberships = await prisma.membership.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      include: {
        business: { select: { name: true, createdBy: true } },
        role: { select: { name: true } },
        branches: { select: { branchId: true } }
      }
    });

    const membershipList = activeMemberships.map((m) => {
      const fallbackRoleName =
        m.business?.createdBy && String(m.business.createdBy) === String(user.id)
          ? 'OWNER'
          : null;

      return {
        id: m.id,
        businessId: m.businessId,
        businessName: m.business?.name || 'Unknown Business',
        roleId: m.roleId,
        roleName: m.role?.name || fallbackRoleName,
        branchIds: Array.isArray(m.branches) ? m.branches.map((b) => b.branchId) : [],
        status: m.status,
      };
    });

    const selectedCompanyId = req.headers['x-company-id'] as string | undefined;
    const currentMembership = selectedCompanyId
      ? membershipList.find((m) => String(m.businessId) === String(selectedCompanyId))
      : membershipList[0];

    const membershipRole = currentMembership?.roleName ? String(currentMembership.roleName).toUpperCase() : null;
    const effectiveRole = membershipRole || 'USER';

    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        isActive: user.isActive,
        role: effectiveRole,
        membership: currentMembership || null,
        memberships: membershipList
      }
    });
  } catch (error: any) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Change password schema
const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(6).required()
});

export const changePassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { error } = changePasswordSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
      return;
    }

    const userId = (req as any).user.id;
    const { currentPassword, newPassword } = req.body;

    // Get database client (works with SQLite or PostgreSQL)
    const prisma = await getPrisma();

    // Get user with current password
    const user = await prisma.zapeeraUser.findUnique({
      where: { id: userId }
    });

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
      return;
    }

    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS || '12'));

    // Update password
    await prisma.zapeeraUser.update({
      where: { id: userId },
      data: { password: hashedNewPassword }
    });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update profile schema
const updateProfileSchema = Joi.object({
  name: Joi.string().optional(),
  email: Joi.string().email().optional(),
  profileImage: Joi.string().uri().optional()
});

export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const { error } = updateProfileSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
      return;
    }

    const userId = (req as any).user.id;
    const { name, email, profileImage } = req.body;

    // Get database client (works with SQLite or PostgreSQL)
    const prisma = await getPrisma();

    // Check if email is already taken by another user
    if (email) {
      const existingUser = await prisma.zapeeraUser.findFirst({
        where: {
          email,
          id: { not: userId }
        }
      });

      if (existingUser) {
        res.status(400).json({
          success: false,
          message: 'Email is already taken by another user'
        });
        return;
      }
    }

    // Update user profile
    const updatedUser = await prisma.zapeeraUser.update({
      where: { id: userId },
      data: {
        ...(name && { name }),
        ...(email && { email }),
        ...(profileImage !== undefined && { profileImage })
      }
    });

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('user', 'update', updatedUser).catch(err => {
      console.error('[Sync] Profile update sync failed:', err.message);
    });

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        username: updatedUser.username,
        profileImage: updatedUser.profileImage,
        role: normalizeAppRole((req as any)?.membership?.role_name || 'USER')
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Forgot Password - Request password reset
 * Generates reset token and sends email with reset link
 */
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, username } = req.body;

    // Accept either email or username (for consistency with login)
    const identifier = email || username;

    if (!identifier) {
      res.status(400).json({
        success: false,
        message: 'Email or username is required'
      });
      return;
    }

    // Get database client
    const prisma = await getPrisma();

    // Normalize input to lowercase for case-insensitive search
    const normalizedInput = identifier.toLowerCase().trim();

    // Check if user exists by email OR username (same logic as login)
    const user = await prisma.zapeeraUser.findFirst({
      where: {
        OR: [
          { email: normalizedInput },
          { username: normalizedInput },
          // Also try original case (in case user exists with different case)
          { email: identifier.trim() },
          { username: identifier.trim() }
        ]
      }
    });

    // Always return success to prevent email enumeration attacks
    // Don't reveal if email/username exists or not
    const successMessage = 'If an account with that email or username exists, you will receive a password reset link shortly.';

    if (!user) {
      console.log(`🔐 Forgot password request for unknown email/username: ${identifier}`);
      // Return success even if user doesn't exist (security best practice)
      res.json({
        success: true,
        message: successMessage
      });
      return;
    }

    // Ensure user has an email (required for sending reset link)
    if (!user.email) {
      console.error(`❌ User found but has no email: ${user.id}`);
      // Still return success to prevent enumeration
      res.json({
        success: true,
        message: successMessage
      });
      return;
    }

    // Generate reset token (cryptographically secure random string)
    const crypto = require('crypto');
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date();
    resetExpires.setHours(resetExpires.getHours() + 1); // Token expires in 1 hour

    // Save reset token to database
    await prisma.zapeeraUser.update({
      where: { id: user.id },
      data: {
        passwordResetToken: resetToken,
        passwordResetExpires: resetExpires
      }
    });

    // Construct reset URL
    // For local development, use localhost, otherwise use production URL
    const isDevelopment = process.env.NODE_ENV !== 'production';
    let frontendUrl = process.env.FRONTEND_URL || (isDevelopment
      ? 'http://localhost:4100'
      : 'https://app.zapeera.com');

    // Remove trailing slash if present
    frontendUrl = frontendUrl.replace(/\/$/, '');

    // BrowserRouter format (pretty URL without hash)
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    console.log(`[Auth] Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`[Auth] FRONTEND_URL from env: ${process.env.FRONTEND_URL || 'Not set'}`);
    console.log(`[Auth] Frontend URL (final): ${frontendUrl}`);
    console.log(`[Auth] Full reset URL: ${resetUrl}`);

    // Send password reset email
    console.log(`[Auth] Attempting to send password reset email to: ${user.email}`);
    console.log(`[Auth] Reset token generated: ${resetToken.substring(0, 10)}...`);
    console.log(`[Auth] Reset URL: ${resetUrl}`);

    try {
      const { emailService } = await import('../services/email.service');
      console.log(`[Auth] Calling email service to send password reset email...`);
      console.log(`[Auth] User email: ${user.email}`);
      console.log(`[Auth] Reset URL: ${resetUrl}`);

      const emailSent = await emailService.sendPasswordResetEmail(
        user.email,
        user.name,
        resetToken,
        resetUrl
      );

      if (emailSent) {
        console.log(`✅ Password reset email sent successfully to: ${user.email} (ID: ${user.id})`);
      } else {
        console.error(`❌ Failed to send password reset email to: ${user.email}`);
        console.error(`❌ Check email service logs above for details`);
        console.error(`❌ Production troubleshooting:`);
        console.error(`   1. Verify SMTP environment variables are set in production`);
        console.error(`   2. Check production server logs for SMTP connection errors`);
        console.error(`   3. Verify Gmail App Password is correct`);
        console.error(`   4. Check if production firewall allows port 587`);
        // Still return success to prevent email enumeration
      }
    } catch (emailError: any) {
      console.error(`❌ Exception while sending password reset email:`, emailError.message);
      console.error(`❌ Error type:`, emailError.constructor.name);
      if (emailError.stack) {
        console.error(`❌ Stack:`, emailError.stack);
      }
      // Still return success to prevent email enumeration
    }

    res.json({
      success: true,
      message: successMessage
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    // Always return success to prevent email enumeration
    res.json({
      success: true,
      message: 'If an account with that email exists, you will receive a password reset link shortly.'
    });
  }
};

/**
 * Verify Reset Token - Check if reset token is valid
 * Public endpoint (no authentication required)
 */
export const verifyResetToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Reset token is required'
      });
      return;
    }

    // Get database client
    const prisma = await getPrisma();

    // Find user with this reset token
    const user = await prisma.zapeeraUser.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpires: {
          gt: new Date() // Token must not be expired
        }
      },
      select: {
        id: true,
        email: true,
        name: true
      }
    });

    if (!user) {
      res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
      return;
    }

    res.json({
      success: true,
      message: 'Reset token is valid',
      data: {
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    console.error('Verify reset token error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Reset Password with Token - Public endpoint to reset password using token from email
 * No authentication required (token serves as authentication)
 */
export const resetPasswordWithToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      res.status(400).json({
        success: false,
        message: 'Reset token and new password are required'
      });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
      return;
    }

    // Get database client
    const prisma = await getPrisma();

    // Find user with this reset token
    const user = await prisma.zapeeraUser.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpires: {
          gt: new Date() // Token must not be expired
        }
      }
    });

    if (!user) {
      res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
      return;
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS || '12'));

    // Update password and clear reset token
    await prisma.zapeeraUser.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
        sessionToken: null // Clear session to force re-login
      }
    });

    console.log(`🔐 Password reset completed for user: ${user.email} (ID: ${user.id})`);

    res.json({
      success: true,
      message: 'Password has been reset successfully. You can now login with your new password.'
    });
  } catch (error) {
    console.error('Reset password with token error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Reset password: Admin or business owner.
 */
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, newPassword } = req.body;
    const requestingUser = (req as any).user;

    const r = String(requestingUser?.role || '').toUpperCase();
    if (!requestingUser || (r !== 'OWNER' && r !== 'ADMIN')) {
      res.status(403).json({
        success: false,
        message: 'Only Admin or business owner can reset passwords'
      });
      return;
    }

    if (!userId || !newPassword) {
      res.status(400).json({
        success: false,
        message: 'User ID and new password are required'
      });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
      return;
    }

    // Get database client
    const prisma = await getPrisma();

    // Check if target user exists
    const targetUser = await prisma.zapeeraUser.findUnique({
      where: { id: userId }
    });

    if (!targetUser) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS || '12'));

    // Update password and clear session token to force re-login
    await prisma.zapeeraUser.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        sessionToken: null // Clear session to force re-login
      }
    });

    console.log(`🔐 Password reset for user: ${targetUser.email} by ${requestingUser.username}`);

    res.json({
      success: true,
      message: `Password has been reset for ${targetUser.name || targetUser.email}`
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Check account status - used by frontend for periodic status checks
 * Returns whether the account is still active
 * If deactivated, frontend should force logout
 */
export const checkAccountStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        isActive: false,
        message: 'User not authenticated',
        shouldLogout: true
      });
      return;
    }

    // Get database client
    const prisma = await getPrisma();

    // Check user status from database
    const user = await prisma.zapeeraUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isActive: true,
        sessionToken: true,
        username: true
      }
    });

    if (!user) {
      res.status(404).json({
        success: false,
        isActive: false,
        message: 'User not found',
        shouldLogout: true
      });
      return;
    }

    // Check if account is active
    // NOTE: Single-session enforcement is disabled so that desktop and web
    // sessions can coexist. Logging in on the desktop no longer invalidates
    // the active web session.

    // If account is deactivated
    if (!user.isActive) {
      console.log(`❌ Account deactivated for user: ${user.username}`);
      res.status(403).json({
        success: false,
        isActive: false,
        message: 'Your account has been deactivated. Please contact the administrator to reactivate.',
        shouldLogout: true,
        accountDeactivated: true
      });
      return;
    }

    // Account is active
    res.json({
      success: true,
      isActive: true,
      message: 'Account is active',
      shouldLogout: false
    });
  } catch (error) {
    console.error('Check account status error:', error);
    // On error, don't force logout - could be temporary issue
    res.status(500).json({
      success: false,
      isActive: true,
      message: 'Could not verify account status',
      shouldLogout: false
    });
  }
};

/**
 * Verify Email - Confirm email address using verification token
 * Public endpoint (no authentication required)
 */
export const verifyEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Verification token is required'
      });
      return;
    }

    const prisma = await getPrisma();

    // Find user with this verification token
    const user = await prisma.zapeeraUser.findFirst({
      where: {
        emailVerificationToken: token,
        emailVerificationExpires: { gt: new Date() }
      }
    });

    if (!user) {
      res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token. Please request a new verification email.',
        expired: true
      });
      return;
    }

    // Mark email as verified and clear token
    await prisma.zapeeraUser.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null
      } as any
    });

    console.log(`✅ Email verified for user: ${user.email} (ID: ${user.id})`);

    // Send welcome email asynchronously (fire-and-forget)
    if (!user.welcomeEmailSent) {
      (async () => {
        try {
          const { emailService } = await import('../services/email.service');
          const sent = await emailService.sendWelcomeEmail(user.email, user.name);
          if (sent) {
            await prisma.zapeeraUser.update({
              where: { id: user.id },
              data: { welcomeEmailSent: true } as any
            });
            console.log(`✅ Welcome email sent to ${user.email}`);
          }
        } catch (err: any) {
          console.error('❌ Failed to send welcome email:', err.message);
        }
      })();
    }

    res.json({
      success: true,
      message: 'Your email has been verified successfully! You can now log in.',
      data: { email: user.email }
    });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Resend Verification Email - Send a new verification link
 * Public endpoint (no authentication required)
 */
export const resendVerificationEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({
        success: false,
        message: 'Email is required'
      });
      return;
    }

    const prisma = await getPrisma();
    const normalizedEmail = email.toLowerCase().trim();

    const user = await prisma.zapeeraUser.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          { email: email.trim() }
        ]
      }
    });

    // Always return success to prevent email enumeration
    const successMessage = 'If an account with that email exists and is not verified, a new verification link has been sent.';

    if (!user) {
      res.json({ success: true, message: successMessage });
      return;
    }

    // If already verified, no need to resend
    if ((user as any).emailVerified) {
      res.json({ success: true, message: successMessage });
      return;
    }

    // Generate new token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date();
    verificationExpires.setHours(verificationExpires.getHours() + 24);

    await prisma.zapeeraUser.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: verificationToken,
        emailVerificationExpires: verificationExpires
      } as any
    });

    // Send verification email
    try {
      const { emailService } = await import('../services/email.service');
      await emailService.sendVerificationEmail(user.email, user.name, verificationToken);
      console.log(`📧 Verification email resent to ${user.email}`);
    } catch (emailErr: any) {
      console.error('❌ Failed to resend verification email:', emailErr.message);
    }

    res.json({ success: true, message: successMessage });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;

    // Clear session token to invalidate the session server-side
    if (userId) {
      try {
        const prisma = await getPrisma();
        await prisma.zapeeraUser.update({
          where: { id: userId },
          data: { sessionToken: null }
        });
      } catch (dbError: any) {
        console.error('⚠️ Failed to clear session token:', dbError.message);
      }
    }

    // Clear auth cookies
    res.clearCookie('auth-token', { path: '/' });
    res.clearCookie('csrf-token', { path: '/' });

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
