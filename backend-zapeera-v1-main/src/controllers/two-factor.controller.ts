/**
 * Two-factor authentication endpoints (real TOTP 2FA, built 2026-10-24).
 *
 * Enrollment model:
 *  - POST /auth/2fa/setup    — password re-confirm; stores a PENDING secret
 *                              (twoFactorSecret set, twoFactorEnabled=false)
 *                              and returns { secret, otpauthUri } for QR /
 *                              manual entry. Nothing is enforced yet.
 *  - POST /auth/2fa/enable   — proves possession with a TOTP code; only
 *                              then twoFactorEnabled=true and 10 single-use
 *                              recovery codes are issued (plaintext once,
 *                              SHA-256 hashes stored).
 *  - POST /auth/2fa/disable  — requires a current TOTP or a recovery code
 *                              (accounts in the legacy flag-only state —
 *                              enabled with NO secret — may instead confirm
 *                              with their password: no second factor exists
 *                              to protect, and they must have a way out).
 *  - POST /auth/2fa/recovery-codes/regenerate — requires a valid TOTP;
 *                              invalidates the old set, returns a new one.
 *  - POST /auth/login/2fa    — completes a challenged login with a TOTP
 *                              code or a recovery code (consumed on use).
 *
 * LOCKOUT SAFETY: login enforcement requires enabled=true AND a stored
 * secret (see the gate in auth.controller login). Legacy accounts that
 * flipped the old fake toggle have the flag but no secret and are never
 * challenged.
 */
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import Joi from 'joi';
import { getPrisma } from '../utils/db.util';
import { issueLoginSession } from './auth.controller';
import {
  generateTotpSecret,
  buildOtpauthUri,
  verifyTotpCode,
  generateRecoveryCodeSet,
  parseRecoveryHashes,
  hashRecoveryCode,
  verifyChallengeToken,
  recordChallengeFailure,
  consumeChallenge,
} from '../utils/two-factor.util';

const loadUser = async (prisma: any, userId: string) =>
  prisma.zapeeraUser.findUnique({ where: { id: userId } });

/** Constant-shape generic failure for the login challenge — never leak which part failed. */
const genericChallengeFailure = (res: Response): void => {
  res.status(401).json({
    success: false,
    message: 'Invalid or expired verification. Please sign in again.',
    error: 'TWO_FACTOR_FAILED'
  });
};

// ---------------------------------------------------------------------------
// POST /api/auth/2fa/setup  (authenticated)
// ---------------------------------------------------------------------------
const setupSchema = Joi.object({
  password: Joi.string().required()
});

