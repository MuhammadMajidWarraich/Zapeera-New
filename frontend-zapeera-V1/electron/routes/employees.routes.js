/**
 * Employees Routes
 * Extracted from routes/index.js
 */

function registerEmployeesRoutes(app, authMiddleware, deps) {
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

// GET /api/employees (line 5425)
      app.get('/api/employees', authMiddleware, (req, res) => {
        try {
          const { page = 1, limit = 10, search = '', status = '', branchId = '', isActive = 'all' } = req.query;
    
          const skip = (Number(page) - 1) * Number(limit);
          const take = Number(limit);
    
          // Get context from headers (set by frontend) - match backend controller
          const selectedCompanyId = req.headers['x-company-id'] || req.user?.selectedCompanyId;
          const selectedBranchId = req.headers['x-branch-id'] || req.user?.selectedBranchId;
    
          // Use getDataFilter for consistent data isolation (match backend)
          const requestedBranchId = branchId || selectedBranchId || null;
          const requestedCompanyId = selectedCompanyId || null;
          const { branchFilter, companyFilter } = getDataFilter(req.user, requestedBranchId, requestedCompanyId);
    
          let sql = 'SELECT * FROM employees WHERE 1=1';
          const params = [];
    
          // Apply data isolation using getDataFilter (match backend)
          if (branchFilter) {
            sql += ' AND branchId = ?';
            params.push(branchFilter);
            console.log('[Employees] Filtering by branchId:', branchFilter);
          }
    
          // Apply company filter if available
          if (companyFilter) {
            // For employees, company filter is applied through branchId, but we can add additional check
            // CRITICAL FIX: Only get ACTIVE branches to prevent showing employees from deleted branches
            const companyBranches = query('SELECT id FROM branches WHERE companyId = ? AND isActive = 1', [companyFilter]);
            if (companyBranches && companyBranches.length > 0) {
              const branchIds = companyBranches.map(b => b.id);
              sql += ' AND branchId IN (' + branchIds.map(() => '?').join(',') + ')';
              params.push(...branchIds);
              console.log('[Employees] Filtering by active company branches:', branchIds.length, 'branches');
            } else {
              // No active branches for this company, return empty
              sql += ' AND branchId = ?';
              params.push('no-branches-for-company');
              console.log('[Employees] No active branches for company - returning empty');
            }
          }
    
          // Apply isActive filter (match backend) - default to 'all' to show both active and inactive
          if (isActive !== 'all' && isActive !== '' && isActive !== undefined && isActive !== null) {
            if (isActive === 'true' || isActive === true || isActive === '1') {
              sql += ' AND isActive = 1';
            } else if (isActive === 'false' || isActive === false || isActive === '0') {
              sql += ' AND isActive = 0';
            }
          }
          // If isActive is 'all' or not provided, don't filter by isActive (show all)
    
          // Apply status filter (match backend)
          if (status && status.trim() !== '') {
            sql += ' AND status = ?';
            params.push(status);
          }
    
          // Apply search filter (match backend)
          if (search && search.trim() !== '') {
            const searchTerm = `%${search}%`;
            sql += ' AND (name LIKE ? OR email LIKE ? OR employeeId LIKE ? OR position LIKE ?)';
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
          }
    
          sql += ' ORDER BY createdAt DESC';
    
          // Get total count for pagination
          const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as count');
          const totalResult = query(countSql, params);
          const total = totalResult[0]?.count || 0;
    
          // Apply pagination
          sql += ' LIMIT ? OFFSET ?';
          params.push(take, skip);
    
          const employees = query(sql, params).map(e => ({
            ...e,
            status: e.status || 'ACTIVE',
            branch: e.branchId ? query('SELECT id, name FROM branches WHERE id = ?', [e.branchId])[0] : null
          }));
    
          console.log('[Employees] Found employees:', employees.length, 'Total:', total, 'Filter:', { branchFilter, companyFilter, isActive, status, search });
    
          res.json({
            success: true,
            data: {
              employees,
              pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                pages: Math.ceil(total / Number(limit))
              }
            }
          });
        } catch (e) {
          console.error('[Employees] GET error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/employees/:id (line 5530)
      app.get('/api/employees/:id', authMiddleware, (req, res) => {
        try {
          const items = query('SELECT * FROM employees WHERE id = ? AND isActive = 1', [req.params.id]);
          if (!items.length) return res.status(404).json({ success: false, message: 'Employee not found' });
          res.json({ success: true, data: items[0] });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // POST /api/employees (line 5539)
      app.post('/api/employees', authMiddleware, (req, res) => {
        try {
          console.log('[Employees] POST request received');
          console.log('[Employees] Request body:', JSON.stringify(req.body, null, 2));
          console.log('[Employees] User:', { id: req.user?.id, email: req.user?.email, branchId: req.user?.branchId, companyId: req.user?.companyId });
    
          const { name, email, phone, address, position, department, salary = 0, hireDate, branchId, companyId, employeeId,
                  status = 'ACTIVE', emergencyContactName, emergencyContactPhone, emergencyContactRelation } = req.body;
    
          if (!name || !name.trim()) {
            console.error('[Employees] ❌ Validation failed: Name is required');
            return res.status(400).json({ success: false, message: 'Name is required' });
          }
    
          // Get context from headers (set by frontend) - match backend controller
          const selectedCompanyId = req.headers['x-company-id'] || req.user?.selectedCompanyId;
          const selectedBranchId = req.headers['x-branch-id'] || req.user?.selectedBranchId;
    
          // CRITICAL FIX: Match backend - prioritize branchId from body FIRST (backend requires it)
          // Backend employee controller line 17: branchId: Joi.string().required()
          // So backend expects branchId in body, but we should also check headers as fallback
          const finalBranchId = branchId || selectedBranchId || req.user?.branchId || null;
          const finalCompanyId = companyId || selectedCompanyId || req.user?.companyId || null;
    
          console.log('[Employees] Final IDs:', { finalBranchId, finalCompanyId });
    
          // CRITICAL: Ensure SQLite table exists and has all required columns BEFORE insert
          try {
            // Check if table exists
            const tableExists = query("SELECT name FROM sqlite_master WHERE type='table' AND name='employees'");
            if (!tableExists || tableExists.length === 0) {
              console.error('[Employees] ❌ Table "employees" does not exist!');
              return res.status(500).json({ success: false, message: 'Database table not found. Please restart the application.' });
            }
    
            const tableInfo = query("PRAGMA table_info(employees)");
            const columnNames = tableInfo.map(col => col.name.toLowerCase());
            console.log('[Employees] SQLite table columns:', columnNames);
    
            // Required columns for employees table
            const requiredColumns = {
              'employeeid': 'TEXT',
              'department': 'TEXT',
              'status': 'TEXT DEFAULT \'ACTIVE\'',
              'createdby': 'TEXT'
            };
    
            // Add missing columns if they don't exist
            for (const [colName, colType] of Object.entries(requiredColumns)) {
              if (!columnNames.includes(colName)) {
                console.log(`[Employees] Adding missing column: ${colName}...`);
                try {
                  run(`ALTER TABLE employees ADD COLUMN ${colName} ${colType}`);
                  saveDatabase();
                  console.log(`[Employees] ✅ Added column: ${colName}`);
                } catch (alterError) {
                  console.log(`[Employees] Could not add column ${colName}:`, alterError.message);
                }
              }
            }
          } catch (migrationError) {
            console.log('[Employees] Migration check:', migrationError.message);
          }
    
          const id = uuid();
          const timestamp = now();
    
          // Validate required fields (match backend)
          if (!email || !email.trim()) {
            return res.status(400).json({
              success: false,
              message: 'Validation error',
              errors: ['Email is required']
            });
          }
    
          if (!position || !position.trim()) {
            return res.status(400).json({
              success: false,
              message: 'Validation error',
              errors: ['Position is required']
            });
          }
    
          if (!finalBranchId) {
            return res.status(400).json({
              success: false,
              message: 'Validation error',
              errors: ['Branch is required']
            });
          }
    
          // Check if employee with email already exists (match backend)
          const existingEmployee = query('SELECT id FROM employees WHERE email = ?', [email]);
          if (existingEmployee && existingEmployee.length > 0) {
            return res.status(400).json({
              success: false,
              message: 'Employee with this email already exists'
            });
          }
    
          // Check if branch exists (match backend)
          const branch = query('SELECT id, companyId FROM branches WHERE id = ?', [finalBranchId]);
          if (!branch || branch.length === 0) {
            return res.status(400).json({
              success: false,
              message: 'Branch not found'
            });
          }
    
          // Get companyId from branch if not provided
          if (!finalCompanyId && branch[0].companyId) {
            finalCompanyId = branch[0].companyId;
          }
    
          // Generate unique employee ID (match backend)
          const lastEmployee = query('SELECT employeeId FROM employees ORDER BY employeeId DESC LIMIT 1')[0];
          let generatedEmployeeId = 'EMP001';
          if (lastEmployee && lastEmployee.employeeId) {
            const lastNumber = parseInt(lastEmployee.employeeId.replace('EMP', '')) || 0;
            const newNumber = lastNumber + 1;
            generatedEmployeeId = `EMP${newNumber.toString().padStart(3, '0')}`;
          }
    
          console.log('[Employees] Inserting into SQLite:', { id, name, email, position, finalBranchId, finalCompanyId });
          console.log('[Employees] User context:', { userId: req.user?.id, userBranchId: req.user?.branchId, userCompanyId: req.user?.companyId });
    
          try {
            // Use finalBranchId and finalCompanyId (match backend)
          const insertSuccess = run(`INSERT INTO employees (id, name, email, phone, address, position, department, salary, hireDate, branchId, companyId, employeeId, status, emergencyContactName, emergencyContactPhone, emergencyContactRelation, createdBy, isActive, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
              [id, name, email || null, phone || null, address || null, position || 'Staff', department || null, salary || null,
               hireDate || timestamp, finalBranchId, finalCompanyId, generatedEmployeeId, status || 'ACTIVE',
               emergencyContactName || null, emergencyContactPhone || null, emergencyContactRelation || null,
               req.user?.id || null, timestamp, timestamp]);
    
            if (!insertSuccess) {
              const errorMsg = lastDbError || 'Unknown database error';
              console.error('[Employees] ❌ SQLite insert failed:', errorMsg);
              return res.status(500).json({ success: false, message: 'Failed to create employee: ' + errorMsg });
            }
          } catch (insertError) {
            console.error('[Employees] ❌ Exception during insert:', insertError);
            console.error('[Employees] Error details:', {
              message: insertError.message,
              stack: insertError.stack,
              lastDbError: lastDbError
            });
            return res.status(500).json({ success: false, message: 'Failed to create employee: ' + (insertError.message || lastDbError || 'Database error') });
          }
    
          // Return with nested objects that frontend expects
          const e = query('SELECT * FROM employees WHERE id = ?', [id])[0];
    
          if (!e) {
            console.error('[Employees] ❌ Employee not found after insert');
            return res.status(500).json({ success: false, message: 'Employee created but could not be retrieved' });
          }
          const employeeBranch = e.branchId ? query('SELECT id, name FROM branches WHERE id = ?', [e.branchId])[0] : null;
    
          const employee = {
            ...e,
            employeeId: e.employeeId || generatedEmployeeId,
            status: e.status || 'ACTIVE',
            branch: employeeBranch,
            emergencyContactName: emergencyContactName || null,
            emergencyContactPhone: emergencyContactPhone || null,
            emergencyContactRelation: emergencyContactRelation || null
          };
    
          console.log('[Employees] Created employee:', employee);
    
          // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
          if (employee) handleDataChange('employees', 'create', employee);
    
          res.status(201).json({ success: true, data: employee, message: 'Employee created successfully' });
        } catch (e) { console.error('[API] Employee create error:', e); res.status(500).json({ success: false, message: e.message }); }
      });

  // PUT /api/employees/:id (line 5719)
      app.put('/api/employees/:id', authMiddleware, (req, res) => {
        try {
          const { id } = req.params;
          const updateData = req.body;
    
          // Check if employee exists (match backend)
          const existingEmployee = query('SELECT * FROM employees WHERE id = ?', [id])[0];
          if (!existingEmployee) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
          }
    
          // Build update fields - match backend structure
          const updateFields = [];
          const updateValues = [];
    
          if (updateData.name !== undefined) { updateFields.push('name = ?'); updateValues.push(updateData.name); }
          if (updateData.email !== undefined) { updateFields.push('email = ?'); updateValues.push(updateData.email || null); }
          if (updateData.phone !== undefined) { updateFields.push('phone = ?'); updateValues.push(updateData.phone || null); }
          if (updateData.address !== undefined) { updateFields.push('address = ?'); updateValues.push(updateData.address || null); }
          if (updateData.position !== undefined) { updateFields.push('position = ?'); updateValues.push(updateData.position || null); }
          if (updateData.department !== undefined) { updateFields.push('department = ?'); updateValues.push(updateData.department || null); }
          if (updateData.salary !== undefined) { updateFields.push('salary = ?'); updateValues.push(updateData.salary || 0); }
          if (updateData.hireDate !== undefined) { updateFields.push('hireDate = ?'); updateValues.push(updateData.hireDate || null); }
          if (updateData.status !== undefined) { updateFields.push('status = ?'); updateValues.push(updateData.status || 'ACTIVE'); }
          if (updateData.isActive !== undefined) { updateFields.push('isActive = ?'); updateValues.push(updateData.isActive ? 1 : 0); }
    
          if (updateFields.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
          }
    
          updateFields.push('updatedAt = ?');
          updateValues.push(now());
          updateValues.push(id);
    
          run(`UPDATE employees SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);
    
          // Get updated employee with related data (match backend)
          const employee = query('SELECT * FROM employees WHERE id = ?', [id])[0];
          if (!employee) {
            return res.status(404).json({ success: false, message: 'Employee not found after update' });
          }
    
          // Include related data (match backend)
          const branch = employee.branchId ? query('SELECT id, name FROM branches WHERE id = ?', [employee.branchId])[0] : null;
    
          const employeeWithRelations = {
            ...employee,
            branch: branch || null,
            status: employee.status || 'ACTIVE'
          };
    
          // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
          if (employeeWithRelations) handleDataChange('employees', 'update', employeeWithRelations);
    
          res.json({ success: true, data: employeeWithRelations, message: 'Employee updated successfully' });
        } catch (e) {
          console.error('[Employees] Update error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // DELETE /api/employees/:id (line 5781)
      app.delete('/api/employees/:id', authMiddleware, (req, res) => {
        try {
          const employee = query('SELECT * FROM employees WHERE id = ?', [req.params.id])[0];
          run('UPDATE employees SET isActive = 0, updatedAt = ? WHERE id = ?', [now(), req.params.id]);
    
          // 🔄 TWO-WAY SYNC: Queue soft delete for sync
          if (employee) handleDataChange('employees', 'update', { ...employee, isActive: 0, updatedAt: now() });
    
          res.json({ success: true, message: 'Employee deleted successfully' });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

}

module.exports = {
  registerEmployeesRoutes
};
