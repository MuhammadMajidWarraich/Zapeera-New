import { useCallback, useEffect, useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { apiService } from '@/services/api';
import { useToast } from '@/hooks/use-toast';

/**
 * v1.0.19 — Staff PIN management (Phase 3).
 *
 * Owner/manager sets or resets a staff member's desktop PIN here. The
 * cloud is the source of truth: the PIN is bcrypt-hashed server-side,
 * only `hasPin` ever comes back (a PIN is never displayed), and the
 * hash reaches the shop computer on its next staff sync. Setting a
 * PIN therefore needs internet; using it at the till does not.
 */

interface StaffPinRow {
  id: string;
  name: string;
  email?: string;
  role?: { name?: string } | null;
  hasPin?: boolean;
}

export function StaffPinManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<StaffPinRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<StaffPinRow | null>(null);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await apiService.getStaff({ page: 1, limit: 200, isActive: true });
      const staff = res?.data?.staff || res?.data || [];
      setRows(Array.isArray(staff) ? staff : []);
    } catch {
      toast({ title: 'Error', description: 'Could not load staff. PIN management needs an internet connection.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (open) {
      setEditing(null);
      setPin('');
      setConfirmPin('');
      setError('');
      load();
    }
  }, [open, load ]);

  if (!open) return null;

  const submitPin = async () => {
    if (!editing) return;
    if (!/^\d{4,6}$/.test(pin)) {
      setError('PIN must be 4 to 6 digits');
      return;
    }
    if (pin !== confirmPin) {
      setError('PINs do not match');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res: any = await apiService.setStaffPin(editing.id, pin);
      if (res?.success) {
        toast({ title: 'PIN saved', description: `${editing.name || 'Staff member'} can now use this PIN at the shop computer (after its next sync).` });
        setEditing(null);
        setPin('');
        setConfirmPin('');
        load();
      } else {
        setError(res?.message || 'Could not save the PIN');
      }
    } catch (e: any) {
      setError(e?.message || 'Could not save the PIN — check your internet connection');
    } finally {
      setBusy(false);
    }
  };

  const removePin = async (row: StaffPinRow) => {
    setBusy(true);
    try {
      const res: any = await apiService.setStaffPin(row.id, null);
      if (res?.success) {
        toast({ title: 'PIN removed', description: `${row.name || 'Staff member'} can no longer PIN in at the till.` });
        load();
      } else {
        toast({ title: 'Error', description: res?.message || 'Could not remove the PIN', variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'Could not remove the PIN', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold leading-tight">Staff PINs</h3>
              <p className="text-sm text-muted-foreground">
                PINs let staff sign in at the shop computer. Set them here (online) — they reach
                the computer on its next sync. A PIN is never shown again.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-black/5" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 space-y-2">
          {loading && <p className="text-sm text-muted-foreground">Loading staff…</p>}
          {!loading && rows.length === 0 && <p className="text-sm text-muted-foreground">No staff found for this business.</p>}
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-3 rounded-xl border border-black/[0.06] px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.name || row.email || 'Staff member'}</p>
                <p className="text-xs text-muted-foreground">
                  {(row.role?.name || 'Staff')} · {row.hasPin ? 'PIN set' : 'No PIN'}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(row);
                  setPin('');
                  setConfirmPin('');
                  setError('');
                }}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                {row.hasPin ? 'Reset PIN' : 'Set PIN'}
              </button>
              {row.hasPin && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removePin(row)}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-60"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        {editing && (
          <div className="mt-5 rounded-xl bg-[#f0f2f7] p-4">
            <p className="text-sm font-medium">
              {editing.hasPin ? 'Reset PIN for' : 'Set PIN for'} {editing.name || 'staff member'}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">New PIN (4–6 digits)</label>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-center text-lg tracking-[0.4em]"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Confirm PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                  className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-center text-lg tracking-[0.4em]"
                />
              </div>
            </div>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="flex-1 rounded-lg bg-white px-4 py-2 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={submitPin}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy ? 'Saving…' : 'Save PIN'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
