import { describe, it, expect } from '@jest/globals';
import { resolveDatabaseMode } from '../src/config/database-mode';

const CLEARABLE_KEYS = ['DATABASE_URL', 'REMOTE_DATABASE_URL', 'POSTGRESQL_URL', 'USE_POSTGRESQL'];

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const base: Record<string, string | undefined> = { ...process.env };
  for (const key of CLEARABLE_KEYS) {
    delete base[key];
  }
  return { ...base, ...overrides } as NodeJS.ProcessEnv;
}

describe('resolveDatabaseMode', () => {
  it('defaults to sqlite when nothing selects postgres', () => {
    expect(resolveDatabaseMode(env())).toBe('sqlite');
  });

  it('selects postgresql when USE_POSTGRESQL=true', () => {
    expect(resolveDatabaseMode(env({ USE_POSTGRESQL: 'true' }))).toBe('postgresql');
  });

  it('selects postgresql when DATABASE_URL is a postgresql:// URL', () => {
    expect(resolveDatabaseMode(env({ DATABASE_URL: 'postgresql://user:pass@host/db' }))).toBe('postgresql');
    expect(resolveDatabaseMode(env({ DATABASE_URL: 'postgres://user:pass@host/db' }))).toBe('postgresql');
  });

  it('selects postgresql when only REMOTE_DATABASE_URL is postgres', () => {
    expect(resolveDatabaseMode(env({ REMOTE_DATABASE_URL: 'postgresql://user:pass@host/db' }))).toBe('postgresql');
  });

  it('selects postgresql when only POSTGRESQL_URL is postgres', () => {
    expect(resolveDatabaseMode(env({ POSTGRESQL_URL: 'postgresql://user:pass@host/db' }))).toBe('postgresql');
  });

  it('stays sqlite when DATABASE_URL is a file: URL even if a remote is present', () => {
    expect(resolveDatabaseMode(env({ DATABASE_URL: 'file:./dev.db', REMOTE_DATABASE_URL: 'postgresql://user:pass@host/db' }))).toBe('sqlite');
  });

  it('keeps an explicit file: DATABASE_URL authoritative even with USE_POSTGRESQL=true', () => {
    expect(resolveDatabaseMode(env({ DATABASE_URL: 'file:./dev.db', USE_POSTGRESQL: 'true' }))).toBe('sqlite');
  });

  it('selects postgresql for USE_POSTGRESQL=true when no DATABASE_URL is set', () => {
    expect(resolveDatabaseMode(env({ USE_POSTGRESQL: 'true' }))).toBe('postgresql');
  });

  it('treats USE_POSTGRESQL=false as sqlite', () => {
    expect(resolveDatabaseMode(env({ USE_POSTGRESQL: 'false', DATABASE_URL: 'file:./dev.db' }))).toBe('sqlite');
  });

  it('agrees with the CommonJS script resolver (scripts/db-mode.js)', () => {
    const { execFileSync } = require('child_process') as typeof import('child_process');
    const path = require('path') as typeof import('path');

    const cases: Array<[NodeJS.ProcessEnv, string]> = [
      [env({}), 'sqlite'],
      [env({ USE_POSTGRESQL: 'true' }), 'postgresql'],
      [env({ DATABASE_URL: 'postgresql://user:pass@host/db' }), 'postgresql'],
      [env({ DATABASE_URL: 'file:./dev.db' }), 'sqlite'],
      [env({ REMOTE_DATABASE_URL: 'postgres://user:pass@host/db' }), 'postgresql'],
      [env({ DATABASE_URL: 'file:./dev.db', REMOTE_DATABASE_URL: 'postgresql://user:pass@host/db' }), 'sqlite'],
      [env({ DATABASE_URL: 'file:./dev.db', USE_POSTGRESQL: 'true' }), 'sqlite'],
      [env({ USE_POSTGRESQL: 'false', DATABASE_URL: 'file:./dev.db' }), 'sqlite'],
    ];

    for (const [vars, expected] of cases) {
      const childEnv: NodeJS.ProcessEnv = { ...process.env };
      for (const key of CLEARABLE_KEYS) {
        delete childEnv[key];
      }
      const out = execFileSync(
        process.execPath,
        [path.join(__dirname, '..', 'scripts', 'db-mode.js')],
        { encoding: 'utf8', env: { ...childEnv, ...vars } }
      ).trim();
      const scriptMode = out.split('\n').pop() as string;
      expect(scriptMode).toBe(expected);
      expect(resolveDatabaseMode(vars)).toBe(expected);
    }
  });
});
