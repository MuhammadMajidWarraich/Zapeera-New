import { useSync } from '@/contexts/SyncProvider';
import { useRuntime } from '@/lib/runtime';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

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
          {/* R6 (2026-10-26): failed ops + open review items, same as the badge. */}
          {status.failedChanges > 0 && (
            <span className="text-red-500">· {status.failedChanges} failed</span>
          )}
          {status.reviewOpen > 0 && (
            <span className="text-amber-500">· {status.reviewOpen} to review</span>
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
  const navigate = useNavigate();

  if (!runtime.isDesktop) return null;

  const isOnline = status.connectionState === 'online';
  const isAuthRequired = status.connectionState === 'auth-required';
  // Setup-pending (2026-10-24 trap): the cloud answers, but no business
  // has downloaded yet — this must NEVER render as green "Online".
  const isSetupPending = status.syncState === 'setup-pending';
  const hasPending = status.pendingChanges > 0;
  // Multi-counter (R6, 2026-10-26): failed ops and open review items
  // were invisible in the header — the badge ignored failedChanges
  // entirely and nothing showed the review list. Failed (red) goes to
  // Settings → Device Status; open review items (amber) go to the
  // Sync Review page. Clicking the badge opens whichever is present
  // (review wins when both are).
  const failed = status.failedChanges || 0;
  const reviewOpen = status.reviewOpen || 0;
  const badgeTarget = reviewOpen > 0 ? '/sync-review' : failed > 0 ? '/settings' : null;

  return (
    <span
      role={badgeTarget ? 'button' : undefined}
      tabIndex={badgeTarget ? 0 : undefined}
      onClick={badgeTarget ? () => navigate(badgeTarget) : undefined}
      onKeyDown={badgeTarget ? (e) => { if (e.key === 'Enter' || e.key === ' ') navigate(badgeTarget); } : undefined}
      title={
        isAuthRequired
          ? 'Your cloud sign-in has expired. Sign out and sign in again to resume syncing.'
          : isSetupPending
            ? status.accountSyncError
              ? `Connected to the cloud, but your businesses have not downloaded yet. Last account sync failed: ${status.accountSyncError}`
              : 'Connected to the cloud, but your businesses have not downloaded yet — sync setup is retrying.'
            : failed > 0
              ? `${failed} sync operation(s) failed — click to open Device Status.`
              : reviewOpen > 0
                ? `${reviewOpen} sale(s) need review (oversold / offline / replay pending) — click to open Sync Review.`
                : undefined
      }
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        failed > 0 ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' : isSetupPending ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300' : isOnline ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300' : isAuthRequired ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
        badgeTarget && 'cursor-pointer hover:opacity-80',
        className,
      )}>
      <span className={cn(
        'w-1.5 h-1.5 rounded-full',
        failed > 0 ? 'bg-red-500' : isSetupPending ? 'bg-amber-500' : isOnline ? 'bg-green-500' : isAuthRequired ? 'bg-red-500' : 'bg-gray-400',
      )} />
      {isSetupPending ? 'Sync setup pending' : isOnline ? 'Online' : isAuthRequired ? 'Sign in again' : 'Offline'}
      {hasPending && <span className="ml-0.5">· {status.pendingChanges}</span>}
      {failed > 0 && <span className="ml-0.5 font-semibold">· {failed} failed</span>}
      {reviewOpen > 0 && <span className="ml-0.5 font-semibold">· {reviewOpen} to review</span>}
    </span>
  );
}
