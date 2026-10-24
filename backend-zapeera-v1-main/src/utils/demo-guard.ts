/**
 * Public live-demo account guard (marketing hero live demo, 2026-10-24).
 *
 * The marketing homepage embeds the REAL app running one dedicated demo
 * tenant. Visitors get a session via POST /api/auth/demo-login (no
 * credentials — the account is designated server-side by DEMO_USER_EMAIL).
 * This module is the server-side fence for that account: the demo user may
 * do anything INSIDE its demo business (sales, stock, customers — the data
 * resets nightly), but account-level, billing and business-structure
 * mutations are refused centrally in the auth middleware, so no individual
 * controller has to remember the check.
 *
 * When DEMO_USER_EMAIL is unset the demo is disabled entirely: demo-login
 * 404s and this guard never matches any user.
 */

export function getDemoUserEmail(): string {
  return String(process.env.DEMO_USER_EMAIL || '').trim().toLowerCase();
}

export function isDemoUserEmail(email: string | null | undefined): boolean {
  const demoEmail = getDemoUserEmail();
  if (!demoEmail || !email) return false;
  return String(email).trim().toLowerCase() === demoEmail;
}

export const DEMO_BLOCKED_MESSAGE =
  'This is the public Zapeera demo account — account, billing and business-structure changes are disabled. Everything inside the demo business (sales, stock, customers) is fully usable, and the demo data resets daily.';

interface DemoBlockRule {
  /** HTTP methods the rule applies to; undefined = all methods. */
  methods?: string[];
  /** Pattern tested against the canonical path (no /api or /api/v1 prefix). */
  pattern: RegExp;
}

const BLOCK_RULES: DemoBlockRule[] = [
  // Account self-service: no password change, no profile/email mutation
  // (in this codebase twoFactorEnabled also rides update-profile).
  { methods: ['POST'], pattern: /^\/auth\/change-password$/ },
  { methods: ['POST'], pattern: /^\/auth\/reset-password$/ },
  { methods: ['PUT', 'PATCH'], pattern: /^\/auth\/update-profile$/ },
  // 2FA management (real-2FA wave): the demo account must never enroll —
  // a shared public account with a TOTP secret would lock out every
  // visitor (and the enrollment itself is an account mutation).
  { methods: ['POST'], pattern: /^\/auth\/2fa\// },
  // Backoffice is never reachable for the demo account (any method).
  { pattern: /^\/backoffice(\/|$)/ },
  // Business lifecycle: cannot create, rename or delete businesses.
  { methods: ['POST'], pattern: /^\/companies$/ },
  { methods: ['PUT', 'PATCH', 'DELETE'], pattern: /^\/companies\// },
  // Member invites ride POST /companies/:id/members (sends real email).
  { methods: ['POST'], pattern: /^\/companies\/[^/]+\/members$/ },
  // Subscription + payments: read-only (plans stay visible, never change).
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], pattern: /^\/subscription(\/|$)/ },
  { methods: ['POST'], pattern: /^\/payments\/manual$/ },
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], pattern: /^\/billing-profiles(\/|$)/ },
  // Backup export AND restore (any method): export is an exfiltration
  // vector, restore could replace the shared demo tenant.
  { pattern: /^\/backup(\/|$)/ },
  // Staff management and invitations (invites send real email).
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], pattern: /^\/users(\/|$)/ },
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], pattern: /^\/invitations(\/|$)/ },
  // Branch structure of the shared tenant: no creating or deleting
  // branches (branch edits stay allowed — in-business data).
  { methods: ['POST'], pattern: /^\/branches$/ },
  { methods: ['DELETE'], pattern: /^\/branches\// },
  // Outbound surfaces that create backoffice work items or send email:
  // partner applications and support tickets are read-only for the demo.
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], pattern: /^\/partners(\/|$)/ },
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], pattern: /^\/support(\/|$)/ },
];

/**
 * Canonicalize an Express originalUrl to the router-relative path the
 * block rules are written against: strips the query string and the
 * /api or /api/v1 mount prefix.
 */
export function canonicalApiPath(originalUrl: string): string {
  const pathOnly = String(originalUrl || '').split('?')[0];
  if (pathOnly.startsWith('/api/v1/')) return pathOnly.slice('/api/v1'.length);
  if (pathOnly.startsWith('/api/')) return pathOnly.slice('/api'.length);
  if (pathOnly === '/api' || pathOnly === '/api/v1') return '/';
  return pathOnly;
}

export function demoBlockedAction(method: string, originalUrl: string): boolean {
  const path = canonicalApiPath(originalUrl);
  const m = String(method || 'GET').toUpperCase();
  return BLOCK_RULES.some(
    (rule) => (!rule.methods || rule.methods.includes(m)) && rule.pattern.test(path)
  );
}
