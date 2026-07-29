const Database = require('better-sqlite3');
const path = require('path');

// Database path from .env
const dbPath = 'C:/Users/Muhammad Majid/.zapeera/data/zapeera.db';

console.log('Opening database:', dbPath);
const db = new Database(dbPath);

try {
  console.log('Adding email verification columns to zapeera_users table...');
  
  // Check if columns already exist
  const columns = db.prepare("PRAGMA table_info(zapeera_users)").all();
  const columnNames = columns.map(col => col.name);
  
  console.log('Current columns in zapeera_users:', columnNames.join(', '));
  
  // Add emailVerified column if it doesn't exist
  if (!columnNames.includes('emailVerified')) {
    console.log('Adding emailVerified column...');
    db.exec('ALTER TABLE zapeera_users ADD COLUMN emailVerified INTEGER DEFAULT 0');
  } else {
    console.log('emailVerified column already exists');
  }
  
  // Add emailVerificationToken column if it doesn't exist
  if (!columnNames.includes('emailVerificationToken')) {
    console.log('Adding emailVerificationToken column...');
    db.exec('ALTER TABLE zapeera_users ADD COLUMN emailVerificationToken TEXT');
  } else {
    console.log('emailVerificationToken column already exists');
  }
  
  // Add emailVerificationExpires column if it doesn't exist
  if (!columnNames.includes('emailVerificationExpires')) {
    console.log('Adding emailVerificationExpires column...');
    db.exec('ALTER TABLE zapeera_users ADD COLUMN emailVerificationExpires TEXT');
  } else {
    console.log('emailVerificationExpires column already exists');
  }
  
  // Add welcomeEmailSent column if it doesn't exist
  if (!columnNames.includes('welcomeEmailSent')) {
    console.log('Adding welcomeEmailSent column...');
    db.exec('ALTER TABLE zapeera_users ADD COLUMN welcomeEmailSent INTEGER DEFAULT 0');
  } else {
    console.log('welcomeEmailSent column already exists');
  }
  
  // Mark all existing users as verified
  console.log('Marking all existing users as email verified...');
  const result = db.exec('UPDATE zapeera_users SET emailVerified = 1 WHERE emailVerified IS NULL OR emailVerified = 0');
  console.log('Updated users');
  
  // Check if unique index exists
  const indexes = db.prepare("PRAGMA index_list(zapeera_users)").all();
  const hasUniqueTokenIndex = indexes.some(idx => idx.name === 'zapeera_users_emailVerificationToken_key');
  
  if (!hasUniqueTokenIndex) {
    console.log('Creating unique index on emailVerificationToken...');
    try {
      db.exec('CREATE UNIQUE INDEX zapeera_users_emailVerificationToken_key ON zapeera_users(emailVerificationToken)');
    } catch (err) {
      console.log('Warning: Could not create unique index (may already exist or have NULL values):', err.message);
    }
  } else {
    console.log('Unique index on emailVerificationToken already exists');
  }
  
  // Verify the changes
  const updatedColumns = db.prepare("PRAGMA table_info(zapeera_users)").all();
  console.log('Updated columns:', updatedColumns.map(col => col.name).join(', '));
  
  // Count verified users
  const verifiedCount = db.prepare('SELECT COUNT(*) as count FROM zapeera_users WHERE emailVerified = 1').get();
  console.log(`✅ Total verified users: ${verifiedCount.count}`);
  
  console.log('✅ Successfully added email verification columns and marked users as verified');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  throw error;
} finally {
  db.close();
}
