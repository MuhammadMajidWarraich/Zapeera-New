import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Loader2, AlertCircle, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ProvisioningStep =
  | 'business-verified'
  | 'branches-loaded'
  | 'products-loaded'
  | 'inventory-syncing'
  | 'customers-loading'
  | 'settings-loading'
  | 'complete'
  | 'failed';

interface StepInfo {
  key: ProvisioningStep;
  label: string;
}

const STEPS: StepInfo[] = [
  { key: 'business-verified', label: 'Business verified' },
  { key: 'branches-loaded', label: 'Branches loaded' },
  { key: 'products-loaded', label: 'Products loaded' },
  { key: 'inventory-syncing', label: 'Inventory syncing' },
  { key: 'customers-loading', label: 'Customers' },
  { key: 'settings-loading', label: 'Settings' },
];

interface BusinessProvisioningProps {
  businessName: string;
  onComplete: () => void;
  onRetry: () => void;
  onCancel: () => void;
}

export function BusinessProvisioning({ businessName, onComplete, onRetry, onCancel }: BusinessProvisioningProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState(false);

  const advance = useCallback(() => {
    setCurrentStep(prev => {
      if (prev >= STEPS.length) {
        setFailed(true);
        return prev;
      }
      return prev + 1;
    });
  }, []);

  useEffect(() => {
    if (currentStep >= STEPS.length) {
      const timer = setTimeout(() => onComplete(), 1500);
      return () => clearTimeout(timer);
    }
  }, [currentStep, onComplete]);

  // Simulated provisioning steps - in real implementation, this would call the cloud API
  useEffect(() => {
    if (currentStep >= STEPS.length || failed || offline) return;
    const timer = setTimeout(advance, 800 + Math.random() * 1200);
    return () => clearTimeout(timer);
  }, [currentStep, advance, failed, offline]);

  return (
    <div className="flex items-center justify-center min-h-[400px] p-8">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold">Preparing {businessName}</h2>
          <p className="text-sm text-muted-foreground">
            Preparing business for offline use...
          </p>
        </div>

        <div className="space-y-3">
          {STEPS.map((step, index) => {
            const isActive = index === currentStep && !failed;
            const isDone = index < currentStep;
            const isError = failed && index === currentStep;

            return (
              <div
                key={step.key}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-lg border transition-colors',
                  isActive && 'border-primary/50 bg-primary/5',
                  isDone && 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950',
                  isError && 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950',
                  !isActive && !isDone && !isError && 'border-muted',
                )}
              >
                {isDone && <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />}
                {isActive && <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0" />}
                {isError && <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />}
                {!isActive && !isDone && !isError && (
                  <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                )}
                <span className={cn(
                  'text-sm',
                  isDone && 'text-green-700 dark:text-green-300',
                  isActive && 'text-foreground font-medium',
                  isError && 'text-red-600 dark:text-red-400',
                )}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        {failed && (
          <div className="text-center space-y-3">
            <p className="text-sm text-red-600 dark:text-red-400">
              Failed to prepare business for offline use.
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={onRetry}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90"
              >
                Retry
              </button>
              <button
                onClick={onCancel}
                className="px-4 py-2 border rounded-md text-sm font-medium hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {offline && (
          <div className="text-center space-y-3 p-4 border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 rounded-lg">
            <WifiOff className="h-8 w-8 text-amber-500 mx-auto" />
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Internet connection required. Connect to the internet to set up this business for offline use.
            </p>
            <button
              onClick={onRetry}
              className="px-4 py-2 bg-amber-500 text-white rounded-md text-sm font-medium hover:bg-amber-600"
            >
              Try Again
            </button>
          </div>
        )}

        {currentStep >= STEPS.length && !failed && (
          <div className="text-center">
            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-2" />
            <p className="text-sm text-green-600 dark:text-green-400 font-medium">
              {businessName} is ready for offline use
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
