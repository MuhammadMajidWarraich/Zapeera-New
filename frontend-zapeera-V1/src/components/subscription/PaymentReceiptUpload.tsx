import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { config } from '@/lib/config';
import {
  Upload, CheckCircle, Clock, XCircle, ImageIcon, X,
  ChevronDown, ChevronUp, AlertCircle, RefreshCw, Copy, Landmark, Smartphone, Wallet
} from 'lucide-react';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Plan {
  id: string;
  name: string;
  price: number;
  isTrial: boolean;
}

interface Proof {
  id: string;
  planId: string;
  planName: string;
  planPrice: number;
  amount: number;
  currency: string;
  method: string;
  referenceNote: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface PaymentReceiptUploadRef {
  submit: () => void;
}

interface Props {
  businessId: string;
  /** Preselected plan id (skip plan picker). */
  planId?: string;
  /** Preselected plan name (display only when plans API unavailable). */
  planName?: string;
  /** Payable amount in PKR (skip amount input). */
  amount?: number;
  /** Callback when payment proof is successfully submitted */
  onSuccess?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: '🏦 Bank Transfer',
  EASYPAISA:     '📱 EasyPaisa',
  JAZZCASH:      '💛 JazzCash',
};

// Dummy account details – replace with real values later.
const ACCOUNT_DETAILS: Record<string, { title: string; number: string; extra?: string; icon: React.ComponentType<{ className?: string }> }> = {
  BANK_TRANSFER: {
    title: 'Zapeera Technologies (Pvt) Ltd',
    number: 'PK36HABB0012345678901234',
    extra: 'Habib Bank Limited (HBL) · Gulberg Branch, Lahore',
    icon: Landmark,
  },
  EASYPAISA: {
    title: 'Zapeera Technologies',
    number: '0300-1234567',
    extra: 'EasyPaisa Merchant Account',
    icon: Smartphone,
  },
  JAZZCASH: {
    title: 'Zapeera Technologies',
    number: '0301-7654321',
    extra: 'JazzCash Merchant Account',
    icon: Wallet,
  },
};

const StatusBadge = ({ status }: { status: Proof['status'] }) => {
  if (status === 'APPROVED') return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
      <CheckCircle className="w-3 h-3" /> Approved
    </span>
  );
  if (status === 'REJECTED') return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
      <XCircle className="w-3 h-3" /> Rejected
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
      <Clock className="w-3 h-3" /> Pending Review
    </span>
  );
};

const BASE_URL = config.api.baseUrl;

// ─── Component ────────────────────────────────────────────────────────────────

