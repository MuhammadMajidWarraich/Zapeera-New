import nodemailer from 'nodemailer';

// Resend SDK - lazy-loaded to avoid startup errors if not installed
let Resend: any = null;
try {
  Resend = require('resend').Resend;
} catch {
  // Resend not installed, will use SMTP fallback
}

interface EmailConfig {
  host?: string;
  port?: number;
  secure?: boolean;
  auth?: {
    user: string;
    pass: string;
  };
}

type EmailProvider = 'resend' | 'smtp' | 'mailpit' | 'console' | 'none';

class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private resendClient: any = null;
  private provider: EmailProvider = 'none';
  private initialized: boolean = false;

  constructor() {
    // Don't initialize immediately - wait for environment to be ready
    // Initialize will be called on first use
    // In production, we might want to verify config is available
    if (process.env.NODE_ENV === 'production') {
      console.log('[Email Service] Production mode - Email service will initialize on first use');
      console.log('[Email Service] Checking environment variables...');
      const hasSmtp = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
      const hasResend = !!(process.env.RESEND_API_KEY);
      if (!hasSmtp && !hasResend) {
        console.warn('[Email Service] ⚠️ No email provider configured in production!');
        console.warn('[Email Service] ⚠️ Please set RESEND_API_KEY (recommended) or SMTP_HOST/SMTP_USER/SMTP_PASS');
      } else if (hasResend) {
        console.log('[Email Service] ✅ Resend API key detected');
      }
    }
  }

  private ensureInitialized() {
    if (!this.initialized) {
      // In production, ensure environment variables are loaded
      if (process.env.NODE_ENV === 'production') {
        // Try to load .env.production if not already loaded
        try {
          const dotenv = require('dotenv');
          const fs = require('fs');
          if (fs.existsSync('.env.production')) {
            dotenv.config({ path: '.env.production', override: false });
            console.log('[Email Service] Loaded .env.production for email configuration');
          }
        } catch (e) {
          // Ignore - environment variables might be set via hosting platform
        }
      }
      this.initializeTransporter();
      this.initialized = true;
    }
  }

  private initializeTransporter() {
    const resendApiKey = process.env.RESEND_API_KEY?.trim();
    const emailHost = (process.env.SMTP_HOST || process.env.EMAIL_HOST)?.trim();
    const emailPort = parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || '587');
    const emailUser = (process.env.SMTP_USER || process.env.EMAIL_USER)?.trim();
    let emailPass = (process.env.SMTP_PASS || process.env.EMAIL_PASSWORD)?.trim();
    if (emailPass) {
      emailPass = emailPass.replace(/^["']|["']$/g, '');
      emailPass = emailPass.replace(/\s+/g, '');
    }
    const mailpitHost = process.env.MAILPIT_HOST?.trim();
    const mailpitPort = parseInt(process.env.MAILPIT_PORT || '1025');

    console.log('[Email Service] ========================================');
    console.log('[Email Service] Initializing email provider...');
    console.log('[Email Service] Environment:', process.env.NODE_ENV || 'development');
    console.log('[Email Service] RESEND_API_KEY:', resendApiKey ? '✅ Set' : '❌ Missing');
    console.log('[Email Service] SMTP_HOST:', emailHost ? `✅ Set (${emailHost})` : '❌ Missing');
    console.log('[Email Service] MAILPIT_HOST:', mailpitHost ? `✅ Set (${mailpitHost})` : '❌ Missing');
    console.log('[Email Service] FRONTEND_URL:', process.env.FRONTEND_URL || 'Not set');
    console.log('[Email Service] ========================================');

    // Priority 1: Resend (recommended for production)
    if (resendApiKey && Resend) {
      try {
        this.resendClient = new Resend(resendApiKey);
        this.provider = 'resend';
        console.log('✅ Email provider: Resend (API key configured)');
        return;
      } catch (error: any) {
        console.error('❌ Failed to initialize Resend:', error.message);
      }
    }

    // Priority 2: Mailpit (local development)
    if (mailpitHost || (process.env.NODE_ENV !== 'production' && !emailHost)) {
      const mpHost = mailpitHost || 'localhost';
      const mpPort = mailpitPort || 1025;
      try {
        this.transporter = nodemailer.createTransport({
          host: mpHost,
          port: mpPort,
          secure: false,
          ignoreTLS: true
        });
        this.provider = 'mailpit';
        console.log(`✅ Email provider: Mailpit (${mpHost}:${mpPort})`);
        console.log(`   View captured emails at http://${mpHost === 'localhost' ? 'localhost' : mpHost}:8025`);
        return;
      } catch (error: any) {
        console.error('❌ Failed to initialize Mailpit:', error.message);
      }
    }

    // Priority 3: SMTP (fallback)
    if (emailHost && emailUser && emailPass) {
      try {
        const emailSecure = process.env.SMTP_SECURE === 'true' || emailPort === 465;
        const isGmail = emailHost.includes('gmail.com');
        const transporterConfig: any = {
          host: emailHost,
          port: emailPort,
          secure: emailSecure,
          auth: { user: emailUser, pass: emailPass },
          connectionTimeout: 20000,
          greetingTimeout: 20000,
          socketTimeout: 20000
        };
        if (isGmail && emailPort === 587) {
          transporterConfig.secure = false;
          transporterConfig.requireTLS = true;
          transporterConfig.tls = { rejectUnauthorized: false };
        }
        this.transporter = nodemailer.createTransport(transporterConfig);
        this.provider = 'smtp';
        console.log('✅ Email provider: SMTP');
        // Verify connection async
        this.transporter.verify((err: any) => {
          if (err) {
            console.error('❌ SMTP verification failed:', err.message);
          } else {
            console.log('✅ SMTP connection verified');
          }
        });
        return;
      } catch (error: any) {
        console.error('❌ Failed to initialize SMTP:', error.message);
      }
    }

    // Priority 4: Console-only (development fallback)
    if (process.env.NODE_ENV !== 'production') {
      this.provider = 'console';
      console.log('⚠️ Email provider: Console (emails will be logged, not sent)');
      console.log('   Set RESEND_API_KEY, SMTP config, or run Mailpit to send real emails');
      return;
    }

    // No provider available
    this.provider = 'none';
    console.error('❌ No email provider configured. Emails will not be sent.');
    console.error('❌ Set RESEND_API_KEY (recommended) or SMTP_HOST/SMTP_USER/SMTP_PASS');
  }

  private getFromEmail(): string {
    return process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM || process.env.FROM_EMAIL || process.env.SMTP_USER || 'noreply@zapeera.com';
  }

  private getAppName(): string {
    return process.env.APP_NAME || 'Zapeera';
  }

  private getFrontendUrl(): string {
    return process.env.FRONTEND_URL || 'http://localhost:4100';
  }

  /**
   * Generic send email method that routes to the correct provider
   */
  private async sendEmail(options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const fromEmail = this.getFromEmail();
    const appName = this.getAppName();
    const from = `"${appName}" <${fromEmail}>`;

    // Console provider - just log
    if (this.provider === 'console') {
      console.log('[Email Console] ====== EMAIL WOULD BE SENT ======');
      console.log('[Email Console] To:', options.to);
      console.log('[Email Console] From:', from);
      console.log('[Email Console] Subject:', options.subject);
      console.log('[Email Console] Text:', options.text || '(html only)');
      console.log('[Email Console] ==================================');
      return { success: true, messageId: 'console-log-only' };
    }

    // No provider configured
    if (this.provider === 'none') {
      console.error('❌ No email provider configured');
      return { success: false, error: 'No email provider configured' };
    }

    // Resend provider
    if (this.provider === 'resend' && this.resendClient) {
      try {
        const result = await this.resendClient.emails.send({
          from,
          to: options.to,
          subject: options.subject,
          html: options.html,
          text: options.text || ''
        });
        if (result.error) {
          console.error(`❌ Resend failed:`, result.error);
          return { success: false, error: result.error.message || String(result.error) };
        }
        console.log(`✅ Email sent via Resend to ${options.to}, ID: ${result.data?.id || 'unknown'}`);
        return { success: true, messageId: result.data?.id };
      } catch (error: any) {
        console.error(`❌ Resend failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    }

    // SMTP / Mailpit provider (both use nodemailer)
    if (this.transporter) {
      try {
        const info = await this.transporter.sendMail({
          from,
          to: options.to,
          subject: options.subject,
          html: options.html,
          text: options.text || ''
        });
        console.log(`✅ Email sent via ${this.provider === 'mailpit' ? 'Mailpit' : 'SMTP'} to ${options.to}`);
        return { success: true, messageId: info.messageId };
      } catch (error: any) {
        console.error(`❌ ${this.provider === 'mailpit' ? 'Mailpit' : 'SMTP'} failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    }

    return { success: false, error: 'Unknown email provider state' };
  }

  async sendPasswordResetEmail(email: string, name: string, resetToken: string, resetUrl: string): Promise<boolean> {
    this.ensureInitialized();
    const appName = this.getAppName();
    const fullResetUrl = resetUrl.startsWith('http')
      ? resetUrl
      : `${this.getFrontendUrl()}${resetUrl.startsWith('/') ? resetUrl : '/' + resetUrl}`;

    const result = await this.sendEmail({
      to: email,
      subject: `Password Reset Request - ${appName}`,
      html: this.getPasswordResetHtml(name, fullResetUrl, appName),
      text: this.getPasswordResetText(name, fullResetUrl, appName)
    });
    return result.success;
  }

  private getPasswordResetHtml(name: string, url: string, appName: string): string {
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
.container { max-width: 600px; margin: 0 auto; padding: 20px; }
.header { background: linear-gradient(135deg, #0c2c8a 0%, #153186 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
.content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
.button { display: inline-block; padding: 12px 30px; background: #0c2c8a; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
.footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
.warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
</style>
</head>
<body>
<div class="container">
  <div class="header"><h1>${appName}</h1><p>Password Reset Request</p></div>
  <div class="content">
    <p>Hello ${name},</p>
    <p>We received a request to reset your password for your ${appName} account.</p>
    <p>Click the button below to reset your password:</p>
    <div style="text-align: center;"><a href="${url}" class="button">Reset Password</a></div>
    <p>Or copy and paste this link into your browser:</p>
    <p style="word-break: break-all; color: #0c2c8a;">${url}</p>
    <div class="warning">
      <strong>Security Notice:</strong>
      <ul><li>This link will expire in 1 hour</li><li>If you didn't request this, please ignore this email</li><li>Never share this link with anyone</li></ul>
    </div>
  </div>
  <div class="footer">
    <p>This is an automated message. Please do not reply to this email.</p>
    <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
  </div>
</div>
</body>
</html>`;
  }

  private getPasswordResetText(name: string, url: string, appName: string): string {
    return `Password Reset Request - ${appName}\n\nHello ${name},\n\nWe received a request to reset your password.\n\nClick the following link to reset your password:\n${url}\n\nThis link will expire in 1 hour.\n\nIf you didn't request this, please ignore this email.\n\n---\nThis is an automated message. Please do not reply.`;
  }

  /**
   * Send business invitation email
   */
  async sendBusinessInvitationEmail(
    recipientEmail: string,
    recipientName: string | undefined,
    businessName: string,
    inviterName: string,
    roleName: string | undefined,
    acceptanceLink: string,
    expiresAt: Date
  ): Promise<boolean> {
    this.ensureInitialized();

    console.log('[Email Service] Sending business invitation email...');
    console.log('[Email Service] To:', recipientEmail);
    console.log('[Email Service] Business:', businessName);

    const appName = this.getAppName();
    const expiresDate = new Date(expiresAt).toLocaleDateString();

    const result = await this.sendEmail({
      to: recipientEmail,
      subject: `Invitation to join ${businessName} on ${appName}`,
      html: this.getBusinessInvitationHtml(recipientName, inviterName, businessName, roleName, acceptanceLink, expiresDate, appName),
      text: `You've been invited to join ${businessName}. Click here to accept: ${acceptanceLink}`
    });
    return result.success;
  }

  private getBusinessInvitationHtml(
    recipientName: string | undefined,
    inviterName: string,
    businessName: string,
    roleName: string | undefined,
    acceptanceLink: string,
    expiresDate: string,
    appName: string
  ): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; background-color: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #0c2c8a 0%, #153186 100%); color: white; padding: 20px; border-radius: 4px; }
    .content { padding: 20px; }
    .button { display: inline-block; background-color: #0c2c8a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 20px 0; }
    .footer { border-top: 1px solid #e5e7eb; padding-top: 20px; color: #6b7280; font-size: 12px; }
    .info-box { background-color: #f3f4f6; border-left: 4px solid #0c2c8a; padding: 15px; margin: 15px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>You're Invited!</h1>
    </div>
    <div class="content">
      <p>Hello${recipientName ? ' ' + recipientName : ''},</p>
      <p><strong>${inviterName}</strong> has invited you to join <strong>${businessName}</strong> on <strong>${appName}</strong>.</p>
      ${roleName ? `<div class="info-box"><p>Your role: <strong>${roleName}</strong></p></div>` : ''}
      <p>Click the button below to accept this invitation:</p>
      <center>
        <a href="${acceptanceLink}" class="button">Accept Invitation</a>
      </center>
      <p>or copy and paste this link in your browser:</p>
      <p style="word-break: break-all; color: #0c2c8a;"><small>${acceptanceLink}</small></p>
      <div class="info-box">
        <p><strong>⏰ This invitation expires on ${expiresDate}</strong></p>
      </div>
      <p>If you don't want to join, you can ignore this email.</p>
      <div class="footer">
        <p>© ${appName}. All rights reserved.</p>
        <p>This is an automated message. Please do not reply to this email.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Send invitation acceptance confirmation email
   */
  async sendInvitationAcceptanceConfirmation(
    recipientEmail: string,
    recipientName: string | undefined,
    businessName: string
  ): Promise<boolean> {
    this.ensureInitialized();

    console.log('[Email Service] Sending invitation acceptance confirmation...');
    console.log('[Email Service] To:', recipientEmail);

    const appName = this.getAppName();

    const result = await this.sendEmail({
      to: recipientEmail,
      subject: `Welcome to ${businessName}!`,
      html: this.getInvitationAcceptanceHtml(recipientName, businessName, appName),
      text: `You have successfully joined ${businessName} on ${appName}!`
    });
    return result.success;
  }

  private getInvitationAcceptanceHtml(
    recipientName: string | undefined,
    businessName: string,
    appName: string
  ): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; background-color: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px; border-radius: 8px; }
    .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 20px; border-radius: 4px; text-align: center; }
    .content { padding: 20px; }
    .footer { border-top: 1px solid #e5e7eb; padding-top: 20px; color: #6b7280; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✓ Welcome!</h1>
    </div>
    <div class="content">
      <p>Hello${recipientName ? ' ' + recipientName : ''},</p>
      <p>You have successfully joined <strong>${businessName}</strong> on <strong>${appName}</strong>!</p>
      <p>You can now log in and start using the application.</p>
      <div class="footer">
        <p>© ${appName}. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Send payment proof approval notification email
   */
  async sendPaymentProofApprovalEmail(
    recipientEmail: string,
    recipientName: string,
    businessName: string,
    planName: string,
    amount: number,
    activationDate: string
  ): Promise<boolean> {
    this.ensureInitialized();
    const appName = this.getAppName();
    const frontendUrl = this.getFrontendUrl();

    const result = await this.sendEmail({
      to: recipientEmail,
      subject: `✅ Subscription Activated - ${businessName}`,
      html: this.getPaymentProofApprovalHtml(recipientName, businessName, planName, amount, activationDate, frontendUrl, appName),
      text: this.getPaymentProofApprovalText(recipientName, businessName, planName, amount, activationDate, frontendUrl, appName)
    });
    return result.success;
  }

  private getPaymentProofApprovalHtml(
    recipientName: string, businessName: string, planName: string, amount: number, activationDate: string, frontendUrl: string, appName: string
  ): string {
    return `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 28px;">Subscription Activated!</h1>
  </div>
  <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0;">
    <p style="font-size: 16px; color: #333;">Dear ${recipientName},</p>
    <p style="font-size: 16px; color: #333;">Great news! Your payment proof has been verified and your subscription has been activated.</p>
    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e0e0e0;">
      <h3 style="margin-top: 0; color: #007bff;">Subscription Details</h3>
      <p style="margin: 10px 0; color: #333;"><strong>Business:</strong> ${businessName}</p>
      <p style="margin: 10px 0; color: #333;"><strong>Plan:</strong> ${planName}</p>
      <p style="margin: 10px 0; color: #333;"><strong>Amount Paid:</strong> PKR ${amount.toLocaleString()}</p>
      <p style="margin: 10px 0; color: #333;"><strong>Activation Date:</strong> ${new Date(activationDate).toLocaleDateString()}</p>
    </div>
    <p style="font-size: 16px; color: #333;">You can now access all features of your subscription plan.</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${frontendUrl}/business/${businessName}" style="background: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: bold;">Go to Dashboard</a>
    </div>
    <p style="font-size: 14px; color: #666; margin-top: 30px;">If you have any questions, please contact our support team.</p>
    <p style="font-size: 14px; color: #666;">This is an automated message. Please do not reply to this email.</p>
  </div>
</div>`;
  }

  private getPaymentProofApprovalText(
    recipientName: string, businessName: string, planName: string, amount: number, activationDate: string, frontendUrl: string, appName: string
  ): string {
    return `Subscription Activated - ${businessName}\n\nDear ${recipientName},\n\nGreat news! Your payment proof has been verified and your subscription has been activated.\n\nSubscription Details:\n- Business: ${businessName}\n- Plan: ${planName}\n- Amount Paid: PKR ${amount.toLocaleString()}\n- Activation Date: ${new Date(activationDate).toLocaleDateString()}\n\nYou can now access all features of your subscription plan.\n\nGo to Dashboard: ${frontendUrl}/business/${businessName}\n\nIf you have any questions, please contact our support team.\n\nThis is an automated message. Please do not reply to this email.`;
  }

  /**
   * Send payment proof rejection notification email
   */
  async sendPaymentProofRejectionEmail(
    recipientEmail: string,
    recipientName: string,
    businessName: string,
    planName: string,
    amount: number,
    rejectionReason: string
  ): Promise<boolean> {
    this.ensureInitialized();
    const appName = this.getAppName();
    const frontendUrl = this.getFrontendUrl();

    const result = await this.sendEmail({
      to: recipientEmail,
      subject: `❌ Payment Proof Rejected - ${businessName}`,
      html: this.getPaymentProofRejectionHtml(recipientName, businessName, planName, amount, rejectionReason, frontendUrl, appName),
      text: this.getPaymentProofRejectionText(recipientName, businessName, planName, amount, rejectionReason, frontendUrl, appName)
    });
    return result.success;
  }

  private getPaymentProofRejectionHtml(
    recipientName: string, businessName: string, planName: string, amount: number, rejectionReason: string, frontendUrl: string, appName: string
  ): string {
    return `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #dc3545 0%, #a71d2a 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 28px;">Payment Proof Rejected</h1>
  </div>
  <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0;">
    <p style="font-size: 16px; color: #333;">Dear ${recipientName},</p>
    <p style="font-size: 16px; color: #333;">We regret to inform you that your payment proof could not be verified.</p>
    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e0e0e0;">
      <h3 style="margin-top: 0; color: #dc3545;">Payment Details</h3>
      <p style="margin: 10px 0; color: #333;"><strong>Business:</strong> ${businessName}</p>
      <p style="margin: 10px 0; color: #333;"><strong>Plan:</strong> ${planName}</p>
      <p style="margin: 10px 0; color: #333;"><strong>Amount:</strong> PKR ${amount.toLocaleString()}</p>
    </div>
    <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #ffeaa7;">
      <h3 style="margin-top: 0; color: #856404;">Rejection Reason</h3>
      <p style="margin: 10px 0; color: #333; font-style: italic;">"${rejectionReason}"</p>
    </div>
    <p style="font-size: 16px; color: #333;">Please review the reason above and submit a new payment proof with the correct information.</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${frontendUrl}/business/${businessName}" style="background: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: bold;">Submit New Payment Proof</a>
    </div>
    <p style="font-size: 14px; color: #666; margin-top: 30px;">If you believe this is an error or need assistance, please contact our support team.</p>
    <p style="font-size: 14px; color: #666;">This is an automated message. Please do not reply to this email.</p>
  </div>
</div>`;
  }

  private getPaymentProofRejectionText(
    recipientName: string, businessName: string, planName: string, amount: number, rejectionReason: string, frontendUrl: string, appName: string
  ): string {
    return `Payment Proof Rejected - ${businessName}\n\nDear ${recipientName},\n\nWe regret to inform you that your payment proof could not be verified.\n\nPayment Details:\n- Business: ${businessName}\n- Plan: ${planName}\n- Amount: PKR ${amount.toLocaleString()}\n\nRejection Reason:\n"${rejectionReason}"\n\nPlease review the reason above and submit a new payment proof with the correct information.\n\nSubmit New Payment Proof: ${frontendUrl}/business/${businessName}\n\nIf you believe this is an error or need assistance, please contact our support team.\n\nThis is an automated message. Please do not reply to this email.`;
  }

  // ==============================
  // NEW: Email Verification
  // ==============================

  async sendVerificationEmail(email: string, name: string, token: string): Promise<boolean> {
    this.ensureInitialized();
    const appName = this.getAppName();
    const frontendUrl = this.getFrontendUrl();
    const verifyUrl = `${frontendUrl}/verify-email?token=${token}`;
    const loginUrl = `${frontendUrl}/login`;

    const result = await this.sendEmail({
      to: email,
      subject: `Verify Your Email - ${appName}`,
      html: this.getVerificationHtml(name, verifyUrl, loginUrl, appName),
      text: this.getVerificationText(name, verifyUrl, loginUrl, appName)
    });
    return result.success;
  }

  private getVerificationHtml(name: string, verifyUrl: string, loginUrl: string, appName: string): string {
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; background: #f4f6f8; margin: 0; padding: 20px; }
.container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
.header { background: linear-gradient(135deg, #0c2c8a 0%, #2563eb 100%); color: white; padding: 40px 30px; text-align: center; }
.header h1 { margin: 0 0 8px 0; font-size: 26px; }
.header p { margin: 0; opacity: 0.9; font-size: 15px; }
.content { padding: 35px 30px; }
.greeting { font-size: 17px; color: #1f2937; margin-bottom: 20px; }
.button-wrap { text-align: center; margin: 28px 0; }
.button { display: inline-block; padding: 14px 36px; background: linear-gradient(135deg, #0c2c8a 0%, #2563eb 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; }
.link-box { background: #f3f4f6; padding: 14px 16px; border-radius: 8px; margin: 18px 0; word-break: break-all; color: #374151; font-size: 13px; }
.expiry { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 14px 18px; margin: 22px 0; border-radius: 0 8px 8px 0; }
.expiry strong { color: #92400e; }
.alt-action { text-align: center; margin: 24px 0; padding-top: 20px; border-top: 1px solid #e5e7eb; }
.alt-action a { color: #2563eb; text-decoration: none; font-weight: 500; }
.footer { text-align: center; padding: 24px 30px; color: #9ca3af; font-size: 12px; border-top: 1px solid #f3f4f6; }
</style>
</head>
<body>
<div class="container">
  <div class="header"><h1>Welcome to ${appName}!</h1><p>One step away from getting started</p></div>
  <div class="content">
    <p class="greeting">Hello ${name},</p>
    <p>Thank you for signing up. Please verify your email address to activate your account and start using ${appName}.</p>
    <div class="button-wrap"><a href="${verifyUrl}" class="button">Verify My Email</a></div>
    <p style="color:#6b7280;font-size:13px;margin-top:8px;">Or copy and paste this link into your browser:</p>
    <div class="link-box">${verifyUrl}</div>
    <div class="expiry">
      <strong>Important:</strong> This verification link expires in 24 hours. If it expires, you can request a new one on the login page.
    </div>
    <div class="alt-action">
      <p>Already verified? <a href="${loginUrl}">Log in to your account</a></p>
    </div>
  </div>
  <div class="footer">
    <p>This is an automated message. Please do not reply to this email.</p>
    <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
  </div>
</div>
</body>
</html>`;
  }

  private getVerificationText(name: string, verifyUrl: string, loginUrl: string, appName: string): string {
    return `Welcome to ${appName}!\n\nHello ${name},\n\nThank you for signing up. Please verify your email address to activate your account.\n\nVerify your email:\n${verifyUrl}\n\nThis link expires in 24 hours.\n\nAlready verified? Log in here:\n${loginUrl}\n\n---\nThis is an automated message. Please do not reply.`;
  }

  // ==============================
  // NEW: Welcome Email
  // ==============================

  async sendWelcomeEmail(email: string, name: string): Promise<boolean> {
    this.ensureInitialized();
    const appName = this.getAppName();
    const frontendUrl = this.getFrontendUrl();

    const result = await this.sendEmail({
      to: email,
      subject: `Welcome to ${appName} - Getting Started`,
      html: this.getWelcomeHtml(name, frontendUrl, appName),
      text: this.getWelcomeText(name, frontendUrl, appName)
    });
    return result.success;
  }

  private getWelcomeHtml(name: string, url: string, appName: string): string {
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; background: #f4f6f8; margin: 0; padding: 20px; }
.container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
.header { background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: white; padding: 40px 30px; text-align: center; }
.header h1 { margin: 0 0 8px 0; font-size: 26px; }
.header p { margin: 0; opacity: 0.9; font-size: 15px; }
.content { padding: 35px 30px; }
.greeting { font-size: 17px; color: #1f2937; margin-bottom: 20px; }
.steps { margin: 22px 0; }
.step { display: flex; align-items: flex-start; margin: 16px 0; padding: 14px 16px; background: #f9fafb; border-radius: 8px; }
.step-num { width: 28px; height: 28px; background: linear-gradient(135deg, #0c2c8a 0%, #2563eb 100%); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 13px; margin-right: 14px; flex-shrink: 0; }
.step-text { color: #374151; font-size: 14px; }
.step-text strong { color: #111827; }
.button-wrap { text-align: center; margin: 28px 0; }
.button { display: inline-block; padding: 14px 36px; background: linear-gradient(135deg, #0c2c8a 0%, #2563eb 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; }
.footer { text-align: center; padding: 24px 30px; color: #9ca3af; font-size: 12px; border-top: 1px solid #f3f4f6; }
</style>
</head>
<body>
<div class="container">
  <div class="header"><h1>Your Account is Active!</h1><p>Welcome to ${appName}</p></div>
  <div class="content">
    <p class="greeting">Hello ${name},</p>
    <p>Your email has been verified and your account is now fully active. Here is how to get started:</p>
    <div class="steps">
      <div class="step"><div class="step-num">1</div><div class="step-text"><strong>Create a Business</strong><br/>Set up your first business profile and configure your settings.</div></div>
      <div class="step"><div class="step-num">2</div><div class="step-text"><strong>Add a Branch</strong><br/>Add your store or warehouse location to manage inventory.</div></div>
      <div class="step"><div class="step-num">3</div><div class="step-text"><strong>Invite Your Team</strong><br/>Add employees and assign roles to collaborate.</div></div>
    </div>
    <div class="button-wrap"><a href="${url}" class="button">Go to Dashboard</a></div>
  </div>
  <div class="footer">
    <p>This is an automated message. Please do not reply to this email.</p>
    <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
  </div>
</div>
</body>
</html>`;
  }

  private getWelcomeText(name: string, url: string, appName: string): string {
    return `Welcome to ${appName}!\n\nHello ${name},\n\nYour email has been verified and your account is now fully active.\n\nGetting started:\n1. Create a Business - Set up your first business profile\n2. Add a Branch - Add your store or warehouse location\n3. Invite Your Team - Add employees and assign roles\n\nGo to Dashboard: ${url}\n\n---\nThis is an automated message. Please do not reply.`;
  }

  // ==============================
  // NEW: Business Created Email
  // ==============================

  async sendBusinessCreatedEmail(email: string, name: string, businessName: string, businessId: string): Promise<boolean> {
    this.ensureInitialized();
    const appName = this.getAppName();
    const frontendUrl = this.getFrontendUrl();
    const dashboardUrl = `${frontendUrl}/business/${businessId}`;

    const result = await this.sendEmail({
      to: email,
      subject: `Business Created - ${businessName}`,
      html: this.getBusinessCreatedHtml(name, businessName, dashboardUrl, appName),
      text: this.getBusinessCreatedText(name, businessName, dashboardUrl, appName)
    });
    return result.success;
  }

  private getBusinessCreatedHtml(name: string, businessName: string, url: string, appName: string): string {
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; background: #f4f6f8; margin: 0; padding: 20px; }
.container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
.header { background: linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%); color: white; padding: 40px 30px; text-align: center; }
.header h1 { margin: 0 0 8px 0; font-size: 26px; }
.content { padding: 35px 30px; }
.greeting { font-size: 17px; color: #1f2937; margin-bottom: 20px; }
.business-card { background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%); padding: 22px; border-radius: 10px; margin: 20px 0; text-align: center; border: 1px solid #ddd6fe; }
.business-card h2 { margin: 0 0 6px 0; color: #5b21b6; font-size: 22px; }
.business-card p { margin: 0; color: #6d28d9; font-size: 14px; }
.button-wrap { text-align: center; margin: 28px 0; }
.button { display: inline-block; padding: 14px 36px; background: linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; }
.tips { margin: 22px 0; padding: 18px 20px; background: #f9fafb; border-radius: 8px; }
.tips h4 { margin: 0 0 10px 0; color: #111827; font-size: 14px; }
.tips ul { margin: 0; padding-left: 18px; color: #374151; font-size: 13px; }
.tips li { margin: 6px 0; }
.footer { text-align: center; padding: 24px 30px; color: #9ca3af; font-size: 12px; border-top: 1px solid #f3f4f6; }
</style>
</head>
<body>
<div class="container">
  <div class="header"><h1>Business Created!</h1></div>
  <div class="content">
    <p class="greeting">Hello ${name},</p>
    <p>Your new business has been successfully created on ${appName}. You can now start managing inventory, sales, and staff.</p>
    <div class="business-card"><h2>${businessName}</h2><p>Status: Active</p></div>
    <div class="button-wrap"><a href="${url}" class="button">Open Dashboard</a></div>
    <div class="tips">
      <h4>Next steps:</h4>
      <ul><li>Add your first branch or warehouse</li><li>Set up product categories and suppliers</li><li>Invite your team members</li></ul>
    </div>
  </div>
  <div class="footer">
    <p>This is an automated message. Please do not reply to this email.</p>
    <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
  </div>
</div>
</body>
</html>`;
  }

  private getBusinessCreatedText(name: string, businessName: string, url: string, appName: string): string {
    return `Business Created - ${businessName}\n\nHello ${name},\n\nYour new business has been successfully created on ${appName}.\n\nBusiness: ${businessName}\nStatus: Active\n\nOpen Dashboard:\n${url}\n\nNext steps:\n- Add your first branch or warehouse\n- Set up product categories and suppliers\n- Invite your team members\n\n---\nThis is an automated message. Please do not reply.`;
  }

  // ==============================
  // NEW: Subscription Purchased Email
  // ==============================

  async sendSubscriptionPurchasedEmail(
    email: string, name: string, businessName: string, planName: string, amount: number, expiryDate: string
  ): Promise<boolean> {
    this.ensureInitialized();
    const appName = this.getAppName();
    const frontendUrl = this.getFrontendUrl();

    const result = await this.sendEmail({
      to: email,
      subject: `Subscription Confirmed - ${planName}`,
      html: this.getSubscriptionHtml(name, businessName, planName, amount, expiryDate, frontendUrl, appName),
      text: this.getSubscriptionText(name, businessName, planName, amount, expiryDate, frontendUrl, appName)
    });
    return result.success;
  }

  private getSubscriptionHtml(
    name: string, businessName: string, planName: string, amount: number, expiryDate: string, url: string, appName: string
  ): string {
    const formattedAmount = typeof amount === 'number' ? `PKR ${amount.toLocaleString()}` : amount;
    const formattedDate = new Date(expiryDate).toLocaleDateString();
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; background: #f4f6f8; margin: 0; padding: 20px; }
.container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
.header { background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%); color: white; padding: 40px 30px; text-align: center; }
.header h1 { margin: 0 0 8px 0; font-size: 26px; }
.header p { margin: 0; opacity: 0.9; font-size: 15px; }
.content { padding: 35px 30px; }
.greeting { font-size: 17px; color: #1f2937; margin-bottom: 20px; }
.receipt { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 22px; margin: 20px 0; }
.receipt-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
.receipt-row:last-child { border-bottom: none; }
.receipt-label { color: #6b7280; font-size: 14px; }
.receipt-value { color: #111827; font-weight: 600; font-size: 14px; }
.total { background: #eff6ff; border-radius: 8px; padding: 14px 16px; margin-top: 14px; }
.total .receipt-label { color: #1e40af; }
.total .receipt-value { color: #1d4ed8; font-size: 16px; }
.button-wrap { text-align: center; margin: 28px 0; }
.button { display: inline-block; padding: 14px 36px; background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; }
.footer { text-align: center; padding: 24px 30px; color: #9ca3af; font-size: 12px; border-top: 1px solid #f3f4f6; }
</style>
</head>
<body>
<div class="container">
  <div class="header"><h1>Subscription Confirmed</h1><p>Thank you for choosing ${appName}</p></div>
  <div class="content">
    <p class="greeting">Hello ${name},</p>
    <p>Your subscription has been successfully activated. Here are your plan details:</p>
    <div class="receipt">
      <div class="receipt-row"><span class="receipt-label">Business</span><span class="receipt-value">${businessName}</span></div>
      <div class="receipt-row"><span class="receipt-label">Plan</span><span class="receipt-value">${planName}</span></div>
      <div class="receipt-row"><span class="receipt-label">Amount Paid</span><span class="receipt-value">${formattedAmount}</span></div>
      <div class="receipt-row"><span class="receipt-label">Valid Until</span><span class="receipt-value">${formattedDate}</span></div>
    </div>
    <div class="button-wrap"><a href="${url}" class="button">Go to Dashboard</a></div>
  </div>
  <div class="footer">
    <p>This is an automated message. Please do not reply to this email.</p>
    <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
  </div>
</div>
</body>
</html>`;
  }

  private getSubscriptionText(
    name: string, businessName: string, planName: string, amount: number, expiryDate: string, url: string, appName: string
  ): string {
    const formattedAmount = typeof amount === 'number' ? `PKR ${amount.toLocaleString()}` : amount;
    const formattedDate = new Date(expiryDate).toLocaleDateString();
    return `Subscription Confirmed - ${planName}\n\nHello ${name},\n\nYour subscription has been successfully activated.\n\nPlan Details:\n- Business: ${businessName}\n- Plan: ${planName}\n- Amount Paid: ${formattedAmount}\n- Valid Until: ${formattedDate}\n\nGo to Dashboard: ${url}\n\n---\nThis is an automated message. Please do not reply.`;
  }

  // ==============================
  // NEW: Subscription Expiry Reminder Email
  // ==============================

  async sendSubscriptionExpiryReminder(
    email: string, 
    name: string, 
    businessName: string, 
    planName: string, 
    expiryDate: string,
    daysRemaining: number
  ): Promise<boolean> {
    this.ensureInitialized();
    const appName = this.getAppName();
    const frontendUrl = this.getFrontendUrl();

    const result = await this.sendEmail({
      to: email,
      subject: `⏰ Subscription Expiring in ${daysRemaining} Day${daysRemaining === 1 ? '' : 's'} - ${businessName}`,
      html: this.getExpiryReminderHtml(name, businessName, planName, expiryDate, daysRemaining, frontendUrl, appName),
      text: this.getExpiryReminderText(name, businessName, planName, expiryDate, daysRemaining, frontendUrl, appName)
    });
    return result.success;
  }

  private getExpiryReminderHtml(
    name: string, businessName: string, planName: string, expiryDate: string, daysRemaining: number, url: string, appName: string
  ): string {
    const formattedDate = new Date(expiryDate).toLocaleDateString();
    const urgencyColor = daysRemaining <= 1 ? '#dc2626' : '#f59e0b';
    const urgencyBg = daysRemaining <= 1 ? '#fef2f2' : '#fffbeb';
    const urgencyText = daysRemaining <= 1 ? 'Your subscription expires tomorrow!' : `Your subscription expires in ${daysRemaining} days.`;
    
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; background: #f4f6f8; margin: 0; padding: 20px; }
.container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
.header { background: linear-gradient(135deg, ${urgencyColor} 0%, #f97316 100%); color: white; padding: 40px 30px; text-align: center; }
.header h1 { margin: 0 0 8px 0; font-size: 26px; }
.content { padding: 35px 30px; }
.greeting { font-size: 17px; color: #1f2937; margin-bottom: 20px; }
.urgency { background: ${urgencyBg}; border-left: 4px solid ${urgencyColor}; padding: 18px; margin: 22px 0; border-radius: 0 8px 8px 0; }
.urgency strong { color: ${urgencyColor}; font-size: 18px; }
.details { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 22px; margin: 20px 0; }
.details-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
.details-row:last-child { border-bottom: none; }
.label { color: #6b7280; font-size: 14px; }
.value { color: #111827; font-weight: 600; font-size: 14px; }
.button-wrap { text-align: center; margin: 28px 0; }
.button { display: inline-block; padding: 14px 36px; background: linear-gradient(135deg, ${urgencyColor} 0%, #f97316 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; }
.footer { text-align: center; padding: 24px 30px; color: #9ca3af; font-size: 12px; border-top: 1px solid #f3f4f6; }
</style>
</head>
<body>
<div class="container">
  <div class="header"><h1>⏰ Subscription Expiring Soon</h1></div>
  <div class="content">
    <p class="greeting">Hello ${name},</p>
    <div class="urgency"><strong>${urgencyText}</strong></div>
    <p>Renew your subscription to avoid service interruption and continue managing your business without any downtime.</p>
    <div class="details">
      <div class="details-row"><span class="label">Business</span><span class="value">${businessName}</span></div>
      <div class="details-row"><span class="label">Plan</span><span class="value">${planName}</span></div>
      <div class="details-row"><span class="label">Expires On</span><span class="value">${formattedDate}</span></div>
    </div>
    <div class="button-wrap"><a href="${url}/subscription" class="button">Renew Subscription</a></div>
    <p style="font-size: 13px; color: #6b7280;">If you don't renew, your subscription will expire and you may lose access to premium features.</p>
  </div>
  <div class="footer">
    <p>This is an automated message. Please do not reply to this email.</p>
    <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
  </div>
</div>
</body>
</html>`;
  }

  private getExpiryReminderText(
    name: string, businessName: string, planName: string, expiryDate: string, daysRemaining: number, url: string, appName: string
  ): string {
    const formattedDate = new Date(expiryDate).toLocaleDateString();
    const urgencyText = daysRemaining <= 1 ? 'Your subscription expires tomorrow!' : `Your subscription expires in ${daysRemaining} days.`;
    
    return `⏰ Subscription Expiring Soon - ${businessName}\n\nHello ${name},\n\n${urgencyText}\n\nRenew your subscription to avoid service interruption.\n\nSubscription Details:\n- Business: ${businessName}\n- Plan: ${planName}\n- Expires On: ${formattedDate}\n\nRenew Now: ${url}/subscription\n\nIf you don't renew, your subscription will expire and you may lose access to premium features.\n\n---\nThis is an automated message. Please do not reply.`;
  }
}

// Export singleton instance
export const emailService = new EmailService();
