/**
 * Complete test flow for staff creation and retrieval
 * Tests: Login -> Create Staff -> GET Users -> Verify Staff appears
 */

const http = require('http');

const SERVER_PORT = 5001;
const BASE_URL = `http://localhost:${SERVER_PORT}`;

// Test credentials
const TEST_USER = {
  email: 'tayyab1@gmail.com',
  password: 'Umair@143'
};

// Helper to make HTTP requests
function makeRequest(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    if (data) {
      options.headers['Content-Length'] = JSON.stringify(data).length;
    }

    const req = http.request(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: body, headers: res.headers });
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Connection error: ${error.message} (Is server running on ${BASE_URL}?)`));
    });
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

// Step 1: Login
async function login() {
  console.log('\n' + '='.repeat(60));
  console.log('STEP 1: LOGIN');
  console.log('='.repeat(60));
  
  try {
    const response = await makeRequest('POST', '/api/auth/login', {
      email: TEST_USER.email,
      password: TEST_USER.password
    });

    if (response.status === 200 && response.data.success) {
      const user = response.data.data.user;
      const token = response.data.data.token;
      
      console.log('✅ Login successful!');
      console.log('   User ID:', user.id);
      console.log('   Email:', user.email);
      console.log('   Role:', user.role);
      console.log('   Created By:', user.createdBy);
      console.log('   Branch ID:', user.branchId);
      console.log('   Company ID:', user.companyId);
      
      return { token, user };
    } else {
      console.error('❌ Login failed:', response.data);
      return null;
    }
  } catch (error) {
    console.error('❌ Login error:', error.message);
    console.error('   Full error:', error);
    return null;
  }
}

// Step 2: Get branches to find lahore branch
async function getBranches(token) {
  console.log('\n' + '='.repeat(60));
  console.log('STEP 2: GET BRANCHES');
  console.log('='.repeat(60));
  
  try {
    const response = await makeRequest('GET', '/api/branches', null, token);

    if (response.status === 200 && response.data.success) {
      // Handle different response structures
      let branches = response.data.data;
      if (!Array.isArray(branches)) {
        // If data is an object, try to find branches array
        branches = response.data.data.branches || response.data.data.data || [];
      }
      if (!Array.isArray(branches)) {
        branches = [];
      }
      console.log(`✅ Found ${branches.length} branches`);
      
      // Find lahore branch
      const lahoreBranch = branches.find(b => 
        b.name && b.name.toLowerCase().includes('lahore')
      );
      
      if (lahoreBranch) {
        console.log('✅ Found lahore branch:');
        console.log('   ID:', lahoreBranch.id);
        console.log('   Name:', lahoreBranch.name);
        console.log('   Company ID:', lahoreBranch.companyId);
        return lahoreBranch;
      } else {
        console.log('⚠️  Lahore branch not found. Using first branch:');
        if (branches.length > 0) {
          console.log('   ID:', branches[0].id);
          console.log('   Name:', branches[0].name);
          return branches[0];
        }
      }
    } else {
      console.error('❌ GET /api/branches failed:', response.data);
      console.error('   Response structure:', JSON.stringify(response.data, null, 2));
    }
    return null;
  } catch (error) {
    console.error('❌ GET /api/branches error:', error.message);
    console.error('   Stack:', error.stack);
    return null;
  }
}

// Step 3: Get users BEFORE creating staff
async function getUsersBefore(token) {
  console.log('\n' + '='.repeat(60));
  console.log('STEP 3: GET USERS (BEFORE CREATING STAFF)');
  console.log('='.repeat(60));
  
  try {
    const response = await makeRequest('GET', '/api/users', null, token);

    if (response.status === 200 && response.data.success) {
      const users = response.data.data.users || [];
      console.log(`✅ GET /api/users successful - Found ${users.length} users`);
      
      if (users.length > 0) {
        console.log('\nCurrent users:');
        users.forEach((user, index) => {
          console.log(`   ${index + 1}. ${user.name} (${user.email})`);
          console.log(`      ID: ${user.id}`);
          console.log(`      Created By: ${user.createdBy}`);
          console.log(`      Branch: ${user.branchId || 'N/A'}`);
        });
      } else {
        console.log('⚠️  No users found (this is expected if no staff has been created)');
      }
      
      return users;
    } else {
      console.error('❌ GET /api/users failed:', response.data);
      return [];
    }
  } catch (error) {
    console.error('❌ GET /api/users error:', error.message);
    return [];
  }
}

// Step 4: Create staff
async function createStaff(token, branchId, companyId, currentUserId) {
  console.log('\n' + '='.repeat(60));
  console.log('STEP 4: CREATE STAFF');
  console.log('='.repeat(60));
  
  const timestamp = Date.now();
  const testStaff = {
    name: `Test Staff ${timestamp}`,
    email: `teststaff${timestamp}@test.com`,
    username: `teststaff${timestamp}`,
    password: 'Test123!',
    role: 'MANAGER',
    branchId: branchId,
    companyId: companyId
  };

  console.log('Creating staff with:');
  console.log('   Name:', testStaff.name);
  console.log('   Email:', testStaff.email);
  console.log('   Role:', testStaff.role);
  console.log('   Branch ID:', testStaff.branchId);
  console.log('   Company ID:', testStaff.companyId);
  console.log('   (Will be created by user ID:', currentUserId, ')');

  try {
    const response = await makeRequest('POST', '/api/users', testStaff, token);

    if (response.status === 201 && response.data.success) {
      const createdStaff = response.data.data;
      console.log('\n✅ Staff created successfully!');
      console.log('   Staff ID:', createdStaff.id);
      console.log('   Name:', createdStaff.name);
      console.log('   Email:', createdStaff.email);
      console.log('   Created By:', createdStaff.createdBy);
      console.log('   Branch ID:', createdStaff.branchId);
      console.log('   Is Active:', createdStaff.isActive);
      console.log('   DB Type:', response.data.dbType);
      console.log('   Synced to PostgreSQL:', response.data.syncedToPostgreSQL);
      
      return createdStaff;
    } else {
      console.error('❌ Staff creation failed:', response.data);
      return null;
    }
  } catch (error) {
    console.error('❌ Staff creation error:', error.message);
    return null;
  }
}

// Step 5: Wait a bit for sync
async function waitForSync(seconds = 2) {
  console.log(`\n⏳ Waiting ${seconds} seconds for backend sync...`);
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

// Step 6: Get users AFTER creating staff
async function getUsersAfter(token, createdStaffId) {
  console.log('\n' + '='.repeat(60));
  console.log('STEP 6: GET USERS (AFTER CREATING STAFF)');
  console.log('='.repeat(60));
  
  try {
    const response = await makeRequest('GET', '/api/users', null, token);

    if (response.status === 200 && response.data.success) {
      const users = response.data.data.users || [];
      console.log(`✅ GET /api/users successful - Found ${users.length} users`);
      
      if (users.length > 0) {
        console.log('\nAll users:');
        users.forEach((user, index) => {
          console.log(`   ${index + 1}. ${user.name} (${user.email})`);
          console.log(`      ID: ${user.id}`);
          console.log(`      Created By: ${user.createdBy}`);
          console.log(`      Branch: ${user.branchId || 'N/A'}`);
        });
      } else {
        console.log('❌ No users found - THIS IS THE PROBLEM!');
      }
      
      // Check if created staff is in the list
      const foundStaff = users.find(u => u.id === createdStaffId);
      
      if (foundStaff) {
        console.log('\n✅ SUCCESS: Created staff found in GET /api/users response!');
        console.log('   Staff:', foundStaff.name, '(', foundStaff.email, ')');
        return true;
      } else {
        console.log('\n❌ FAILURE: Created staff NOT found in GET /api/users response!');
        console.log('   Looking for staff ID:', createdStaffId);
        console.log('   This indicates the GET endpoint is not returning the created staff.');
        return false;
      }
    } else {
      console.error('❌ GET /api/users failed:', response.data);
      return false;
    }
  } catch (error) {
    console.error('❌ GET /api/users error:', error.message);
    return false;
  }
}

// Main test flow
async function runTest() {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 STARTING STAFF CREATION AND RETRIEVAL TEST');
  console.log('='.repeat(60));
  console.log('Server:', BASE_URL);
  console.log('User:', TEST_USER.email);
  console.log('='.repeat(60));

  try {
    // Step 1: Login
    const loginResult = await login();
    if (!loginResult) {
      console.error('\n❌ Cannot continue without login');
      return;
    }
    const { token, user } = loginResult;

    // Step 2: Get branches
    const branch = await getBranches(token);
    if (!branch) {
      console.error('\n❌ Cannot continue without a branch');
      return;
    }

    // Step 3: Get users before
    const usersBefore = await getUsersBefore(token);
    console.log(`\n📊 Users before creating staff: ${usersBefore.length}`);

    // Step 4: Create staff
    const createdStaff = await createStaff(token, branch.id, branch.companyId, user.id);
    if (!createdStaff) {
      console.error('\n❌ Cannot continue without creating staff');
      return;
    }

    // Step 5: Wait for sync
    await waitForSync(2);

    // Step 6: Get users after
    const verified = await getUsersAfter(token, createdStaff.id);

    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('📋 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Login: SUCCESS`);
    console.log(`✅ Branch found: ${branch.name}`);
    console.log(`✅ Users before: ${usersBefore.length}`);
    console.log(`✅ Staff created: ${createdStaff.name} (${createdStaff.id})`);
    console.log(`✅ Created By: ${createdStaff.createdBy}`);
    console.log(`✅ Staff visible in GET: ${verified ? 'YES ✅' : 'NO ❌'}`);
    
    if (verified) {
      console.log('\n🎉 TEST PASSED! GET /api/users is working correctly.');
    } else {
      console.log('\n❌ TEST FAILED! Created staff is not visible in GET /api/users.');
      console.log('   This indicates the GET endpoint query logic needs to be fixed.');
    }
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ Test suite error:', error);
  }
}

// Run the test
runTest();


