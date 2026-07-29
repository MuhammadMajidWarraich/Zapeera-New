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
}
