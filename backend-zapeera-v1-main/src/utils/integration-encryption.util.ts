// ─── Integration credential encryption (feature/integration-framework) ───
// Server-side AES-256-GCM encryption for third-party integration
// credentials (IntegrationConnection.encryptedCredentials).
//
// There was NO encryption helper in the codebase before this file: the
// FBR integration stores its API token in PLAINTEXT
// (FbrConfig.apiToken). Integrations must NOT repeat that — credentials
// are encrypted here before they ever reach the database, and are
// decrypted only inside the backend process that calls the vendor.
//
// Key: env INTEGRATION_ENCRYPTION_KEY — 64 hex characters (32 bytes).
// Generate with:  openssl rand -hex 32
// Base64 of 32 bytes (44 chars incl. padding) is also accepted.
// The key is read lazily on every encrypt/decrypt call so a rotated key
// takes effect without a restart; a missing/invalid key FAILS LOUDLY
// (throws) instead of silently storing plaintext — connect-time callers
// surface this as a 500 INTEGRATION_ENCRYPTION_NOT_CONFIGURED.
//
// Wire format (single string, versioned for future rotation):
//   v1.<iv base64>.<authTag base64>.<ciphertext base64>
// IV is 12 random bytes per encryption (GCM nonce); the auth tag is
// 16 bytes. Tampering with any part fails authentication on decrypt.
//
// This module NEVER logs credential material (plaintext or ciphertext).
import crypto from 'crypto';

export const INTEGRATION_ENCRYPTION_KEY_ENV = 'INTEGRATION_ENCRYPTION_KEY';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const FORMAT_VERSION = 'v1';

function readKey(): Buffer {
  const raw = (process.env[INTEGRATION_ENCRYPTION_KEY_ENV] || '').trim();
  if (!raw) {
    throw new Error(
      `${INTEGRATION_ENCRYPTION_KEY_ENV} is not set — integration credentials cannot be stored. ` +
        'Set it to 64 hex characters (generate with: openssl rand -hex 32). ' +
        'Refusing to store credentials in plaintext.'
    );
  }
  // 64 hex chars -> 32 bytes.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  // Base64 of 32 bytes (44 chars incl. one "=" of padding).
  if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === KEY_BYTES) return decoded;
  }
  throw new Error(
    `${INTEGRATION_ENCRYPTION_KEY_ENV} is invalid — expected 64 hex characters ` +
      '(32 bytes, generate with: openssl rand -hex 32) or base64 of 32 bytes.'
  );
}

/** True when a usable key is configured (does not throw). */
export function isIntegrationEncryptionConfigured(): boolean {
  try {
    readKey();
    return true;
  } catch {
    return false;
  }
}

/** Encrypt a UTF-8 string. Returns the versioned `v1.iv.tag.data` bundle. */
export function encryptIntegrationSecret(plaintext: string): string {
  const key = readKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    FORMAT_VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64')
  ].join('.');
}

/** Decrypt a bundle produced by encryptIntegrationSecret. Throws on tampering. */
export function decryptIntegrationSecret(bundle: string): string {
  const key = readKey();
  const parts = String(bundle || '').split('.');
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new Error('Invalid encrypted credential format — expected v1.iv.tag.data.');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(dataB64, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error('Invalid encrypted credential format — bad iv/tag/ciphertext length.');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Encrypt a credentials object (e.g. { accessToken, shopDomain }) for
 * storage in IntegrationConnection.encryptedCredentials.
 */
export function encryptIntegrationCredentials(credentials: Record<string, unknown>): string {
  return encryptIntegrationSecret(JSON.stringify(credentials ?? {}));
}

/** Decrypt a stored credentials bundle back to its object. */
export function decryptIntegrationCredentials(bundle: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(decryptIntegrationSecret(bundle));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Decrypted integration credentials are not an object.');
  }
  return parsed as Record<string, unknown>;
}
