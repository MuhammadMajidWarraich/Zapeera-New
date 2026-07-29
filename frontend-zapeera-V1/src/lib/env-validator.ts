/**
 * Environment variable validation utilities
 */

import { config } from './config';

/**
 * Validates that all required environment variables are present
 */
export function validateEnvironment(): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check required API configuration
  if (!config.api.baseUrl) {
    errors.push('VITE_API_BASE_URL is required');
  }

  // Validate API URL format
  if (config.api.baseUrl && !isValidUrl(config.api.baseUrl)) {
    errors.push('VITE_API_BASE_URL must be a valid URL');
  }

  // Validate timeout is a positive number
  if (config.api.timeout <= 0) {
    errors.push('VITE_API_TIMEOUT must be a positive number');
  }

  // Validate log level
  const validLogLevels = ['error', 'warn', 'info', 'debug'];
  if (!validLogLevels.includes(config.debug.logLevel)) {
    errors.push(`VITE_LOG_LEVEL must be one of: ${validLogLevels.join(', ')}`);
  }

  // Validate theme
  const validThemes = ['light', 'dark'];
  if (!validThemes.includes(config.ui.defaultTheme)) {
    errors.push(`VITE_DEFAULT_THEME must be one of: ${validThemes.join(', ')}`);
  }

  // Validate items per page
  if (config.ui.itemsPerPage <= 0) {
    errors.push('VITE_ITEMS_PER_PAGE must be a positive number');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Checks if a string is a valid URL or relative path
 */
function isValidUrl(urlString: string): boolean {
  // Relative paths (starting with /) are valid for same-origin + proxy setups
  if (urlString.startsWith('/')) return true;
  try {
    new URL(urlString);
    return true;
  } catch {
    return false;
  }
}

/**
 * Logs environment configuration (only in debug mode)
 */
export function logEnvironmentConfig(): void {
  if (config.debug.enabled) {
    console.group('🔧 Environment Configuration');
    console.log('API Base URL:', config.api.baseUrl);
    console.log('API Timeout:', config.api.timeout);
    console.log('App Name:', config.app.name);
    console.log('App Version:', config.app.version);
    console.log('Debug Mode:', config.debug.enabled);
    console.log('Log Level:', config.debug.logLevel);
    console.log('Analytics Enabled:', config.features.analytics);
    console.log('Debug Logs Enabled:', config.features.debugLogs);
    console.log('Default Theme:', config.ui.defaultTheme);
    console.log('Items Per Page:', config.ui.itemsPerPage);
    console.groupEnd();
  }
}

/**
 * Gets environment-specific configuration recommendations
 */
export function getEnvironmentRecommendations(): string[] {
  const recommendations: string[] = [];

  // Development recommendations
  if (config.api.baseUrl.includes('localhost')) {
    recommendations.push('Using local development API');
    if (!config.debug.enabled) {
      recommendations.push('Consider enabling VITE_DEBUG_MODE=true for development');
    }
  }

  // Production recommendations
  if (config.api.baseUrl.includes('https://')) {
    if (config.debug.enabled) {
      recommendations.push('Consider disabling VITE_DEBUG_MODE=false for production');
    }
    if (!config.features.analytics) {
      recommendations.push('Consider enabling VITE_ENABLE_ANALYTICS=true for production');
    }
  }

  // Performance recommendations
  if (config.api.timeout < 10000) {
    recommendations.push('Consider increasing VITE_API_TIMEOUT for better reliability');
  }

  if (config.ui.itemsPerPage > 50) {
    recommendations.push('Consider reducing VITE_ITEMS_PER_PAGE for better performance');
  }

  return recommendations;
}
