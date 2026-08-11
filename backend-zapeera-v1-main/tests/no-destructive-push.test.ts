import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const BACKEND_ROOT = path.join(__dirname, '..');

/** Files allowed to mention the destructive flag (documentation only). */
const DOCUMENTATION_ONLY_FILES = ['README.md'];

function collectSourceFiles(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 4) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git' || entry.name === 'coverage') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out, depth + 1);
    } else if (/\.(ts|js|json)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('destructive schema push guard (Issue 3)', () => {
  it('keeps --accept-data-loss out of all runtime/startup files', () => {
    const offenders: string[] = [];
    for (const rel of ['scripts/init-sqlite-db.js', 'scripts/fix-sqlite-setup.js', 'src/services/sync.service.ts']) {
      const content = fs.readFileSync(path.join(BACKEND_ROOT, rel), 'utf8');
      if (content.includes('--accept-data-loss')) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps --accept-data-loss out of all src/ files', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(path.join(BACKEND_ROOT, 'src'))) {
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('--accept-data-loss')) {
        offenders.push(path.relative(BACKEND_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps --accept-data-loss out of all scripts/ files', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(path.join(BACKEND_ROOT, 'scripts'))) {
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('--accept-data-loss')) {
        offenders.push(path.relative(BACKEND_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('does not mention --accept-data-loss in package.json scripts', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8'));
    const scripts = JSON.stringify(pkg.scripts || {});
    expect(scripts).not.toContain('--accept-data-loss');
  });

  it('limits --accept-data-loss mentions to documentation and test files', () => {
    // Tests themselves reference the flag while asserting its absence, so the
    // tests/ directory is excluded here (covered by the strict per-file tests
    // above for src/, scripts/ and the runtime files).
    const allowed = new Set(DOCUMENTATION_ONLY_FILES.map((f) => path.join(BACKEND_ROOT, f)));
    const mentions: string[] = [];
    for (const file of collectSourceFiles(BACKEND_ROOT)) {
      if (allowed.has(file)) continue;
      if (file.includes(path.join(BACKEND_ROOT, 'tests'))) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('--accept-data-loss')) {
        mentions.push(path.relative(BACKEND_ROOT, file));
      }
    }
    expect(mentions).toEqual([]);
  });

  it('fix-sqlite-setup.js gates destructive recovery behind an explicit opt-in env var', () => {
    const content = fs.readFileSync(path.join(BACKEND_ROOT, 'scripts', 'fix-sqlite-setup.js'), 'utf8');
    expect(content).toContain('FIX_SQLITE_ALLOW_DESTRUCTIVE');
    expect(content).toContain('allowDestructive');
    expect(content).toContain('process.exit(1)');
  });

  it('init-sqlite-db.js push command carries no destructive flag', () => {
    const content = fs.readFileSync(path.join(BACKEND_ROOT, 'scripts', 'init-sqlite-db.js'), 'utf8');
    expect(content).toContain("'prisma', 'db', 'push', '--schema', SCHEMA_FILE");
  });

  it('sync.service.ts push command carries no destructive flag', () => {
    const content = fs.readFileSync(path.join(BACKEND_ROOT, 'src', 'services', 'sync.service.ts'), 'utf8');
    expect(content).toContain('--skip-generate');
  });

  it('does not wipe or rebuild the local database on sync failure', () => {
    const content = fs.readFileSync(path.join(BACKEND_ROOT, 'src', 'services', 'sync.service.ts'), 'utf8');
    // The rebuild path must preserve the database when schema push fails.
    expect(content).toContain('preserving local database. No data was destroyed');
    expect(content).toContain('return result');
  });
});
