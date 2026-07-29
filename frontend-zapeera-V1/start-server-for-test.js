/**
 * Start embedded server for testing
 */

const path = require('path');
const os = require('os');

// Get userData path (similar to Electron app.getPath('userData'))
const userDataPath = path.join(os.homedir(), '.zapeera-test-db');

console.log('Starting embedded server for testing...');
console.log('Database path:', userDataPath);
console.log('Port: 5001');
console.log('');

const { startServer } = require('./electron/embedded-server.js');

startServer(5001, userDataPath)
  .then((server) => {
    console.log('');
    console.log('✅ Server started successfully!');
    console.log('✅ Listening on http://127.0.0.1:5001');
    console.log('');
    console.log('Server is running. Press Ctrl+C to stop.');
    console.log('');
  })
  .catch((error) => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  });

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  process.exit(0);
});

