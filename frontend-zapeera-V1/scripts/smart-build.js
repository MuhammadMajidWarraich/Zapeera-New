#!/usr/bin/env node
/**
 * Smart build script that only rebuilds what's necessary
 * Checks file modification times to avoid unnecessary rebuilds
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BUILD_CACHE_FILE = path.join(__dirname, '../.build-cache.json');

// Get last build times
function getBuildCache() {
  if (fs.existsSync(BUILD_CACHE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(BUILD_CACHE_FILE, 'utf8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

// Save build times
function saveBuildCache(cache) {
  fs.writeFileSync(BUILD_CACHE_FILE, JSON.stringify(cache, null, 2));
}

// Check if files changed since last build
function needsRebuild(sourceDir, lastBuildTime) {
  if (!lastBuildTime) return true;

  const lastBuild = new Date(lastBuildTime);
  const sourcePath = path.join(__dirname, '..', sourceDir);

  if (!fs.existsSync(sourcePath)) return true;

  // Check if any source files changed
  const files = getAllFiles(sourcePath);
  for (const file of files) {
    const stats = fs.statSync(file);
    if (stats.mtime > lastBuild) {
      return true;
    }
  }
  return false;
}

// Get all files recursively
function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      // Skip node_modules and dist folders
      if (!['node_modules', 'dist', 'dist-electron', '.git'].includes(file)) {
        getAllFiles(filePath, fileList);
      }
    } else {
      // Only check source files
      if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx') || file.endsWith('.json')) {
        fileList.push(filePath);
      }
    }
  });
  return fileList;
}

// Main build function
async function smartBuild() {
  console.log('🔍 Checking what needs to be rebuilt...\n');

  const cache = getBuildCache();
  const now = new Date().toISOString();
  const force = process.argv.includes('--force');

  let needsFrontend = force || needsRebuild('src', cache.frontend);
  let needsBackend = force || needsRebuild('../backend-zapeera-v1/src', cache.backend);

  console.log(`Frontend rebuild needed: ${needsFrontend ? '✅ YES' : '⏭️  SKIP (no changes)'}`);
  console.log(`Backend rebuild needed: ${needsBackend ? '✅ YES' : '⏭️  SKIP (no changes)'}\n`);

  try {
    // Build frontend if needed
    if (needsFrontend) {
      console.log('📦 Building frontend...');
      execSync('npm run build', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
      cache.frontend = now;
      console.log('✅ Frontend built\n');
    }

    // Build backend if needed
    if (needsBackend) {
      console.log('📦 Building backend...');
      execSync('npm run electron:build-backend', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
      cache.backend = now;
      console.log('✅ Backend built\n');
    }

    // Always run electron-builder (it's fast if nothing changed)
    console.log('📦 Packaging with electron-builder...');
    const target = process.argv.find(arg => arg.startsWith('--target='))?.split('=')[1] || 'win';
    execSync(`electron-builder --config electron-builder.json --${target} nsis`, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    });

    saveBuildCache(cache);
    console.log('\n✅ Build complete!');

  } catch (error) {
    console.error('\n❌ Build failed:', error.message);
    process.exit(1);
  }
}

smartBuild();
