import { getDatabaseService } from './database.service';
import { getSyncService } from './sync.service';

interface ScheduledInterval {
  name: string;
  intervalMs: number;
  description: string;
  ref: NodeJS.Timeout | null;
}

export class SyncScheduler {
  private intervals: ScheduledInterval[] = [];
  private dbService: ReturnType<typeof getDatabaseService>;
  private syncService: ReturnType<typeof getSyncService>;
  private started = false;

  constructor(dbService: ReturnType<typeof getDatabaseService>, syncService: ReturnType<typeof getSyncService>) {
    this.dbService = dbService;
    this.syncService = syncService;

    this.intervals = [
      { name: 'userSync', intervalMs: 30_000, description: 'PostgreSQL user sync', ref: null },
      { name: 'statusCheck', intervalMs: 30_000, description: 'Online/offline status transitions', ref: null },
      { name: 'backupSync', intervalMs: 300_000, description: 'Bidirectional sync backup', ref: null },
      { name: 'safetyNet', intervalMs: 600_000, description: 'Safety net full sync', ref: null },
    ];
  }

  async start(): Promise<void> {
    if (this.started) {
      console.log('[SyncScheduler] Already running, skipping start');
      return;
    }

    console.log('[SyncScheduler] Starting all scheduled syncs...');
    this.started = true;

    for (const interval of this.intervals) {
      interval.ref = this.createInterval(interval);
      console.log(`[SyncScheduler] + ${interval.name} (${interval.description}) every ${interval.intervalMs / 1000}s`);
    }

    console.log('[SyncScheduler] All intervals started');
  }

  stop(): void {
    if (!this.started) {
      console.log('[SyncScheduler] Not running, nothing to stop');
      return;
    }

    console.log('[SyncScheduler] Stopping all scheduled syncs...');
    this.started = false;

    for (const interval of this.intervals) {
      if (interval.ref) {
        clearInterval(interval.ref);
        interval.ref = null;
        console.log(`[SyncScheduler] - ${interval.name} stopped`);
      }
    }

    console.log('[SyncScheduler] All intervals stopped');
  }

  getStatus(): { running: boolean; intervals: Array<{ name: string; description: string; intervalMs: number; scheduled: boolean }> } {
    return {
      running: this.started,
      intervals: this.intervals.map((i) => ({
        name: i.name,
        description: i.description,
        intervalMs: i.intervalMs,
        scheduled: i.ref !== null,
      })),
    };
  }

  private createInterval(interval: ScheduledInterval): NodeJS.Timeout {
    return setInterval(async () => {
      try {
        await this.runSync(interval.name);
      } catch (err) {
        console.error(`[SyncScheduler] Error in ${interval.name}:`, err);
      }
    }, interval.intervalMs);
  }

  private previousStatus: string = '';
  private previousType: string = '';

  private async runSync(name: string): Promise<void> {
    try {
      switch (name) {
        case 'userSync':
          if (this.dbService.getConnectionStatus() === 'online') {
            await this.syncService.syncUsersFromPostgreSQL();
          }
          break;
        case 'statusCheck': {
          const currentStatus = String(this.dbService.getConnectionStatus());
          const currentType = this.dbService.getCurrentType();
          if (this.previousStatus === 'offline' && currentStatus === 'online') {
            console.log('[SyncScheduler] Connection restored — running full bidirectional sync');
            await this.syncService.bidirectionalSync();
          }
          if (this.previousStatus === 'online' && currentStatus === 'offline') {
            console.log('[SyncScheduler] Going offline — syncing PostgreSQL → SQLite');
            await this.syncService.syncToSQLite();
          }
          this.previousStatus = currentStatus;
          this.previousType = currentType;
          break;
        }
        case 'backupSync':
          if (this.dbService.getConnectionStatus() === 'online') {
            await this.syncService.bidirectionalSync();
          }
          break;
        case 'safetyNet': {
          const status = this.dbService.getConnectionStatus();
          const dbType = this.dbService.getCurrentType();
          if (status === 'online' && dbType === 'postgresql') {
            const lastSync = this.syncService.getStatus().lastSync;
            const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
            if (!lastSync || new Date(lastSync) < tenMinAgo) {
              await this.syncService.syncToPostgreSQL();
              await this.syncService.syncToSQLite();
            }
          }
          break;
        }
      }
    } catch (err) {
      console.error(`[SyncScheduler] Error in ${name}:`, err);
    }
  }
}
