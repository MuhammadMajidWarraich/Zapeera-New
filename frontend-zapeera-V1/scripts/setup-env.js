#!/usr/bin/env node

/**
 * Environment setup script for Zapeera
 * This script helps set up environment variables for different environments
 */

const fs = require('fs');
const path = require('path');

const environments = {
  development: {
    VITE_API_BASE_URL: 'http://localhost:5002/api',
    VITE_API_TIMEOUT: '30000',
    VITE_APP_NAME: 'Zapeera',
    VITE_APP_VERSION: '1.0.0',
    VITE_DEBUG_MODE: 'true',
    VITE_LOG_LEVEL: 'debug',
    VITE_ENABLE_ANALYTICS: 'false',
    VITE_ENABLE_DEBUG_LOGS: 'true',
    VITE_DEFAULT_THEME: 'light',
    VITE_ITEMS_PER_PAGE: '10'
  },
  staging: {
    VITE_API_BASE_URL: 'https://staging-api.zapeera.com/api',
    VITE_API_TIMEOUT: '30000',
    VITE_APP_NAME: 'Zapeera',
    VITE_APP_VERSION: '1.0.0',
    VITE_DEBUG_MODE: 'true',
    VITE_LOG_LEVEL: 'info',
    VITE_ENABLE_ANALYTICS: 'false',
    VITE_ENABLE_DEBUG_LOGS: 'true',
    VITE_DEFAULT_THEME: 'light',
    VITE_ITEMS_PER_PAGE: '10'
  },
  production: {
    VITE_API_BASE_URL: 'https://api.zapeera.com/api',
    VITE_API_TIMEOUT: '60000',
    VITE_APP_NAME: 'Zapeera',
    VITE_APP_VERSION: '1.0.0',
    VITE_DEBUG_MODE: 'false',
    VITE_LOG_LEVEL: 'error',
    VITE_ENABLE_ANALYTICS: 'true',
    VITE_ENABLE_DEBUG_LOGS: 'false',
    VITE_DEFAULT_THEME: 'light',
    VITE_ITEMS_PER_PAGE: '20'
  }
};

function createEnvFile(environment) {
  const envContent = Object.entries(environments[environment])
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const envPath = path.join(process.cwd(), '.env');

  fs.writeFileSync(envPath, envContent);
  console.log(`✅ Created .env file for ${environment} environment`);
  console.log(`📁 File location: ${envPath}`);
}

function showHelp() {
  console.log(`
🔧 Zapeera Environment Setup Script

Usage:
  node scripts/setup-env.js <environment>

Available environments:
  - development: Local development with debug enabled
  - staging: Staging environment with moderate logging
  - production: Production environment with minimal logging

Examples:
  node scripts/setup-env.js development
  node scripts/setup-env.js staging
  node scripts/setup-env.js production
`);
}

function main() {
  const environment = process.argv[2];

  if (!environment || !environments[environment]) {
    console.error('❌ Invalid environment specified');
    showHelp();
    process.exit(1);
  }

  try {
    createEnvFile(environment);

    console.log(`
🎉 Environment setup complete!

Next steps:
1. Review the generated .env file
2. Modify any values as needed
3. Restart your development server
4. Check the console for environment validation results

For more information, see ENVIRONMENT_SETUP.md
`);
  } catch (error) {
    console.error('❌ Error creating environment file:', error.message);
    process.exit(1);
  }
}

main();
