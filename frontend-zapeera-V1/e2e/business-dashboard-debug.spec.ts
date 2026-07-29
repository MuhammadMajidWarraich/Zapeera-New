import { test, expect } from '@playwright/test';

/**
 * Business Dashboard Debug Tests
 * 
 * These tests are designed to identify and diagnose the "Business not found" issue
 * when accessing the business dashboard.
 */

test.describe('Business Dashboard - Debug "Business Not Found" Issue', () => {
  
  test.beforeEach(async ({ page }) => {
    // Enable console logging for debugging
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`❌ Console Error: ${msg.text()}`);
      } else if (msg.type() === 'warning') {
        console.log(`⚠️ Console Warning: ${msg.text()}`);
      }
    });

    // Log all network requests and responses for debugging
    page.on('request', request => {
      if (request.url().includes('/api/')) {
        console.log(`🌐 Request: ${request.method()} ${request.url()}`);
      }
    });

    page.on('response', response => {
      if (response.url().includes('/api/')) {
        console.log(`🌐 Response: ${response.status()} ${response.url()}`);
        if (response.status() >= 400) {
          response.text().then(body => {
            console.log(`❌ Error Body: ${body.substring(0, 500)}`);
          });
        }
      }
    });

    // Login first
    await page.goto('/login');
    console.log('🔑 Attempting login...');
    
    await page.fill('input[name="username"]', 'testowner');
    await page.fill('input[name="password"]', 'testpass123');
    await page.click('button[type="submit"]');
    
    // Wait for navigation
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('✅ Login successful, reached dashboard');
  });

  test('debug business dashboard access', async ({ page }) => {
    console.log('\n🔍 === DEBUG: Business Dashboard Access ===\n');
    
    // 1. Check if user data is loaded correctly
    console.log('1️⃣ Checking user data...');
    const localStorageData = await page.evaluate(() => {
      return {
        token: localStorage.getItem('token'),
        user: localStorage.getItem('user'),
        membership: localStorage.getItem('membership'),
        memberships: localStorage.getItem('memberships')
      };
    });
    
    console.log('LocalStorage Data:', JSON.stringify(localStorageData, null, 2));
    
    // 2. Check API responses for dashboard data
    console.log('\n2️⃣ Checking dashboard API calls...');
    
    // Navigate to dashboard
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // 3. Check for "Business not found" error messages
    console.log('\n3️⃣ Checking for error messages...');
    const errorElements = await page.locator('text=/business not found|not found|404/i').all();
    console.log(`Found ${errorElements.length} potential error elements`);
    
    for (const el of errorElements) {
      const text = await el.textContent();
      console.log(`  ❌ Error found: ${text}`);
    }
    
    // 4. Check current URL
    console.log('\n4️⃣ Current URL:', page.url());
    
    // 5. Screenshot for debugging
    await page.screenshot({ 
      path: `debug-dashboard-${Date.now()}.png`, 
      fullPage: true 
    });
    console.log('📸 Screenshot saved');
    
    console.log('\n✅ Debug test completed');
  });

  test('debug business context in API headers', async ({ page }) => {
    console.log('\n🔍 === DEBUG: Business Context Headers ===\n');
    
    // Intercept API requests to check headers
    const apiCalls: any[] = [];
    
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const headers = await request.allHeaders();
      
      apiCalls.push({
        url: request.url(),
        method: request.method(),
        headers: {
          'authorization': headers['authorization'] ? 'Present' : 'Missing',
          'x-company-id': headers['x-company-id'] || 'Missing',
          'x-branch-id': headers['x-branch-id'] || 'Missing'
        }
      });
      
      await route.continue();
    });
    
    // Navigate to dashboard
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    // Log all API calls
    console.log('API Calls Made:');
    apiCalls.forEach((call, index) => {
      console.log(`\n${index + 1}. ${call.method} ${call.url}`);
      console.log(`   Headers:`, JSON.stringify(call.headers, null, 2));
    });
    
    // Check for missing headers
    const missingCompanyId = apiCalls.filter(c => c.headers['x-company-id'] === 'Missing');
    if (missingCompanyId.length > 0) {
      console.log('\n⚠️ WARNING: Some API calls missing X-Company-ID header!');
      missingCompanyId.forEach(c => console.log(`   - ${c.url}`));
    }
  });

  test('debug business slug routing', async ({ page, context }) => {
    console.log('\n🔍 === DEBUG: Business Slug Routing ===\n');
    
    // Test direct access to business dashboard via slug
    const testSlugs = [
      '/business/gohar-pharma/dashboard',
      '/business/test-pharmacy/dashboard',
      '/dashboard'
    ];
    
    for (const slug of testSlugs) {
      console.log(`\n🔄 Testing route: ${slug}`);
      
      // Clear any error state
      await context.clearCookies();
      
      // Re-login for fresh session
      await page.goto('/login');
      await page.fill('input[name="username"]', 'testowner');
      await page.fill('input[name="password"]', 'testpass123');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/dashboard', { timeout: 10000 });
      
      // Now try the slug route
      await page.goto(slug);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      
      const url = page.url();
      const title = await page.title();
      
      console.log(`   Final URL: ${url}`);
      console.log(`   Page Title: ${title}`);
      
      // Check for errors
      const errorText = await page.locator('body').textContent();
      if (errorText?.toLowerCase().includes('not found') || 
          errorText?.toLowerCase().includes('404')) {
        console.log(`   ❌ "Not Found" detected on ${slug}`);
      } else {
        console.log(`   ✅ Route accessible`);
      }
      
      // Screenshot
      await page.screenshot({ 
        path: `debug-slug-${slug.replace(/\//g, '-')}-${Date.now()}.png`,
        fullPage: true 
      });
    }
  });

  test('debug modules loading on dashboard', async ({ page }) => {
    console.log('\n🔍 === DEBUG: Modules Loading ===\n');
    
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    // Check if sidebar modules are loaded
    const sidebarModules = await page.locator('[data-testid="sidebar-module"], .sidebar-module, [role="navigation"] a').all();
    console.log(`\n📊 Found ${sidebarModules.length} sidebar items`);
    
    for (const module of sidebarModules.slice(0, 10)) {
      const text = await module.textContent();
      const href = await module.getAttribute('href');
      console.log(`   - ${text?.trim()} (${href || 'no href'})`);
    }
    
    // Check for module loading errors
    const moduleError = await page.locator('text=/failed to load|error loading|could not load modules/i').first();
    if (await moduleError.isVisible().catch(() => false)) {
      const errorText = await moduleError.textContent();
      console.log(`\n❌ Module Loading Error: ${errorText}`);
    } else {
      console.log('\n✅ No module loading errors detected');
    }
  });

});
