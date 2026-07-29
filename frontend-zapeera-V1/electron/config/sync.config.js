/**
 * Sync Configuration
 */

// Cloud API configuration
// The Desktop app communicates with the Cloud Backend via HTTPS.
// Set ZAPEERA_CLOUD_API_URL or CLOUD_API_URL in deployment environment.
const CLOUD_API_URL =
  process.env.ZAPEERA_CLOUD_API_URL ||
  process.env.CLOUD_API_URL ||
  'http://localhost:3000';

const SYNC_CONFIG = {
  POLL_INTERVAL: 5000,
  FULL_SYNC_INTERVAL: 15000,
  PUSH_DEBOUNCE: 2000,
  MAX_QUEUE_SIZE: 1000,
  RETRY_ATTEMPTS: 3,
  BATCH_SIZE: 100
};

module.exports = {
  CLOUD_API_URL,
  SYNC_CONFIG
};
