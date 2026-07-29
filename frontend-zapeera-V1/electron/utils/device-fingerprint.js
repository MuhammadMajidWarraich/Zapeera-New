/**
 * Device Fingerprinting Utility
 * Generates unique device ID based on machine characteristics
 */

const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Get machine-specific information for fingerprinting
 */
function getMachineInfo() {
  const info = {
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    cpus: os.cpus().map(cpu => ({
      model: cpu.model,
      speed: cpu.speed
    })),
    totalMemory: os.totalmem(),
    macAddress: getPrimaryMacAddress()
  };

  return info;
}

/**
 * Get primary MAC address
 */
function getPrimaryMacAddress() {
  const interfaces = os.networkInterfaces();

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (addrs) {
      const addr = addrs.find(a => !a.internal && a.mac !== '00:00:00:00:00:00');
      if (addr) {
        return addr.mac;
      }
    }
  }

  return 'unknown';
}

/**
 * Generate device fingerprint hash
 */
function generateDeviceFingerprint() {
  const machineInfo = getMachineInfo();

  // Create a stable string from machine info
  const fingerprintString = JSON.stringify({
    platform: machineInfo.platform,
    arch: machineInfo.arch,
    hostname: machineInfo.hostname,
    mac: machineInfo.macAddress,
    cpus: machineInfo.cpus.length,
    totalMemory: machineInfo.totalMemory
  });

  // Generate SHA-256 hash
  const hash = crypto.createHash('sha256').update(fingerprintString).digest('hex');

  return hash;
}

/**
 * Get or create device ID (persistent across app restarts)
 */
function getDeviceId() {
  const deviceIdPath = path.join(os.homedir(), '.zapeera', 'device-id.txt');
  const deviceDir = path.dirname(deviceIdPath);

  // Ensure directory exists
  if (!fs.existsSync(deviceDir)) {
    fs.mkdirSync(deviceDir, { recursive: true });
  }

  // Try to read existing device ID
  if (fs.existsSync(deviceIdPath)) {
    try {
      const existingId = fs.readFileSync(deviceIdPath, 'utf8').trim();
      if (existingId && existingId.length > 0) {
        return existingId;
      }
    } catch (e) {
      console.log('[Device] Could not read existing device ID:', e.message);
    }
  }

  // Generate new device ID
  const fingerprint = generateDeviceFingerprint();
  const deviceId = `DEV-${fingerprint.substring(0, 16).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

  // Save device ID
  try {
    fs.writeFileSync(deviceIdPath, deviceId, 'utf8');
    console.log('[Device] Generated new device ID:', deviceId);
  } catch (e) {
    console.error('[Device] Could not save device ID:', e.message);
  }

  return deviceId;
}

/**
 * Get device information for activation request
 */
function getDeviceInfo() {
  const machineInfo = getMachineInfo();

  return {
    deviceId: getDeviceId(),
    fingerprint: generateDeviceFingerprint(),
    platform: machineInfo.platform,
    arch: machineInfo.arch,
    hostname: machineInfo.hostname,
    macAddress: machineInfo.macAddress,
    cpuCount: machineInfo.cpus.length,
    totalMemory: machineInfo.totalMemory,
    appVersion: process.env.npm_package_version || '1.0.0',
    electronVersion: process.versions.electron || 'unknown',
    nodeVersion: process.versions.node
  };
}

module.exports = {
  getDeviceId,
  getDeviceInfo,
  generateDeviceFingerprint,
  getMachineInfo
};
