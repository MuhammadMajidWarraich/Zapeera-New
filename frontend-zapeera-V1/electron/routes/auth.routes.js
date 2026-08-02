/**
 * Auth Routes
 * Extracted from routes/index.js
 */

function registerAuthRoutes(app, authMiddleware, deps) {
  const { query, run, getDatabase, getActiveDatabase, insertIntoActiveDatabase, 
          queryActiveDatabase, updateInActiveDatabase, deleteInActiveDatabase,
          handleDataChange, getDataFilter, uuid, now, hashPassword, generateToken,
          verifyToken, verifyProvisioningToken, getDeviceId, getDeviceInfo, REMOTE_DATABASE_URL, SYNC_CONFIG,
          connectPostgreSQL, checkPostgreSQLConnection, syncAllToPostgreSQL,
          pullAllFromPostgreSQL, processOfflineQueue, startPeriodicSync,
          markTableForPush, queueOfflineOperation, loadOfflineQueue, saveOfflineQueue,
          createRecordPostgreSQLFirst, mapRowForPostgreSQL, getPostgreSQLColumns,
          getSQLiteColumns, pgRowToSqlite, normalizeValue, getWeekNumber, getDateFromWeek,
          getDatabasePath, getDataDir, OFFLINE_ACCESS_HOURS, bcryptjs, getPgClient, getIsOnline, getSyncInProgress, getLastSyncTime, getOfflineQueue,
          saveDatabase, initDatabase, deviceService, sessionService, syncAccountService, authRefreshService } = deps;

// POST /api/auth/register (line 354)
      app.post('/api/auth/register', async (req, res) => {
        try {
          const email = (req.body.email || req.body.username || '').toLowerCase().trim();
          const password = req.body.password;
          const name = req.body.name;
          const role = req.body.role || 'ADMIN';
          const branchId = req.body.branchId;
    
          console.log('[Auth] Register attempt:', email);
    
          if (!email || !password || !name) {
            return res.status(400).json({ success: false, message: 'Email, password, and name are required' });
          }
    
          // Check if user exists
          const existing = query('SELECT id FROM users WHERE LOWER(email) = ?', [email]);
          if (existing.length) {
            return res.status(400).json({ success: false, message: 'User already exists with this email' });
          }
    
          const id = uuid();
          const hashedPassword = hashPassword(password);
          const timestamp = now();
    
          // Check which database to use (PostgreSQL if available, SQLite otherwise)
          const dbType = await getActiveDatabase();
          console.log('[Auth] Using database for registration:', dbType);
    
          // Prepare user data
          const userData = {
            id,
            username: email,
            email,
            password: hashedPassword,
            name,
            role,
            branchId: branchId || null,
            isActive: false, // New registrations need activation
            createdAt: timestamp,
            updatedAt: timestamp
          };
    
          // Insert into active database (PostgreSQL if available, SQLite otherwise)
          const insertResult = await insertIntoActiveDatabase('users', userData);
    
          if (!insertResult || !insertResult.success) {
            const errorMsg = insertResult?.error || 'Registration failed';
            console.error('[Auth] ❌ Registration failed:', errorMsg);
            return res.status(500).json({ success: false, message: errorMsg });
          }
    
          const createdUser = insertResult.data;
          console.log('[Auth] ✅ User created successfully in', insertResult.dbType, ':', id);
    
          // If using SQLite, queue for sync to PostgreSQL (background)
          if (insertResult.dbType === 'sqlite') {
            console.log('[Auth] Data saved to SQLite, triggering immediate sync to PostgreSQL...');
            handleDataChange('users', 'create', createdUser);
    
            // CRITICAL: Force immediate sync attempt (non-blocking)
            (async () => {
              try {
                const connected = await checkPostgreSQLConnection();
                if (connected) {
                  console.log('[Auth] ✅ PostgreSQL is now available, syncing user immediately...');
                  const client = await connectPostgreSQL(true);
                  if (client) {
                    await syncTableToPostgreSQL('users', client);
                    console.log('[Auth] ✅ User synced to PostgreSQL');
                  }
                }
              } catch (e) {
                console.log('[Auth] ⚠️ Immediate sync failed (will retry):', e.message);
              }
            })();
          }
    
          res.json({
            success: true,
            pendingActivation: true,
            syncedToPostgreSQL: insertResult.dbType === 'postgresql',
            data: { user: { id, email, username: email, name, role, isActive: false } },
            message: 'Account created! Contact SuperAdmin at +923107100663 to activate your account.',
            dbType: insertResult.dbType
          });
        } catch (e) {
          console.error('[Auth] Register exception:', e.message);
          console.error('[Auth] Stack:', e.stack);
          res.status(500).json({ success: false, message: 'Server error: ' + e.message });
        }
      });

  // POST /api/auth/login (line 447)
      app.post('/api/auth/login', async (req, res) => {
        try {
          // CRITICAL: Check if database is initialized (fixes "internal server error" on fresh install)
          if (!getDatabase()) {
            console.error('[Auth] ❌ Database not initialized! Attempting to initialize...');
            try {
              await initDatabase();
              console.log('[Auth] ✅ Database initialized successfully');
            } catch (initError) {
              console.error('[Auth] ❌ Database initialization failed:', initError.message);
              return res.status(500).json({
                success: false,
                message: 'Database not initialized. Please restart the application.'
              });
            }
          }
    
          // CRITICAL: Auto-activate device for local/offline use
          // Device activation is optional - always allow login in local mode
          try {
            const activationStatus = checkActivationStatus();
            // If activation check fails or device not activated, auto-activate it
            if (!activationStatus || !activationStatus.activated) {
              console.log('[Auth] Device not activated, auto-activating for local use...');
              const deviceId = getDeviceId();
              const deviceInfo = getDeviceInfo();
              const expiryDate = new Date();
              expiryDate.setFullYear(expiryDate.getFullYear() + 10); // 10 years offline access
    
              // Ensure device_activation table exists
              run(`
                CREATE TABLE IF NOT EXISTS device_activation (
                  id TEXT PRIMARY KEY,
                  deviceId TEXT UNIQUE NOT NULL,
                  fingerprint TEXT,
                  platform TEXT,
                  hostname TEXT,
                  macAddress TEXT,
                  status TEXT DEFAULT 'ACTIVE',
                  licenseKey TEXT,
                  userId TEXT,
                  companyId TEXT,
                  branchId TEXT,
                  activatedBy TEXT,
                  activatedAt TEXT,
                  lastVerifiedAt TEXT,
                  lastVerifiedStatus TEXT DEFAULT 'ACTIVE',
                  offlineAccessExpiresAt TEXT,
                  notes TEXT,
                  createdAt TEXT DEFAULT (datetime('now')),
                  updatedAt TEXT DEFAULT (datetime('now'))
                )
              `);
    
              // Auto-register and activate device
              run(`
                INSERT OR REPLACE INTO device_activation
                (id, deviceId, fingerprint, platform, hostname, status, lastVerifiedAt, lastVerifiedStatus, offlineAccessExpiresAt, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, 'ACTIVE', datetime('now'), 'ACTIVE', ?, datetime('now'), datetime('now'))
              `, [
                'local-' + deviceId,
                deviceId,
                deviceInfo.fingerprint || '',
                deviceInfo.platform || '',
                deviceInfo.hostname || '',
                expiryDate.toISOString()
              ]);
    
              console.log('[Auth] ✅ Device auto-activated for local use');
            }
          } catch (activationError) {
            // If activation check fails completely, allow login anyway (local mode)
            console.log('[Auth] Activation check failed, allowing login anyway (local mode):', activationError.message);
          }
    
          // Support both 'email' and 'usernameOrEmail' fields - case insensitive
          const originalEmail = (req.body.email || req.body.usernameOrEmail || '').trim();
          // CRITICAL: Normalize - remove all whitespace, convert to lowercase
          const emailInput = originalEmail.toLowerCase().replace(/\s+/g, '').trim();
          const password = req.body.password;
    
          // CRITICAL: Log to both console AND include in response for debugging
          const debugLogs = [];
          const logDebug = (msg) => {
            const logMsg = '[Auth] ' + msg;
            console.log(logMsg);
            debugLogs.push(msg);
          };
    
          logDebug('=====');
          logDebug('🔐 LOGIN ATTEMPT STARTED');
          logDebug('Email/Username: ' + emailInput);
          logDebug('Original input: ' + originalEmail);
          logDebug('Password provided: ' + (password ? 'YES (length: ' + password.length + ')' : 'NO'));
          logDebug('REMOTE_DATABASE_URL: ' + (REMOTE_DATABASE_URL ? 'configured' : 'NOT configured'));
          logDebug('=====');
    
          if (!emailInput || !password) {
            return res.status(400).json({
              success: false,
              message: 'Email and password required',
              debug: { logs: debugLogs }
            });
          }
    
          // CRITICAL: Check PostgreSQL FIRST if available (new users are in PostgreSQL)
          // Then fall back to SQLite if PostgreSQL fails
          let users = [];
          let passwordMatches = false;
          let pgUserFound = false;
          let sessionToken = null;
    
          // Step 1: Try PostgreSQL FIRST (new users are created in PostgreSQL)
          if (REMOTE_DATABASE_URL) {
            console.log('[Auth] 🔍 Step 1: Checking PostgreSQL FIRST (new users are here)...');
            console.log('[Auth] REMOTE_DATABASE_URL:', REMOTE_DATABASE_URL ? 'configured' : 'not configured');
    
            try {
              // Force connection attempt
              let Client;
              try {
                const pg = require('pg');
                Client = pg.Client;
              } catch (e) {
                console.log('[Auth] pg module not available');
                Client = null;
              }
    
              if (Client) {
                const loginPgClient = new (require('pg').Client)({
                  connectionString: REMOTE_DATABASE_URL,
                  connectionTimeoutMillis: 10000,
                  query_timeout: 10000,
                  statement_timeout: 10000
                });
    
                try {
                  logDebug('🔌 Attempting PostgreSQL connection...');
                  await Promise.race([
                    loginPgClient.connect(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout after 10 seconds')), 10000))
                  ]);
    
                  logDebug('✅ PostgreSQL connection established');
    
                  // Get ALL users and find match manually
                  // CRITICAL FIX: Remove 'phone' column if it doesn't exist in database
                  const allUsersQuery = await Promise.race([
                    loginPgClient.query('SELECT id, username, email, password, name, role, "branchId", "companyId", "isActive", "createdAt", "updatedAt" FROM users'),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 10000))
                  ]);
    
                  if (allUsersQuery && allUsersQuery.rows && allUsersQuery.rows.length > 0) {
                    logDebug(`✅ Found ${allUsersQuery.rows.length} users in PostgreSQL`);
    
                    const searchEmailLower = emailInput.toLowerCase().trim();
                    let matchedUser = null;
    
                    // Manual matching with ALL users
                    logDebug('🔍 Starting manual matching with ' + allUsersQuery.rows.length + ' users...');
                    for (let idx = 0; idx < allUsersQuery.rows.length; idx++) {
                      const u = allUsersQuery.rows[idx];
                      const userEmail = (u.email || '').toLowerCase().trim();
                      const userUsername = (u.username || '').toLowerCase().trim();
    
                      // Log first 10 users for debugging
                      if (idx < 10) {
                        logDebug(`  Checking user ${idx + 1}: Email="${u.email || 'NULL'}", Username="${u.username || 'NULL'}"`);
                        logDebug(`    Normalized: Email="${userEmail}", Username="${userUsername}"`);
                        logDebug(`    Searching for: "${searchEmailLower}"`);
                        logDebug(`    Email match: ${userEmail === searchEmailLower}, Username match: ${userUsername === searchEmailLower}`);
                      }
    
                      // Check exact match
                      if (userEmail === searchEmailLower || userUsername === searchEmailLower) {
                        logDebug(`✅✅✅ FOUND USER in PostgreSQL at index ${idx}!`);
                        logDebug(`✅ User details: ID=${u.id}, Email=${u.email}, Username=${u.username}, Active=${u.isActive}, HasPassword=${!!u.password}`);
                        matchedUser = u;
                        break;
                      }
                    }
    
                    if (!matchedUser) {
                      logDebug('❌ No match found after checking all ' + allUsersQuery.rows.length + ' users');
                      logDebug('💡 Searched for: "' + searchEmailLower + '"');
                      logDebug('💡 Original input: "' + originalEmail + '"');
                      // Show all emails/usernames for debugging
                      logDebug('📋 All emails in database (first 20):');
                      for (let i = 0; i < Math.min(20, allUsersQuery.rows.length); i++) {
                        const u = allUsersQuery.rows[i];
                        logDebug(`  ${i + 1}. Email: "${u.email || 'NULL'}", Username: "${u.username || 'NULL'}"`);
                      }
                    }
    
                    if (matchedUser) {
                      // Verify password with bcrypt
                      if (!bcryptjs) {
                        logDebug('⚠️ bcryptjs not available');
                        await loginPgClient.end();
                        return res.status(401).json({
                          success: false,
                          message: 'Password verification unavailable. Please check server logs.',
                          debug: { logs: debugLogs }
                        });
                      }
    
                      logDebug('🔐 Verifying password...');
                      logDebug('🔐 Input password length: ' + password.length);
                      logDebug('🔐 Stored password hash length: ' + (matchedUser.password ? matchedUser.password.length : 0));
                      logDebug('🔐 Stored password hash starts with: ' + (matchedUser.password ? matchedUser.password.substring(0, 10) : 'NULL'));
    
                      // CRITICAL: Check if password is bcrypt (starts with $2a$, $2b$, $2y$) or SHA256 (64 chars hex)
                      const isBcrypt = matchedUser.password && (matchedUser.password.startsWith('$2a$') || matchedUser.password.startsWith('$2b$') || matchedUser.password.startsWith('$2y$'));
                      const isSha256 = matchedUser.password && matchedUser.password.length === 64 && /^[a-f0-9]{64}$/i.test(matchedUser.password);
    
                      logDebug('🔐 Password hash type: ' + (isBcrypt ? 'bcrypt' : (isSha256 ? 'SHA256' : 'unknown')));
    
                      if (isBcrypt) {
                        // Verify with bcrypt
                        if (!bcryptjs) {
                          logDebug('⚠️ bcryptjs not available');
                          await loginPgClient.end();
                          return res.status(401).json({
                            success: false,
                            message: 'Password verification unavailable. Please check server logs.',
                            debug: { logs: debugLogs }
                          });
                        }
                        passwordMatches = await bcryptjs.compare(password, matchedUser.password);
                        logDebug('🔐 Bcrypt verification: ' + (passwordMatches ? '✅ MATCH' : '❌ NO MATCH'));
                      } else if (isSha256) {
                        // Verify with SHA256
                        const inputHash = hashPassword(password);
                        passwordMatches = (inputHash === matchedUser.password);
                        logDebug('🔐 SHA256 verification: ' + (passwordMatches ? '✅ MATCH' : '❌ NO MATCH'));
                        logDebug('🔐 Input hash: ' + inputHash.substring(0, 20) + '...');
                        logDebug('🔐 Stored hash: ' + matchedUser.password.substring(0, 20) + '...');
                      } else {
                        // Try both methods
                        logDebug('⚠️ Unknown password format, trying both methods...');
                        let bcryptMatch = false;
                        let sha256Match = false;
    
                        if (bcryptjs) {
                          try {
                            bcryptMatch = await bcryptjs.compare(password, matchedUser.password);
                            logDebug('🔐 Bcrypt attempt: ' + (bcryptMatch ? '✅ MATCH' : '❌ NO MATCH'));
                          } catch (e) {
                            logDebug('🔐 Bcrypt attempt failed: ' + e.message);
                          }
                        }
    
                        const inputHash = hashPassword(password);
                        sha256Match = (inputHash === matchedUser.password);
                        logDebug('🔐 SHA256 attempt: ' + (sha256Match ? '✅ MATCH' : '❌ NO MATCH'));
    
                        passwordMatches = bcryptMatch || sha256Match;
                        logDebug('🔐 Final verification: ' + (passwordMatches ? '✅ MATCH' : '❌ NO MATCH'));
                      }
    
                      if (passwordMatches) {
                        // Check isActive
                        const isActive = matchedUser.isActive === true || matchedUser.isActive === 1 || matchedUser.isActive === 'true' || matchedUser.isActive === '1';
                        logDebug('🔍 isActive check: rawValue=' + matchedUser.isActive + ', type=' + typeof matchedUser.isActive + ', isActive=' + isActive);
                        if (!isActive) {
                          logDebug('❌ Account not activated');
                          await loginPgClient.end();
                          return res.status(403).json({
                            success: false,
                            message: 'Account is pending activation. Please contact SuperAdmin to activate your account.',
                            debug: { logs: debugLogs, isActiveValue: matchedUser.isActive }
                          });
                        }
    
                        // Create user in SQLite for future logins
                        const sqlitePasswordHash = hashPassword(password);
                        const userId = matchedUser.id;
                        const timestamp = now();
    
                        run(`
                          INSERT OR REPLACE INTO users
                          (id, username, email, password, name, role, branchId, companyId, isActive, createdAt, updatedAt)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `, [
                          userId,
                          matchedUser.username || matchedUser.email,
                          matchedUser.email,
                          sqlitePasswordHash,
                          matchedUser.name,
                          matchedUser.role,
                          matchedUser.branchId || null,
                          matchedUser.companyId || null,
                          matchedUser.isActive ? 1 : 0,
                          matchedUser.createdAt || timestamp,
                          matchedUser.updatedAt || timestamp
                        ]);
                        saveDatabase();
    
                        // Get user from SQLite
                        try {
                          users = query('SELECT * FROM users WHERE id = ?', [userId]);
                          logDebug('✅ User synced to SQLite for future logins');
                          logDebug('✅ Users array length after sync: ' + users.length);
    
                          if (users.length === 0) {
                            logDebug('⚠️ WARNING: User not found in SQLite after sync! Creating temporary user object...');
                            // Create temporary user object from PostgreSQL data
                            users = [{
                              id: matchedUser.id,
                              email: matchedUser.email,
                              username: matchedUser.username || matchedUser.email,
                              password: sqlitePasswordHash,
                              name: matchedUser.name,
                              role: matchedUser.role,
                              branchId: matchedUser.branchId,
                              companyId: matchedUser.companyId,
                              isActive: matchedUser.isActive ? 1 : 0
                            }];
                            logDebug('✅ Temporary user object created, users array length: ' + users.length);
                          } else {
                            logDebug('✅ User successfully retrieved from SQLite');
                          }
                        } catch (queryError) {
                          logDebug('⚠️ Error querying SQLite after sync: ' + queryError.message);
                          logDebug('💡 Creating temporary user object from PostgreSQL data...');
                          // Create temporary user object from PostgreSQL data
                          users = [{
                            id: matchedUser.id,
                            email: matchedUser.email,
                            username: matchedUser.username || matchedUser.email,
                            password: sqlitePasswordHash,
                            name: matchedUser.name,
                            role: matchedUser.role,
                            branchId: matchedUser.branchId,
                            companyId: matchedUser.companyId,
                            isActive: matchedUser.isActive ? 1 : 0
                          }];
                          logDebug('✅ Temporary user object created, users array length: ' + users.length);
                        }
    
                        pgUserFound = true;

                        // Phase 1: Register device and create session after successful cloud auth
                        try {
                          if (deviceService && sessionService) {
                            const deviceReg = deviceService.registerDevice(userId);
                            const deviceId = deviceService.getDeviceId();
                            const session = sessionService.createSession(userId, deviceId);
                            sessionToken = session.token;
                            logDebug('✅ Device registered and session created for user: ' + userId);
                            logDebug('✅ Session token: ' + sessionToken.substring(0, 16) + '...');
                          } else {
                            logDebug('⚠️ Device/session services not available, skipping registration');
                          }
                        } catch (svcError) {
                          logDebug('⚠️ Device/session registration error: ' + svcError.message);
                        }

                        logDebug('✅✅✅ Ready to proceed with login - users array has ' + users.length + ' user(s)');

                        // Persist session token in user record and refresh user object
                        if (sessionToken && users && users.length > 0) {
                          try {
                            run('UPDATE users SET sessionToken = ?, updatedAt = ? WHERE id = ?', [sessionToken, now(), users[0].id]);
                            saveDatabase();
                            // Re-query user to get fresh sessionToken for response
                            const freshUsers = query('SELECT * FROM users WHERE id = ?', [users[0].id]);
                            if (freshUsers && freshUsers.length > 0) {
                              users[0].sessionToken = freshUsers[0].sessionToken;
                            }
                          } catch (e) {}
                        }
                      } else {
                        logDebug('❌ Password mismatch');
                        logDebug('💡 User found but password does not match');
                        logDebug('💡 User email: ' + matchedUser.email);
                        logDebug('💡 User ID: ' + matchedUser.id);
                        await loginPgClient.end();
                        return res.status(401).json({
                          success: false,
                          message: 'Invalid credentials - wrong password. Please check your password and try again.',
                          debug: {
                            logs: debugLogs,
                            userFound: true,
                            userId: matchedUser.id,
                            userEmail: matchedUser.email
                          }
                        });
                      }
                    } else {
                      logDebug('⚠️ User not found in PostgreSQL');
                      logDebug('💡 Searched for: ' + emailInput);
                      logDebug('💡 Total users checked: ' + allUsersQuery.rows.length);
                      // List first 5 users for debugging
                      logDebug('📋 First 5 users in database:');
                      for (let i = 0; i < Math.min(5, allUsersQuery.rows.length); i++) {
                        const u = allUsersQuery.rows[i];
                        logDebug(`  ${i + 1}. Email: "${u.email || 'NULL'}", Username: "${u.username || 'NULL'}"`);
                      }
                    }
    
                    await loginPgClient.end();
                  } else {
                    console.log('[Auth] ⚠️ No users found in PostgreSQL');
                    await loginPgClient.end();
                  }
                } catch (pgError) {
                  logDebug('❌ PostgreSQL error: ' + pgError.message);
                  logDebug('💡 Error stack: ' + (pgError.stack || 'N/A'));
                  try { await loginPgClient.end(); } catch (e) {}
                }
              }
            } catch (pgConnectError) {
              logDebug('❌ PostgreSQL connection error: ' + pgConnectError.message);
              logDebug('💡 Falling back to SQLite...');
            }
          }
    
          // Step 2: If PostgreSQL didn't find user, check SQLite
          if (!pgUserFound) {
            logDebug('🔍 Step 2: Checking SQLite database...');
    
            // CRITICAL FIX: Ensure database is available before querying
            if (!getDatabase()) {
              logDebug('❌ Database not available for query');
              return res.status(500).json({
                success: false,
                message: 'Database not available. Please restart the application.',
                debug: { logs: debugLogs }
              });
            }
    
            try {
              users = query('SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?', [emailInput, emailInput]);
              logDebug('Users found in SQLite: ' + users.length);
            } catch (queryError) {
              logDebug('❌ SQLite query error: ' + queryError.message);
              return res.status(500).json({
                success: false,
                message: 'Database query failed. Please restart the application.',
                debug: { logs: debugLogs }
              });
            }
    
            // Check password if user found in SQLite
            if (users.length > 0) {
              const u = users[0];
              const inputHash = hashPassword(password);
              passwordMatches = (u.password && u.password === inputHash);
              logDebug('SQLite password check: ' + (passwordMatches ? 'MATCH' : 'NO MATCH'));
            }
          }
    
          // User found and password verified - continue to login
          // (PostgreSQL already checked first, SQLite checked second if needed)
    
          logDebug('📊 Final check - users array length: ' + users.length);
          logDebug('📊 pgUserFound: ' + pgUserFound);
          logDebug('📊 passwordMatches: ' + passwordMatches);
    
          // CRITICAL: If user was found in PostgreSQL and password matches, proceed to login
          if (pgUserFound && passwordMatches && users.length > 0) {
            logDebug('✅✅✅ User found, password verified, proceeding to login response...');
            // Skip the "user not found" check and proceed directly to login
          } else if (!users.length) {
            console.log('[Auth] ❌❌❌ User not found in SQLite or PostgreSQL');
            console.log('[Auth] 🔍 Searched for:', emailInput);
            console.log('[Auth] 📊 Status:');
            console.log('[Auth]     - SQLite checked: YES');
            console.log('[Auth]     - PostgreSQL available:', REMOTE_DATABASE_URL ? 'YES' : 'NO');
            console.log('[Auth]     - PostgreSQL connection attempted: YES');
            console.log('[Auth]     - REMOTE_DATABASE_URL:', REMOTE_DATABASE_URL ? REMOTE_DATABASE_URL.replace(/:[^:@]+@/, ':****@') : 'NOT SET');
    
            // Try to get list of users from PostgreSQL for better error message
            let availableUsers = [];
            if (REMOTE_DATABASE_URL) {
              try {
                // Try to connect one more time to get user list
                let Client;
                try {
                  const pg = require('pg');
                  Client = pg.Client;
                } catch (e) {
                  console.log('[Auth] pg module not available for user listing');
                }
    
                if (Client) {
                  const listClient = new (require('pg').Client)({
                    connectionString: REMOTE_DATABASE_URL,
                    connectionTimeoutMillis: 5000,
                    query_timeout: 5000
                  });
    
                  try {
                    await Promise.race([
                      listClient.connect(),
                      new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 5000))
                    ]);
    
                    const usersList = await Promise.race([
                      listClient.query('SELECT email, username, "isActive" FROM users ORDER BY "createdAt" DESC'),
                      new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 10000))
                    ]);
    
                    if (usersList && usersList.rows) {
                      availableUsers = usersList.rows.map(u => ({
                        email: u.email || 'NULL',
                        username: u.username || 'NULL',
                        isActive: u.isActive
                      }));
                      console.log(`[Auth] 📋 Available users in PostgreSQL (ALL ${availableUsers.length} users):`);
                      // Log all users, but limit console output to first 50 for readability
                      const logLimit = Math.min(50, availableUsers.length);
                      for (let i = 0; i < logLimit; i++) {
                        console.log(`[Auth]   ${i + 1}. Email: "${availableUsers[i].email}", Username: "${availableUsers[i].username}", Active: ${availableUsers[i].isActive}`);
                      }
                      if (availableUsers.length > 50) {
                        console.log(`[Auth]   ... and ${availableUsers.length - 50} more users`);
                      }
                    }
    
                    await listClient.end();
                  } catch (listError) {
                    console.log('[Auth] Could not fetch user list:', listError.message);
                    try { await listClient.end(); } catch (e) {}
                  }
                }
              } catch (e) {
                console.log('[Auth] Could not connect to list users:', e.message);
              }
            }
    
            // Provide helpful error message with user list
            let errorMessage = 'Invalid credentials - user not found.';
            if (REMOTE_DATABASE_URL) {
              errorMessage += ' Please verify your email/username and password.';
              if (availableUsers.length > 0) {
                errorMessage += ` Found ${availableUsers.length} users in database.`;
              }
            } else {
              errorMessage += ' Please verify your email/username and password.';
            }
    
            return res.status(401).json({
              success: false,
              message: errorMessage,
              debug: {
                logs: debugLogs,
                searchedEmail: emailInput,
                sqliteChecked: true,
                postgresqlChecked: !!REMOTE_DATABASE_URL,
                postgresqlUrl: REMOTE_DATABASE_URL ? 'configured' : 'not configured',
                availableUsersCount: availableUsers.length,
                availableUsers: availableUsers.slice(0, 50) // First 50 users for debugging
              }
            });
          }
    
          const u = users[0];
    
          // CRITICAL FIX: Check if account is active - DO NOT auto-activate
          // Users must be activated by superadmin before they can login
          // Handle both SQLite (INTEGER 1/0) and PostgreSQL (boolean true/false) formats
          let isActive = u.isActive === true || u.isActive === 1 || u.isActive === 'true' || u.isActive === '1';
          console.log('[Auth] 🔍 isActive check for SQLite user:', {
            rawValue: u.isActive,
            type: typeof u.isActive,
            isActive: isActive
          });
    
          // CRITICAL FIX: If SQLite shows inactive, check PostgreSQL directly for latest status
          // This handles the case where user was activated in PostgreSQL but SQLite hasn't synced yet
          if (!isActive && REMOTE_DATABASE_URL) {
            console.log('[Auth] 🔄 SQLite shows inactive, checking PostgreSQL for latest isActive status...');
            try {
              const pgClient = await connectPostgreSQL(true); // Force connection
              if (pgClient) {
                try {
                  const pgUserResult = await pgClient.query(`
                    SELECT "isActive" FROM users
                    WHERE id = $1 OR LOWER(email) = $2 OR LOWER(username) = $2
                    LIMIT 1
                  `, [u.id, emailInput]);
    
                  if (pgUserResult.rows && pgUserResult.rows.length > 0) {
                    const pgIsActive = pgUserResult.rows[0].isActive;
                    const pgIsActiveBool = pgIsActive === true || pgIsActive === 1 || pgIsActive === 'true' || pgIsActive === '1';
    
                    console.log('[Auth] 🔍 PostgreSQL isActive status:', {
                      rawValue: pgIsActive,
                      type: typeof pgIsActive,
                      isActive: pgIsActiveBool
                    });
    
                    if (pgIsActiveBool) {
                      console.log('[Auth] ✅ User is active in PostgreSQL - updating SQLite and allowing login');
                      // Update SQLite with latest isActive status from PostgreSQL
                      run('UPDATE users SET isActive = ?, updatedAt = datetime("now") WHERE id = ?', [1, u.id]);
                      saveDatabase();
                      // Update local user object
                      u.isActive = 1;
                      isActive = true;
                      console.log('[Auth] ✅ SQLite updated with isActive = 1');
                    } else {
                      console.log('[Auth] ❌ User is also inactive in PostgreSQL');
                    }
                  } else {
                    console.log('[Auth] ⚠️ User not found in PostgreSQL');
                  }
                } catch (pgCheckError) {
                  console.log('[Auth] ⚠️ Could not check PostgreSQL isActive status:', pgCheckError.message);
                  // Continue with SQLite status if PostgreSQL check fails
                }
              }
            } catch (pgConnectError) {
              console.log('[Auth] ⚠️ Could not connect to PostgreSQL to check isActive:', pgConnectError.message);
              // Continue with SQLite status if PostgreSQL connection fails
            }
          }
    
          if (!isActive) {
            console.log('[Auth] ❌ Account not activated for:', emailInput, 'isActive:', u.isActive, 'type:', typeof u.isActive);
            console.log('[Auth] User must be activated by superadmin before login');
    
            return res.status(403).json({
              success: false,
              message: 'Account is pending activation. Please contact SuperAdmin to activate your account.',
              requiresActivation: true,
              contactInfo: {
                phone: '+92 310 7100663',
                email: 'support@zapeera.com'
              },
              debug: {
                isActiveValue: u.isActive,
                isActiveType: typeof u.isActive
              }
            });
          }
    
          // Check password - if user was synced from PostgreSQL, password might be bcrypt hash
          // So we need to check both SHA256 (SQLite) and bcrypt (PostgreSQL)
          const inputHash = hashPassword(password);
          const storedHash = u.password;
    
          console.log('[Auth] Input hash:', inputHash.substring(0, 10) + '...');
          console.log('[Auth] Stored hash:', storedHash ? storedHash.substring(0, 10) + '...' : 'NULL');
    
          let passwordValid = false;
    
          // First check if it's SHA256 hash (SQLite format)
          if (storedHash && storedHash === inputHash) {
            passwordValid = true;
            console.log('[Auth] Password match (SHA256/SQLite)');
          } else if (storedHash && storedHash.startsWith('$2')) {
            // Looks like bcrypt hash - verify with bcrypt
            if (bcryptjs) {
              try {
                passwordValid = await bcryptjs.compare(password, storedHash);
                console.log('[Auth] Password check (bcrypt):', passwordValid ? 'MATCH' : 'NO MATCH');
    
                // If password matches but it's bcrypt, convert to SHA256 for SQLite
                if (passwordValid) {
                  console.log('[Auth] Converting bcrypt password to SHA256 for SQLite...');
                  run('UPDATE users SET password = ? WHERE id = ?', [inputHash, u.id]);
                  saveDatabase();
                  u.password = inputHash; // Update local object
                }
              } catch (bcryptError) {
                console.log('[Auth] Bcrypt comparison error:', bcryptError.message);
                passwordValid = false;
              }
            } else {
              console.log('[Auth] ⚠️ bcryptjs not available, cannot verify bcrypt password');
            }
          }
    
          if (!passwordValid) {
            console.log('[Auth] Password mismatch - checking PostgreSQL as fallback...');
    
            // Last resort: Check PostgreSQL directly
            if (REMOTE_DATABASE_URL && bcryptjs) {
              try {
                const pgClient = await connectPostgreSQL(true); // Force connection
                if (pgClient) {
                  const pgResult = await pgClient.query(`
                    SELECT id, username, email, password, name, role, "branchId", "companyId", "isActive"
                    FROM users
                    WHERE LOWER(email) = $1 OR LOWER(username) = $1
                    LIMIT 1
                  `, [emailInput]);
    
                  // Final check - make sure pgResult is set correctly
                  if (pgResult && pgResult.rows && pgResult.rows.length > 0) {
                    const pgUser = pgResult.rows[0];
                    const pgPasswordValid = await bcryptjs.compare(password, pgUser.password);
    
                    if (pgPasswordValid) {
                      console.log('[Auth] ✅ Password verified in PostgreSQL, updating SQLite...');
                      // Update SQLite user with correct password hash
                      run('UPDATE users SET password = ?, updatedAt = datetime("now") WHERE id = ?', [inputHash, u.id]);
                      saveDatabase();
                      passwordValid = true;
                    }
                  }
                }
              } catch (pgCheckError) {
                console.log('[Auth] PostgreSQL fallback check failed:', pgCheckError.message);
              }
            }
    
            if (!passwordValid) {
              console.log('[Auth] Password mismatch after all checks');
              return res.status(401).json({ success: false, message: 'Invalid credentials - wrong password' });
            }
          }
    
          logDebug('✅✅✅ LOGIN SUCCESSFUL for: ' + u.email);
          
          // CRITICAL FIX: After successful login, ALWAYS sync all data from PostgreSQL to SQLite
          // This ensures that when user logs in with PostgreSQL credentials, all business data is synced
          // After sync, SQLite will have all data and app can work offline
          let syncCompleted = false;
          let syncResult = null;
          
          if (REMOTE_DATABASE_URL && pullAllFromPostgreSQL) {
            try {
              // Check if database is fresh (no business data)
              const companiesCount = query('SELECT COUNT(*) as count FROM companies')[0]?.count || 0;
              const productsCount = query('SELECT COUNT(*) as count FROM products')[0]?.count || 0;
              const salesCount = query('SELECT COUNT(*) as count FROM sales')[0]?.count || 0;
              const isFreshDatabase = companiesCount === 0 && productsCount === 0 && salesCount === 0;
              
              console.log('[Auth] 🔍 Checking database state after login...');
              console.log('[Auth] 📊 Current data: companies=' + companiesCount + ', products=' + productsCount + ', sales=' + salesCount);
              
              // CRITICAL: For fresh database, WAIT for sync to complete before sending login response
              // This ensures user's data is available immediately after login
              if (isFreshDatabase || companiesCount === 0 || productsCount === 0) {
                console.log('[Auth] 🆕 Fresh/Incomplete database detected - WAITING for full sync from PostgreSQL...');
                console.log('[Auth] ⚠️ NET REQUIRED: First-time sync needs internet connection');
                console.log('[Auth] ⏳ This may take a few moments - please wait...');
                
                // Check PostgreSQL connection
                const connected = await checkPostgreSQLConnection();
                if (connected) {
                  console.log('[Auth] ✅ PostgreSQL connected - starting FULL data sync...');
                  console.log('[Auth] 🔄 Syncing all business data - this may take 10-30 seconds...');
                  
                  const client = await connectPostgreSQL(true);
                  if (client) {
                    // CRITICAL: Wait for sync to complete (with timeout)
                    // This ensures data is available before login response is sent
                    try {
                      const syncPromise = pullAllFromPostgreSQL(true); // Force full compare
                      const timeoutPromise = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Sync timeout after 60 seconds')), 60000)
                      );
                      
                      syncResult = await Promise.race([syncPromise, timeoutPromise]);
                      
                      // Save database after sync to ensure data is persisted
                      saveDatabase();
                      
                      syncCompleted = true;
                      console.log('[Auth] ✅✅✅ FULL SYNC COMPLETE!');
                      console.log('[Auth] 📊 Sync summary:', {
                        added: syncResult.added || 0,
                        updated: syncResult.updated || 0,
                        synced: (syncResult.added || 0) + (syncResult.updated || 0),
                        duration: syncResult.duration || 0
                      });
                      console.log('[Auth] ✅ All data is now in SQLite - app can work offline!');
                      
                      // Verify data was synced
                      const finalCompaniesCount = query('SELECT COUNT(*) as count FROM companies')[0]?.count || 0;
                      const finalProductsCount = query('SELECT COUNT(*) as count FROM products')[0]?.count || 0;
                      console.log('[Auth] ✅ Verification: companies=' + finalCompaniesCount + ', products=' + finalProductsCount);
                      
                      if (finalCompaniesCount === 0 && finalProductsCount === 0) {
                        console.log('[Auth] ⚠️ WARNING: Sync completed but no data found - user may need to check PostgreSQL connection');
                      }
                    } catch (syncTimeoutError) {
                      console.error('[Auth] ⚠️ Sync timeout or error:', syncTimeoutError.message);
                      console.log('[Auth] ⚠️ Login will proceed - data will sync in background');
                      syncCompleted = false;
                    }
                  } else {
                    console.log('[Auth] ⚠️ Could not connect to PostgreSQL - sync will retry later');
                  }
                } else {
                  console.log('[Auth] ⚠️ PostgreSQL not available for initial sync');
                  console.log('[Auth] ⚠️ NET REQUIRED: Please ensure internet connection for first-time sync');
                }
              } else {
                console.log('[Auth] ℹ️ Database already has data - performing incremental sync in background...');
                // For existing database, do async sync (non-blocking)
                (async () => {
                  try {
                    const connected = await checkPostgreSQLConnection();
                    if (connected) {
                      const bgSyncResult = await pullAllFromPostgreSQL(false); // Smart sync
                      console.log('[Auth] ✅ Background incremental sync complete:', {
                        added: bgSyncResult.added || 0,
                        updated: bgSyncResult.updated || 0
                      });
                    }
                  } catch (e) {
                    console.log('[Auth] ℹ️ Background sync skipped (non-critical)');
                  }
                })();
                syncCompleted = true; // Don't wait for background sync
              }
            } catch (syncError) {
              console.error('[Auth] ⚠️ Initial sync error:', syncError.message);
              console.error('[Auth] ⚠️ Login will proceed - data will sync when connection is available');
              syncCompleted = true; // Don't block login on error
            }
          } else {
            syncCompleted = true; // No sync needed
          }
          
          const token = generateToken({ id: u.id, email: u.email, name: u.name, role: u.role, companyId: u.companyId, branchId: u.branchId });
          logDebug('✅ Token generated successfully');
          logDebug('✅✅✅ Sending login response...');

          // Set httpOnly cookie for auth (7 day expiry)
          res.cookie('zapeera_token', token, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: '/'
          });

          // Set session token cookie for offline session persistence
          if (sessionToken) {
            res.cookie('zapeera_session', sessionToken, {
              httpOnly: true,
              secure: false,
              sameSite: 'lax',
              maxAge: 72 * 60 * 60 * 1000, // 72 hours offline grace
              path: '/'
            });
          }

          // Phase 2-5: Trigger account sync and auth refresh after login (fire-and-forget)
          (async () => {
            try {
              if (syncAccountService) {
                const accountSyncResult = await syncAccountService.syncAccount(u.id, u.email);
                if (accountSyncResult.success) {
                  logDebug('✅ Account sync complete: ' + accountSyncResult.data.memberships.length + ' memberships');
                }
              }
              if (authRefreshService) {
                await authRefreshService.startPeriodicRefresh(u.id);
                logDebug('✅ Auth refresh started');
              }
            } catch (syncErr) {
              logDebug('⚠️ Background account sync error (non-critical): ' + syncErr.message);
            }
          })();

          // sessionToken was set during device/session registration phase above

          res.json({
            success: true,
            data: {
              user: {
                id: u.id,
                email: u.email,
                username: u.email,
                name: u.name,
                role: u.role,
                phone: u.phone || null,
                companyId: u.companyId,
                branchId: u.branchId,
                isActive: u.isActive
              },
              token,
              sessionToken
            },
            syncCompleted: syncCompleted, // Tell frontend if sync completed
            syncResult: syncResult ? {
              added: syncResult.added || 0,
              updated: syncResult.updated || 0
            } : null,
            debug: { logs: debugLogs }
          });
        } catch (e) {
          console.error('[Auth] ❌ Login error:', e.message);
          console.error('[Auth] ❌ Error stack:', e.stack);
          console.error('[Auth] ❌ Database status:', getDatabase() ? 'initialized' : 'NOT initialized');
          console.error('[Auth] ❌ SQL.js status:', SQL ? 'loaded' : 'NOT loaded');
    
          // Provide helpful error message
          let errorMessage = 'Login failed. Please try again.';
          if (e.message.includes('Database') || e.message.includes('database')) {
            errorMessage = 'Database error. Please restart the application.';
          } else if (e.message.includes('sql.js') || e.message.includes('SQL')) {
            errorMessage = 'Database initialization error. Please restart the application.';
          } else if (e.message) {
            errorMessage = e.message;
          }
    
          res.status(500).json({
            success: false,
            message: errorMessage,
            error: isDev ? e.message : undefined // Only show detailed error in dev mode
          });
        }
      });

  // POST /api/auth/forgot-password (line 1179)
      app.post('/api/auth/forgot-password', async (req, res) => {
        try {
          const email = (req.body.email || '').toLowerCase().trim();
    
          if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required' });
          }
    
          // Check if user exists
          const users = query('SELECT id, email, name FROM users WHERE LOWER(email) = ?', [email]);
    
          // Always return success to prevent email enumeration attacks
          const successMessage = 'If an account with that email exists, you will receive a password reset link shortly.';
    
          if (!users.length) {
            console.log(`[Auth] Forgot password request for unknown email: ${email}`);
            return res.json({
              success: true,
              message: successMessage
            });
          }
    
          const user = users[0];
    
          // Generate reset token (cryptographically secure)
          const crypto = require('crypto');
          const resetToken = crypto.randomBytes(32).toString('hex');
          const resetExpires = new Date();
          resetExpires.setHours(resetExpires.getHours() + 1); // Token expires in 1 hour
    
          // Save reset token to database
          run('UPDATE users SET passwordResetToken = ?, passwordResetExpires = ? WHERE id = ?',
            [resetToken, resetExpires.toISOString(), user.id]);
    
          console.log(`[Auth] Password reset token generated for: ${email} (ID: ${user.id})`);
    
          // Try to sync to PostgreSQL first (if connected, backend will send email)
          if (REMOTE_DATABASE_URL) {
            try {
              const client = await connectPostgreSQL(true);
              if (client) {
                // Try to use backend's forgot password endpoint via PostgreSQL sync
                // The backend will handle email sending
                const updatedUser = query('SELECT * FROM users WHERE id = ?', [user.id])[0];
                if (updatedUser) {
                  handleDataChange('users', 'update', updatedUser);
                  // Also try to trigger backend forgot password
                  try {
                    const https = require('https');
                    const http = require('http');
                    const url = require('url');
                    const apiUrl = REMOTE_DATABASE_URL.replace(/^postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)$/,
                      (match, user, pass, host, port, db) => {
                        // Try to construct API URL from PostgreSQL URL
                        return `https://api.zapeera.com`; // Default API URL
                      });
                    // Try to call backend API if available
                    const backendUrl = process.env.API_URL || 'https://api.zapeera.com';
                    const forgotPasswordUrl = `${backendUrl}/api/auth/forgot-password`;
    
                    // Fire and forget - don't wait for response
                    fetch(forgotPasswordUrl, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email: user.email })
                    }).catch(e => {
                      console.log('[Auth] Could not reach backend API for email sending:', e.message);
                    });
                  } catch (e) {
                    console.log('[Auth] Backend API call failed (non-critical):', e.message);
                  }
                }
              }
            } catch (e) {
              console.log('[Auth] PostgreSQL sync for password reset failed (non-critical):', e.message);
            }
          }
    
          // Note: In Electron mode, email sending is handled by backend if connected
          // If not connected, user needs to use web version or contact admin
          res.json({
            success: true,
            message: successMessage
          });
        } catch (e) {
          console.error('[Auth] Forgot password error:', e.message);
          // Always return success to prevent email enumeration
          res.json({
            success: true,
            message: 'If an account with that email exists, you will receive a password reset link shortly.'
          });
        }
      });

  // GET /api/auth/verify-reset-token (line 1274)
      app.get('/api/auth/verify-reset-token', (req, res) => {
        try {
          const token = req.query.token;
    
          if (!token) {
            return res.status(400).json({ success: false, message: 'Reset token is required' });
          }
    
          // Find user with this reset token
          const users = query(
            'SELECT id, email, name FROM users WHERE passwordResetToken = ? AND passwordResetExpires > ?',
            [token, new Date().toISOString()]
          );
    
          if (!users.length) {
            return res.status(400).json({
              success: false,
              message: 'Invalid or expired reset token'
            });
          }
    
          const user = users[0];
          res.json({
            success: true,
            message: 'Reset token is valid',
            data: {
              email: user.email,
              name: user.name
            }
          });
        } catch (e) {
          console.error('[Auth] Verify reset token error:', e.message);
          res.status(500).json({ success: false, message: 'Internal server error' });
        }
      });

  // POST /api/auth/reset-password-with-token (line 1311)
      app.post('/api/auth/reset-password-with-token', (req, res) => {
        try {
          const { token, newPassword } = req.body;
    
          if (!token || !newPassword) {
            return res.status(400).json({
              success: false,
              message: 'Reset token and new password are required'
            });
          }
    
          if (newPassword.length < 6) {
            return res.status(400).json({
              success: false,
              message: 'Password must be at least 6 characters long'
            });
          }
    
          // Find user with this reset token
          const users = query(
            'SELECT id, email, name FROM users WHERE passwordResetToken = ? AND passwordResetExpires > ?',
            [token, new Date().toISOString()]
          );
    
          if (!users.length) {
            return res.status(400).json({
              success: false,
              message: 'Invalid or expired reset token'
            });
          }
    
          const user = users[0];
    
          // Hash new password
          const hashedPassword = hashPassword(newPassword);
    
          // Update password and clear reset token
          run('UPDATE users SET password = ?, passwordResetToken = NULL, passwordResetExpires = NULL, sessionToken = NULL, updatedAt = ? WHERE id = ?',
            [hashedPassword, now(), user.id]);
    
          console.log(`[Auth] Password reset completed for user: ${user.email} (ID: ${user.id})`);
    
          // Sync to PostgreSQL if connected
          const updatedUser = query('SELECT * FROM users WHERE id = ?', [user.id])[0];
          if (updatedUser) {
            handleDataChange('users', 'update', updatedUser);
          }
    
          res.json({
            success: true,
            message: 'Password has been reset successfully. You can now login with your new password.'
          });
        } catch (e) {
          console.error('[Auth] Reset password with token error:', e.message);
          res.status(500).json({ success: false, message: 'Internal server error' });
        }
      });

  // POST /api/auth/reset-password (line 1370)
      app.post('/api/auth/reset-password', authMiddleware, (req, res) => {
        try {
          const { userId, newPassword, email } = req.body;
    
          // Only SUPERADMIN can reset passwords
          if (req.user.role !== 'SUPERADMIN' && req.user.role !== 'ADMIN') {
            return res.status(403).json({ success: false, message: 'Only admins can reset passwords' });
          }
    
          if (!newPassword) {
            return res.status(400).json({ success: false, message: 'New password is required' });
          }
    
          // Find user by ID or email
          let targetUser;
          if (userId) {
            const users = query('SELECT id, email, name FROM users WHERE id = ?', [userId]);
            targetUser = users[0];
          } else if (email) {
            const users = query('SELECT id, email, name FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
            targetUser = users[0];
          }
    
          if (!targetUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
          }
    
          // Reset password
          const hashedPassword = hashPassword(newPassword);
          run('UPDATE users SET password = ?, updatedAt = ? WHERE id = ?', [hashedPassword, now(), targetUser.id]);
    
          console.log(`[Auth] Password reset by ${req.user.email} for user: ${targetUser.email}`);
    
          // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
          const resetUser = query('SELECT * FROM users WHERE id = ?', [targetUser.id])[0];
          if (resetUser) handleDataChange('users', 'update', resetUser);
    
          res.json({
            success: true,
            message: `Password reset successfully for ${targetUser.email}`,
            data: { email: targetUser.email, name: targetUser.name }
          });
        } catch (e) {
          console.error('[Auth] Reset password error:', e.message);
          res.status(500).json({ success: false, message: 'Failed to reset password' });
        }
      });

  // GET /api/auth/me (line 1419)
      app.get('/api/auth/me', authMiddleware, (req, res) => {
        try {
          const users = query('SELECT id, email, name, role, phone, companyId, branchId FROM users WHERE id = ?', [req.user.id]);
          if (!users.length) return res.status(404).json({ success: false, message: 'User not found' });
          res.json({ success: true, data: users[0] });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // GET /api/auth/profile (line 1428)
      app.get('/api/auth/profile', authMiddleware, (req, res) => {
        try {
          const users = query('SELECT id, email, name, role, phone, companyId, branchId FROM users WHERE id = ?', [req.user.id]);
          if (!users.length) return res.status(404).json({ success: false, message: 'User not found' });
          res.json({ success: true, data: users[0] });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // POST /api/auth/change-password (line 1437)
      app.post('/api/auth/change-password', authMiddleware, (req, res) => {
        try {
          const { currentPassword, newPassword } = req.body;
          const users = query('SELECT password FROM users WHERE id = ?', [req.user.id]);
          if (!users.length || users[0].password !== hashPassword(currentPassword)) {
            return res.status(400).json({ success: false, message: 'Current password is incorrect' });
          }
          run('UPDATE users SET password = ?, updatedAt = ? WHERE id = ?', [hashPassword(newPassword), now(), req.user.id]);
          const updatedUser = query('SELECT * FROM users WHERE id = ?', [req.user.id])[0];
    
          // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
          if (updatedUser) handleDataChange('users', 'update', updatedUser);
    
          res.json({ success: true, message: 'Password changed successfully' });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // GET /api/auth/check-status (line 1455)
      app.get('/api/auth/check-status', authMiddleware, async (req, res) => {
        try {
          const userId = req.user?.id || req.user?.userId;
    
          if (!userId) {
            return res.status(401).json({
              success: false,
              isActive: false,
              message: 'User not authenticated',
              shouldLogout: true
            });
          }
    
          let user = null;
          let isActive = false;
    
          // Step 1: Check SQLite first
          if (getDatabase()) {
            user = query('SELECT id, isActive, sessionToken, username, email FROM users WHERE id = ?', [userId])[0];
            if (user) {
              // Handle isActive - can be true, 1, '1', 'true', false, 0, '0', 'false'
              isActive = user.isActive === true || user.isActive === 1 || user.isActive === 'true' || user.isActive === '1';
              console.log(`[Auth] User found in SQLite: ${user.username || user.email}, isActive: ${isActive} (raw: ${user.isActive})`);
            }
          }
    
          // Step 2: If not found in SQLite, check PostgreSQL
          if (!user && REMOTE_DATABASE_URL) {
            try {
              const pg = require('pg');
              const Client = pg.Client;
              const checkStatusPgClient = new (require('pg').Client)({
                connectionString: REMOTE_DATABASE_URL,
                connectionTimeoutMillis: 5000,
                query_timeout: 5000,
                statement_timeout: 5000
              });
    
              await Promise.race([
                checkStatusPgClient.connect(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 5000))
              ]);
    
              const pgUserQuery = await Promise.race([
                checkStatusPgClient.query('SELECT id, username, email, "isActive", "sessionToken" FROM users WHERE id = $1', [userId]),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 5000))
              ]);
    
              await checkStatusPgClient.end();
    
              if (pgUserQuery.rows && pgUserQuery.rows.length > 0) {
                const pgUser = pgUserQuery.rows[0];
                user = {
                  id: pgUser.id,
                  username: pgUser.username,
                  email: pgUser.email,
                  isActive: pgUser.isActive,
                  sessionToken: pgUser.sessionToken
                };
                // Handle isActive - can be true, 1, '1', 'true', false, 0, '0', 'false'
                isActive = pgUser.isActive === true || pgUser.isActive === 1 || pgUser.isActive === 'true' || pgUser.isActive === '1';
                console.log(`[Auth] User found in PostgreSQL: ${user.username || user.email}, isActive: ${isActive} (raw: ${pgUser.isActive})`);
              }
            } catch (pgError) {
              console.error('[Auth] PostgreSQL check failed (non-critical):', pgError.message);
              // Continue with SQLite result or assume active
            }
          }
    
          if (!user) {
            console.log(`[Auth] User not found in SQLite or PostgreSQL: ${userId}`);
            // If user not found, assume active (could be temporary database issue)
            return res.json({
              success: true,
              isActive: true,
              message: 'Account status verified',
              shouldLogout: false
            });
          }
    
          // Check if session token matches (for single-session enforcement)
          const requestSessionToken = req.user?.sessionToken;
          if (requestSessionToken && user.sessionToken && user.sessionToken !== requestSessionToken) {
            return res.status(401).json({
              success: false,
              isActive: false,
              message: 'Session expired - logged in from another device',
              shouldLogout: true
            });
          }
    
          // If account is deactivated
          if (!isActive) {
            console.log(`❌ Account deactivated for user: ${user.username || user.email}`);
            return res.status(403).json({
              success: false,
              isActive: false,
              message: 'Your account has been deactivated. Please contact SuperAdmin to reactivate.',
              shouldLogout: true,
              accountDeactivated: true
            });
          }
    
          // Account is active
          return res.json({
            success: true,
            isActive: true,
            message: 'Account is active',
            shouldLogout: false
          });
        } catch (error) {
          console.error('[Auth] Check account status error:', error);
          // On error, don't force logout - could be temporary issue
          return res.status(500).json({
            success: false,
            isActive: true, // Assume active on error to prevent unnecessary logouts
            message: 'Could not verify account status',
            shouldLogout: false
          });
        }
      });

  // PUT /api/auth/update-profile (line 1578)
      app.put('/api/auth/update-profile', authMiddleware, (req, res) => {
        try {
          const { name, phone } = req.body;
          run('UPDATE users SET name = COALESCE(?, name), phone = COALESCE(?, phone), updatedAt = ? WHERE id = ?',
            [name, phone, now(), req.user.id]);
          const user = query('SELECT id, email, name, role, phone, companyId, branchId FROM users WHERE id = ?', [req.user.id])[0];
    
          // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
          if (user) handleDataChange('users', 'update', user);
    
          res.json({ success: true, data: user, message: 'Profile updated' });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // POST /api/auth/session/login - Offline session login (no password, validates session + device)
      app.post('/api/auth/session/login', async (req, res) => {
        try {
          const { sessionToken } = req.body;
          if (!sessionToken) {
            return res.status(400).json({ success: false, message: 'Session token required' });
          }

          if (!sessionService) {
            return res.status(500).json({ success: false, message: 'Session service not available' });
          }

          // Allow grace period for offline login
          const session = sessionService.validateOfflineSession(sessionToken);
          if (!session) {
            return res.status(401).json({
              success: false,
              message: 'Session expired. Please login again.',
              needsReauth: true
            });
          }

          // Verify device binding
          const deviceId = deviceService ? deviceService.getDeviceId() : null;
          if (session.deviceId && deviceId && session.deviceId !== deviceId) {
            return res.status(401).json({
              success: false,
              message: 'Session belongs to a different device. Please login again.',
              needsReauth: true
            });
          }

          // Get user from database
          const userRecord = query('SELECT id, email, name, role, branchId, companyId, isActive FROM users WHERE id = ?', [session.userId]);
          if (!userRecord || userRecord.length === 0) {
            return res.status(401).json({
              success: false,
              message: 'User not found. Please login again.',
              needsReauth: true
            });
          }

          const u = userRecord[0];
          const token = generateToken({ id: u.id, email: u.email, name: u.name, role: u.role, companyId: u.companyId, branchId: u.branchId });

          res.cookie('zapeera_token', token, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: '/'
          });

          res.json({
            success: true,
            offline: true,
            offlineGrace: session._offlineGrace || false,
            data: {
              user: {
                id: u.id,
                email: u.email,
                username: u.email,
                name: u.name,
                role: u.role,
                companyId: u.companyId,
                branchId: u.branchId,
                isActive: u.isActive
              },
              token,
              sessionToken
            }
          });
        } catch (e) {
          console.error('[Auth] Session login error:', e.message);
          res.status(500).json({ success: false, message: 'Session login failed: ' + e.message });
        }
      });

  // POST /api/auth/logout
      app.post('/api/auth/logout', authMiddleware, (req, res) => {
        try {
          // Stop periodic auth refresh
          if (authRefreshService) {
            authRefreshService.stopPeriodicRefresh();
          }

          // Revoke all sessions for the authenticated user
          if (sessionService && req.user && req.user.id) {
            sessionService.revokeAllUserSessions(req.user.id);
            console.log('[Auth] All sessions revoked for user:', req.user.id);
          }

          // Clear cookies
          res.clearCookie('zapeera_token', { path: '/' });
          res.clearCookie('zapeera_session', { path: '/' });
          res.json({ success: true, message: 'Logged out successfully' });
        } catch (e) {
          console.error('[Auth] Logout error:', e.message);
          res.clearCookie('zapeera_token', { path: '/' });
          res.json({ success: true, message: 'Logged out' });
        }
      });

  // POST /api/auth/provision-session - Create local session after cloud auth.
  // Requires a valid provisioning token in Authorization: Bearer.
  // The token is issued by the Electron main process (the trusted Desktop layer)
  // and signed with the embedded server's JWT_SECRET.
      app.post('/api/auth/provision-session', async (req, res) => {
        try {
          // Validate provisioning token
          const authHeader = req.headers.authorization || '';
          const provisionToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
          if (!provisionToken) {
            return res.status(401).json({ success: false, message: 'Provisioning authorization required' });
          }
          const provisionPayload = verifyProvisioningToken(provisionToken);
          if (!provisionPayload || provisionPayload.purpose !== 'provision') {
            return res.status(403).json({ success: false, message: 'Invalid or expired provisioning token' });
          }

          const { user: cloudUser, memberships, businesses, cloudAccessToken, cloudApiUrl } = req.body;
          if (!cloudUser || !cloudUser.id || !cloudUser.email) {
            return res.status(400).json({ success: false, message: 'Invalid provisioning payload' });
          }
          // Verify the provisioned userId matches the token
          if (String(cloudUser.id) !== String(provisionPayload.userId)) {
            return res.status(403).json({ success: false, message: 'Provisioning token userId mismatch' });
          }

          const userId = cloudUser.id;
          const email = cloudUser.email;
          const name = cloudUser.name || cloudUser.displayName || email;
          const timestamp = now();

          // Ensure user exists in local SQLite
          const existing = query('SELECT id FROM users WHERE id = ?', [userId]);
          if (!existing || existing.length === 0) {
            const hashedPassword = hashPassword(userId + '-' + timestamp);
            const isActiveVal = cloudUser.isActive === true || cloudUser.isActive === 1 || cloudUser.isActive === 'true' || cloudUser.isActive === '1' ? 1 : 0;
            run(`
              INSERT OR IGNORE INTO users
              (id, username, email, password, name, role, companyId, branchId, isActive, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              userId,
              cloudUser.username || email,
              email,
              hashedPassword,
              name,
              cloudUser.role || 'USER',
              cloudUser.companyId || null,
              cloudUser.branchId || null,
              isActiveVal,
              timestamp,
              timestamp
            ]);
            saveDatabase();
            console.log('[Provision] Created local user:', userId);
          }

          // Register device and create session
          let sessionToken = null;
          let localToken = null;
          try {
            if (deviceService) {
              deviceService.registerDevice(userId);
            }
            if (sessionService) {
              const deviceId = deviceService ? deviceService.getDeviceId() : null;
              const session = sessionService.createSession(userId, deviceId);
              sessionToken = session.token;
              run('UPDATE users SET sessionToken = ?, updatedAt = ? WHERE id = ?', [sessionToken, timestamp, userId]);
              saveDatabase();
            }
          } catch (svcError) {
            console.warn('[Provision] Device/session setup warning:', svcError.message);
          }

          // Generate local JWT
          localToken = generateToken({ id: userId, email, name, role: cloudUser.role || 'USER', companyId: cloudUser.companyId, branchId: cloudUser.branchId });

          // Configure the embedded cloud sync client so the periodic sync engine
          // can authenticate to the Cloud Backend and download business data.
          try {
            const cloudApiService = require('../services/cloud-api.service');
            if (cloudApiUrl) {
              cloudApiService.setCloudApiUrl(cloudApiUrl);
            }
            if (cloudAccessToken) {
              cloudApiService.setAuthToken(cloudAccessToken);
            }
            // Persist so the token/url survive an app restart (restored on boot).
            try {
              const existingToken = query("SELECT id FROM settings WHERE key = 'zapeera_cloud_access_token'");
              if (existingToken && existingToken.length > 0) {
                run("UPDATE settings SET value = ?, updatedAt = ? WHERE key = 'zapeera_cloud_access_token'",
                  [cloudAccessToken || '', timestamp]);
              } else {
                run("INSERT OR IGNORE INTO settings (id, key, value, createdAt, updatedAt) VALUES (?, 'zapeera_cloud_access_token', ?, ?, ?)",
                  [uuid(), cloudAccessToken || '', timestamp, timestamp]);
              }
              const existingUrl = query("SELECT id FROM settings WHERE key = 'zapeera_cloud_api_url'");
              if (existingUrl && existingUrl.length > 0) {
                run("UPDATE settings SET value = ?, updatedAt = ? WHERE key = 'zapeera_cloud_api_url'",
                  [cloudApiUrl || '', timestamp]);
              } else {
                run("INSERT OR IGNORE INTO settings (id, key, value, createdAt, updatedAt) VALUES (?, 'zapeera_cloud_api_url', ?, ?, ?)",
                  [uuid(), cloudApiUrl || '', timestamp, timestamp]);
              }
              saveDatabase();
            } catch (persistErr) {
              console.warn('[Provision] Cloud credential persistence warning:', persistErr.message);
            }
          } catch (apiErr) {
            console.warn('[Provision] Cloud API setup warning:', apiErr.message);
          }

          // Persist the user's businesses into the local companies table so they
          // appear in /api/companies/my/list immediately (offline-first bootstrap).
          try {
            const businessList = Array.isArray(businesses) ? businesses : [];
            for (const biz of businessList) {
              if (!biz || !biz.id) continue;
              const existing = query('SELECT id FROM companies WHERE id = ?', [biz.id]);
              if (existing && existing.length > 0) {
                run('UPDATE companies SET name = ?, description = ?, address = ?, phone = ?, email = ?, slug = ?, businessType = ?, updatedAt = ? WHERE id = ?',
                  [biz.name || '', biz.description || null, biz.address || null, biz.phone || null, biz.email || null, biz.slug || null, biz.businessType || 'PHARMACY', timestamp, biz.id]);
              } else {
                run(`INSERT INTO companies (id, name, description, address, phone, email, slug, businessType, isActive, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
                  [biz.id, biz.name || '', biz.description || null, biz.address || null, biz.phone || null, biz.email || null, biz.slug || null, biz.businessType || 'PHARMACY', userId, timestamp, timestamp]);
              }
            }
            saveDatabase();
          } catch (bizErr) {
            console.warn('[Provision] Business persistence warning:', bizErr.message);
          }

          // Persist identity + memberships (requires the cloud token set above)
          try {
            if (syncAccountService && syncAccountService.syncAccount) {
              await syncAccountService.syncAccount(userId, email);
            }
          } catch (accErr) {
            console.warn('[Provision] Account sync warning:', accErr.message);
          }

          // Set cookies
          res.cookie('zapeera_token', localToken, {
            httpOnly: true, secure: false, sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000, path: '/'
          });
          if (sessionToken) {
            res.cookie('zapeera_session', sessionToken, {
              httpOnly: true, secure: false, sameSite: 'lax',
              maxAge: 72 * 60 * 60 * 1000, path: '/'
            });
          }

          res.json({
            success: true,
            data: {
              user: {
                id: userId,
                email,
                username: cloudUser.username || email,
                name,
                role: cloudUser.role || 'USER',
                companyId: cloudUser.companyId,
                branchId: cloudUser.branchId,
                isActive: 1,
                memberships: memberships || [],
                businesses: businesses || []
              },
              token: localToken,
              sessionToken
            }
          });
        } catch (e) {
          console.error('[Provision] Error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

}

module.exports = {
  registerAuthRoutes
};