export const setupTwoFactor = async (req: Request, res: Response): Promise<void> => {
  try {
    const { error } = setupSchema.validate(req.body);
    if (error) {
      res.status(400).json({ success: false, message: 'Password is required to set up two-factor authentication' });
      return;
    }
    const userId = (req as any).user.id;
    const prisma = await getPrisma();
    const user = await loadUser(prisma, userId);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    if (user.twoFactorEnabled && user.twoFactorSecret) {
      res.status(400).json({
        success: false,
        message: 'Two-factor authentication is already enabled. Disable it first if you want to set it up again.'
      });
      return;
    }

    const passwordOk = await bcrypt.compare(String(req.body.password), user.password);
    if (!passwordOk) {
      res.status(401).json({ success: false, message: 'Password is incorrect' });
      return;
    }

    // Store the secret as PENDING: enrollment becomes enforceable only
    // after /2fa/enable proves the user can produce codes from it. For a
    // legacy flag-only account this also clears the stale flag, so the
    // account is never half-armed.
    const secret = generateTotpSecret();
    await prisma.zapeeraUser.update({
      where: { id: userId },
      data: { twoFactorSecret: secret, twoFactorEnabled: false, twoFactorRecoveryCodes: null }
    });

    res.json({
      success: true,
      data: {
        secret,
        otpauthUri: buildOtpauthUri(user.email || user.username, secret)
      }
    });
  } catch (error: any) {
    console.error('2FA setup error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/auth/2fa/enable  (authenticated)
// ---------------------------------------------------------------------------
const enableSchema = Joi.object({
  code: Joi.string().trim().required()
});

export const enableTwoFactor = async (req: Request, res: Response): Promise<void> => {
  try {
    const { error } = enableSchema.validate(req.body);
    if (error) {
      res.status(400).json({ success: false, message: 'A 6-digit code from your authenticator app is required' });
      return;
    }
    const userId = (req as any).user.id;
    const prisma = await getPrisma();
    const user = await loadUser(prisma, userId);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      res.status(400).json({ success: false, message: 'Two-factor authentication is already enabled' });
      return;
    }
    if (!user.twoFactorSecret) {
      res.status(400).json({ success: false, message: 'Start setup first so a secret can be issued' });
      return;
    }
    if (!verifyTotpCode(user.twoFactorSecret, req.body.code)) {
      res.status(400).json({ success: false, message: 'That code does not match. Check your authenticator app and try again.' });
      return;
    }

    const { plainCodes, hashes } = generateRecoveryCodeSet();
    await prisma.zapeeraUser.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorRecoveryCodes: JSON.stringify(hashes)
      }
    });

    // Plaintext recovery codes are returned exactly this once.
    res.json({
      success: true,
      message: 'Two-factor authentication is enabled',
      data: { recoveryCodes: plainCodes }
    });
  } catch (error: any) {
    console.error('2FA enable error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/auth/2fa/disable  (authenticated)
// ---------------------------------------------------------------------------
const disableSchema = Joi.object({
  code: Joi.string().trim().optional(),
  recoveryCode: Joi.string().trim().optional(),
  password: Joi.string().optional()
}).or('code', 'recoveryCode', 'password');

export const disableTwoFactor = async (req: Request, res: Response): Promise<void> => {
  try {
    const { error } = disableSchema.validate(req.body);
    if (error) {
      res.status(400).json({ success: false, message: 'Provide a current authenticator code, a recovery code, or your password' });
      return;
    }
    const userId = (req as any).user.id;
    const prisma = await getPrisma();
    const user = await loadUser(prisma, userId);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }
    if (!user.twoFactorEnabled && !user.twoFactorSecret) {
      res.status(400).json({ success: false, message: 'Two-factor authentication is not enabled' });
      return;
    }

    let authorized = false;
    if (user.twoFactorSecret) {
      // A real second factor exists: a code is required to remove it.
      if (req.body.code && verifyTotpCode(user.twoFactorSecret, req.body.code)) {
        authorized = true;
      } else if (req.body.recoveryCode) {
        const hashes = parseRecoveryHashes(user.twoFactorRecoveryCodes);
        const idx = hashes.indexOf(hashRecoveryCode(req.body.recoveryCode));
        if (idx >= 0) authorized = true;
      }
    } else if (req.body.password) {
      // Legacy flag-only state (enabled=true, no secret): there is no
      // second factor to prove — the account password is the way out.
      authorized = await bcrypt.compare(String(req.body.password), user.password);
    }

    if (!authorized) {
      res.status(401).json({ success: false, message: 'Verification failed. Two-factor authentication is still on.' });
      return;
    }

    await prisma.zapeeraUser.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecoveryCodes: null }
    });

    res.json({ success: true, message: 'Two-factor authentication is disabled' });
  } catch (error: any) {
    console.error('2FA disable error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/auth/2fa/recovery-codes/regenerate  (authenticated)
// ---------------------------------------------------------------------------
const regenerateSchema = Joi.object({
  code: Joi.string().trim().required()
});

export const regenerateRecoveryCodes = async (req: Request, res: Response): Promise<void> => {
  try {
    const { error } = regenerateSchema.validate(req.body);
    if (error) {
      res.status(400).json({ success: false, message: 'A 6-digit code from your authenticator app is required' });
      return;
    }
    const userId = (req as any).user.id;
    const prisma = await getPrisma();
    const user = await loadUser(prisma, userId);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }
    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      res.status(400).json({ success: false, message: 'Two-factor authentication is not enabled' });
      return;
    }
    if (!verifyTotpCode(user.twoFactorSecret, req.body.code)) {
      res.status(401).json({ success: false, message: 'That code does not match. Recovery codes were not changed.' });
      return;
    }

    const { plainCodes, hashes } = generateRecoveryCodeSet();
    await prisma.zapeeraUser.update({
      where: { id: userId },
      data: { twoFactorRecoveryCodes: JSON.stringify(hashes) }
    });

    res.json({
      success: true,
      message: 'New recovery codes issued. Your previous codes no longer work.',
      data: { recoveryCodes: plainCodes }
    });
  } catch (error: any) {
    console.error('2FA recovery-code regeneration error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ---------------------------------------------------------------------------
// POST /api/auth/login/2fa  (public — the challenge token is the credential)
// ---------------------------------------------------------------------------
const verifyLoginSchema = Joi.object({
  challengeToken: Joi.string().required(),
  code: Joi.string().trim().optional(),
  recoveryCode: Joi.string().trim().optional()
}).xor('code', 'recoveryCode');

export const verifyLoginTwoFactor = async (req: Request, res: Response): Promise<void> => {
  try {
    const { error } = verifyLoginSchema.validate(req.body);
    if (error) {
      genericChallengeFailure(res);
      return;
    }

    const claims = verifyChallengeToken(String(req.body.challengeToken));
    if (!claims) {
      genericChallengeFailure(res);
      return;
    }
    const { userId, jti } = claims;

    const prisma = await getPrisma();
    const user = await loadUser(prisma, userId);

    // Re-check enrollment at completion time: if 2FA was disabled (or the
    // account deactivated) after the challenge was issued, the challenge
    // must not mint a session.
    if (!user || !user.isActive || !user.twoFactorEnabled || !user.twoFactorSecret) {
      consumeChallenge(jti);
      genericChallengeFailure(res);
      return;
    }

    let verified = false;
    if (req.body.code) {
      verified = verifyTotpCode(user.twoFactorSecret, req.body.code);
    } else if (req.body.recoveryCode) {
      const hashes = parseRecoveryHashes(user.twoFactorRecoveryCodes);
      const idx = hashes.indexOf(hashRecoveryCode(req.body.recoveryCode));
      if (idx >= 0) {
        // Consume BEFORE issuing the session so the code can never be
        // replayed, even if session issuance then fails.
        hashes.splice(idx, 1);
        await prisma.zapeeraUser.update({
          where: { id: userId },
          data: { twoFactorRecoveryCodes: JSON.stringify(hashes) }
        });
        verified = true;
      }
    }

    if (!verified) {
      recordChallengeFailure(jti);
      genericChallengeFailure(res);
      return;
    }

    consumeChallenge(jti);
    await issueLoginSession(req, res, prisma, user);
  } catch (error: any) {
    console.error('2FA login verification error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
