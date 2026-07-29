/**
 * Add sync columns (updated_at, created_at, is_synced) to PostgreSQL tables
 * Run: npm run db:add-sync-columns
 */

import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

async function addSyncColumns() {
  // Try to find PostgreSQL URL (same logic as database service)
  let postgresUrl = process.env.REMOTE_DATABASE_URL ||
                   process.env.POSTGRESQL_URL ||
                   process.env.POSTGRES_URL;

  // If not found, try common URLs
  if (!postgresUrl || !postgresUrl.startsWith('postgresql://')) {
    const os = require('os');
    const currentUser = os.userInfo().username;

    const commonUrls = [
      `postgresql://${currentUser}@localhost:5432/zapeera`,
      `postgresql://${currentUser}@localhost:5432/postgres`,
      'postgresql://postgres:postgres@localhost:5432/zapeera',
      'postgresql://postgres:postgres@localhost:5432/postgres',
    ];

    console.log('🔍 Trying to find PostgreSQL URL...');

    for (const url of commonUrls) {
      try {
        const testClient = new Client({ connectionString: url });
        await testClient.connect();
        await testClient.query('SELECT 1');
        await testClient.end();
        postgresUrl = url;
        console.log(`✅ Found PostgreSQL: ${url.replace(/:[^:@]+@/, ':****@')}`);
        break;
      } catch (error) {
        // Continue to next URL
      }
    }
  }

  if (!postgresUrl || !postgresUrl.startsWith('postgresql://')) {
    console.error('❌ PostgreSQL URL not configured');
    console.error('💡 Set REMOTE_DATABASE_URL in .env file');
    console.error('💡 Or ensure PostgreSQL is running on localhost:5432');
    process.exit(1);
  }

  const client = new Client({
    connectionString: postgresUrl
  });

  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL');

    // Get all tables
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name NOT LIKE '_prisma%'
      ORDER BY table_name
    `);

    const tables = tablesResult.rows.map(row => row.table_name);
    console.log(`📋 Found ${tables.length} tables to update`);

    let updated = 0;
    let skipped = 0;

    for (const table of tables) {
      try {
        const columns: string[] = [];
        const alterStatements: string[] = [];

        // Check and add updated_at
        const hasUpdatedAt = await client.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = $1
            AND column_name = 'updated_at'
          )
        `, [table]);

        if (!hasUpdatedAt.rows[0].exists) {
          alterStatements.push(`ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
        }

        // Check and add created_at
        const hasCreatedAt = await client.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = $1
            AND column_name = 'created_at'
          )
        `, [table]);

        if (!hasCreatedAt.rows[0].exists) {
          alterStatements.push(`ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
        }

        // Check and add is_synced
        const hasIsSynced = await client.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = $1
            AND column_name = 'is_synced'
          )
        `, [table]);

        if (!hasIsSynced.rows[0].exists) {
          alterStatements.push(`ADD COLUMN is_synced BOOLEAN DEFAULT true`);
        }

        if (alterStatements.length > 0) {
          const alterQuery = `ALTER TABLE "${table}" ${alterStatements.join(', ')}`;
          await client.query(alterQuery);
          console.log(`✅ Updated table: ${table} (added ${alterStatements.length} columns)`);
          updated++;
        } else {
          console.log(`⏭️  Skipped table: ${table} (columns already exist)`);
          skipped++;
        }
      } catch (error: any) {
        console.error(`❌ Error updating table ${table}:`, error.message);
      }
    }

    console.log('\n📊 Summary:');
    console.log(`   ✅ Updated: ${updated} tables`);
    console.log(`   ⏭️  Skipped: ${skipped} tables`);
    console.log(`   📋 Total: ${tables.length} tables`);

    await client.end();
    console.log('\n✅ Done!');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    await client.end();
    process.exit(1);
  }
}

addSyncColumns();
