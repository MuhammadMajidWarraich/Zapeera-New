import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';

// Rate limiting configuration
interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  message?: string;
}

// Store for tracking requests (in production, use Redis)
const requestTracker = new Map<string, { count: number; resetTime: number }>();

// Clean up expired entries periodically
const cleanupInterval = 60 * 1000; // Every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of requestTracker.entries()) {
    if (data.resetTime < now) {
      requestTracker.delete(key);
    }
  }
}, cleanupInterval);

/**
 * Create a rate limiting middleware
 */
export const createRateLimiter = (config: RateLimitConfig) => {
  return (req: Request | AuthRequest, res: Response, next: NextFunction) => {
    // Skip rate limiting if bypass is enabled (for development/testing only)
    const bypassRateLimit = process.env.NODE_ENV === 'development' && String(process.env.RATE_LIMIT_BYPASS || '').toLowerCase() === 'true';
    if (bypassRateLimit) {
      return next();
    }

    // Get identifier for the request (IP address or user ID)
    const identifier = req.ip || req.headers['x-forwarded-for'] as string || (req as AuthRequest).user?.id || 'unknown';

    // Get current time
    const now = Date.now();

    // Get or create tracker for this identifier
    let tracker = requestTracker.get(identifier);

    if (!tracker || tracker.resetTime < now) {
      // Create new tracker
      tracker = {
        count: 1,
        resetTime: now + config.windowMs
      };
      requestTracker.set(identifier, tracker);
    } else {
      // Increment counter
      tracker.count++;
      requestTracker.set(identifier, tracker);
    }

    // Check if limit exceeded
    if (tracker.count > config.maxRequests) {
      const retryAfter = Math.ceil((tracker.resetTime - now) / 1000);
      
      res.set('Retry-After', retryAfter.toString());
      res.status(429).json({
        success: false,
        message: config.message || 'Too many requests, please try again later.',
        retryAfter,
        limit: config.maxRequests,
        windowMs: config.windowMs
      });
      return;
    }

    // Add rate limit headers
    res.set('X-RateLimit-Limit', config.maxRequests.toString());
    res.set('X-RateLimit-Remaining', (config.maxRequests - tracker.count).toString());
    res.set('X-RateLimit-Reset', new Date(tracker.resetTime).toISOString());

    next();
  };
};

/**
 * Pre-configured rate limiters for different endpoints
 */

// Strict rate limiter for authentication endpoints (10 requests per 15 minutes)
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10,
  message: 'Too many authentication attempts. Please wait before trying again.'
});

// Moderate rate limiter for API endpoints (100 requests per minute)
export const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100,
  message: 'Too many requests. Please slow down.'
});

// Lenient rate limiter for public endpoints (1000 requests per hour)
export const publicRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 1000,
  message: 'Too many requests. Please try again later.'
});
