import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { useAdmin } from './useAdmin';
import { useRuntime } from '@/lib/runtime';
import { getLocalApi } from '@/services/api-clients';

/**
 * v1.0.19 — Staff-PIN OPERATOR layer (desktop only).
 *
 * The OPERATOR is the person physically at the till, distinct from the
 * device account session. The embedded backend verifies a staff PIN
 * against the synced hash and binds the operator locally; subsequent
 * embedded calls carry x-operator-token, and the backend stamps sales,
 * shifts and refunds from the OPERATOR.
 *
 * Rules implemented here (see the implementation record):
 * - Default operator = the signed-in account itself (no binding).
 * - The lock screen engages ONLY when at least one staff profile in
 *   the business has a PIN (pinEnabled). PIN-less businesses behave
 *   exactly as before — no forced lock, ever.
 * - "End shift" (counted close of the operator's own shift) → operator
 *   cleared → lock screen. Switching with an open shift is done from
 *   the lock screen after a counted close, or via manager-PIN override
 *   (requestManagerOverride) which leaves the shift open.
 * - Auto-lock after 15 minutes idle (operator cleared; an open shift
 *   stays open under its owner).
 * - Shift change NEVER requires account logout.
 */

export interface OperatorStaffEntry {
  staffProfileId: string;
  userId: string;
  name: string;
  role: string | null;
  hasPin: boolean;
}

export interface BoundOperator {
  staffProfileId: string;
  userId: string;
  name: string;
  role: string | null;
  businessId: string;
}

interface OperatorContextType {
  isDesktop: boolean;
  businessId: string | null;
  staff: OperatorStaffEntry[];
  pinEnabled: boolean;
  /** The PIN-bound operator, or null when operating as the account. */
  operator: BoundOperator | null;
  /** Display identity: the bound operator, else the account user. */
  effectiveName: string;
  effectiveRole: string | null;
  isBoundOperator: boolean;
  locked: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  verifyPin: (staffProfileId: string, pin: string) => Promise<{ success: boolean; message?: string }>;
  lock: () => Promise<void>;
  unlockAsAccount: () => Promise<void>;
  /** Call after the operator's OWN shift completes its counted close. */
  handleOwnShiftClosed: () => Promise<void>;
  /**
   * In-place manager/owner PIN authorisation for one privileged action
   * (refund/void by a cashier operator). Resolves to a one-action
   * override token, or null when cancelled.
   */
  requestManagerOverride: () => Promise<string | null>;
}

const OperatorContext = createContext<OperatorContextType | undefined>(undefined);

export const useOperator = () => {
  const ctx = useContext(OperatorContext);
  if (!ctx) throw new Error('useOperator must be used within an OperatorProvider');
  return ctx;
};

const OPERATOR_TOKEN_KEY = 'operatorToken';
const OPERATOR_STORAGE_KEY = 'zapeera_operator';
const IDLE_LOCK_MS = 15 * 60 * 1000;

const PRIVILEGED = ['OWNER', 'MANAGER', 'ADMIN'];