const PaymentReceiptUpload = forwardRef<PaymentReceiptUploadRef, Props>(({ businessId, planId: planIdProp, planName: planNameProp, amount: amountProp, onSuccess }, ref) => {
  const [plans, setPlans]             = useState<Plan[]>([]);
  const [proofs, setProofs]           = useState<Proof[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState(planIdProp || '');
  const [amount, setAmount]           = useState(amountProp ? String(amountProp) : '');
  const [method, setMethod]           = useState('BANK_TRANSFER');
  const [referenceNote, setReferenceNote] = useState('');
  const [file, setFile]               = useState<File | null>(null);
  const [preview, setPreview]         = useState<string | null>(null);
  const [submitting, setSubmitting]   = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const planPreselected = Boolean(planIdProp);
  const amountPreselected = typeof amountProp === 'number' && amountProp > 0;

  // Keep internal state in sync when parent updates the preselected plan / amount
  useEffect(() => {
    if (planIdProp) setSelectedPlanId(planIdProp);
  }, [planIdProp]);
  useEffect(() => {
    if (amountPreselected) setAmount(String(amountProp));
  }, [amountProp, amountPreselected]);

  // Expose submit function to parent
  useImperativeHandle(ref, () => ({
    submit: () => {
      if (formRef.current) {
        formRef.current.requestSubmit();
      }
    }
  }));

  const fetchProofs = useCallback(async () => {
    try {
      const r = await fetch(`${BASE_URL}/payments/manual/my?businessId=${businessId}`, {
        credentials: 'include',
      });
      const d = await r.json();
      if (d.success && Array.isArray(d.data)) setProofs(d.data);
    } catch {}
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    // Only fetch plan list when not preselected – we need it to show the dropdown.
    if (!planPreselected) {
      fetch(`${BASE_URL}/subscription/plans`, { credentials: 'include' })
        .then(r => r.json())
        .then(d => {
          if (d.success && Array.isArray(d.data)) {
            setPlans(d.data.filter((p: Plan) => !p.isTrial));
          }
        })
        .catch(() => {});
    }
    fetchProofs();
  }, [businessId, fetchProofs, planPreselected]);

  // Derived state
  const latest          = proofs[0] ?? null;
  const hasPending      = latest?.status === 'PENDING';
  const lastRejected    = latest?.status === 'REJECTED' ? latest : null;
  const selectedPlan    = plans.find(p => p.id === selectedPlanId);
  const effectivePlanName = planNameProp || selectedPlan?.name || '';
  const effectivePlanPrice = amountPreselected ? Number(amountProp) : (selectedPlan?.price ?? 0);
  const amountMismatch  = !amountPreselected && selectedPlan && amount
    ? Math.abs(parseFloat(amount) - selectedPlan.price) > selectedPlan.price * 0.05
    : false;

  // Periodic polling for status updates (fallback if SSE not available)
  useEffect(() => {
    const interval = setInterval(() => {
      // Only poll if there's a pending proof
      if (hasPending) {
        fetchProofs();
      }
    }, 30000); // Poll every 30 seconds

    return () => clearInterval(interval);
  }, [hasPending, fetchProofs]);

  // Listen for SSE payment proof status changes
  useEffect(() => {
    const handleStatusChange = (event: CustomEvent) => {
      fetchProofs(); // Refresh proofs when status changes
    };

    window.addEventListener('paymentProofStatusChanged', handleStatusChange as EventListener);
    return () => window.removeEventListener('paymentProofStatusChanged', handleStatusChange as EventListener);
  }, [fetchProofs]);

  const onPlanChange = (planId: string) => {
    setSelectedPlanId(planId);
    const p = plans.find(pl => pl.id === planId);
    if (p) setAmount(String(p.price));
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(f);
  };

  const clearFile = () => {
    setFile(null); setPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const resetForm = () => {
    if (!planPreselected) setSelectedPlanId('');
    if (!amountPreselected) setAmount('');
    setMethod(''); setReferenceNote('');
    clearFile();
  };

  const copyToClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!method)         { toast.error('Select your payment method');            return; }
    if (!referenceNote || referenceNote.trim().length < 3) { 
      toast.error('Transaction ID / Reference is required (min 3 characters)'); 
      return; 
    }
    if (!file)           { toast.error('Receipt screenshot is required');       return; }
    if (!selectedPlanId) { toast.error('Plan information is missing');           return; }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      toast.error('Payable amount is missing'); return;
    }
    if (amountMismatch) {
      toast.error(`Amount must be within ±5% of plan price (PKR ${selectedPlan!.price.toLocaleString()})`);
      return;
    }

    const fd = new FormData();
    fd.append('screenshot',    file);
    fd.append('businessId',    businessId);
    fd.append('planId',        selectedPlanId);
    fd.append('amount',        amount);
    fd.append('method',        method);
    if (referenceNote) fd.append('referenceNote', referenceNote);

    setSubmitting(true);
    try {
      const response = await fetch(`${BASE_URL}/payments/manual/submit`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });

      // Check for HTTP errors
      if (!response.ok) {
        if (response.status === 409) {
          const errorData = await response.json().catch(() => ({}));
          console.log('409 Error data:', errorData);
          
          const codeMessages: Record<string, string> = {
            PENDING_EXISTS:      'You already have a proof under review — please wait.',
            DAILY_LIMIT_EXCEEDED:'You\'ve hit the daily submission limit (3). Try again tomorrow.',
            DUPLICATE_SCREENSHOT:'This screenshot was already submitted. Please upload a different payment proof image.',
            DUPLICATE_REFERENCE: 'This transaction reference was already submitted. Please use a different reference.',
            DUPLICATE_FILE:      'This payment proof image was already uploaded. Please select a different image.',
            IMAGE_EXISTS:        'This payment proof image already exists in the system. Please upload a new image.',
          };
          
          const errorMessage = codeMessages[errorData.code] || errorData.message || 'This payment proof image already exists in the system. Please upload a new payment proof image.';
          toast.error(errorMessage);
          return;
        }
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }

      const res = await response.json();

      if (res.success) {
        toast.success("Receipt submitted! We'll verify and activate your subscription within 24 hours.");
        resetForm();
        fetchProofs();
        setShowHistory(true);
        if (onSuccess) onSuccess();
      } else {
        // User-readable error codes
        const codeMessages: Record<string, string> = {
          PENDING_EXISTS:      'You already have a proof under review — please wait.',
          DAILY_LIMIT_EXCEEDED:'You\'ve hit the daily submission limit (3). Try again tomorrow.',
          DUPLICATE_SCREENSHOT:'This screenshot was already submitted. Upload a fresh one.',
          DUPLICATE_REFERENCE: 'This transaction reference was already submitted.',
        };
        toast.error(codeMessages[res.code] || res.message || 'Submission failed');
      }
    } catch {
      toast.error('Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return null;

  // ── STATE: PENDING ─────────────────────────────────────────────────────────
  if (hasPending) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-amber-400 flex items-center justify-center shrink-0">
          <Clock className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-amber-800">Waiting for Admin Approval</p>
          <p className="text-sm text-amber-700 mt-0.5">
            Your payment receipt for <strong>{latest.planName}</strong> (PKR {Number(latest.amount).toLocaleString()})
            via <strong>{METHOD_LABELS[latest.method] ?? latest.method}</strong> is under review.
            We'll activate your subscription within 24 hours.
          </p>
          <p className="text-xs text-amber-600 mt-2">Submitted {new Date(latest.createdAt).toLocaleDateString()}</p>
        </div>
        <button onClick={fetchProofs} className="p-2 text-amber-600 hover:text-amber-800 transition" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const accountInfo = method ? ACCOUNT_DETAILS[method] : null;

  return (
    <div className="space-y-4">
      {/* STATE: REJECTED — show reason + allow resubmit */}
      {lastRejected && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-800 text-sm">Previous submission was rejected</p>
            <p className="text-sm text-red-700 mt-0.5">
              Reason: <em>{lastRejected.rejectionReason || 'No reason provided'}</em>
            </p>
            <p className="text-xs text-red-500 mt-1">Please fix the issue and submit a new receipt below.</p>
          </div>
        </div>
      )}

      {/* Upload form */}
      <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50 p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
            <Upload className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Pay &amp; Upload Receipt</h3>
            <p className="text-sm text-gray-500">Transfer via bank / JazzCash / EasyPaisa and upload your receipt</p>
          </div>
        </div>

        {/* Payable summary (only when plan/amount come from parent) */}
        {(planPreselected || amountPreselected) && (
          <div className="mb-5 rounded-xl border border-blue-200 bg-white/70 p-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Payable for</p>
              <p className="text-sm font-semibold text-gray-900">{effectivePlanName || 'Selected Plan'}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-gray-500">Amount</p>
              <p className="text-lg font-bold text-blue-700">PKR {effectivePlanPrice.toLocaleString()}</p>
            </div>
          </div>
        )}

        <form ref={formRef} onSubmit={handleSubmit} action="#" className="space-y-4">
          {/* Plan – only shown when not preselected */}
          {!planPreselected && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plan you're paying for</label>
              <select
                value={selectedPlanId}
                onChange={e => onPlanChange(e.target.value)}
                required
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="">Select plan…</option>
                {plans.map(p => (
                  <option key={p.id} value={p.id}>{p.name} — PKR {p.price.toLocaleString()}</option>
                ))}
              </select>
            </div>
          )}

          {/* Method */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment method</label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(METHOD_LABELS).map(([val, label]) => (
                <button
                  key={val} type="button"
                  onClick={() => setMethod(val)}
                  className={`py-2.5 text-sm font-medium rounded-xl border transition ${
                    method === val
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Account details – shown after method is selected */}
          {accountInfo && (
            <div className="rounded-xl border border-blue-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <accountInfo.icon className="w-4 h-4 text-blue-600" />
                <p className="text-sm font-semibold text-gray-900">Send payment to</p>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                Please transfer <strong className="text-gray-900">PKR {effectivePlanPrice.toLocaleString()}</strong> using the details below, then upload your receipt.
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-gray-500">Account Title</span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{accountInfo.title}</span>
                    <button type="button" onClick={() => copyToClipboard(accountInfo.title, 'Title')} className="text-blue-600 hover:text-blue-800" title="Copy">
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-gray-500">{method === 'BANK_TRANSFER' ? 'IBAN / Account #' : 'Number'}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-gray-900">{accountInfo.number}</span>
                    <button type="button" onClick={() => copyToClipboard(accountInfo.number, 'Account')} className="text-blue-600 hover:text-blue-800" title="Copy">
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {accountInfo.extra && (
                  <p className="text-xs text-gray-500 pt-1 border-t border-gray-100">{accountInfo.extra}</p>
                )}
              </div>
            </div>
          )}

          {/* Amount – only when not preselected */}
          {!amountPreselected && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount paid (PKR)</label>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder={selectedPlan ? `Plan price: PKR ${selectedPlan.price.toLocaleString()}` : 'e.g. 5000'}
                required min={1}
                className={`w-full px-4 py-2.5 border rounded-xl text-sm bg-white outline-none focus:ring-2 focus:ring-blue-400 ${
                  amountMismatch ? 'border-red-400 bg-red-50' : 'border-gray-200'
                }`}
              />
              {amountMismatch && (
                <p className="text-xs text-red-600 mt-1">
                  Amount must be within ±5% of PKR {selectedPlan!.price.toLocaleString()}
                </p>
              )}
            </div>
          )}

          {/* Reference / TXN ID – only shown after method selected */}
          {method && (
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-1">Transaction ID / Reference <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={referenceNote}
                onChange={e => setReferenceNote(e.target.value)}
                placeholder="e.g. TXN123456789, cheque #0042…"
                required
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          )}

          {/* Screenshot – only shown after method selected */}
          {method && (
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Receipt screenshot <span className="text-red-500">*</span></label>
              {preview ? (
                <div className="relative inline-block">
                  <img src={preview} alt="receipt preview" className="max-h-48 rounded-xl border-2 border-blue-300 object-contain shadow-lg" />
                  <button
                    type="button" onClick={clearFile}
                    className="absolute -top-2 -right-2 w-7 h-7 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 shadow-md"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-blue-400 bg-blue-50 rounded-xl p-8 cursor-pointer hover:bg-blue-100 hover:border-blue-500 transition shadow-md">
                  <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                    <ImageIcon className="w-6 h-6 text-blue-600" />
                  </div>
                  <div className="text-center">
                    <span className="block text-sm font-semibold text-gray-900">Click to upload receipt</span>
                    <span className="block text-xs text-gray-500 mt-1">PNG, JPG, WEBP or PDF (max 5 MB)</span>
                  </div>
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={onFileChange} className="hidden" />
                </label>
              )}
            </div>
          )}
        </form>
      </div>

      {/* Submission history */}
      {proofs.length > 0 && (
        <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
          <button
            onClick={() => setShowHistory(v => !v)}
            className="w-full flex items-center justify-between px-5 py-4 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            <span>Submission History ({proofs.length})</span>
            {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showHistory && (
            <div className="divide-y divide-gray-100">
              {proofs.map(proof => (
                <div key={proof.id} className="px-5 py-4 flex items-start gap-3">
                  {proof.status === 'APPROVED' ? <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5" />
                    : proof.status === 'REJECTED' ? <XCircle className="w-4 h-4 text-red-500 mt-0.5" />
                    : <Clock className="w-4 h-4 text-amber-500 mt-0.5" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-gray-900">{proof.planName}</span>
                      <StatusBadge status={proof.status} />
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      PKR {Number(proof.amount).toLocaleString()} · {METHOD_LABELS[proof.method] ?? proof.method}
                      {proof.referenceNote && ` · Ref: ${proof.referenceNote}`}
                    </p>
                    <p className="text-xs text-gray-400">{new Date(proof.createdAt).toLocaleDateString()}</p>
                    {proof.rejectionReason && (
                      <p className="text-xs mt-1 text-red-600 italic">Rejected: {proof.rejectionReason}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

PaymentReceiptUpload.displayName = 'PaymentReceiptUpload';

export default PaymentReceiptUpload;
