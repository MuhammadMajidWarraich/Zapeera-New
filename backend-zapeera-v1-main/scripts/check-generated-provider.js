#!/usr/bin/env node
/**
 * Verify the currently generated Prisma client provider.
 *
 * Usage: node scripts/check-generated-provider.js <sqlite|postgresql>
 * Exits 0 when the generated client matches the requested mode, 1 otherwise.
 * Never prints DATABASE_URL or other secrets.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const expected = String(process.argv[2] || '').toLowerCase();
if (!['sqlite', 'postgresql'].includes(expected)) {
  console.error('[Check Provider] ❌ Usage: node scripts/check-generated-provider.js <sqlite|postgresql>');
  process.exit(1);
}

const generatedSchema = path.join(__dirname, '..', 'node_modules', '.prisma', 'client', 'schema.prisma');
if (!fs.existsSync(generatedSchema)) {
  console.error(`[Check Provider] ❌ No generated client found (${generatedSchema}). Run node scripts/generate-client.js ${expected} first.`);
  process.exit(1);
}

const text = fs.readFileSync(generatedSchema, 'utf8');
const match = text.match(/datasource\s+\w+\s*\{[\s\S]*?provider\s*=\s*"(\w+)"/);
const actual = match ? match[1].toLowerCase() : null;

if (actual !== expected) {
  console.error(`[Check Provider] ❌ Expected generated provider "${expected}" but found "${actual}".`);
  process.exit(1);
}

console.log(`[Check Provider] ✅ Generated provider is "${actual}"`);
