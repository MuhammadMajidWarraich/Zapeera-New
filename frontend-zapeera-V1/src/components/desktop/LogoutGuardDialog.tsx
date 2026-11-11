import { useEffect, useState } from 'react';
import { CloudOff, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

/**
 * v1.0.19 — Logout guard dialog (owner-corrected Phase 4).
 *
 * NOT a hard block. When the desktop sync queue holds unsynced
 * operations, a user-initiated logout first shows this strong warning:
 * the count, the plain consequence, and the reminder that a shift
 * change never needs a logout. The override is deliberate and
 * two-step ("Phir bhi logout karein" → explicit confirm). The queued
 * data itself survives the logout untouched — it stays parked on this
 * computer and resumes when the same business signs in again.
 *
 * With Phase 2B local-first login, the user can sign back in on this
 * device without internet afterwards — the warning is about the DATA
 * not being on the cloud yet, never about being locked out.
 */
export function LogoutGuardDialog() {
  const { logoutWarning, confirmLogout, cancelLogoutWarning } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);

  useEffect(() => {
    if (logoutWarning) setStep(1);
  }, [logoutWarning]);

  if (!logoutWarning) return null;
  const count = logoutWarning.pendingCount;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-600">
            <CloudOff className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold leading-tight">
              {count} change{count === 1 ? '' : 's'} not synced yet
            </h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Ye data abhi sirf is computer par hai; internet aanay par hi cloud par jayega.
              Agar aap abhi logout karte hain, ye changes is computer par mehfooz rahenge —
              jab wohi business dobara is computer par sign in hoga, sync wahin se resume ho jayega.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Shift change ke liye logout ki zaroorat nahi — “Switch staff / Lock” se agla
              staff member apne PIN se kaam shuru kar sakta hai, baghair internet ke.
            </p>
          </div>
        </div>

        {step === 1 ? (
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={cancelLogoutWarning}
              className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Cancel — logout nahi karna
            </button>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="flex-1 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700"
            >
              Phir bhi logout karein
            </button>
          </div>
        ) : (
          <div className="mt-5">
            <p className="text-sm font-medium text-red-700">
              Confirm karein: {count} unsynced change{count === 1 ? '' : 's'} ke saath logout ho jayega.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 rounded-lg bg-muted px-4 py-2.5 text-sm font-medium"
              >
                Wapas
              </button>
              <button
                type="button"
                onClick={confirmLogout}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white"
              >
                <LogOut className="h-4 w-4" />
                Haan, logout karein
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
