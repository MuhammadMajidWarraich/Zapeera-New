/**
 * Test script to verify GET /api/users endpoint and staff creation
 * This script tests:
 * 1. GET /api/users returns staff created by tayyab1@gmail.com
 * 2. POST /api/users creates staff with correct createdBy
 * 
 * Run this with: node test-staff-api.js
 * Make sure the embedded server is running first
 */

const http = require('http');

// Configuration
const SERVER_PORT = 5001;
const BASE_URL = `http://localhost:${SERVER_PORT}`;

// Test user credentials (tayyab1@gmail.com)
const TEST_USER = {
  email: 'tayyab1@gmail.com',
  password: 'Umair@143' // Default password from embedded-server.js
};

// Helper function to make HTTP requests
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
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

// Test 1: Login as tayyab1@gmail.com
async function testLogin() {
  console.log('\n=== Test 1: Login as tayyab1@gmail.com ===');
  try {
    const response = await makeRequest('POST', '/api/auth/login', {
      email: TEST_USER.email,
      password: TEST_USER.password
    });

    if (response.status === 200 && response.data.success) {
      console.log('✅ Login successful');
      console.log('User ID:', response.data.data.user.id);
      console.log('User Role:', response.data.data.user.role);
      console.log('Created By:', response.data.data.user.createdBy);
      return response.data.data.token;
    } else {
      console.error('❌ Login failed:', response.data);
      return null;
    }
  } catch (error) {
    console.error('❌ Login error:', error.message);
    return null;
  }
}

// Test 2: Get all users (should show staff created by logged-in user)
async function testGetUsers(token) {
  console.log('\n=== Test 2: GET /api/users ===');
  try {
    const response = await makeRequest('GET', '/api/users', null, token);

    if (response.status === 200 && response.data.success) {
      const users = response.data.data.users || [];
      console.log(`✅ GET /api/users successful - Found ${users.length} users`);
      
      if (users.length > 0) {
        console.log('\nUsers found:');
        users.forEach((user, index) => {
          console.log(`  ${index + 1}. ${user.name} (${user.email})`);
          console.log(`     - ID: ${user.id}`);
          console.log(`     - Role: ${user.role}`);
          console.log(`     - Created By: ${user.createdBy}`);
          console.log(`     - Branch ID: ${user.branchId || 'N/A'}`);
          console.log(`     - Is Active: ${user.isActive}`);
        });
      } else {
        console.log('⚠️  No users found - this might be expected if no staff has been created yet');
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

// Test 3: Get branches to find lahore branch
async function testGetBranches(token) {
  console.log('\n=== Test 3: GET /api/branches (to find lahore branch) ===');
  try {
    const response = await makeRequest('GET', '/api/branches', null, token);

    if (response.status === 200 && response.data.success) {
      const branches = response.data.data || [];
      console.log(`✅ GET /api/branches successful - Found ${branches.length} branches`);
      
      const lahoreBranch = branches.find(b => 
        b.name && b.name.toLowerCase().includes('lahore')
      );
      
      if (lahoreBranch) {
        console.log(`\n✅ Found lahore branch:`);
        console.log(`   - ID: ${lahoreBranch.id}`);
        console.log(`   - Name: ${lahoreBranch.name}`);
        console.log(`   - Company ID: ${lahoreBranch.companyId || 'N/A'}`);
        return lahoreBranch;
      } else {
        console.log('⚠️  No lahore branch found. Available branches:');
        branches.forEach((branch, index) => {
          console.log(`  ${index + 1}. ${branch.name} (ID: ${branch.id})`);
        });
        return branches[0] || null; // Return first branch if lahore not found
      }
    } else {
      console.error('❌ GET /api/branches failed:', response.data);
      return null;
    }
  } catch (error) {
    console.error('❌ GET /api/branches error:', error.message);
    return null;
  }
}

// Test 4: Create a test staff member
async function testCreateStaff(token, branchId, companyId) {
  console.log('\n=== Test 4: POST /api/users (create staff) ===');
  
  const testStaff = {
    name: 'Test Staff Member',
    email: `teststaff${Date.now()}@test.com`,
    username: `teststaff${Date.now()}`,
    password: 'Test123!',
    role: 'MANAGER',
    branchId: branchId,
    companyId: companyId
  };

  console.log('Creating staff with data:', {
    name: testStaff.name,
    email: testStaff.email,
    role: testStaff.role,
    branchId: testStaff.branchId
  });

  try {
    const response = await makeRequest('POST', '/api/users', testStaff, token);

    if (response.status === 201 && response.data.success) {
      console.log('✅ Staff created successfully!');
      console.log('Created staff:', {
        id: response.data.data.id,
        name: response.data.data.name,
        email: response.data.data.email,
        createdBy: response.data.data.createdBy,
        branchId: response.data.data.branchId,
        isActive: response.data.data.isActive
      });
      return response.data.data;
    } else {
      console.error('❌ Staff creation failed:', response.data);
      return null;
    }
  } catch (error) {
    console.error('❌ Staff creation error:', error.message);
    return null;
  }
}

// Test 5: Verify created staff appears in GET /api/users
async function testVerifyStaff(token, createdStaffId) {
  console.log('\n=== Test 5: Verify created staff appears in GET /api/users ===');
  
  // Wait a bit for sync
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const users = await testGetUsers(token);
  const foundStaff = users.find(u => u.id === createdStaffId);
  
  if (foundStaff) {
    console.log('✅ Created staff found in GET /api/users response!');
    console.log('Staff details:', {
      id: foundStaff.id,
      name: foundStaff.name,
      email: foundStaff.email,
      createdBy: foundStaff.createdBy,
      branchId: foundStaff.branchId
    });
    return true;
  } else {
    console.error('❌ Created staff NOT found in GET /api/users response!');
    console.error('This indicates a problem with the GET endpoint query logic.');
    return false;
  }
}

// Main test function
async function runTests() {
  console.log('🚀 Starting Staff API Tests...');
  console.log('Make sure the embedded server is running on port', SERVER_PORT);

  try {
    // Test 1: Login
    const token = await testLogin();
    if (!token) {
      console.error('\n❌ Cannot continue without authentication token');
      return;
    }

    // Test 2: Get users (before creating)
    const usersBefore = await testGetUsers(token);
    console.log(`\n📊 Users before creating staff: ${usersBefore.length}`);

    // Test 3: Get branches
    const branch = await testGetBranches(token);
    if (!branch) {
      console.error('\n❌ Cannot continue without a branch');
      return;
    }

    // Test 4: Create staff
    const createdStaff = await testCreateStaff(token, branch.id, branch.companyId);
    if (!createdStaff) {
      console.error('\n❌ Cannot continue without creating staff');
      return;
    }

    // Test 5: Verify staff appears
    const verified = await testVerifyStaff(token, createdStaff.id);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📋 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Login: Success`);
    console.log(`✅ GET /api/users (before): ${usersBefore.length} users`);
    console.log(`✅ Branch found: ${branch.name} (${branch.id})`);
    console.log(`✅ Staff created: ${createdStaff.name} (${createdStaff.id})`);
    console.log(`✅ Staff visible in GET: ${verified ? 'YES' : 'NO'}`);
    
    if (verified) {
      console.log('\n🎉 All tests passed! GET /api/users is working correctly.');
    } else {
      console.log('\n❌ Test failed! Created staff is not visible in GET /api/users.');
      console.log('This indicates the GET endpoint query logic needs to be fixed.');
    }
  } catch (error) {
    console.error('\n❌ Test suite error:', error);
  }
}

// Run tests
runTests();