export const OperatorProvider = ({ children }: { children: ReactNode }) => {
  const runtime = useRuntime();
  const { user, isAuthenticated } = useAuth();
  const { selectedCompanyId } = useAdmin() as any;
  const businessId: string | null = selectedCompanyId || null;
  const isDesktop = !!runtime?.isDesktop;

  const [staff, setStaff] = useState<OperatorStaffEntry[]>([]);
  const [pinEnabled, setPinEnabled] = useState(false);
  const [operator, setOperator] = useState<BoundOperator | null>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(false);

  // Manager-override modal state
  const [overridePrompt, setOverridePrompt] = useState<{
    resolve: (token: string | null) => void;
  } | null>(null);
  const [overrideStaffId, setOverrideStaffId] = useState<string>('');
  const [overridePin, setOverridePin] = useState('');
  const [overrideError, setOverrideError] = useState('');
  const [overrideBusy, setOverrideBusy] = useState(false);

  const businessRef = useRef<string | null>(null);

  const clearLocalBinding = useCallback(() => {
    try {
      localStorage.removeItem(OPERATOR_TOKEN_KEY);
      localStorage.removeItem(OPERATOR_STORAGE_KEY);
    } catch { /* ignore */ }
    setOperator(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!isDesktop || !businessId || !isAuthenticated) {
      setStaff([]);
      setPinEnabled(false);
      return;
    }
    setLoading(true);
    try {
      const local = getLocalApi();
      const res: any = await local.getOperatorStaff(businessId);
      if (res?.success && res.data) {
        setStaff(res.data.staff || []);
        setPinEnabled(!!res.data.pinEnabled);
      }
      // Re-adopt an existing binding after a renderer reload: the
      // token lives in localStorage, the binding in the embedded DB.
      let storedToken: string | null = null;
      try { storedToken = localStorage.getItem(OPERATOR_TOKEN_KEY); } catch { /* ignore */ }
      if (storedToken) {
        const cur: any = await local.getCurrentOperator(businessId);
        if (cur?.success && cur.data?.operator) {
          setOperator(cur.data.operator as BoundOperator);
        } else {
          clearLocalBinding();
        }
      }
    } catch {
      // Embedded unreachable — operator layer stays inert.
    } finally {
      setLoading(false);
    }
  }, [isDesktop, businessId, isAuthenticated, clearLocalBinding]);

  // Business switch: a binding belongs to ONE business. Drop it and
  // re-adopt for the new business via refresh().
  useEffect(() => {
    if (businessRef.current !== businessId) {
      businessRef.current = businessId;
      clearLocalBinding();
      setLocked(false);
    }
    refresh();
  }, [businessId, refresh, clearLocalBinding]);

  const verifyPin = useCallback(
    async (staffProfileId: string, pin: string) => {
      if (!businessId) return { success: false, message: 'No business selected' };
      try {
        const local = getLocalApi();
        const res: any = await local.verifyOperatorPin({ businessId, staffProfileId, pin });
        if (res?.success && res.data?.operatorToken) {
          try {
            localStorage.setItem(OPERATOR_TOKEN_KEY, res.data.operatorToken);
            localStorage.setItem(OPERATOR_STORAGE_KEY, JSON.stringify(res.data.operator));
          } catch { /* ignore */ }
          setOperator(res.data.operator as BoundOperator);
          setLocked(false);
          return { success: true };
        }
        return { success: false, message: res?.message || 'Incorrect PIN' };
      } catch (e: any) {
        return { success: false, message: e?.message || 'Could not verify PIN' };
      }
    },
    [businessId]
  );

  const lock = useCallback(async () => {
    try {
      const local = getLocalApi();
      await local.clearOperatorBinding();
    } catch { /* best-effort */ }
    clearLocalBinding();
    // The lock screen only exists when the business uses PINs.
    setLocked(pinEnabled);
  }, [clearLocalBinding, pinEnabled]);

  const unlockAsAccount = useCallback(async () => {
    try {
      const local = getLocalApi();
      await local.clearOperatorBinding();
    } catch { /* best-effort */ }
    clearLocalBinding();
    setLocked(false);
  }, [clearLocalBinding]);

  const handleOwnShiftClosed = useCallback(async () => {
    // Only a bound operator hands over via the lock screen; the
    // account-as-operator keeps working as before.
    if (operator) {
      await lock();
    }
  }, [operator, lock]);

  // Idle auto-lock (desktop POS): 15 minutes without interaction
  // clears the operator; an open shift stays open under its owner.
  useEffect(() => {
    if (!isDesktop || !pinEnabled || !operator || locked) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reset = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        lock();
      }, IDLE_LOCK_MS);
    };
    const events = ['mousedown', 'keydown', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      if (timer) clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [isDesktop, pinEnabled, operator, locked, lock]);

  const requestManagerOverride = useCallback((): Promise<string | null> => {
    if (!pinEnabled || !businessId) return Promise.resolve(null);
    return new Promise((resolve) => {
      setOverrideStaffId('');
      setOverridePin('');
      setOverrideError('');
      setOverridePrompt({ resolve });
    });
  }, [pinEnabled, businessId]);

  const submitOverride = useCallback(async () => {
    if (!overridePrompt || !businessId) return;
    if (!overrideStaffId) {
      setOverrideError('Select the manager or owner authorising this action');
      return;
    }
    if (!/^\d{4,6}$/.test(overridePin)) {
      setOverrideError('Enter the 4–6 digit PIN');
      return;
    }
    setOverrideBusy(true);
    try {
      const local = getLocalApi();
      const res: any = await local.verifyManagerPin({
        businessId,
        staffProfileId: overrideStaffId,
        pin: overridePin,
      });
      if (res?.success && res.data?.overrideToken) {
        const resolve = overridePrompt.resolve;
        setOverridePrompt(null);
        resolve(res.data.overrideToken as string);
      } else {
        setOverrideError(res?.message || 'Incorrect PIN');
      }
    } catch (e: any) {
      setOverrideError(e?.message || 'Could not verify PIN');
    } finally {
      setOverrideBusy(false);
    }
  }, [overridePrompt, businessId, overrideStaffId, overridePin]);

  const cancelOverride = useCallback(() => {
    if (!overridePrompt) return;
    const resolve = overridePrompt.resolve;
    setOverridePrompt(null);
    resolve(null);
  }, [overridePrompt]);

  const managers = staff.filter(
    (s) => s.hasPin && s.role && PRIVILEGED.includes(String(s.role).toUpperCase())
  );

  const value: OperatorContextType = {
    isDesktop,
    businessId,
    staff,
    pinEnabled,
    operator,
    effectiveName: operator?.name || user?.name || 'Account user',
    effectiveRole: operator?.role || (user as any)?.membership?.roleName || user?.role || null,
    isBoundOperator: !!operator,
    locked,
    loading,
    refresh,
    verifyPin,
    lock,
    unlockAsAccount,
    handleOwnShiftClosed,
    requestManagerOverride,
  };

  return (
    <OperatorContext.Provider value={value}>
      {children}
      {overridePrompt && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold">Manager authorisation required</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              This action needs a manager or owner PIN. The authoriser is recorded on the record;
              you stay signed in as the current operator.
            </p>
            <label className="mt-4 block text-xs font-medium text-muted-foreground">Authoriser</label>
            <select
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={overrideStaffId}
              onChange={(e) => setOverrideStaffId(e.target.value)}
            >
              <option value="">Select manager / owner…</option>
              {managers.map((m) => (
                <option key={m.staffProfileId} value={m.staffProfileId}>
                  {m.name} ({m.role})
                </option>
              ))}
            </select>
            <label className="mt-3 block text-xs font-medium text-muted-foreground">PIN</label>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-center text-lg tracking-[0.5em]"
              value={overridePin}
              onChange={(e) => setOverridePin(e.target.value.replace(/\D/g, ''))}
            />
            {overrideError && <p className="mt-2 text-sm text-red-600">{overrideError}</p>}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={cancelOverride}
                className="flex-1 rounded-lg bg-muted px-4 py-2 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={overrideBusy}
                onClick={submitOverride}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {overrideBusy ? 'Verifying…' : 'Authorise'}
              </button>
            </div>
          </div>
        </div>
      )}
    </OperatorContext.Provider>
  );
};
