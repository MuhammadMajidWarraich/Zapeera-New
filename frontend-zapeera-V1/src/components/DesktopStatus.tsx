import { useState, useEffect } from 'react';
import { useSync } from '@/contexts/SyncProvider';
import { useRuntime } from '@/lib/runtime';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RefreshCw, Wifi, WifiOff, Clock, Database, HardDrive, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StorageInfo {
  appVersion?: string;
  storagePath?: string;
  storageUsed?: string;
  dbSize?: string;
}

export function DesktopStatusPanel() {
  const runtime = useRuntime();
  const { status, triggerSync } = useSync();
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (runtime.isDesktop) {
      const ei = (window as any).electronAPI;
      if (ei?.getStorageInfo) {
        ei.getStorageInfo().then(setStorage).catch(() => {});
      }
    }
  }, [runtime.isDesktop]);

  if (!runtime.isDesktop) return null;

  const handleSync = async () => {
    setSyncing(true);
    await triggerSync();
    setTimeout(() => setSyncing(false), 1000);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Desktop Status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground flex items-center gap-2">
            {runtime.cloudState === 'online' ? <Wifi className="h-3.5 w-3.5 text-green-500" /> : <WifiOff className="h-3.5 w-3.5 text-gray-400" />}
            Cloud
          </span>
          <span className={cn(
            'font-medium',
            runtime.cloudState === 'online' && 'text-green-600',
            runtime.cloudState === 'offline' && 'text-gray-400',
            runtime.cloudState === 'checking' && 'text-amber-500',
            runtime.cloudState === 'auth-required' && 'text-red-500',
          )}>
            {runtime.cloudState === 'online' && 'Connected'}
            {runtime.cloudState === 'offline' && 'Offline'}
            {runtime.cloudState === 'checking' && 'Checking...'}
            {runtime.cloudState === 'auth-required' && 'Auth Required'}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-muted-foreground flex items-center gap-2">
            <RefreshCw className={cn('h-3.5 w-3.5', status.syncState === 'syncing' && 'animate-spin text-blue-500')} />
            Sync
          </span>
          <span className={cn(
            'font-medium',
            status.syncState === 'synced' && 'text-green-600',
            status.syncState === 'syncing' && 'text-blue-500',
            status.syncState === 'pending' && 'text-amber-500',
            status.syncState === 'failed' && 'text-red-500',
            status.syncState === 'offline' && 'text-gray-400',
          )}>
            {status.syncState === 'synced' && 'Synced'}
            {status.syncState === 'syncing' && 'Syncing...'}
            {status.syncState === 'pending' && `${status.pendingChanges} pending`}
            {status.syncState === 'failed' && 'Failed'}
            {status.syncState === 'offline' && 'Offline'}
            {status.syncState === 'idle' && 'Idle'}
          </span>
        </div>

        {status.lastSyncAt && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" />
              Last sync
            </span>
            <span className="font-medium">{formatDate(status.lastSyncAt)}</span>
          </div>
        )}

        {storage && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-2">
                <Database className="h-3.5 w-3.5" />
                Database
              </span>
              <span className="font-medium">{storage.dbSize || '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-2">
                <HardDrive className="h-3.5 w-3.5" />
                Storage
              </span>
              <span className="font-medium">{storage.storageUsed || '—'}</span>
            </div>
          </>
        )}

        {runtime.desktopBusinessStates.length > 0 && (
          <div className="pt-1">
            <div className="text-xs text-muted-foreground mb-1">Local Businesses</div>
            {runtime.desktopBusinessStates.map(b => (
              <div key={b.businessId} className="flex items-center justify-between gap-2 text-xs py-0.5">
                <span className="truncate max-w-[180px]">{b.name || b.businessId}</span>
                <span className={b.availableOffline ? 'text-green-500' : 'text-gray-400'}>
                  {b.availableOffline ? 'Available offline' : 'Cloud only'}
                </span>
              </div>
            ))}
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="w-full mt-2"
          onClick={handleSync}
          disabled={syncing || status.syncState === 'syncing'}
        >
          <RefreshCw className={cn('h-3.5 w-3.5 mr-2', syncing && 'animate-spin')} />
          {syncing ? 'Syncing...' : 'Sync Now'}
        </Button>
      </CardContent>
    </Card>
  );
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return d.toLocaleDateString();
  } catch {
    return dateStr;
  }
}
