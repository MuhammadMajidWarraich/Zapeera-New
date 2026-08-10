import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
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

  it('flags drift when the model sections differ', () => {
    const original = fs.readFileSync(postgresPath, 'utf8');
    try {
      fs.writeFileSync(postgresPath, original + '\nmodel DriftOnly { id String @id }\n');
      const result = checkSchemaSync() as any;
      expect(result.ok).toBe(false);
      expect(result.errors.some((e: string) => e.includes('model sections differ'))).toBe(true);
    } finally {
      fs.writeFileSync(postgresPath, original);
    }
  });

  it('extractModelSection excludes the datasource block but keeps models', () => {
    const sqlite = fs.readFileSync(sqlitePath, 'utf8');
    const section = extractModelSection(sqlite) as string;
    expect(section).toContain('model ZapeeraUser');
    expect(section).not.toContain('datasource db');
  });
});
