import { useSync } from '@/contexts/SyncProvider';
import { useRuntime } from '@/lib/runtime';
import { cn } from '@/lib/utils';

interface SyncStatusIndicatorProps {
  detailed?: boolean;
  className?: string;
}

const cloudLabel: Record<string, string> = {
  checking: 'Checking connection...',
  online: 'Connected to Cloud',
  offline: 'No Internet',
  'auth-required': 'Re-authentication needed',
};

const syncLabel: Record<string, string> = {
  idle: '',
  syncing: 'Syncing...',
  synced: 'Synced',
  pending: 'Changes pending',
  offline: 'Working offline',
  failed: 'Sync failed',
  conflict: 'Sync conflict',
};

const syncColor: Record<string, string> = {
  idle: 'text-muted-foreground',
  syncing: 'text-blue-500',
  synced: 'text-green-500',
  pending: 'text-amber-500',
  offline: 'text-muted-foreground',
  failed: 'text-red-500',
  conflict: 'text-red-500',
};

export function SyncStatusIndicator({ detailed, className }: SyncStatusIndicatorProps) {
  const { status } = useSync();
  const runtime = useRuntime();

  if (!runtime.isDesktop) return null;

  const cloudText = cloudLabel[status.connectionState] || status.connectionState;
  const syncText = syncLabel[status.syncState] || status.syncState;

  return (
    <div className={cn('flex items-center gap-2 text-xs', className)}>
      <span className="flex items-center gap-1">
        <span className={cn(
          'inline-block w-1.5 h-1.5 rounded-full',
          status.connectionState === 'online' && 'bg-green-500',
          status.connectionState === 'offline' && 'bg-gray-400',
          status.connectionState === 'checking' && 'bg-amber-400 animate-pulse',
          status.connectionState === 'auth-required' && 'bg-red-500',
        )} />
        <span className={cn(
          status.connectionState === 'offline' ? 'text-gray-400' : 'text-muted-foreground'
        )}>{cloudText}</span>
      </span>

      {detailed && (
        <>
          <span className="text-muted-foreground">·</span>
          <span className={syncColor[status.syncState] || 'text-muted-foreground'}>
            {status.syncState === 'syncing' && (
              <span className="inline-block mr-1 h-2 w-2 rounded-full border border-current border-t-transparent animate-spin" />
            )}
            {syncText}
            {status.pendingChanges > 0 && status.syncState !== 'syncing' && (
              <span className="ml-1">({status.pendingChanges})</span>
            )}
          </span>
          {status.lastSyncAt && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                {formatRelativeTime(status.lastSyncAt)}
              </span>
            </>
          )}
        </>
      )}
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  } catch {
    return '';
  }
}

interface SyncStatusBadgeProps {
  className?: string;
}

export function SyncStatusBadge({ className }: SyncStatusBadgeProps) {
  const { status } = useSync();
  const runtime = useRuntime();

  if (!runtime.isDesktop) return null;

  const isOnline = status.connectionState === 'online';
  const hasPending = status.pendingChanges > 0;

  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
      isOnline ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
      className,
    )}>
      <span className={cn(
        'w-1.5 h-1.5 rounded-full',
        isOnline ? 'bg-green-500' : 'bg-gray-400',
      )} />
      {isOnline ? 'Online' : 'Offline'}
      {hasPending && <span className="ml-0.5">· {status.pendingChanges}</span>}
    </span>
  );
}
