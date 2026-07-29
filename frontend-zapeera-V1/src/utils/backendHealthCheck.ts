/**
 * Backend Health Check Utility
 * Checks if the backend API is available before the app tries to connect
 */

const BACKEND_CHECK_TIMEOUT = 60000; // 60 seconds
const BACKEND_CHECK_INTERVAL = 2000; // Check every 2 seconds

// Helper function to detect Windows platform
function isWindowsPlatform(): boolean {
  if (typeof window === 'undefined') return false;
  return window.navigator?.platform?.includes('Win') ||
         window.electronAPI?.platform === 'win32' ||
         window.electronAPI?.getPlatform?.() === 'win32';
}

// Helper function to detect if running in production (packaged app)
function isProductionMode(): boolean {
  if (typeof window === 'undefined') return false;
  return window.electronAPI?.isPackaged === true ||
         !window.electronAPI;
}

// Maximum retries - reduced since server starts immediately with SQLite
function getMaxRetries(): number {
  const isWin = isWindowsPlatform();
  const isProd = isProductionMode();

  if (isProd && isWin) {
    return 15; // Windows EXE: 15 retries = 30 seconds total (reduced - server starts immediately)
  } else if (isProd) {
    return 10; // Production (non-Windows): 10 retries = 20 seconds
  } else {
    return 5; // Dev: 5 retries = 10 seconds
  }
}

const MAX_RETRIES = getMaxRetries();

// For Electron, wait a bit longer initially as backend might be starting
// Windows EXE in production needs significantly more time due to slower startup
// REDUCED wait times since server starts immediately with SQLite (no PostgreSQL dependency)
function getInitialWaitTime(): number {
  const isWin = isWindowsPlatform();
  const isProd = isProductionMode();

  if (isProd && isWin) {
    return 3000; // Windows EXE: 3 seconds (reduced - server starts immediately now)
  } else if (isProd) {
    return 2000; // Production (non-Windows): 2 seconds
  } else if (isWin) {
    return 1000;  // Dev Windows: 1 second
  } else {
    return 500;  // Dev others: 0.5 seconds
  }
}

const INITIAL_WAIT_MS = getInitialWaitTime();

/**
 * Check if backend is healthy
 */
export async function checkBackendHealth(baseUrl: string): Promise<boolean> {
  try {
    // Extract base URL without /api
    let healthUrl = String(baseUrl).replace('/api', '');
    // Remove trailing slash if present
    healthUrl = healthUrl.replace(/\/$/, '');
    // Add /health endpoint
    healthUrl = `${healthUrl}/health`;

    const controller = new AbortController();
    // Reduced timeout since server starts immediately now
    const healthCheckTimeout = isWindowsPlatform() ? 3000 : 2000; // Windows: 3 seconds, others: 2 seconds
    const timeoutId = setTimeout(() => controller.abort(), healthCheckTimeout);

    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
        cache: 'no-cache',
        mode: 'cors',
        credentials: 'include',
      });

      clearTimeout(timeoutId);

      // ANY response (even 500) means server is running - that's good enough
      if (response.status >= 200 && response.status < 600) {
        const data = await response.json().catch(() => ({}));
        console.log(`[Backend Health] ✓ Backend is responding at ${healthUrl} (status: ${response.status})`, data);
        // Server is responding - that's all we need
        return true;
      }

      console.warn(`[Backend Health] Backend returned unexpected status ${response.status} at ${healthUrl}`);
      return false;
    } catch (fetchError: any) {
      clearTimeout(timeoutId);

      // Network errors are expected when backend is starting
      if (fetchError.name === 'AbortError') {
        // Timeout - backend might not be ready yet
        console.log(`[Backend Health] Health check timed out for ${healthUrl} (backend may still be starting)`);
        return false;
      }
      if (fetchError.name === 'TypeError' || fetchError.message?.includes('Failed to fetch') || fetchError.message?.includes('NetworkError') || fetchError.message?.includes('ECONNREFUSED')) {
        // Network error - backend might not be ready yet
        console.log(`[Backend Health] Network error for ${healthUrl} (backend may not be running yet):`, fetchError.message);
        return false;
      }
      // Log other errors for debugging
      console.warn(`[Backend Health] Unexpected error:`, fetchError.message);
      return false;
    }
  } catch (error: any) {
    // Ignore abort errors (timeouts) - they're expected
    if (error.name !== 'AbortError' && error.name !== 'TypeError') {
      console.warn('[Backend Health] Health check failed:', error.message);
    }
    return false;
  }
}

/**
 * Wait for backend to be ready
 * @param baseUrl - Base API URL
 * @param onProgress - Optional callback for progress updates
 * @returns Promise that resolves when backend is ready, or rejects after max retries
 */
export async function waitForBackend(
  baseUrl: string,
  onProgress?: (attempt: number, maxRetries: number) => void
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const isElectron = typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined';

    const checkHealth = async () => {
      attempts++;

      if (onProgress) {
        onProgress(attempts, getMaxRetries());
      }

      const isHealthy = await checkBackendHealth(baseUrl);

      if (isHealthy) {
        console.log(`[Backend Health] ✅ Backend is ready after ${attempts} attempts`);
        resolve(true);
        return;
      }

      const maxRetries = getMaxRetries();
      if (attempts >= maxRetries) {
        const totalTime = (attempts * BACKEND_CHECK_INTERVAL + (isElectron ? getInitialWaitTime() : 0)) / 1000;
        const healthUrl = String(baseUrl).replace('/api', '/health');
        console.error(`[Backend Health] ❌ Backend not ready after ${attempts} attempts (${totalTime} seconds)`);
        console.error(`[Backend Health] Checked URL: ${healthUrl}`);
        console.error(`[Backend Health] 💡 Troubleshooting:`);
        console.error(`[Backend Health]    1. Check if backend is running: curl ${healthUrl}`);
        if (!isProductionMode()) {
          console.error(`[Backend Health]    2. In dev mode, run the backend: cd backend-zapeera-v1-main && npm run dev`);
          console.error(`[Backend Health]    3. Or set VITE_API_BASE_URL to the correct backend URL and restart the frontend`);
        }
        console.error(`[Backend Health]    4. Check logs: ~/.zapeera/logs/backend-*.log`);
        console.error(`[Backend Health]    5. Check Electron console for backend startup messages`);
        reject(new Error(`Backend not available after ${totalTime} seconds. Please check whether the backend server is running and accessible at ${healthUrl}.`));
        return;
      }

      // Continue checking
      setTimeout(checkHealth, BACKEND_CHECK_INTERVAL);
    };

    // In Electron, server starts immediately, so check right away
    if (isElectron && attempts === 0) {
      const waitTime = getInitialWaitTime();
      const isWin = isWindowsPlatform();
      const isProd = isProductionMode();
      const platformInfo = isProd
        ? (isWin ? 'Windows EXE (Production)' : 'Production')
        : (isWin ? 'Windows (Dev)' : 'Dev');
      console.log(`[Backend Health] ⏳ Waiting ${waitTime}ms for backend to start (${platformInfo})...`);
      // Start checking immediately - server should be ready quickly
      setTimeout(checkHealth, waitTime);
    } else {
      // Start checking immediately
      checkHealth();
    }
  });
}
