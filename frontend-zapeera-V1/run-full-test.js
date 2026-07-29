/**
 * Complete test: Start server -> Run test -> Stop server
 */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const userDataPath = path.join(os.homedir(), '.zapeera-test-db');
const { startServer, stopServer } = require('./electron/embedded-server.js');

let server = null;

async function runFullTest() {
  console.log('='.repeat(60));
  console.log('🚀 STARTING FULL TEST SUITE');
  console.log('='.repeat(60));
  console.log('');

  try {
    // Step 1: Start server
    console.log('📡 Starting embedded server...');
    server = await startServer(5001, userDataPath);
    console.log('✅ Server started on http://127.0.0.1:5001');
    console.log('');

    // Step 2: Wait for server to be ready
    console.log('⏳ Waiting 3 seconds for server to initialize...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log('');

    // Step 3: Run test
    console.log('🧪 Running staff creation test...');
    console.log('');
    
    const testCode = await new Promise((resolve, reject) => {
      const testProcess = spawn('node', ['test-staff-flow.js'], {
        cwd: __dirname,
        stdio: 'inherit',
        shell: true
      });

      testProcess.on('close', (code) => {
        resolve(code);
      });

      testProcess.on('error', (error) => {
        console.error('❌ Test process error:', error);
        reject(error);
      });
    });

    console.log('');
    console.log('='.repeat(60));
    if (testCode === 0) {
      console.log('✅ TEST COMPLETED');
    } else {
      console.log('❌ TEST FAILED WITH CODE:', testCode);
    }
    console.log('='.repeat(60));
    
    return testCode;

  } catch (error) {
    console.error('❌ Test suite error:', error);
    return 1;
  } finally {
    // Step 4: Stop server
    if (server) {
      console.log('');
      console.log('🛑 Stopping server...');
      try {
        stopServer();
        console.log('✅ Server stopped');
      } catch (error) {
        console.error('⚠️  Error stopping server:', error.message);
      }
    }
  }
}

// Run the full test
runFullTest()
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

