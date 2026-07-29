#!/usr/bin/env node

/**
 * Setup script for Capacitor mobile platforms
 * Run: node scripts/setup-capacitor.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('📱 Setting up Capacitor for mobile platforms...\n');

// Check if Capacitor is installed
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const hasCapacitor = packageJson.devDependencies?.['@capacitor/cli'] || 
                     packageJson.dependencies?.['@capacitor/core'];

if (!hasCapacitor) {
  console.log('📦 Installing Capacitor dependencies...');
  try {
    execSync('npm install @capacitor/core @capacitor/cli --save', { stdio: 'inherit' });
    execSync('npm install @capacitor/android @capacitor/ios --save-dev', { stdio: 'inherit' });
    execSync('npm install @capacitor/status-bar @capacitor/splash-screen @capacitor/push-notifications @capacitor/local-notifications --save', { stdio: 'inherit' });
    console.log('✅ Capacitor dependencies installed\n');
  } catch (error) {
    console.error('❌ Failed to install Capacitor dependencies:', error.message);
    process.exit(1);
  }
}

// Check if build exists
if (!fs.existsSync('dist')) {
  console.log('🔨 Building web app first...');
  try {
    execSync('npm run build', { stdio: 'inherit' });
    console.log('✅ Build completed\n');
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
  }
}

// Add platforms
console.log('🤖 Adding Android platform...');
try {
  if (!fs.existsSync('android')) {
    execSync('npx cap add android', { stdio: 'inherit' });
  } else {
    console.log('   Android platform already exists');
  }
  console.log('✅ Android platform ready\n');
} catch (error) {
  console.error('❌ Failed to add Android platform:', error.message);
}

console.log('🍎 Adding iOS platform...');
try {
  if (!fs.existsSync('ios')) {
    execSync('npx cap add ios', { stdio: 'inherit' });
  } else {
    console.log('   iOS platform already exists');
  }
  console.log('✅ iOS platform ready\n');
} catch (error) {
  console.error('❌ Failed to add iOS platform:', error.message);
  console.log('   Note: iOS requires macOS and Xcode\n');
}

// Sync web assets
console.log('🔄 Syncing web assets to mobile platforms...');
try {
  execSync('npx cap sync', { stdio: 'inherit' });
  console.log('✅ Sync completed\n');
} catch (error) {
  console.error('❌ Sync failed:', error.message);
}

console.log('🎉 Capacitor setup complete!\n');
console.log('Next steps:');
console.log('  Android: cd android && ./gradlew assembleDebug');
console.log('           or open android folder in Android Studio');
console.log('  iOS:     cd ios && xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug');
console.log('           or open ios/App.xcworkspace in Xcode');
console.log('\nDevelopment:');
console.log('  npm run mobile:dev:android - Run on Android device/emulator');
console.log('  npm run mobile:dev:ios     - Run on iOS device/simulator');
