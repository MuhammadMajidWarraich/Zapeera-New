export const USER_STORAGE_KEY = 'zapeera_user';
export const TOKEN_STORAGE_KEY = 'token';
export const SESSION_TOKEN_STORAGE_KEY = 'sessionToken';

export function readStoredUser(): string | null {
  return localStorage.getItem(USER_STORAGE_KEY);
}

export function writeStoredUser(value: unknown): void {
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(value));
}

export function clearStoredSession(): void {
  localStorage.removeItem(USER_STORAGE_KEY);
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
  // v1.0.19: the operator binding belongs to the account session and
  // never survives an account logout. The desktop cloud REFRESH token
  // deliberately DOES survive (Phase 2B): it is a device credential in
  // the same trust class as the cached password hash — logout closes
  // the screen, it does not un-verify the device. It is cleared only
  // by clearCloudToken() (explicit full reset) or by a definitive
  // cloud rejection in maintainCloudToken.
  // (The local sync QUEUE also survives: it is business data, parked
  // until the same business signs in again.)
  localStorage.removeItem('operatorToken');
  localStorage.removeItem('zapeera_operator');
}
