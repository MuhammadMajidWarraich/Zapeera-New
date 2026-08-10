#!/usr/bin/env node
/**
 * Schema parity check for the deterministic Prisma schema inputs.
 *
 * prisma/schema.sqlite.prisma and prisma/schema.postgresql.prisma MUST be
 * identical except for the datasource provider line. This script fails (exit 1)
 * if the model sections drift, which would silently produce two divergent
 * database schemas across web/desktop deployments.
 *
 * Usage: node scripts/check-schema-sync.js
 * Exits 0 when the two schemas are in sync, 1 otherwise.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SQLITE_SCHEMA = path.join(__dirname, '..', 'prisma', 'schema.sqlite.prisma');
const POSTGRESQL_SCHEMA = path.join(__dirname, '..', 'prisma', 'schema.postgresql.prisma');

/**
 * Extract everything after the datasource block (generator + models + comments).
 * Header comments and the datasource block itself are excluded because they
 * legitimately differ between the two files.
 */
function extractModelSection(schemaText) {
  const datasourceMatch = schemaText.match(/datasource\s+[\w]+\s*\{[\s\S]*?\n\}/);
  if (!datasourceMatch) {
    return '';
  }
  return schemaText.slice(datasourceMatch.index + datasourceMatch[0].length).replace(/^\s*\n/, '');
}

function readProvider(schemaText) {
  const match = schemaText.match(/datasource\s+[\w]+\s*\{[\s\S]*?provider\s*=\s*"(\w+)"/);
  return match ? match[1] : null;
}

/**
 * Pure parity check — usable from tests.
 */
function checkSchemaSync(schemaPaths = { sqlite: SQLITE_SCHEMA, postgresql: POSTGRESQL_SCHEMA }) {
  const sqliteText = fs.readFileSync(schemaPaths.sqlite, 'utf8');
  const postgresText = fs.readFileSync(schemaPaths.postgresql, 'utf8');

  const sqliteProvider = readProvider(sqliteText);
  const postgresProvider = readProvider(postgresText);

  const errors = [];
  if (sqliteProvider !== 'sqlite') {
    errors.push(`schema.sqlite.prisma datasource provider is "${sqliteProvider}", expected "sqlite"`);
  }
  if (postgresProvider !== 'postgresql') {
    errors.push(`schema.postgresql.prisma datasource provider is "${postgresProvider}", expected "postgresql"`);
  }

  const sqliteModels = extractModelSection(sqliteText);
  const postgresModels = extractModelSection(postgresText);

  if (sqliteModels !== postgresModels) {
    errors.push('model sections differ between schema.sqlite.prisma and schema.postgresql.prisma');
  }

  return { ok: errors.length === 0, errors, sqliteProvider, postgresProvider };
}

module.exports = { checkSchemaSync, extractModelSection, SQLITE_SCHEMA, POSTGRESQL_SCHEMA };

if (require.main === module) {
  try {
    const result = checkSchemaSync();
    if (!result.ok) {
      console.error('[Schema Sync] ❌ Prisma schema drift detected:');
      for (const error of result.errors) {
        console.error(`   - ${error}`);
      }
      console.error('[Schema Sync] ℹ️  Regenerate both files from one source of truth and keep them identical except the datasource provider.');
      process.exit(1);
    }
    console.log(
      `[Schema Sync] ✅ SQLite (${result.sqliteProvider}) and PostgreSQL (${result.postgresProvider}) schemas are in sync`
    );
  } catch (error) {
    console.error('[Schema Sync] ❌ Failed to verify schemas:', error.message);
    process.exit(1);
  }
}
