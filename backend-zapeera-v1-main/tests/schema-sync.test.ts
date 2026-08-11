import { describe, it, expect, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// scripts/check-schema-sync.js is a plain CommonJS module (no declarations).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkSchemaSync, extractModelSection } = require('../scripts/check-schema-sync') as any;

const sqlitePath = path.join(__dirname, '..', 'prisma', 'schema.sqlite.prisma');
const postgresPath = path.join(__dirname, '..', 'prisma', 'schema.postgresql.prisma');

describe('deterministic prisma schema inputs', () => {
  it('keeps both schema files in sync (identical except datasource provider)', () => {
    const result = checkSchemaSync() as any;
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('uses the correct datasource provider in each file', () => {
    const result = checkSchemaSync() as any;
    expect(result.sqliteProvider).toBe('sqlite');
    expect(result.postgresProvider).toBe('postgresql');
  });

  it('extractModelSection excludes the datasource block but keeps models', () => {
    const sqlite = fs.readFileSync(sqlitePath, 'utf8');
    const section = extractModelSection(sqlite) as string;
    expect(section).toContain('model ZapeeraUser');
    expect(section).not.toContain('datasource db');
  });
});

describe('schema drift detection (read-only — Issue 2)', () => {
  let tmpDir: string;
  let sqliteCopy: string;
  let postgresCopy: string;

  beforeEach(() => {
    // Work exclusively on disposable copies — NEVER on the committed schemas.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapeera-schema-sync-'));
    sqliteCopy = path.join(tmpDir, 'schema.sqlite.prisma');
    postgresCopy = path.join(tmpDir, 'schema.postgresql.prisma');
    fs.copyFileSync(sqlitePath, sqliteCopy);
    fs.copyFileSync(postgresPath, postgresCopy);
  });

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('flags drift when the model sections differ (using temporary copies)', () => {
    fs.appendFileSync(postgresCopy, '\nmodel DriftOnly { id String @id }\n');
    const result = checkSchemaSync({ sqlite: sqliteCopy, postgresql: postgresCopy }) as any;
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('model sections differ'))).toBe(true);
  });

  it('flags missing provider in a temporary copy', () => {
    const broken = fs.readFileSync(sqliteCopy, 'utf8').replace('provider = "sqlite"', 'provider = "postgresql"');
    fs.writeFileSync(sqliteCopy, broken);
    const result = checkSchemaSync({ sqlite: sqliteCopy, postgresql: postgresCopy }) as any;
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('expected "sqlite"'))).toBe(true);
  });

  it('never modifies the committed schema files under prisma/', () => {
    const before = fs.readFileSync(sqlitePath, 'utf8') + '|' + fs.readFileSync(postgresPath, 'utf8');

    // Intentionally drift the copies and run the check.
    fs.appendFileSync(postgresCopy, '\nmodel DriftOnly { id String @id }\n');
    checkSchemaSync({ sqlite: sqliteCopy, postgresql: postgresCopy });

    const after = fs.readFileSync(sqlitePath, 'utf8') + '|' + fs.readFileSync(postgresPath, 'utf8');
    expect(after).toBe(before);
  });
});
