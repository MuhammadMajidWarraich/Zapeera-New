import { test, expect } from '@playwright/test';

/**
 * Authentication E2E Tests
 * 
 * Covers:
 * - Login with valid credentials
 * - Login with invalid credentials
 * - Logout functionality
 * - Session persistence
 */

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('login with valid credentials', async ({ page }) => {
    // Fill in login form
    await page.fill('input[name="username"]', 'testowner');
    await page.fill('input[name="password"]', 'testpass123');
    
    // Submit form
    await page.click('button[type="submit"]');
    
    // Wait for navigation to dashboard
    await page.waitForURL('**/dashboard');
    
    // Verify dashboard is loaded
    await expect(page.locator('text=Dashboard')).toBeVisible();
    
    // Verify business switcher is present
    await expect(page.locator('[data-testid="business-switcher"]')).toBeVisible();
  });

  test('login with invalid credentials shows error', async ({ page }) => {
    // Fill in invalid credentials
    await page.fill('input[name="username"]', 'invaliduser');
    await page.fill('input[name="password"]', 'wrongpassword');
    
    // Submit form
    await page.click('button[type="submit"]');
    
    // Verify error message
    await expect(page.locator('text=Invalid username or password')).toBeVisible();
    
    // Verify still on login page
    await expect(page).toHaveURL(/.*login/);
  });

  test('logout redirects to login', async ({ page }) => {
    // Login first
    await page.fill('input[name="username"]', 'testowner');
    await page.fill('input[name="password"]', 'testpass123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
    
    // Click logout
    await page.click('[data-testid="user-menu"]');
    await page.click('text=Logout');
    
    // Verify redirect to login
    await page.waitForURL('**/login');
    
    // Verify login form is visible
    await expect(page.locator('input[name="username"]')).toBeVisible();
  });

  test('session persists after page reload', async ({ page }) => {
    // Login
    await page.fill('input[name="username"]', 'testowner');
    await page.fill('input[name="password"]', 'testpass123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
    
    // Reload page
    await page.reload();
    
    // Verify still logged in (dashboard visible)
    await expect(page.locator('text=Dashboard')).toBeVisible();
  });

  test('protected routes redirect to login when not authenticated', async ({ page }) => {
    // Try to access dashboard directly
    await page.goto('/dashboard');
    
    // Should redirect to login
    await page.waitForURL('**/login');
  });
});
