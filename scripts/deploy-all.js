#!/usr/bin/env node

/**
 * Universal Deployment Script for Zapeera Platform
 * Builds and deploys to Web, Desktop, and Mobile
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const platforms = {
  web: args.includes('--web'),
  desktop: args.includes('--desktop'),
  mobile: args.includes('--mobile'),
  all: args.includes('--all') || args.length === 0
};

if (platforms.all) {
  platforms.web = platforms.desktop = platforms.mobile = true;
}

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function run(command, cwd = process.cwd()) {
  log(`\n▶ ${command}`, 'cyan');
  try {
    execSync(command, { stdio: 'inherit', cwd });
    return true;
  } catch (error) {
    log(`❌ Command failed: ${command}`, 'red');
    return false;
  }
}

async function deployWeb() {
  log('\n🌐 WEB DEPLOYMENT', 'bright');
  log('='.repeat(50));
  
  const frontendPath = path.join(__dirname, '..', 'frontend-zapeera-V1');
  
  if (!fs.existsSync(path.join(frontendPath, 'vercel.json'))) {
    log('⚠️ vercel.json not found. Skipping web deployment.', 'yellow');
    return false;
  }
  
  log('\n📦 Building web app...');
  if (!run('npm run build', frontendPath)) return false;
  
  log('\n🚀 Deploying to Vercel...');
  if (!run('vercel --prod', frontendPath)) return false;
  
  log('\n✅ Web deployment complete!', 'green');
  return true;
}

async function deployDesktop() {
  log('\n💻 DESKTOP DEPLOYMENT', 'bright');
  log('='.repeat(50));
  
  const frontendPath = path.join(__dirname, '..', 'frontend-zapeera-V1');
  const backendPath = path.join(__dirname, '..', 'backend-zapeera-v1-main');
  
  const platform = process.platform;
  let buildCommand;
  
  if (platform === 'win32') {
    buildCommand = 'npm run electron:dist:win:exe';
  } else if (platform === 'darwin') {
    buildCommand = 'npm run electron:dist:mac:dmg';
  } else {
    buildCommand = 'npm run electron:dist:linux';
  }
  
  log('\n📦 Building desktop app...');
  log(`Target: ${platform}`, 'cyan');
  
  if (!run('npm run build', frontendPath)) return false;
  if (!run('npm run electron:build-backend', frontendPath)) return false;
  if (!run(buildCommand, frontendPath)) return false;
  
  log('\n✅ Desktop build complete!', 'green');
  log(`Output: frontend-zapeera-V1/dist_electron/`, 'cyan');
  return true;
}

async function deployMobile() {
  log('\n📱 MOBILE DEPLOYMENT', 'bright');
  log('='.repeat(50));
  
  const frontendPath = path.join(__dirname, '..', 'frontend-zapeera-V1');
  
  if (!fs.existsSync(path.join(frontendPath, 'capacitor.config.ts'))) {
    log('⚠️ Capacitor not configured. Running setup...', 'yellow');
    if (!run('npm run mobile:setup', frontendPath)) {
      return false;
    }
  }
  
  log('\n📦 Building mobile app...');
  if (!run('npm run build', frontendPath)) return false;
  if (!run('npx cap sync', frontendPath)) return false;
  
  const platform = process.platform;
  if (platform === 'darwin') {
    log('\n🍎 iOS build available:', 'cyan');
    log('  cd ios && xcodebuild -workspace App.xcworkspace -scheme App -configuration Release', 'yellow');
  }
  
  log('\n🤖 Android build:', 'cyan');
  if (!run('npm run mobile:build:android', frontendPath)) {
    log('\n⚠️ Android build may require manual signing.', 'yellow');
  }
  
  log('\n✅ Mobile build complete!', 'green');
  return true;
}

async function main() {
  log('\n🚀 ZAPEERA UNIVERSAL DEPLOYMENT', 'bright');
  log('='.repeat(50));
  
  const startTime = Date.now();
  const results = {
    web: false,
    desktop: false,
    mobile: false
  };
  
  if (platforms.web) {
    results.web = await deployWeb();
  }
  
  if (platforms.desktop) {
    results.desktop = await deployDesktop();
  }
  
  if (platforms.mobile) {
    results.mobile = await deployMobile();
  }
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  log('\n' + '='.repeat(50));
  log('📊 DEPLOYMENT SUMMARY', 'bright');
  log('='.repeat(50));
  
  if (platforms.web) {
    log(`${results.web ? '✅' : '❌'} Web (Vercel)`, results.web ? 'green' : 'red');
  }
  if (platforms.desktop) {
    log(`${results.desktop ? '✅' : '❌'} Desktop (Electron)`, results.desktop ? 'green' : 'red');
  }
  if (platforms.mobile) {
    log(`${results.mobile ? '✅' : '❌'} Mobile (Capacitor)`, results.mobile ? 'green' : 'red');
  }
  
  log(`\n⏱️ Total time: ${duration}s`, 'cyan');
  
  log('\n📚 Next Steps:', 'bright');
  log('  • Review DEPLOYMENT.md for detailed instructions');
  log('  • Test each platform build before distribution');
  log('  • Configure code signing for production releases');
  
  const allSuccess = Object.values(results).every(r => r);
  process.exit(allSuccess ? 0 : 1);
}

main().catch(error => {
  log(`\n❌ Fatal error: ${error.message}`, 'red');
  process.exit(1);
});
