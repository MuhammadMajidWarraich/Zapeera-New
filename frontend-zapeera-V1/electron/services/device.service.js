/**
 * Device Service
 * Manages device registration, activation, and linking to user accounts.
 * Follows cloud-first architecture: device must be authorized on cloud before local use.
 */

const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs');

let getDeviceId = null;
let getDeviceInfo = null;
try {
  const deviceUtils = require('../utils/device-fingerprint.js');
  getDeviceId = deviceUtils.getDeviceId;
  getDeviceInfo = deviceUtils.getDeviceInfo;
} catch (e) {
  getDeviceId = () => {
    const deviceIdPath = path.join(os.homedir(), '.zapeera', 'device-id.txt');
    if (fs.existsSync(deviceIdPath)) {
      return fs.readFileSync(deviceIdPath, 'utf8').trim();
    }
    const id = 'DEV-' + crypto.randomBytes(8).toString('hex').toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
    const deviceDir = path.dirname(deviceIdPath);
    if (!fs.existsSync(deviceDir)) {
      fs.mkdirSync(deviceDir, { recursive: true });
    }
    fs.writeFileSync(deviceIdPath, id, 'utf8');
    return id;
  };
  getDeviceInfo = () => ({
    deviceId: getDeviceId(),
    fingerprint: crypto.createHash('sha256').update(os.hostname() + os.platform() + os.arch()).digest('hex'),
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname()
  });
}

let _query = null;
let _run = null;
let _saveDatabase = null;
let _uuid = null;
let _now = null;

function init(deps) {
  _query = deps.query;
  _run = deps.run;
  _saveDatabase = deps.saveDatabase;
  _uuid = deps.uuid;
  _now = deps.now;
}

function ensureInit() {
  if (!_query) {
    const deps = require('./database.service');
    _query = deps.query;
    _run = deps.run;
    _saveDatabase = deps.saveDatabase;
    _uuid = require('../utils/helpers').uuid;
    _now = require('../utils/helpers').now;
  }
}

function registerDevice(userId) {
  ensureInit();
  const deviceId = getDeviceId();
  const deviceInfo = getDeviceInfo();
  const timestamp = _now();

  const existing = _query('SELECT id, userId FROM device_activation WHERE deviceId = ?', [deviceId]);

  if (existing && existing.length > 0) {
    const record = existing[0];
    _run(`UPDATE device_activation SET userId = ?, lastVerifiedAt = ?, updatedAt = ? WHERE deviceId = ?`,
      [userId, timestamp, timestamp, deviceId]);
    _saveDatabase();
    return { registered: true, deviceId, updated: true };
  }

  _run(`
    INSERT INTO device_activation
    (id, deviceId, fingerprint, platform, hostname, macAddress, status, userId, activatedBy, activatedAt, lastVerifiedAt, offlineAccessExpiresAt, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?)
  `, [
    'dev-' + deviceId,
    deviceId,
    deviceInfo.fingerprint || '',
    deviceInfo.platform || '',
    deviceInfo.hostname || '',
    deviceInfo.macAddress || '',
    userId,
    'system',
    timestamp,
    timestamp,
    computeOfflineExpiry(),
    timestamp,
    timestamp
  ]);

  _saveDatabase();
  return { registered: true, deviceId, updated: false };
}

function getDevice(deviceId) {
  ensureInit();
  const results = _query('SELECT * FROM device_activation WHERE deviceId = ?', [deviceId || getDeviceId()]);
  return results && results.length > 0 ? results[0] : null;
}

function isDeviceActive(deviceId) {
  const device = getDevice(deviceId);
  if (!device) return false;
  if (device.status !== 'ACTIVE') return false;
  const offlineExpiry = device.offlineAccessExpiresAt;
  if (offlineExpiry && new Date(offlineExpiry) < new Date()) return false;
  return true;
}

function revokeDevice(deviceId) {
  ensureInit();
  _run(`UPDATE device_activation SET status = 'REVOKED', updatedAt = ? WHERE deviceId = ?`,
    [_now(), deviceId]);
  _saveDatabase();
}

function computeOfflineExpiry(hours = 72) {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

function getDeviceIdExport() {
  return getDeviceId();
}

function getDeviceInfoExport() {
  return getDeviceInfo();
}

module.exports = {
  init,
  registerDevice,
  getDevice,
  isDeviceActive,
  revokeDevice,
  getDeviceId: getDeviceIdExport,
  getDeviceInfo: getDeviceInfoExport
};
