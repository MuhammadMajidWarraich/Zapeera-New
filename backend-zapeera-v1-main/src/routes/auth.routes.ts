import { Router } from 'express';
import { login, register, getProfile, changePassword, updateProfile, checkAccountStatus, forgotPassword, resetPassword, verifyResetToken, resetPasswordWithToken, verifyEmail, resendVerificationEmail, logout } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Public routes
router.post('/login', login);
router.post('/register', register);
router.post('/signup', register);
router.post('/forgot-password', forgotPassword);
router.get('/verify-reset-token', verifyResetToken);
router.post('/reset-password-with-token', resetPasswordWithToken);
router.get('/verify-email', verifyEmail);
router.post('/resend-verification', resendVerificationEmail);

// Test email endpoint (development only)
if (process.env.NODE_ENV !== 'production') {
  router.post('/test-email', async (req, res): Promise<void> => {
    try {
      const { email } = req.body;
      if (!email) {
        res.status(400).json({ success: false, message: 'Email is required' });
        return;
      }

      console.log('[Test Email] Starting test email send...');
      console.log('[Test Email] Environment check:');
      console.log('  SMTP_HOST:', process.env.SMTP_HOST || 'NOT SET');
      console.log('  SMTP_USER:', process.env.SMTP_USER || 'NOT SET');
      console.log('  SMTP_PASS:', process.env.SMTP_PASS ? 'SET (hidden)' : 'NOT SET');

      const { emailService } = await import('../services/email.service');
      const testUrl = 'http://localhost:5173/reset-password?token=test-token-123';
      console.log('[Test Email] Calling sendPasswordResetEmail...');
      const sent = await emailService.sendPasswordResetEmail(email, 'Test User', 'test-token-123', testUrl);

      res.json({
        success: sent,
        message: sent
          ? 'Test email sent successfully. Check your inbox (and spam folder).'
          : 'Failed to send test email. Check server logs for details.'
      });
    } catch (error: any) {
      console.error('[Test Email] Error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });
}

// Protected routes
router.get('/profile', authenticate, getProfile);
router.post('/change-password', authenticate, changePassword);
router.put('/update-profile', authenticate, updateProfile);
router.post('/reset-password', authenticate, resetPassword);
router.post('/logout', authenticate, logout);

// Account status check (for periodic checking by frontend)
router.get('/check-status', authenticate, checkAccountStatus);

export default router;
