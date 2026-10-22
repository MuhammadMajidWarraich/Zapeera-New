import { Router, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getBranding } from '../controllers/branding.controller';
import { AuthRequest } from '../middleware/auth.middleware';
import { getPrisma } from '../utils/db.util';

const router = Router();

// ─── Branding (White-label Feature 3) ─────────────────────────────────
// GET /api/branding is PUBLIC (route-policy registry: kind 'public') —
// the login/register/join surfaces need partner branding before any
// session exists. Identity is OPTIONAL: when a valid tenant token is
// present, this soft-auth middleware attaches req.user so the
// controller can resolve the branding of the caller's current business
// and the partner-admin viewer flag. An absent/invalid token is NOT an
// error here — it just means "anonymous". (This mirrors the token
// sources of the strict `authenticate` middleware: Authorization header
// first, then the auth-token cookie.)
const optionalAuthenticate = async (req: AuthRequest, _res: Response, next: NextFunction) => {
  try {
    let token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      const cookies = (req.header('Cookie') || '').split(';').reduce<Record<string, string>>((acc, pair) => {
        const [key, ...rest] = pair.trim().split('=');
        if (key) acc[key.trim()] = rest.join('=').trim();
        return acc;
      }, {});
      token = cookies['auth-token'];
    }
    if (token && process.env.JWT_SECRET) {
      const decoded: any = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded?.userId || decoded?.id;
      if (userId) {
        const prisma = await getPrisma();
        const user = await prisma.zapeeraUser.findUnique({
          where: { id: userId },
          select: { id: true, username: true, email: true, name: true, isActive: true }
        });
        if (user && user.isActive) {
          req.user = {
            id: user.id,
            username: user.username,
            email: user.email,
            name: user.name,
            selectedCompanyId: decoded.selectedCompanyId,
            companyId: decoded.companyId
          } as AuthRequest['user'];
        }
      }
    }
  } catch {
    // Soft auth: any failure simply leaves the request anonymous.
  }
  next();
};

router.get('/', optionalAuthenticate, getBranding);

export default router;
