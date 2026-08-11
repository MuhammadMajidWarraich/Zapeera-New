import { describe, it, expect } from '@jest/globals';

// scripts/run-tests.js is a plain CommonJS module (no declarations).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { providerForTests, providerToRestore } = require('../scripts/run-tests') as any;

describe('deterministic test-mode runner (Issue 1)', () => {
  describe('providerForTests', () => {
    it('generates SQLite when PostgreSQL is currently generated (web dev state)', () => {
      expect(providerForTests('postgresql')).toBe('sqlite');
    });

    it('generates SQLite when no client exists yet (fresh checkout)', () => {
      expect(providerForTests(null)).toBe('sqlite');
    });

    it('does not regenerate when SQLite is already active', () => {
      expect(providerForTests('sqlite')).toBeNull();
    });
  });

  describe('providerToRestore', () => {
    it('restores PostgreSQL when tests started from web mode', () => {
      expect(providerToRestore('postgresql')).toBe('postgresql');
    });

    it('restores SQLite when tests started from Electron mode', () => {
      expect(providerToRestore('sqlite')).toBe('sqlite');
    });

    it('does not restore when nothing was generated before tests', () => {
      expect(providerToRestore(null)).toBeNull();
    });

    it('does not attempt to restore unknown providers', () => {
      expect(providerToRestore('mysql')).toBeNull();
    });
  });
});
