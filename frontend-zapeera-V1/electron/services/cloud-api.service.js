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
  provisionBusiness,
  pullChanges,
  pushOperations,
  getSyncStatus,
  refreshAuth,
  checkConnectivity,
  getBaseUrl
};
