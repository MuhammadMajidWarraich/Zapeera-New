const http = require('http');
const https = require('https');

let CLOUD_API_URL = process.env.CLOUD_API_URL || 'http://127.0.0.1:4200';
let authToken = null;

function setCloudApiUrl(url) {
  CLOUD_API_URL = url;
}

function setAuthToken(token) {
  authToken = token;
}

function getAuthToken() {
  return authToken;
}

function getCloudApiUrl() {
  return CLOUD_API_URL;
}

function isConfigured() {
  return Boolean(authToken);
}

function getBaseUrl() {
  const url = new URL(CLOUD_API_URL);
  return { hostname: url.hostname, port: url.port, protocol: url.protocol };
}

function makeRequest(method, path, body = null, opts = {}) {
  return new Promise((resolve, reject) => {
    const { hostname, port, protocol } = getBaseUrl();
    const transport = protocol === 'https:' ? https : http;
    const url = new URL(path, CLOUD_API_URL);
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    if (opts.headers) Object.assign(headers, opts.headers);

    const req = transport.request(
      {
        hostname,
        port,
        path: url.pathname + url.search,
        method,
        headers,
        timeout: opts.timeout || 15000,
        rejectUnauthorized: opts.rejectUnauthorized !== false
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              const err = new Error(parsed.message || `HTTP ${res.statusCode}`);
              err.statusCode = res.statusCode;
              err.body = parsed;
              reject(err);
            }
          } catch {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ success: true, raw: data });
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
            }
          }
        });
      }
    );

    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function checkHealth() {
  try {
    const result = await makeRequest('GET', '/health', null, { timeout: 5000 });
    return { reachable: true, status: 'ok', data: result };
  } catch (e) {
    return { reachable: false, status: 'unreachable', error: e.message };
  }
}

async function login(email, password) {
  return makeRequest('POST', '/api/auth/login', { email, password });
}

async function syncAccount() {
  return makeRequest('POST', '/api/sync/account');
}

/**
 * Device presence check-in: tells the cloud "this desktop is signed in and
 * running" so the account dashboard's "Desktop Connected" count is real.
 * Identity comes from the stored cloud auth token (the server derives the
 * user from it — never from this payload); the payload only carries the
 * device's stable id/fingerprint plus the explicit desktop marker the
 * server requires. Never throws: presence is best-effort and must not
 * break login or sync.
 */
async function checkInDevice() {
  try {
    const { getDeviceInfo } = require('../utils/device-fingerprint');
    const info = getDeviceInfo();
    return await makeRequest('POST', '/api/devices/check-in', {
      deviceId: info.deviceId,
      fingerprint: info.fingerprint,
      platform: info.platform,
      hostname: info.hostname,
      client: 'desktop'
    });
  } catch (e) {
    return { success: false, message: e.message };
  }
}

async function provisionBusiness(businessId) {
  return makeRequest('POST', '/api/sync/business/provision', { businessId });
}

async function pullChanges(businessId, cursor = null) {
  const params = new URLSearchParams({ businessId });
  if (cursor) params.set('cursor', cursor);
  return makeRequest('GET', `/api/sync/changes?${params.toString()}`);
}

async function pushOperations(businessId, operations) {
  return makeRequest('POST', '/api/sync/operations/push', { businessId, operations });
}

async function getSyncStatus() {
  return makeRequest('GET', '/api/sync/status');
}

// v1.0.8 (RC-3): push a profile saved on the desktop (name / email /
// profileImage) to the cloud. Same PUT /api/auth/update-profile the web
// app uses, authenticated with the cloud JWT this module already holds
// (set at provision, restored on boot). Rejects on non-2xx with the
// cloud's message, so callers can report/queue it.
async function updateProfile(profile) {
  return makeRequest('PUT', '/api/auth/update-profile', profile, { timeout: 8000 });
}

async function refreshAuth() {
  return makeRequest('POST', '/api/auth/refresh');
}

async function checkConnectivity() {
  return makeRequest('GET', '/api/sync/connectivity');
}

module.exports = {
  setCloudApiUrl,
  setAuthToken,
  getAuthToken,
  getCloudApiUrl,
  isConfigured,
  makeRequest,
  checkHealth,
  login,
  syncAccount,
  checkInDevice,
  provisionBusiness,
  pullChanges,
  pushOperations,
  getSyncStatus,
  updateProfile,
  refreshAuth,
  checkConnectivity,
  getBaseUrl
};
