/**
 * Test Script: Staff Creation & Retrieval Flow
 * 
 * This script tests the complete flow:
 * 1. Login with an admin account (TEST_EMAIL / TEST_PASSWORD env vars)
 * 2. Create a new staff member
 * 3. Retrieve staff list
 * 4. Verify the created staff appears in the list
 * 
 * Run: ts-node scripts/test-staff-flow.ts
 */

// Use Node.js built-in fetch or axios
// For Node.js 18+, we can use fetch, otherwise install axios
const httpRequest = async (url: string, options: any) => {
  try {
    // Try to use native fetch (Node.js 18+)
    if (typeof globalThis.fetch !== 'undefined') {
      return await globalThis.fetch(url, options);
    }
    
    // Fallback: use http/https modules
    const http = require('http');
    const https = require('https');
    const urlModule = require('url');
    
    const parsedUrl = urlModule.parse(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;
    
    return new Promise((resolve, reject) => {
      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.path,
        method: options.method || 'GET',
        headers: options.headers || {}
      };
      
      const req = client.request(requestOptions, (res: any) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json: async () => JSON.parse(data),
            text: async () => data
          });
        });
      });
      
      req.on('error', reject);
      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  } catch (error: any) {
    throw error;
  }
};

const BASE_URL = process.env.API_URL || 'http://localhost:5000';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin';  // username or email
const TEST_PASSWORD = process.env.TEST_PASSWORD || ''; // set TEST_PASSWORD in env for real logins

interface LoginResponse {
  success: boolean;
  data?: {
    token: string;
    user: {
      id: string;
      email: string;
      role: string;
      branchId?: string;
      companyId?: string;
      createdBy?: string;
    };
  };
  message?: string;
}

interface CreateStaffResponse {
  success: boolean;
  data?: {
    id: string;
    username: string;
    email: string;
    name: string;
    role: string;
    createdBy: string;
    isActive: boolean;
  };
  message?: string;
}

