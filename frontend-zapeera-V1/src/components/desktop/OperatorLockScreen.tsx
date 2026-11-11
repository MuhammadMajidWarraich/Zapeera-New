import { useState } from 'react';
import { Lock, UserRound } from 'lucide-react';
import { useOperator } from '@/contexts/OperatorContext';
import { useAuth } from '@/contexts/AuthContext';

/**
 * v1.0.19 — Operator lock screen (desktop, PIN-enabled businesses only).
 *
 * Shown when the operator is locked out (shift handover, idle
 * auto-lock, or "Switch staff / Lock"). Staff with a PIN can PIN in;
 * staff without a PIN are shown as unavailable (a manager sets PINs
 * from Staff on the web/cloud, they sync down). The signed-in account
 * can always continue as itself — shift change never needs an account
 * logout.
 */
export function OperatorLockScreen() {
  const { staff, locked, pinEnabled, verifyPin, unlockAsAccount, businessId } = useOperator();
  const { user } = useAuth();
  const [selected, setSelected] = useState<string>('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!locked || !pinEnabled) return null;

  const handleVerify = async () => {
    if (!selected) {
      setError('Select your name first');
      return;
    }
    if (!/^\d{4,6}$/.test(pin)) {
      setError('Enter your 4–6 digit PIN');
      return;
    }
    setBusy(true);
    setError('');
    const res = await verifyPin(selected, pin);
    setBusy(false);
    if (!res.success) {
      setError(res.message || 'Incorrect PIN');
      setPin('');
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0f1b33]/95 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold leading-tight">Staff sign-in</h2>
            <p className="text-sm text-muted-foreground">Select your name and enter your PIN to start working.</p>
          </div>
        </div>

        <div className="mt-5 max-h-56 space-y-2 overflow-y-auto">
          {staff.map((s) => (
            <button
              key={s.staffProfileId}
              type="button"
              disabled={!s.hasPin}
              onClick={() => setSelected(s.staffProfileId)}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                selected === s.staffProfileId
                  ? 'border-primary bg-primary/5'
                  : 'border-black/10 hover:bg-black/[0.02]'
              } ${!s.hasPin ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{s.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {s.role || 'Staff'}
                  {!s.hasPin && ' — No PIN set (a manager can set one from Staff)'}
                </span>
              </span>
            </button>
          ))}
          {staff.length === 0 && (
            <p className="text-sm text-muted-foreground">No staff found for this business yet.</p>
          )}
        </div>

        <label className="mt-4 block text-xs font-medium text-muted-foreground">PIN</label>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleVerify();
          }}
          className="mt-1 w-full rounded-lg border px-3 py-2.5 text-center text-xl tracking-[0.5em]"
          placeholder="••••"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <button
          type="button"
          disabled={busy}
          onClick={handleVerify}
          className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? 'Verifying…' : 'Start working'}
        </button>

        <button
          type="button"
          onClick={unlockAsAccount}
          className="mt-2 w-full rounded-lg bg-muted px-4 py-2.5 text-sm font-medium text-muted-foreground"
        >
          Continue as {user?.name || 'the account user'} (account session)
        </button>
        {businessId && <p className="mt-3 text-center text-[11px] text-muted-foreground">Shift change never needs an account logout.</p>}
      </div>
    </div>
  );
}
