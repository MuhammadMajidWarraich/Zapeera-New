import { describe, it, expect } from '@jest/globals';
import {
  checkDatabaseMode,
  buildMismatchMessage,
  readGeneratedProvider,
  SKIP_ENV_VAR,
} from '../src/config/prisma-mode-assert';

const CLEARABLE_KEYS = ['DATABASE_URL', 'USE_POSTGRESQL', 'REMOTE_DATABASE_URL', 'POSTGRESQL_URL', SKIP_ENV_VAR];

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const base: Record<string, string | undefined> = { ...process.env };
  for (const key of CLEARABLE_KEYS) {
    delete base[key];
  }
  return { ...base, ...overrides } as NodeJS.ProcessEnv;
}

describe('checkDatabaseMode (unit — injected provider)', () => {
  it('passes when sqlite mode has a sqlite-generated client', () => {
    const result = checkDatabaseMode(env({ DATABASE_URL: 'file:./dev.db' }), 'sqlite');
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
  });

  it('passes when postgresql mode has a postgresql-generated client', () => {
    const result = checkDatabaseMode(env({ USE_POSTGRESQL: 'true' }), 'postgresql');
    expect(result.ok).toBe(true);
  });

  it('fails when postgresql mode has a sqlite-generated client', () => {
    const result = checkDatabaseMode(env({ USE_POSTGRESQL: 'true' }), 'sqlite');
    expect(result.ok).toBe(false);
    expect(result.configuredMode).toBe('postgresql');
    expect(result.generatedProvider).toBe('sqlite');
    expect(result.reason).toContain('does not match');
  });

  it('fails when sqlite mode has a postgresql-generated client', () => {
    const result = checkDatabaseMode(env({ DATABASE_URL: 'file:./dev.db' }), 'postgresql');
    expect(result.ok).toBe(false);
    expect(result.configuredMode).toBe('sqlite');
  });

  it('fails when no generated client can be read', () => {
    const result = checkDatabaseMode(env({ DATABASE_URL: 'file:./dev.db' }), null);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('not generated');
  });

  it('skips the check when the escape hatch is set', () => {
    const result = checkDatabaseMode(env({ USE_POSTGRESQL: 'true', [SKIP_ENV_VAR]: 'true' }), 'sqlite');
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
  });
});

describe('buildMismatchMessage', () => {
  it('is actionable and never leaks the database URL or credentials', () => {
    const result = checkDatabaseMode(env({ DATABASE_URL: 'postgresql://user:secret@host/db' }), 'sqlite');
    const message = buildMismatchMessage(result);

    expect(message).toContain('npm run setup:web');
    expect(message).toContain('npm run setup:electron');
    expect(message).toContain('schema.postgresql.prisma');
    expect(message).toContain('Configured mode');
    expect(message).toContain('Generated provider');
    expect(message).not.toContain('postgresql://');
    expect(message).not.toContain('user:secret');
    expect(message).not.toContain('@host');
  });
});

describe('readGeneratedProvider (integration — real generated client)', () => {
  it('reads the provider from the actual generated client schema', () => {
    // The test runner (scripts/run-tests.js) generates a SQLite client before
    // jest runs and restores the previous provider afterwards.
    const provider = readGeneratedProvider();
    expect(provider).toBe('sqlite');
  });

  it('passes the full check against the real generated client in sqlite test mode', () => {
    const result = checkDatabaseMode(env({ DATABASE_URL: 'file:./tests/cloud-test.db' }));
    expect(result.ok).toBe(true);
    expect(result.generatedProvider).toBe('sqlite');
    expect(result.generatedSchemaPath).toBeTruthy();
  });

  it('detects a mismatch against the real generated client when web mode is requested', () => {
    const result = checkDatabaseMode(env({ USE_POSTGRESQL: 'true' }));
    expect(result.ok).toBe(false);
    expect(result.configuredMode).toBe('postgresql');
    expect(result.generatedProvider).toBe('sqlite');
  });
});