interface GetStaffResponse {
  success: boolean;
  data?: {
    users: Array<{
      id: string;
      username: string;
      email: string;
      name: string;
      role: string;
      createdBy: string;
      isActive: boolean;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
  };
  message?: string;
}

async function testStaffFlow() {
  console.log('🧪 ========== STAFF FLOW TEST START ==========\n');
  
  let authToken: string | null = null;
  let adminUser: any = null;
  let createdStaffId: string | null = null;

  try {
    // Step 1: Login
    console.log('📝 Step 1: Logging in...');
    console.log(`   Email: ${TEST_EMAIL}`);
    console.log(`   Password: ${TEST_PASSWORD.substring(0, 3)}***\n`);

    const loginResponse: any = await httpRequest(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        usernameOrEmail: TEST_EMAIL, // Login uses usernameOrEmail, not email
        password: TEST_PASSWORD
      })
    });

    const loginData: LoginResponse = await loginResponse.json();

    if (!loginData.success || !loginData.data?.token) {
      console.error('❌ Login failed:', loginData.message || 'Unknown error');
      console.error('   Response:', JSON.stringify(loginData, null, 2));
      return;
    }

    authToken = loginData.data.token;
    adminUser = loginData.data.user;

    console.log('✅ Login successful!');
    console.log(`   User ID: ${adminUser.id}`);
    console.log(`   Role: ${adminUser.role}`);
    console.log(`   Email: ${adminUser.email}`);
    console.log(`   Branch ID: ${adminUser.branchId || 'None'}`);
    console.log(`   Company ID: ${adminUser.companyId || 'None'}`);
    console.log(`   Created By: ${adminUser.createdBy || 'None'}\n`);

    // Step 2: Create Staff
    console.log('📝 Step 2: Creating new staff member...');
    
    const staffData = {
      username: `teststaff_${Date.now()}`,
      email: `teststaff_${Date.now()}@test.com`,
      password: 'Test123!',
      name: 'Test Staff Member',
      role: 'CASHIER',
      branchId: adminUser.branchId || null
    };

    console.log('   Staff Data:', JSON.stringify(staffData, null, 2));

    const createResponse: any = await httpRequest(`${BASE_URL}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'x-branch-id': adminUser.branchId || '',
        'x-company-id': adminUser.companyId || ''
      },
      body: JSON.stringify(staffData)
    });

    const createData: CreateStaffResponse = await createResponse.json();

    if (!createData.success || !createData.data) {
      console.error('❌ Staff creation failed:', createData.message || 'Unknown error');
      console.error('   Response:', JSON.stringify(createData, null, 2));
      return;
    }

    createdStaffId = createData.data.id;

    console.log('✅ Staff created successfully!');
    console.log(`   Staff ID: ${createData.data.id}`);
    console.log(`   Username: ${createData.data.username}`);
    console.log(`   Email: ${createData.data.email}`);
    console.log(`   Created By: ${createData.data.createdBy}`);
    console.log(`   Is Active: ${createData.data.isActive}`);
    console.log(`   Expected Created By: ${adminUser.id}`);
    
    if (createData.data.createdBy !== adminUser.id) {
      console.error('⚠️  WARNING: createdBy mismatch!');
      console.error(`   Expected: ${adminUser.id}`);
      console.error(`   Got: ${createData.data.createdBy}`);
    } else {
      console.log('✅ createdBy matches admin user ID!\n');
    }

    // Wait a bit for sync (if needed)
    console.log('⏳ Waiting 2 seconds for sync...\n');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 3: Get Staff List
    console.log('📝 Step 3: Retrieving staff list...');

    const getStaffUrl = new URL(`${BASE_URL}/api/users`);
    getStaffUrl.searchParams.append('page', '1');
    getStaffUrl.searchParams.append('limit', '100');

    const getStaffResponse: any = await httpRequest(getStaffUrl.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'x-branch-id': '', // All branches
        'x-company-id': adminUser.companyId || ''
      }
    });

    const getStaffData: GetStaffResponse = await getStaffResponse.json();

    if (!getStaffData.success || !getStaffData.data) {
      console.error('❌ Get staff failed:', getStaffData.message || 'Unknown error');
      console.error('   Response:', JSON.stringify(getStaffData, null, 2));
      return;
    }

    const staffList = getStaffData.data.users;
    const total = getStaffData.data.pagination.total;

    console.log(`✅ Staff list retrieved!`);
    console.log(`   Total staff: ${total}`);
    console.log(`   Returned: ${staffList.length} staff members\n`);

    // Step 4: Verify Created Staff in List
    console.log('📝 Step 4: Verifying created staff in list...');
    
    const foundStaff = staffList.find(s => s.id === createdStaffId);

    if (!foundStaff) {
      console.error('❌ Created staff NOT found in list!');
      console.error(`   Looking for ID: ${createdStaffId}`);
      console.error(`   Available IDs: ${staffList.map(s => s.id).join(', ')}\n`);
      
      // Debug: Check staff with matching createdBy
      const matchingCreatedBy = staffList.filter(s => s.createdBy === adminUser.id);
      console.log(`   Staff with createdBy = ${adminUser.id}: ${matchingCreatedBy.length}`);
      matchingCreatedBy.forEach(s => {
        console.log(`     - ${s.username} (${s.id}) - Active: ${s.isActive}`);
      });
      
      // Check if staff exists but with different createdBy
      const staffById = staffList.find(s => s.id === createdStaffId);
      if (!staffById) {
        console.error('   Staff not found at all in the list!');
      }
      
      return;
    }

    console.log('✅ Created staff found in list!');
    console.log(`   ID: ${foundStaff.id}`);
    console.log(`   Username: ${foundStaff.username}`);
    console.log(`   Email: ${foundStaff.email}`);
    console.log(`   Created By: ${foundStaff.createdBy}`);
    console.log(`   Is Active: ${foundStaff.isActive}\n`);

    // Final Verification
    console.log('📝 Step 5: Final verification...');
    
    const allChecks = [
      { name: 'Staff ID matches', pass: foundStaff.id === createdStaffId },
      { name: 'CreatedBy matches admin ID', pass: foundStaff.createdBy === adminUser.id },
      { name: 'Staff is in list', pass: true } // Already verified above
    ];

    const allPassed = allChecks.every(check => check.pass);
    
    allChecks.forEach(check => {
      console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`);
    });

    console.log('\n🧪 ========== TEST RESULT ==========');
    if (allPassed) {
      console.log('✅ ALL TESTS PASSED! Staff creation and retrieval working correctly.\n');
    } else {
      console.log('❌ SOME TESTS FAILED! Check the details above.\n');
    }

  } catch (error: any) {
    console.error('\n❌ ========== TEST ERROR ==========');
    if (error.message) {
      console.error('   Error:', error.message);
    }
    if (error.stack) {
      console.error('   Stack:', error.stack);
    }
    console.error('   Make sure the server is running at:', BASE_URL);
    console.error('\n');
  }
}

// Run the test
testStaffFlow().catch(console.error);

