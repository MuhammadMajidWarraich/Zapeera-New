/**
 * Database Configuration
 * Extracted from embedded-server.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

let DATA_DIR = path.join(os.homedir(), '.zapeera', 'data');
let DB_PATH = path.join(DATA_DIR, 'zapeera.db');

function setDatabasePath(userDataPath) {
  const normalizedPath = path.normalize(userDataPath);
  DATA_DIR = path.join(normalizedPath, 'data');
  DB_PATH = path.join(DATA_DIR, 'zapeera.db');
  console.log('[DB] Database path set to:', DB_PATH);
  console.log('[DB] Platform:', process.platform);
  console.log('[DB] This path will be deleted on uninstall, ensuring fresh database on each installation');

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      console.log('[DB] ✅ Created data directory:', DATA_DIR);
    } else {
      console.log('[DB] ✅ Data directory already exists:', DATA_DIR);
    }
    
    // Verify directory is writable
    try {
      const testFile = path.join(DATA_DIR, '.test-write');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      console.log('[DB] ✅ Data directory is writable');
    } catch (writeError) {
      console.error('[DB] ❌ Data directory is NOT writable:', writeError.message);
      throw new Error(`Database directory is not writable: ${DATA_DIR}`);
    }
  } catch (error) {
    console.error('[DB] ❌ Failed to setup database directory:', error.message);
    throw error;
  }
}

function getDatabasePath() {
  return DB_PATH;
}

function getDataDir() {
  return DATA_DIR;
}

// Ensure default data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

module.exports = {
  setDatabasePath,
  getDatabasePath,
  getDataDir,
  DATA_DIR,
  DB_PATH
};

