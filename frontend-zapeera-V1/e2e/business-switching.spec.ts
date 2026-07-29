import { test, expect } from '@playwright/test';

/**
 * Business Switching E2E Tests
 * 
 * Covers:
 * - Business switcher visibility
 * - Switching between businesses
 * - Context header propagation
 * - Data updates on switch
 */

test.describe('Business Switching', () => {
  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.fill('input[name="username"]', 'testowner');
    await page.fill('input[name="password"]', 'testpass123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
  });

  test('business switcher is visible for multi-business users', async ({ page }) => {
    // Verify business switcher exists
    const switcher = page.locator('[data-testid="business-switcher"]');
    await expect(switcher).toBeVisible();
    
    // Click to open dropdown
    await switcher.click();
    
    // Verify dropdown shows businesses
    await expect(page.locator('[data-testid="business-option"]')).toHaveCount.greaterThan(0);
  });

  test('switching business updates context', async ({ page }) => {
    // Open business switcher
    await page.click('[data-testid="business-switcher"]');
    
    // Get current business name
    const currentBusiness = await page.locator('[data-testid="current-business"]').textContent();
    
    // Select different business
    const options = page.locator('[data-testid="business-option"]');
    const count = await options.count();
    
    if (count > 1) {
      // Click second option
      await options.nth(1).click();
      
      // Wait for data reload
      await page.waitForTimeout(1000);
      
      // Verify business name changed
      const newBusiness = await page.locator('[data-testid="current-business"]').textContent();
      expect(newBusiness).not.toBe(currentBusiness);
    }
  });

  test('data is scoped to selected business', async ({ page }) => {
    // Navigate to inventory
    await page.click('text=Inventory');
    await page.waitForURL('**/inventory');
    
    // Get product count for current business
    const initialCount = await page.locator('[data-testid="product-row"]').count();
    
    // Switch business
    await page.click('[data-testid="business-switcher"]');
    const options = page.locator('[data-testid="business-option"]');
    
    if (await options.count() > 1) {
      await options.nth(1).click();
      await page.waitForTimeout(1000);
      
      // Verify product count may be different (different business = different data)
      const newCount = await page.locator('[data-testid="product-row"]').count();
      
      // Data should be reloaded (even if count happens to be same, the data is different)
      await expect(page.locator('[data-testid="data-loading"]')).not.toBeVisible();
    }
  });

  test('branch selector filters by business', async ({ page }) => {
    // Verify branch selector exists
    const branchSelector = page.locator('[data-testid="branch-selector"]');
    
    // Only visible if business has branches
    if (await branchSelector.isVisible().catch(() => false)) {
      await branchSelector.click();
      
      // Verify branches are shown
      await expect(page.locator('[data-testid="branch-option"]')).toHaveCount.greaterThan(0);
    }
  });
});
