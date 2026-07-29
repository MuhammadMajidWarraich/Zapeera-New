/**
 * Activation Routes
 * Extracted from routes/index.js
 */

function registerActivationRoutes(app, authMiddleware, deps) {
  const { query, run, getDatabase, getActiveDatabase, insertIntoActiveDatabase, 
          queryActiveDatabase, updateInActiveDatabase, deleteInActiveDatabase,
          handleDataChange, getDataFilter, uuid, now, hashPassword, generateToken,
          verifyToken, getDeviceId, getDeviceInfo, REMOTE_DATABASE_URL, SYNC_CONFIG,
          connectPostgreSQL, checkPostgreSQLConnection, syncAllToPostgreSQL,
          pullAllFromPostgreSQL, processOfflineQueue, startPeriodicSync,
          markTableForPush, queueOfflineOperation, loadOfflineQueue, saveOfflineQueue,
          createRecordPostgreSQLFirst, mapRowForPostgreSQL, getPostgreSQLColumns,
          getSQLiteColumns, pgRowToSqlite, normalizeValue, getWeekNumber, getDateFromWeek,
          getDatabasePath, getDataDir, OFFLINE_ACCESS_HOURS, bcryptjs, getPgClient, getIsOnline, getSyncInProgress, getLastSyncTime, getOfflineQueue,
          saveDatabase, initDatabase } = deps;

// POST /api/activation/register (line 157)
      app.post('/api/activation/register', async (req, res) => {
        try {
          const deviceInfo = getDeviceInfo();
          const { licenseKey, userId, companyId, branchId, notes } = req.body;
    
          console.log('[Activation] Registering device:', deviceInfo.deviceId);
    
          // Check if device already registered
          const existing = query('SELECT * FROM device_activation WHERE deviceId = ?', [deviceInfo.deviceId])[0];
    
          if (existing) {
            return res.json({
              success: true,
              data: {
                deviceId: existing.deviceId,
                status: existing.status,
                message: 'Device already registered. Waiting for activation.'
              }
            });
          }
    
          // Try to register with server (PostgreSQL)
          let serverResponse = null;
          if (REMOTE_DATABASE_URL) {
            try {
              const pg = await connectPostgreSQL();
              if (pg) {
                const result = await pg.query(`
                  INSERT INTO device_activation (id, device_id, fingerprint, status, license_key, user_id, company_id, branch_id, platform, hostname, mac_address, notes, created_at, updated_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
                  ON CONFLICT (device_id) DO UPDATE SET updated_at = NOW()
                  RETURNING *
                `, [
                  uuid(),
                  deviceInfo.deviceId,
                  deviceInfo.fingerprint,
                  'PENDING',
                  licenseKey || null,
                  userId || null,
                  companyId || null,
                  branchId || null,
                  deviceInfo.platform,
                  deviceInfo.hostname,
                  deviceInfo.macAddress,
                  notes || null
                ]);
    
                if (result.rows && result.rows.length > 0) {
                  serverResponse = result.rows[0];
                }
              }
            } catch (pgError) {
              console.log('[Activation] Could not register with server (will store locally):', pgError.message);
            }
          }
    
          // Store locally in SQLite
          const id = uuid();
          const timestamp = now();
          const insertSuccess = run(`
            INSERT INTO device_activation (id, deviceId, fingerprint, status, licenseKey, userId, companyId, branchId, platform, hostname, macAddress, notes, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            id,
            deviceInfo.deviceId,
            deviceInfo.fingerprint,
            'PENDING',
            licenseKey || null,
            userId || null,
            companyId || null,
            branchId || null,
            deviceInfo.platform,
            deviceInfo.hostname,
            deviceInfo.macAddress,
            notes || null,
            timestamp,
            timestamp
          ]);
    
          if (!insertSuccess) {
            return res.status(500).json({ success: false, message: 'Failed to register device' });
          }
    
          res.json({
            success: true,
            data: {
              deviceId: deviceInfo.deviceId,
              status: 'PENDING',
              message: 'Device registered successfully. Waiting for administrator activation.',
              serverRegistered: !!serverResponse
            }
          });
        } catch (e) {
          console.error('[Activation] Register error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/activation/status (line 256)
      app.get('/api/activation/status', (req, res) => {
        try {
          const status = checkActivationStatus();
          res.json({ success: true, data: status });
        } catch (e) {
          console.error('[Activation] Status check error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // POST /api/activation/verify (line 267)
      app.post('/api/activation/verify', async (req, res) => {
        try {
          const deviceId = getDeviceId();
          const activation = query('SELECT * FROM device_activation WHERE deviceId = ?', [deviceId])[0];
    
          if (!activation) {
            return res.json({
              success: false,
              data: { activated: false, status: 'PENDING', message: 'Device not registered' }
            });
          }
    
          // Try to verify with server
          let serverStatus = null;
          if (REMOTE_DATABASE_URL) {
            try {
              const pg = await connectPostgreSQL();
              if (pg) {
                const result = await pg.query(`
                  SELECT * FROM device_activation WHERE device_id = $1
                `, [deviceId]);
    
                if (result.rows && result.rows.length > 0) {
                  serverStatus = result.rows[0];
    
                  // Update local status from server
                  const serverActivation = serverStatus;
                  const timestamp = now();
    
                  // Calculate offline access expiry (72 hours from now if active)
                  let offlineExpiresAt = null;
                  if (serverActivation.status === 'ACTIVE') {
                    const expiryDate = new Date();
                    expiryDate.setHours(expiryDate.getHours() + OFFLINE_ACCESS_HOURS);
                    offlineExpiresAt = expiryDate.toISOString();
                  }
    
                  run(`
                    UPDATE device_activation
                    SET status = ?, lastVerifiedAt = ?, lastVerifiedStatus = ?, offlineAccessExpiresAt = ?, updatedAt = ?
                    WHERE deviceId = ?
                  `, [
                    serverActivation.status,
                    timestamp,
                    serverActivation.status,
                    offlineExpiresAt,
                    timestamp,
                    deviceId
                  ]);
    
                  // If deactivated, return special status
                  if (serverActivation.status !== 'ACTIVE') {
                    return res.json({
                      success: true,
                      data: {
                        activated: false,
                        status: serverActivation.status,
                        message: 'Device has been deactivated by administrator',
                        requiresLogout: true
                      }
                    });
                  }
                }
              }
            } catch (pgError) {
              console.log('[Activation] Could not verify with server (using local status):', pgError.message);
            }
          }
    
          // Check local status
          const localStatus = checkActivationStatus();
    
          res.json({
            success: true,
            data: {
              ...localStatus,
              lastVerifiedAt: activation.lastVerifiedAt,
              serverVerified: !!serverStatus
            }
          });
        } catch (e) {
          console.error('[Activation] Verify error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

}

module.exports = {
  registerActivationRoutes
};
