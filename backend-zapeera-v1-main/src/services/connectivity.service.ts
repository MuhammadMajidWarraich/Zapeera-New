/**
 * Connectivity Service
 * Monitors network connectivity and PostgreSQL availability
 */

export enum ConnectivityStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  CHECKING = 'checking',
  UNKNOWN = 'unknown'
}

interface ConnectivityCheckOptions {
  timeout?: number;
}

class ConnectivityService {
  private status: ConnectivityStatus = ConnectivityStatus.UNKNOWN;
  private lastCheck: Date | null = null;
  private checkInterval: NodeJS.Timeout | null = null;
  private listeners: Array<(status: ConnectivityStatus) => void> = [];

  // Health check endpoints to try
  private healthCheckUrls: string[] = [
    'https://www.google.com',
    'https://www.cloudflare.com',
    'https://1.1.1.1',
    'http://localhost:5432', // PostgreSQL default port
  ];

  constructor() {
    // Skip automatic checks in test environment to prevent leaks
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
      return;
    }

    // Initial check
    this.checkConnectivity();

    // Periodic checks every 30 seconds
    this.startPeriodicCheck(30000);
  }

  /**
   * Check connectivity using multiple methods
   */
  async checkConnectivity(options: ConnectivityCheckOptions = {}): Promise<ConnectivityStatus> {
    this.setStatus(ConnectivityStatus.CHECKING);

    const timeout = options.timeout || 5000;

    // Check internet connectivity
    const internetCheck = this.checkInternetConnectivity(timeout);

    // Check PostgreSQL connectivity
    const postgresCheck = this.checkPostgreSQLConnection(timeout);

    try {
      const [internetOnline, postgresOnline] = await Promise.all([
        internetCheck,
        postgresCheck
      ]);

      if (internetOnline || postgresOnline) {
        this.setStatus(ConnectivityStatus.ONLINE);
        return ConnectivityStatus.ONLINE;
      } else {
        this.setStatus(ConnectivityStatus.OFFLINE);
        return ConnectivityStatus.OFFLINE;
      }
    } catch (error) {
      this.setStatus(ConnectivityStatus.OFFLINE);
      return ConnectivityStatus.OFFLINE;
    }
  }

  /**
   * Check internet connectivity
   */
  private async checkInternetConnectivity(timeout: number): Promise<boolean> {
    for (const url of this.healthCheckUrls) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
          const response = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (response.ok) {
            return true;
          }
        } catch (err) {
          clearTimeout(timeoutId);
          // Continue to next URL
        }
      } catch (error) {
        // Continue to next URL
      }
    }
    return false;
  }

  /**
   * Check PostgreSQL connection
   */
  private async checkPostgreSQLConnection(timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const postgresUrl = process.env.REMOTE_DATABASE_URL ||
                         process.env.POSTGRESQL_URL ||
                         process.env.DATABASE_URL;

      if (!postgresUrl || !postgresUrl.startsWith('postgresql://')) {
        resolve(false);
        return;
      }

      let timeoutId: NodeJS.Timeout | undefined;
      let client: any = null;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
      };

      try {
        const { Client } = require('pg');
        client = new Client({
          connectionString: postgresUrl,
          connectionTimeoutMillis: timeout
        });

        const connectPromise = client.connect();
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error('Timeout'));
          }, timeout);
          // Allow Node.js to exit even if timeout is pending (for tests)
          if (timeoutId && typeof timeoutId.unref === 'function') {
            timeoutId.unref();
          }
        });

        Promise.race([connectPromise, timeoutPromise])
          .then(() => {
            cleanup(); // Always cleanup
            return client.query('SELECT 1');
          })
          .then(() => {
            if (client) client.end().catch(() => {});
            resolve(true);
          })
          .catch((err) => {
            cleanup(); // Always cleanup
            if (client) client.end().catch(() => {});
            resolve(false);
          });
      } catch (error) {
        cleanup(); // Always cleanup on exception
        if (client) {
          try {
            client.end().catch(() => {});
          } catch (e) {
            // Ignore
          }
        }
        resolve(false);
      }
    });
  }

  /**
   * Set status and notify listeners
   */
  private setStatus(newStatus: ConnectivityStatus): void {
    if (this.status !== newStatus) {
      const oldStatus = this.status;
      this.status = newStatus;
      this.lastCheck = new Date();
      console.log(`[Connectivity] Status changed: ${oldStatus} → ${newStatus}`);

      // Notify listeners
      this.listeners.forEach(listener => {
        try {
          listener(newStatus);
        } catch (error) {
          console.error('[Connectivity] Error in status change listener:', error);
        }
      });
    }
  }

  /**
   * Subscribe to status changes
   */
  onStatusChange(listener: (status: ConnectivityStatus) => void): () => void {
    this.listeners.push(listener);

    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Start periodic connectivity checks
   */
  startPeriodicCheck(intervalMs: number): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(() => {
      this.checkConnectivity();
    }, intervalMs);

    // Allow Node.js to exit even if interval is running (for tests)
    if (this.checkInterval && typeof this.checkInterval.unref === 'function') {
      this.checkInterval.unref();
    }

    console.log(`[Connectivity] Started periodic checks every ${intervalMs}ms`);
  }

  /**
   * Stop periodic checks
   */
  stopPeriodicCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Get current status
   */
  getStatus(): ConnectivityStatus {
    return this.status;
  }

  /**
   * Check if online
   */
  isOnline(): boolean {
    return this.status === ConnectivityStatus.ONLINE;
  }

  /**
   * Check if offline
   */
  isOffline(): boolean {
    return this.status === ConnectivityStatus.OFFLINE;
  }

  /**
   * Get last check time
   */
  getLastCheck(): Date | null {
    return this.lastCheck;
  }
}

// Singleton instance
let connectivityServiceInstance: ConnectivityService | null = null;

export function getConnectivityService(): ConnectivityService {
  if (!connectivityServiceInstance) {
    connectivityServiceInstance = new ConnectivityService();
  }
  return connectivityServiceInstance;
}
