import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { escapeHtml } from "@/utils/html-escape";
import { levelLabel, levelPriceFromUnitPrice, describeStoredLine, KG_GRAMS_PER_KG, formatKgFromGrams, isWeightUnitType, isWeightSellingAllowedForBusinessType, type UnitLevel } from "@/utils/units";
import { batchInLinePool, variantUnitPrice, type ProductVariantLite } from "@/utils/variants";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { FbrQrImage, useQrDataUrl } from "@/components/common/FbrFiscal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ShoppingCart,
  Package,
  Plus,
  Minus,
  Trash2,
  Receipt,
  ArrowLeft,
  Printer,
  Download,
  Phone,
  Mail,
  AlertCircle,
  Calendar,
  Banknote,
  CreditCard,
  Smartphone,
  MapPin,
  User,
  CheckCircle2,
  Copy,
  Info,
  MessageCircle,
  Landmark,
  Wallet,
  Gift,
  Stethoscope,
  Zap,
  History,
  Keyboard,
  ClipboardList,
  ScanBarcode,
  Clock,
  UserRound,
  FileText,
  Loader2,
  PauseCircle,
  Play
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { apiService } from "@/services/api";
import type { TaxBreakdownLine, ProvincialTaxBreakdownLine, PrescriptionRecord, SalePrescriptionSummary } from "@/services/api";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useKeyboardShortcuts, openShortcutsHelp, isTypingTarget } from "@/lib/keyboard-shortcuts";
import { Kbd } from "@/components/ui/kbd";
import ProductSearchSection from "@/components/pos/ProductSearchSection";
import { useWedgeScanner } from "@/hooks/useWedgeScanner";
import { useMembershipRole } from "@/hooks/useMembershipRole";
import { CameraScannerDialog } from "@/components/barcode/CameraScannerDialog";
import { UnknownBarcodeDialog } from "@/components/barcode/UnknownBarcodeDialog";
import { isBarcodeApplicableBusinessType, resolveBarcodeScanningEnabled, resolveScanLookup } from "@/lib/barcode-scan";
import { playScanFailureSound, playScanSuccessSound } from "@/lib/scan-sound";

// Tender methods offered at the POS (Wave B1). JAZZCASH and EASYPAISA
// are first-class rails alongside cash/card; MOBILE is the legacy
// mobile-wallet label kept for older records.
// GIFT_CARD / EWALLET (Wave C9 — gap item 9): gift-card redemption
// (code in the split row's reference) and eWallet spend (the sale
// customer). Both travel ONLY as split-tender allocations — picking
// one auto-opens the split editor (see selectPaymentMethod) — and the
// server enforces the GIFT_CARD_KIOSK_PACK add-on + the ledger
// balance inside the sale transaction.
const PAYMENT_METHOD_OPTIONS = [
  { key: 'CASH', label: 'Cash', Icon: Banknote },
  { key: 'CARD', label: 'Card', Icon: CreditCard },
  { key: 'JAZZCASH', label: 'JazzCash', Icon: Smartphone },
  { key: 'EASYPAISA', label: 'Easypaisa', Icon: Wallet },
  { key: 'MOBILE', label: 'Mobile', Icon: Smartphone },
  { key: 'BANK_TRANSFER', label: 'Bank', Icon: Landmark },
  { key: 'GIFT_CARD', label: 'Gift Card', Icon: Gift },
  { key: 'EWALLET', label: 'eWallet', Icon: Wallet },
] as const;

interface SplitPaymentRow {
  method: string;
  amount: number;
  reference: string;
}

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  unitType: string;
  batch: string;
  expiry: string;
  formula?: string; // Product composition/formula for search
  barcode?: string;
  // POS redesign: real catalog metadata for the grid + category pills.
  categoryId?: string;
  categoryName?: string;
  minStock?: number;
  reorderLevel?: number | null;
  requiresPrescription?: boolean;
  unitsPerPack?: number; // Number of units in a pack
  unitsPerBox?: number;
  unitsPerStrip?: number | null; // Wave C2 - tablets per strip
  // Product variants (Wave C6): the ACTIVE variant matrix, riding
  // the products list from the server. Absent/empty = no variants,
  // every POS path behaves exactly as before.
  variants?: ProductVariantLite[];
}

interface Batch {
  id: string;
  batchNo: string;
  quantity: number;
  sellingPrice: number;
  // Product variants (Wave C6): the variant pool this batch's stock
  // belongs to; null/absent = the base pool.
  variantId?: string | null;
  unitsPerBox?: number;
  totalBoxes?: number;
  expireDate?: string;
  expiryStatus?: 'GOOD' | 'WARNING' | 'CRITICAL' | 'EXPIRED';
  daysUntilExpiry?: number;
}

interface CartItem {
  id: string; // Composite ID for React key
  productId?: string; // CRITICAL: Actual product ID from database
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  unitType: string;
  unitsPerBox?: number;
  batch: string;
  expiry: string;
  batchId?: string;
  instructions?: string;
  discountPercentage?: number;
  discountAmount?: number;
  // Prescriptions (Wave C1): copied from the product at add-to-cart
  // time so the rail can show the Prescription section even when the
  // product has since dropped out of the search results list.
  requiresPrescription?: boolean;
  // Unit engine (Wave C2): for pack-structured products the line is
  // sold at a LEVEL. `quantity` always stays in pieces (base units);
  // levelQuantity is the amount as entered in the level, unitPrice is
  // per LEVEL unit, and batchUnitPrice is the selected batch's
  // per-tablet price (the derivation base for level switching).
  // Merging two adds of one product normalizes the line back to
  // per-piece UNIT pricing and clears these fields.
  unitLevel?: UnitLevel;
  unitFactor?: number;
  levelQuantity?: number;
  batchUnitPrice?: number;
  unitsPerPack?: number;
  unitsPerStrip?: number | null;
  unitsDeducted?: number;
  // Product variants (Wave C6): the variant sold on this line +
  // its name snapshot. Lines merge only within the same variant.
  variantId?: string | null;
  variantName?: string | null;
}

interface Receipt {
  id: string;
  receiptNumber: string;
  date: string;
  time: string;
  cashier: string;
  customer?: {
    name: string;
    phone: string;
    email?: string;
    address?: string;
  };
  items: CartItem[];
  subtotal: number;
  discountAmount?: number;
  discountPercentage?: number;
  // Loyalty (Wave B3): discount bought with points, and the points
  // spent/earned on this sale, as returned by the server.
  loyaltyDiscount?: number;
  pointsRedeemed?: number;
  pointsEarned?: number;
  // Promotions (Wave B4): the server's promotion discount for this
  // sale and a label for it (coupon code or promotion name).
  promotionDiscount?: number;
  promotionLabel?: string;
  // Tax classes (Wave B5): the server's per-class tax groups.
  // Receipts render them only when shouldShowTaxBreakdown() is true;
  // single-default receipts render exactly as before (no tax line).
  taxBreakdown?: TaxBreakdownLine[];
  // Provincial tax (Gap item 1): the server's per-authority lines
  // (PRA / SRB / KPRA / BRA). Rendered as their own receipt lines,
  // separate from the FBR/general tax above; empty when no provincial
  // config applied, so old receipts render exactly as before.
  provincialTaxAmount?: number;
  provincialTaxBreakdown?: ProvincialTaxBreakdownLine[];
  // FBR POS (Wave B7): fiscal invoice number + status from the server.
  // The number usually lands asynchronously (worker), so it is often
  // absent on this just-created receipt and present on reprints.
  fbrInvoiceNumber?: string | null;
  fbrStatus?: string | null;
  // Prescriptions (Wave C1): the register record this sale dispensed
  // against — receipts print "Rx: <patient> (Dr. <doctor>)".
  prescription?: SalePrescriptionSummary | null;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
}

/**
 * Unit engine (Wave C2): how a cart line's quantity reads on receipts
 * and messages — "2 strips (20 tablets)" for leveled lines, the plain
 * piece count for everything else.
 */
const cartItemQtyPhrase = (item: CartItem): string => {
  // Loose / by-weight selling (Stage 1): a kilo line reads in kg
  // ("0.500 kg"), never "packs (N tablets)".
  if (item.unitType === "kg" && item.unitLevel && item.unitFactor && item.unitFactor > 1) {
    const levelQty = item.levelQuantity ?? item.quantity / item.unitFactor;
    return `${levelQty.toFixed(3)} kg`;
  }
  if (item.unitLevel && item.unitFactor && item.unitFactor > 1) {
    const levelQty = item.levelQuantity ?? item.quantity / item.unitFactor;
    return `${levelQty} ${levelLabel(item.unitLevel, levelQty)} (${item.quantity} tablets)`;
  }
  return `${item.quantity}`;
};

/**
 * Loose / by-weight selling (Stage 1): a receipt line is a kilo line
 * when it carries the weight conjunction — PACK level, factor 1000
 * (grams per kilo), unitType 'kg'/'KG'. A pharmacy pack of 1000 tablets
 * has factor 1000 but unitType 'tablets'; a legacy UNIT gram line has
 * no PACK level. Same conjunction as describeStoredLine's KG branch
 * and the receipt detailsLine builders — so the " / kg" price suffix
 * appears exactly when the qty phrase reads "N.NNN kg".
 */
const isKgReceiptLine = (item: { unitLevel?: string | null; unitFactor?: number | null; unitType?: string | null }): boolean =>
  (item.unitLevel || "").toUpperCase() === "PACK" && item.unitFactor === KG_GRAMS_PER_KG && isWeightUnitType(item.unitType);

/**
 * Tax classes (Wave B5): per-class tax lines appear on a receipt only
 * when the sale actually used tax classes — more than one group, or a
 * single group tied to a real class. A single implicit "Default" group
 * (classless company / default-rate sale) renders exactly as receipts
 * always have: no separate tax line.
 */
function shouldShowTaxBreakdown(receipt: Receipt): boolean {
  const breakdown = receipt.taxBreakdown || [];
  return breakdown.length > 1 || (breakdown.length === 1 && !!breakdown[0].taxClassId);
}

/**
 * POS header (fix-up 2026-10-26): branch names arrive as
 * "Seikho Medicos - DHA" / "Seikho Medicos - Gulberg" — the business
 * prefix is redundant in the header (the brand right beside it already
 * says "Seikho Medicos") and at 1280px it truncated to the unreadable
 * "Seikho Medicos -…". The select, the non-owner branch chip and the
 * cashier pill show this SHORT name ("DHA", "Gulberg", "Main Branch");
 * the full name stays available via the title tooltip and the open
 * dropdown list (which keeps full names). Names without the prefix
 * ("Main Branch") pass through unchanged.
 */
function shortBranchName(name: string | undefined | null, businessName?: string | null): string {
  if (!name) return "—";
  const prefix = businessName ? `${businessName} - ` : "";
  if (prefix && name.startsWith(prefix)) return name.slice(prefix.length);
  return name;
}

/**
 * WhatsApp receipt share (QA Wave 2): builds a wa.me deep link with a
 * text receipt summary. wa.me needs the phone in international format
 * without '+': local Pakistani numbers (03xx…) are converted to 92xx…;
 * anything else is passed through as digits.
 */
function buildWhatsAppReceiptUrl(receipt: Receipt, businessName: string): string {
  let digits = String(receipt.customer?.phone || "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "92" + digits.slice(1);
  else if (digits.length === 10 && digits.startsWith("3")) digits = "92" + digits;
  const lines: string[] = [
    `*${businessName} — Receipt ${receipt.receiptNumber}*`,
    `Date: ${receipt.date} ${receipt.time}`,
    "------------------------",
    ...receipt.items.map(
      (item) => `${item.name}${item.variantName ? ` (${item.variantName})` : ''} x${cartItemQtyPhrase(item)} — PKR ${Number(item.totalPrice || 0).toFixed(2)}`
    ),
    "------------------------",
    `Subtotal: PKR ${Number(receipt.subtotal || 0).toFixed(2)}`,
  ];
  if (receipt.discountAmount && receipt.discountAmount > 0) {
    lines.push(`Discount: -PKR ${Number(receipt.discountAmount).toFixed(2)}`);
  }
  if (receipt.loyaltyDiscount && receipt.loyaltyDiscount > 0) {
    lines.push(`Loyalty discount (${receipt.pointsRedeemed || 0} pts): -PKR ${Number(receipt.loyaltyDiscount).toFixed(2)}`);
  }
  if (receipt.promotionDiscount && receipt.promotionDiscount > 0) {
    lines.push(`Promotion${receipt.promotionLabel ? ` (${receipt.promotionLabel})` : ''}: -PKR ${Number(receipt.promotionDiscount).toFixed(2)}`);
  }
  if (shouldShowTaxBreakdown(receipt)) {
    for (const line of receipt.taxBreakdown || []) {
      lines.push(`Tax — ${line.className} (${Number(line.rate)}%): PKR ${Number(line.taxAmount || 0).toFixed(2)}`);
    }
  }
  for (const line of receipt.provincialTaxBreakdown || []) {
    lines.push(`Provincial tax — ${line.authorityName} (${line.authority}, ${Number(line.rate)}%): PKR ${Number(line.taxAmount || 0).toFixed(2)}`);
  }
  if (receipt.prescription) {
    lines.push(`Rx: ${receipt.prescription.patientName}${receipt.prescription.doctorName ? ` (Dr. ${receipt.prescription.doctorName})` : ''}`);
  }
  if (receipt.fbrInvoiceNumber) {
    lines.push(`FBR Invoice #: ${receipt.fbrInvoiceNumber}`);
  }
  lines.push(
    `*Total: PKR ${Number(receipt.total || 0).toFixed(2)}*`,
    `Payment: ${receipt.paymentMethod} (${receipt.paymentStatus})`,
    "",
    "Thank you for choosing us!"
  );
  return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join("\n"))}`;
}

const CreateInvoice = ({ registerLayout = false }: { registerLayout?: boolean } = {}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { selectedBranchId, selectedBranch, selectedCompanyId, selectedCompany, setSelectedBranchId, allBranches } = useAdmin();

  // State management
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [invoiceItems, setInvoiceItems] = useState<CartItem[]>([]);
  // Loose / by-weight selling (Stage 1): per-cart-line local strings
  // for the decimal KG qty input and the amount→weight input. Local
  // strings (not controlled numbers) so typing "0." does not snap
  // back while the cashier is mid-typing; committed on blur/Enter.
  const [kgInputByItem, setKgInputByItem] = useState<Record<string, string>>({});
  const [weightAmountByItem, setWeightAmountByItem] = useState<Record<string, string>>({});
  const [invoiceCustomer, setInvoiceCustomer] = useState({
    name: "",
    phone: ""
  });
  const [discountPercentage, setDiscountPercentage] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<string>('CASH');
  const [paymentStatus, setPaymentStatus] = useState<string>('COMPLETED'); // COMPLETED = Paid, PENDING = Unpaid
  const [paidAmount, setPaidAmount] = useState<number>(0); // Amount paid by customer
  // Split tender (Wave B1): when enabled, the single amount/method
  // controls are replaced by per-method allocation rows.
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitPayments, setSplitPayments] = useState<SplitPaymentRow[]>([]);
  // --- POS redesign state (layout only; sale state above is unchanged) ---
  const [posCategories, setPosCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(new Date());
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [isTxnDialogOpen, setIsTxnDialogOpen] = useState(false);
  // POS Hold (parked sales): the Held tab of the Transactions dialog,
  // the parked rows for this branch, and the id of the parked record
  // the current cart was resumed from (consumed — deleted — only
  // after that resumed sale's invoice has been created).
  const [txnTab, setTxnTab] = useState<"recent" | "held">("recent");
  const [parkedSales, setParkedSales] = useState<any[]>([]);
  const [isLoadingParked, setIsLoadingParked] = useState(false);
  const [isParking, setIsParking] = useState(false);
  const [resumedParkedId, setResumedParkedId] = useState<string | null>(null);
  const [todaySales, setTodaySales] = useState<any[]>([]);
  const [isLoadingTodaySales, setIsLoadingTodaySales] = useState(false);
  const [isShiftDialogOpen, setIsShiftDialogOpen] = useState(false);
  const [activeShift, setActiveShift] = useState<any>(null);
  const [myStaffProfileId, setMyStaffProfileId] = useState<string | null>(null);
  // Loyalty redemption (Wave B3): the customer resolved from the
  // entered phone (its points balance drives the "Use points"
  // control), the raw points input, and the PKR value of one point
  // from the loyaltyPointValue setting (default 1).
  const [posCustomer, setPosCustomer] = useState<{ id: string; name: string; phone: string; loyaltyPoints: number } | null>(null);
  const [loyaltyPointsInput, setLoyaltyPointsInput] = useState("");
  const [loyaltyPointValue, setLoyaltyPointValue] = useState(1);
  // Prescriptions (Wave C1): the register record attached to this
  // sale, the picker search, the inline-create form (for when the
  // patient has no record yet), and the blocked-sale dialog state.
  const [selectedPrescription, setSelectedPrescription] = useState<PrescriptionRecord | null>(null);
  const [rxSearch, setRxSearch] = useState("");
  const [rxResults, setRxResults] = useState<PrescriptionRecord[]>([]);
  const [rxSearching, setRxSearching] = useState(false);
  const [showRxCreate, setShowRxCreate] = useState(false);
  const [rxForm, setRxForm] = useState({ patientName: "", doctorName: "" });
  const [rxDosages, setRxDosages] = useState<Record<string, { dosage: string; durationDays: string }>>({});
  const [rxCreating, setRxCreating] = useState(false);
  const [rxBlock, setRxBlock] = useState<{ message: string; products: Array<{ id: string; name: string }> } | null>(null);
  // Credit limit (khata, gap item 7): the selected customer's khata
  // balance + limit for the payment dialog warning, the 402 block
  // the server returns for an over-limit credit sale, and the one-shot
  // manager override that re-submits with creditLimitOverride: true.
  const [khataCredit, setKhataCredit] = useState<{ balance: number; creditLimit: number | null; availableCredit: number | null } | null>(null);
  const [creditLimitBlock, setCreditLimitBlock] = useState<{ message: string; balance: number; creditLimit: number; projectedBalance: number; overBy: number; dueAmount: number } | null>(null);
  const [creditLimitOverrideArmed, setCreditLimitOverrideArmed] = useState(false);
  // Promotions (Wave B4): the coupon code the cashier typed and, once
  // validated against the live cart, the server-estimated promotion
  // discount. Only the CODE is ever sent with the sale — the server
  // recomputes the discount itself. The estimate clears whenever the
  // cart or the manual discount changes, so a stale figure is never
  // shown or relied on.
  const [couponCodeInput, setCouponCodeInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; name: string; estimatedDiscount: number } | null>(null);
  const [couponError, setCouponError] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  // Barcode scanning (wedge + camera): the raw stored setting
  // ('true' | 'false' | null = Automatic, resolved against the
  // business type below), the header feedback pill for the last
  // scan, and the camera / unknown-barcode dialog state. The cart a
  // scan belongs to is remembered so a scan that started in the New
  // Sale modal resolves back into the modal cart after assignment.
  const [barcodeScanningSetting, setBarcodeScanningSetting] = useState<string | null>(null);
  const [scanFeedback, setScanFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const scanFeedbackTimer = useRef<number | null>(null);
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);
  const [scanTarget, setScanTarget] = useState<"main" | "modal">("main");
  const membershipRole = useMembershipRole();
  const canCreateProducts =
    membershipRole === "OWNER" || membershipRole === "MANAGER" || user?.role === "OWNER";
  // Credit-limit override (gap item 7): only owner/manager/admin may
  // approve an over-limit credit sale — cashiers see the block, never
  // the override button. Mirrors the server's override roles.
  const canOverrideCreditLimit =
    membershipRole === "OWNER" || membershipRole === "MANAGER" || user?.role === "OWNER" || user?.role === "ADMIN";
  const [isLoading, setIsLoading] = useState(false);
  const [isReceiptDialogOpen, setIsReceiptDialogOpen] = useState(false);
  const [currentReceipt, setCurrentReceipt] = useState<Receipt | null>(null);
  // FBR POS (Wave B7): QR of the fiscal invoice number for print HTML.
  const currentReceiptQr = useQrDataUrl(currentReceipt?.fbrInvoiceNumber ?? null);
  const [isRefundDialogOpen, setIsRefundDialogOpen] = useState(false);
  const [refundInvoiceNumber, setRefundInvoiceNumber] = useState(""); // Changed from receiptNumber to invoiceNumber
  const [refundReason, setRefundReason] = useState("");
  const [foundInvoice, setFoundInvoice] = useState<any>(null);
  const [invoiceLookupLoading, setInvoiceLookupLoading] = useState(false);

  // New Sale Modal State
  const [isNewSaleDialogOpen, setIsNewSaleDialogOpen] = useState(false);
  const [modalInvoiceItems, setModalInvoiceItems] = useState<CartItem[]>([]);
  const [modalInvoiceCustomer, setModalInvoiceCustomer] = useState({
    name: "",
    phone: ""
  });
  const [modalDiscountPercentage, setModalDiscountPercentage] = useState<number>(0);
  const [modalPaymentMethod, setModalPaymentMethod] = useState<string>('CASH');
  const [modalPaymentStatus, setModalPaymentStatus] = useState<string>('COMPLETED');
  const [modalPaidAmount, setModalPaidAmount] = useState<number>(0);
  const [modalSearchQuery, setModalSearchQuery] = useState("");

  // Batch management state
  const [productBatches, setProductBatches] = useState<Record<string, Batch[]>>({});
  const [selectedBatches, setSelectedBatches] = useState<Record<string, string>>({}); // productId -> batchId
  // Product variants (Wave C6): productId -> chosen variantId.
  // Absent = untouched (the first variant is the effective choice
  // for a variant product); explicit null = the "Standard" base
  // pool. Only the main rail uses variants — the modal quick-sale
  // stays variant-less (its lines carry no variantId), as with C2
  // levels.
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string | null>>({});
  // Salesperson attribution (Wave C6): the staff USER id credited
  // with this sale when it is not the cashier; '' = the cashier.
  const [salespersonId, setSalespersonId] = useState<string>('');
  const [salesStaff, setSalesStaff] = useState<Array<{ userId: string; name: string }>>([]);
  const [loadingBatches, setLoadingBatches] = useState<Record<string, boolean>>({});
  const batchLoadingTimeouts = useRef<Record<string, number>>({});
  const [fetchedProducts, setFetchedProducts] = useState<Set<string>>(new Set());
  const processedProductIds = useRef<Set<string>>(new Set());
  const lastProductIdsString = useRef<string>('');

  // Load products on component mount
  useEffect(() => {
    loadProducts();
  }, []);

  // Salesperson attribution (Wave C6 → gap item 7): the designated
  // SALESMEN for the checkout picker (StaffProfile.isSalesman) — not
  // the whole staff list. Best-effort — without it the picker simply
  // stays hidden and sales attribute to the cashier, as before.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await apiService.getSalesmen();
        if (cancelled || !response.success) return;
        const people = ((response.data as any[]) || [])
          .map((s: any) => ({
            userId: s.userId || '',
            name: s.name || 'Salesman',
          }))
          .filter((p: any) => p.userId && p.userId !== user?.id);
        if (!cancelled) setSalesStaff(people);
      } catch {
        // Picker stays hidden; attribution is optional.
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch batches for a specific product
  const fetchProductBatches = useCallback(async (productId: string) => {
    // CRITICAL FIX: Don't block batch fetching if branch is not selected
    // Show all batches for the product, even if branch is not selected
    // This allows users to see and select batches regardless of branch selection
    if (user?.role === 'OWNER' && !selectedBranchId) {
      // Continue with fetch but don't send branchId in query - this is OK
    }

    // CRITICAL FIX: Check loading state using functional update to get current state
    // This prevents duplicate requests while ensuring we get the latest state
    let shouldSkip = false;
    setLoadingBatches(prev => {
      if (prev[productId]) {
        shouldSkip = true;
        return prev; // Already loading, skip
      }
      return { ...prev, [productId]: true };
    });

    // Skip if already loading (using the flag from functional update)
    if (shouldSkip) {
      const existingTimeout = batchLoadingTimeouts.current[productId];
      if (!existingTimeout) {
        batchLoadingTimeouts.current[productId] = window.setTimeout(() => {
          setLoadingBatches(prev => ({ ...prev, [productId]: false }));
          delete batchLoadingTimeouts.current[productId];
        }, 12000);
      }
      return;
    }
    
    // CRITICAL: Skip if already fetched (even if no batches found)
    if (fetchedProducts.has(productId)) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setLoadingBatches(prev => ({ ...prev, [productId]: false }));
      delete batchLoadingTimeouts.current[productId];
    }, 12000);
    batchLoadingTimeouts.current[productId] = timeoutId;

    try {
      // CRITICAL FIX: For ADMIN/SUPERADMIN, require branch selection
      // For MANAGER/CASHIER, use their assigned branch
      let branchIdForBatches: string | undefined;
      if (user?.role === 'OWNER') {
        // Only send branchId if it's selected - don't send undefined
        branchIdForBatches = selectedBranchId || undefined;
      } else {
        branchIdForBatches = user?.branchId || undefined;
      }
      // CRITICAL FIX: Don't send branchId in query if it's not selected
      // This allows the server to return ALL batches for the product
      const queryParams: any = {
        productId: productId,
        limit: 100, // Get all batches for this product
        expired: false, // Exclude expired batches
        // CRITICAL FIX: Exclude reported batches - they should not be available for sale
        isReported: false
      };

      // Only add branchId if it's actually selected (not null/undefined)
      if (branchIdForBatches) {
        queryParams.branchId = branchIdForBatches;
      }
      const response = await apiService.getBatches({
        page: 1,
        limit: 100,
        productId,
        isActive: true,
        isReported: false,
      });


      let batchesData: any[] = [];

      if (response.success) {
        if (response.data?.batches) {
          batchesData = response.data.batches;
        }
        if (batchesData.length === 0) {
        }

        const batches: Batch[] = batchesData
          .filter((batch: any) => batch && batch.id) // Filter out invalid batches
          .map((batch: any) => {
            const totalBoxes = batch.totalBoxes || 0;
            const quantity = batch.quantity || batch.totalStock || batch.stockQuantity || 0;
            const computedUnitsPerBox = totalBoxes > 0 && quantity > 0
              ? Math.round(quantity / totalBoxes)
              : 0;
            const expireDate = batch.expireDate || batch.expiryDate;
            let expiryStatus: Batch['expiryStatus'] = 'GOOD';
            let daysUntilExpiry: number | undefined;
            if (expireDate) {
              daysUntilExpiry = Math.ceil((new Date(expireDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
              if (daysUntilExpiry < 0) {
                expiryStatus = 'EXPIRED';
              } else if (daysUntilExpiry <= 7) {
                expiryStatus = 'CRITICAL';
              } else if (daysUntilExpiry <= 30) {
                expiryStatus = 'WARNING';
              }
            }
            return {
              id: batch.id,
              batchNo: batch.batchNo || batch.batchNumber || `BATCH-${batch.id}`,
              quantity,
              variantId: batch.variantId ?? null,
              sellingPrice: batch.sellingPrice || batch.unitPrice || batch.sellingPricePerUnit || 0,
              unitsPerBox: batch.unitsPerBox ||
                (computedUnitsPerBox > 0 ? computedUnitsPerBox : undefined) ||
                batch.product?.unitsPerPack ||
                0,
              totalBoxes: totalBoxes || undefined,
              expireDate,
              expiryStatus,
              daysUntilExpiry
            };
          })
          // CRITICAL FIX: Filter out expired batches - they should not be available for sale
          .filter((batch: Batch) => {
            // Exclude batches that are expired
            if (batch.expiryStatus === 'EXPIRED') {
              return false;
            }
            // Also exclude batches with negative daysUntilExpiry (past expiry date)
            if (batch.daysUntilExpiry !== undefined && batch.daysUntilExpiry < 0) {
              return false;
            }
            // Exclude batches with past expireDate
            if (batch.expireDate) {
              const expireDate = new Date(batch.expireDate);
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              expireDate.setHours(0, 0, 0, 0);
              if (expireDate < today) {
                return false;
              }
            }
            return true;
          });
        // Sort batches by expiry date (nearest first)
        batches.sort((a, b) => {
          if (!a.expireDate && !b.expireDate) return 0;
          if (!a.expireDate) return 1;
          if (!b.expireDate) return -1;
          return new Date(a.expireDate).getTime() - new Date(b.expireDate).getTime();
        });

        const needsUnitsPerBox = batches.some(b => !b.unitsPerBox || b.unitsPerBox <= 1);
        if (needsUnitsPerBox) {
        }

        const batchUnitsPerBox = batches.find(b => b.unitsPerBox && b.unitsPerBox > 1)?.unitsPerBox;
        if (batchUnitsPerBox && batchUnitsPerBox > 1) {
          setProducts(prev => prev.map(product =>
            product.id === productId
              ? {
                  ...product,
                  unitsPerPack: product.unitsPerPack && product.unitsPerPack > 1 ? product.unitsPerPack : batchUnitsPerBox,
                  unitsPerBox: product.unitsPerBox && product.unitsPerBox > 1 ? product.unitsPerBox : batchUnitsPerBox
                }
              : product
          ));
        }

        setProductBatches(prev => {
          const updated = { ...prev, [productId]: batches };
          return updated;
        });
        
        // Mark as fetched
        setFetchedProducts(prev => {
          const newSet = new Set(prev);
          newSet.add(productId);
          return newSet;
        });

        // Auto-select batch with nearest expiry if no batch is selected
        setSelectedBatches(prev => {
          if (prev[productId]) {
            // Check if the selected batch still exists in the new batches
            const selectedBatchExists = batches.find(b => b.id === prev[productId]);
            if (selectedBatchExists && selectedBatchExists.quantity > 0) {
              return prev; // Keep existing selection if valid
            }
          }
          // Auto-select first available batch with stock
          if (batches.length > 0) {
            const availableBatch = batches.find(b => b.quantity > 0) || batches[0];
            if (availableBatch) {
              return { ...prev, [productId]: availableBatch.id };
            }
          }
          return prev;
        });
      } else {
        setProductBatches(prev => ({ ...prev, [productId]: [] }));
        // Mark as fetched even if no batches found
        setFetchedProducts(prev => {
          const newSet = new Set(prev);
          newSet.add(productId);
          return newSet;
        });
      }
    } catch (error: any) {
      setProductBatches(prev => ({ ...prev, [productId]: [] }));
      // Mark as fetched even on error to prevent repeated failed requests
      setFetchedProducts(prev => {
        const newSet = new Set(prev);
        newSet.add(productId);
        return newSet;
      });
    } finally {
      setLoadingBatches(prev => {
        const updated = { ...prev, [productId]: false };
        return updated;
      });
      const existingTimeout = batchLoadingTimeouts.current[productId];
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        delete batchLoadingTimeouts.current[productId];
      }
    }
  }, [user, selectedBranchId, selectedCompanyId]);

  // CRITICAL FIX: Re-fetch batches when branch changes
  useEffect(() => {
    if (selectedBranchId && filteredProducts.length > 0) {
      // Clear existing batches and re-fetch for all visible products
      setProductBatches({});
      setSelectedBatches({});
      // CRITICAL: Clear fetchedProducts so batches can be re-fetched for new branch
      setFetchedProducts(new Set());
      processedProductIds.current = new Set();
      lastProductIdsString.current = '';
      // Re-fetch batches for all filtered products
      filteredProducts.forEach(product => {
        fetchProductBatches(product.id);
      });
    }
  }, [selectedBranchId]);

  // Filter products: search query (when typed), the active category
  // pill (POS redesign), and the expired-batch exclusion. An empty
  // query now means "browse the loaded catalog" (POS redesign) — the
  // grid is the register's home view.
  useEffect(() => {
    if (!Array.isArray(products)) {
      setFilteredProducts([]);
      return;
    }
    const query = searchQuery.trim().toLowerCase();
    const filtered = products.filter(product => {
      // Category pill filter (real product categories)
      if (activeCategoryId && product.categoryId !== activeCategoryId) return false;

      // First check if product matches search query (if one is typed)
      const matchesSearch = !query ||
        product.name.toLowerCase().includes(query) ||
        product.id.toLowerCase().includes(query) ||
        (product.formula && product.formula.toLowerCase().includes(query)) || // Search by formula
        (product.categoryName && product.categoryName.toLowerCase().includes(query)) || // Search by category
        (product.barcode && product.barcode.toLowerCase().includes(query)); // Search by barcode

      if (!matchesSearch) return false;

      // CRITICAL FIX: Exclude products that only have expired batches
      const batchesForProduct = productBatches[product.id] || [];
      if (batchesForProduct.length > 0) {
        // Check if all batches are expired
        const hasNonExpiredBatches = batchesForProduct.some(batch => {
          // Check if batch is expired
          if (batch.expiryStatus === 'EXPIRED') return false;
          if (batch.daysUntilExpiry !== undefined && batch.daysUntilExpiry < 0) return false;
          if (batch.expireDate) {
            const expireDate = new Date(batch.expireDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            expireDate.setHours(0, 0, 0, 0);
            if (expireDate < today) return false;
          }
          return true;
        });
        // Only include product if it has at least one non-expired batch
        return hasNonExpiredBatches;
      }

      // If batches haven't been fetched yet, include the product (will be filtered later when batches are loaded)
      return true;
    });
    setFilteredProducts(filtered);
  }, [searchQuery, products, productBatches, activeCategoryId]);

  // Filter products for modal search
  const modalFilteredProducts = useMemo(() => {
    if (modalSearchQuery.trim() && Array.isArray(products)) {
      const query = modalSearchQuery.toLowerCase();
      return products.filter(product => {
        // First check if product matches search query
        const matchesSearch = product.name.toLowerCase().includes(query) ||
          product.id.toLowerCase().includes(query) ||
          (product.formula && product.formula.toLowerCase().includes(query)) ||
          (product.barcode && product.barcode.toLowerCase().includes(query));
        
        if (!matchesSearch) return false;
        
        // CRITICAL FIX: Exclude products that only have expired batches
        const batchesForProduct = productBatches[product.id] || [];
        if (batchesForProduct.length > 0) {
          // Check if all batches are expired
          const hasNonExpiredBatches = batchesForProduct.some(batch => {
            // Check if batch is expired
            if (batch.expiryStatus === 'EXPIRED') return false;
            if (batch.daysUntilExpiry !== undefined && batch.daysUntilExpiry < 0) return false;
            if (batch.expireDate) {
              const expireDate = new Date(batch.expireDate);
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              expireDate.setHours(0, 0, 0, 0);
              if (expireDate < today) return false;
            }
            return true;
          });
          // Only include product if it has at least one non-expired batch
          return hasNonExpiredBatches;
        }
        
        // If batches haven't been fetched yet, include the product (will be filtered later when batches are loaded)
        return true;
      });
    }
    return [];
  }, [modalSearchQuery, products, productBatches]);

  // Server-side product search (debounced) to avoid loading 1000 products on tab open.
  // POS redesign: an empty query reloads the browse catalog — the
  // product grid is the register's home view now, not just results.
  // New Invoice modal (2026-10-26): while the modal is open ITS query
  // drives the search, exactly like the main search box. The modal
  // previously filtered only the already-loaded browse page, so
  // products outside the first 50 (e.g. Desi Ghee) were unfindable
  // from the modal even though the server has them. Closing the modal
  // re-runs this with the main query, restoring the browse grid.
  useEffect(() => {
    const effectiveQuery = isNewSaleDialogOpen ? modalSearchQuery : searchQuery;
    const timer = setTimeout(() => {
      loadProducts(effectiveQuery);
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, modalSearchQuery, isNewSaleDialogOpen, selectedBranchId, selectedCompanyId]);

  // POS redesign: live clock for the register header bar.
  useEffect(() => {
    const timer = setInterval(() => setClockNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // POS redesign: the business's real product categories for the
  // catalog pills (only categories that actually hold products).
  useEffect(() => {
    if (!selectedCompanyId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await apiService.getCategories({ companyId: selectedCompanyId, limit: 100 });
        if (!cancelled && response.success) {
          const list = (response.data?.categories || [])
            .filter((c: any) => (c._count?.products ?? 1) > 0)
            .map((c: any) => ({ id: c.id, name: c.name }));
          setPosCategories(list);
        }
      } catch {
        if (!cancelled) setPosCategories([]);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCompanyId]);

  // POS redesign: the signed-in user's OWN active register shift
  // (the real record from Shift Management) for the header pill and
  // the shift report. No shift → nothing is shown; nothing invented.
  useEffect(() => {
    if (!myStaffProfileId) return;
    let cancelled = false;
    apiService.getActiveShift(myStaffProfileId)
      .then((response) => {
        if (!cancelled) setActiveShift(response.success ? (response.data ?? null) : null);
      })
      .catch(() => { if (!cancelled) setActiveShift(null); });
    return () => { cancelled = true; };
  }, [myStaffProfileId]);

  // POS redesign: resolve my staff-profile id from the staff list so
  // the active-shift lookup above can run. (The salesperson effect
  // deliberately skips the register layout, so this is separate.)
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    apiService.getStaff()
      .then((response) => {
        if (cancelled || !response.success) return;
        // The staff endpoint returns a paginated envelope
        // ({ staff, pagination }), not a bare array — reading only
        // the array shape left the shift pill permanently unloaded.
        const rows = Array.isArray(response.data)
          ? response.data
          : (response.data as any)?.staff;
        if (!Array.isArray(rows)) return;
        const mine = rows.find(
          (s: any) => (s.membership?.userId || s.membership?.user?.id) === user.id,
        );
        if (mine?.id) setMyStaffProfileId(mine.id);
      })
      .catch(() => { /* shift pill simply stays hidden */ });
    return () => { cancelled = true; };
  }, [user?.id]);

  // POS redesign: today's real sales for the header's Transactions
  // dialog and the tender totals in the Shift Report dialog.
  const fetchTodaySales = useCallback(async () => {
    setIsLoadingTodaySales(true);
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const branchId = user?.role === 'OWNER'
        ? selectedBranchId || undefined
        : user?.membership?.branchIds?.[0] || user?.branchId || undefined;
      const response = await apiService.getSales({
        startDate: start.toISOString(),
        endDate: new Date().toISOString(),
        branchId,
        companyId: selectedCompanyId || '',
        limit: 100,
      });
      setTodaySales(response.success && Array.isArray(response.data?.sales) ? response.data.sales : []);
    } catch {
      setTodaySales([]);
    } finally {
      setIsLoadingTodaySales(false);
    }
  }, [user, selectedBranchId, selectedCompanyId]);

  // POS Hold: the branch this terminal is selling from — the same
  // resolution the product loader and the sale submit use.
  const resolvePosBranchId = useCallback((): string | undefined => {
    if (user?.role === 'OWNER') return selectedBranchId || undefined;
    return user?.membership?.branchIds?.[0] || user?.branchId || undefined;
  }, [user, selectedBranchId]);

  const fetchParkedSales = useCallback(async () => {
    setIsLoadingParked(true);
    try {
      const response = await apiService.getParkedSales(resolvePosBranchId());
      setParkedSales(response.success && Array.isArray(response.data?.parkedSales) ? response.data.parkedSales : []);
    } catch {
      setParkedSales([]);
    } finally {
      setIsLoadingParked(false);
    }
  }, [resolvePosBranchId]);

  // Clear the rail back to a fresh cart. Mirrors the sale-success
  // reset; used by Hold (after a successful park) and by Resume
  // (before the held cart is loaded). Never touches a parked record —
  // a held order is consumed only by a completed sale or an explicit
  // Discard in the held-orders list.
  const resetPosCart = useCallback(() => {
    setInvoiceItems([]);
    setInvoiceCustomer({ name: "", phone: "" });
    setPosCustomer(null);
    setLoyaltyPointsInput("");
    setSelectedPrescription(null);
    setSalespersonId('');
    setRxSearch("");
    setRxResults([]);
    setShowRxCreate(false);
    setRxForm({ patientName: "", doctorName: "" });
    setRxDosages({});
    setCouponCodeInput("");
    setAppliedCoupon(null);
    setCouponError("");
    setDiscountPercentage(0);
    setPaymentMethod('CASH');
    setPaymentStatus('COMPLETED');
    setPaidAmount(0);
    setSplitEnabled(false);
    setSplitPayments([]);
    setSearchQuery("");
  }, []);

  // Park the current cart server-side (header Hold button). An empty
  // cart is an honest toast — never a fake "held" success.
  const handleParkSale = async () => {
    if (invoiceItems.length === 0) {
      toast({
        title: "Cart is empty",
        description: "There is nothing to hold. Held orders are under Transactions → Held.",
      });
      return;
    }
    const branchId = resolvePosBranchId();
    if (!branchId) {
      toast({
        title: "No branch selected",
        description: "Select a branch before holding this sale.",
        variant: "destructive",
      });
      return;
    }
    setIsParking(true);
    try {
      const cartProductIds = new Set(invoiceItems.map(i => i.productId || i.id));
      const payload = {
        version: 1,
        items: invoiceItems,
        customer: posCustomer,
        walkInCustomer: invoiceCustomer,
        discountPercentage,
        salespersonId: salespersonId || "",
        prescription: selectedPrescription,
        rxDosages,
        coupon: appliedCoupon,
        couponCodeInput,
        loyaltyPointsInput,
        selectedBatches: Object.fromEntries(Object.entries(selectedBatches).filter(([pid]) => cartProductIds.has(pid))),
        selectedVariants: Object.fromEntries(Object.entries(selectedVariants).filter(([pid]) => cartProductIds.has(pid))),
      };
      const itemCount = invoiceItems.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
      const response = await apiService.createParkedSale({
        branchId,
        customerId: posCustomer?.id ?? null,
        label: invoiceCustomer.name || null,
        itemCount,
        grandTotal: mainTotalAfterLoyalty,
        payload,
      });
      if (!response.success) {
        toast({
          title: "Could not hold the sale",
          description: response.message || "Please try again.",
          variant: "destructive",
        });
        return;
      }
      // Parking a NEW cart while a resumed one was loaded abandons the
      // resume — the original held order stays parked, untouched.
      setResumedParkedId(null);
      resetPosCart();
      toast({
        title: "Sale held",
        description: `${itemCount} item${itemCount === 1 ? "" : "s"} • PKR ${mainTotalAfterLoyalty.toFixed(2)} — resume it anytime from Transactions → Held.`,
        duration: 4000,
      });
      fetchParkedSales();
    } catch (error: any) {
      toast({
        title: "Could not hold the sale",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsParking(false);
    }
  };

  // Resume a held order: load its payload back into the rail through
  // the same state the cart was built with, so batch selections,
  // quantities, discounts, customer and prescription return exactly.
  const handleResumeParked = async (parkedId: string) => {
    if (invoiceItems.length > 0) {
      toast({
        title: "Current cart is not empty",
        description: "Hold or clear the current cart before resuming a held order.",
        variant: "destructive",
      });
      return;
    }
    try {
      const response = await apiService.getParkedSale(parkedId);
      const payload: any = response.data?.payload;
      if (!response.success || !payload || !Array.isArray(payload.items)) {
        toast({
          title: "Could not resume",
          description: "This held order could not be loaded.",
          variant: "destructive",
        });
        return;
      }
      resetPosCart();
      setInvoiceItems(payload.items);
      setInvoiceCustomer(payload.walkInCustomer ?? { name: "", phone: "" });
      setPosCustomer(payload.customer ?? null);
      setDiscountPercentage(payload.discountPercentage ?? 0);
      setSalespersonId(payload.salespersonId ?? "");
      setSelectedPrescription(payload.prescription ?? null);
      setRxDosages(payload.rxDosages ?? {});
      setAppliedCoupon(payload.coupon ?? null);
      setCouponCodeInput(payload.couponCodeInput ?? "");
      setLoyaltyPointsInput(payload.loyaltyPointsInput ?? "");
      if (payload.selectedBatches) setSelectedBatches(prev => ({ ...prev, ...payload.selectedBatches }));
      if (payload.selectedVariants) setSelectedVariants(prev => ({ ...prev, ...payload.selectedVariants }));
      setResumedParkedId(parkedId);
      setIsTxnDialogOpen(false);
      toast({
        title: "Held order restored",
        description: "The cart is exactly as it was when held. Complete the sale to finish it.",
      });
    } catch (error: any) {
      toast({
        title: "Could not resume",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDiscardParked = async (parkedId: string) => {
    try {
      const response = await apiService.deleteParkedSale(parkedId);
      if (!response.success) {
        toast({
          title: "Could not discard",
          description: response.message || "Please try again.",
          variant: "destructive",
        });
        return;
      }
      if (resumedParkedId === parkedId) setResumedParkedId(null);
      setParkedSales(prev => prev.filter(p => p.id !== parkedId));
      toast({ title: "Held order discarded" });
    } catch (error: any) {
      toast({
        title: "Could not discard",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  // NOTE: Previously, two useEffects here cleared all user work (productBatches, selectedBatches,
  // filteredProducts, searchQuery) on branch/company change events. They have been removed because
  // they silently destroyed user in-progress work (e.g. 100+ products in an invoice draft).
  // Branch/company switching is a deliberate navigation action handled by MainLayout routing.

  // Create stable reference to product IDs to avoid infinite loops
  const productIdsString = useMemo(() => {
    const ids = filteredProducts.map(p => p.id).sort().join(',');
    return ids;
  }, [filteredProducts.length, filteredProducts.map(p => p.id).sort().join(',')]);

  // Fetch batches for filtered products - CRITICAL: Always fetch when product appears in search
  // FIX: Fetch batches immediately when products are searched, similar to product API call
  useEffect(() => {
    if (filteredProducts.length === 0) {
      return;
    }

    // console.log(`[CreateInvoice] 🔍 Filtered products changed, fetching batches for ${filteredProducts.length} products`);
    // Get current product IDs as a sorted string for comparison
    const currentProductIds = filteredProducts.map(p => p.id).sort().join(',');
    
    // Only process if product IDs have actually changed
    if (currentProductIds === lastProductIdsString.current) {
      return; // Product IDs haven't changed, skip
    }

    // Update the reference
    lastProductIdsString.current = currentProductIds;

    // Fetch batches for products that haven't been fetched yet
    const timeoutId = setTimeout(() => {
    filteredProducts.forEach(product => {
        // Skip if already processed or fetched
        if (processedProductIds.current.has(product.id) || fetchedProducts.has(product.id)) {
          return;
        }
        
        // Skip if already has batches
        if (productBatches[product.id] && productBatches[product.id].length > 0) {
          processedProductIds.current.add(product.id);
          return;
        }
        
        // Skip if currently loading
        if (loadingBatches[product.id]) {
          return;
        }
        
        // Mark as processed immediately to prevent duplicate fetches
        processedProductIds.current.add(product.id);
        // console.log(`[CreateInvoice] ✅ Calling fetchProductBatches for product ${product.id} (${product.name})`);
        fetchProductBatches(product.id);
      });
    }, 100); // Small delay to batch operations

    return () => clearTimeout(timeoutId);
    // Only re-run when product IDs actually change (not when batches are loaded)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredProducts.map(p => p.id).sort().join(',')]);

  // Calculate totals for main invoice
  const mainSubtotal = useMemo(() => {
    return invoiceItems.reduce((sum, item) => sum + item.totalPrice, 0);
  }, [invoiceItems]);

  const mainDiscountAmount = useMemo(() => {
    return (mainSubtotal * discountPercentage) / 100;
  }, [mainSubtotal, discountPercentage]);

  const mainTotalAmount = useMemo(() => {
    return mainSubtotal - mainDiscountAmount;
  }, [mainSubtotal, mainDiscountAmount]);

  // Promotions (Wave B4): the validated coupon's estimated discount
  // sits between the manual discount and loyalty in the pipeline —
  // the same order the server applies — so the loyalty clamp below
  // uses the after-promotion bill. Automatic promotions (no coupon)
  // are not estimated here; the server applies them at checkout and
  // the receipt shows the real figure.
  const promoEstimate = appliedCoupon ? appliedCoupon.estimatedDiscount : 0;
  const mainTotalAfterPromo = Math.max(0, Math.round((mainTotalAmount - promoEstimate) * 100) / 100);

  // Loyalty (Wave B3): the points the cashier typed, clamped to the
  // customer's balance AND to what the discounted bill can absorb —
  // the same two caps the server enforces — and the bill total after
  // the loyalty discount. Everywhere the POS compares money against
  // "the total" (split allocations, change) it must use the
  // after-loyalty figure, because that is the server's totalAmount.
  const loyaltyPointsRequested = Math.max(0, Math.floor(Number(loyaltyPointsInput) || 0));
  const loyaltyMaxPoints = posCustomer
    ? Math.min(posCustomer.loyaltyPoints, Math.floor(mainTotalAfterPromo / (loyaltyPointValue || 1)))
    : 0;
  const loyaltyPointsToUse = Math.min(loyaltyPointsRequested, loyaltyMaxPoints);
  const loyaltyDiscountValue = Math.round(loyaltyPointsToUse * loyaltyPointValue * 100) / 100;
  const mainTotalAfterLoyalty = Math.round((mainTotalAfterPromo - loyaltyDiscountValue) * 100) / 100;

  // Prescriptions (Wave C1): the distinct prescription-only products
  // in the cart, and which of them the attached record does NOT cover
  // (the server enforces the same product-level coverage rule).
  const rxCartProducts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of invoiceItems) {
      if (item.requiresPrescription && item.productId && !seen.has(item.productId)) {
        seen.set(item.productId, item.name);
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [invoiceItems]);
  const rxMissingFromSelected = selectedPrescription
    ? rxCartProducts.filter(p => !(selectedPrescription.items || []).some(i => i.productId === p.id))
    : rxCartProducts;

  // Prescription picker: search the register by patient name / phone.
  useEffect(() => {
    if (rxCartProducts.length === 0 || selectedPrescription) return;
    const term = rxSearch.trim();
    const handle = setTimeout(async () => {
      setRxSearching(true);
      try {
        const response = await apiService.getPrescriptions({
          page: 1,
          limit: 8,
          isActive: true,
          search: term || undefined,
        });
        setRxResults(response.success && response.data ? response.data : []);
      } catch {
        setRxResults([]);
      } finally {
        setRxSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [rxSearch, rxCartProducts.length, selectedPrescription]);

  // Inline-create: record a new prescription for the cart's Rx items
  // without leaving the sale, then attach it.
  const handleCreatePrescriptionInline = async () => {
    if (!rxForm.patientName.trim()) {
      toast({ title: "Patient name required", description: "Enter the patient's name from the paper prescription.", variant: "destructive" });
      return;
    }
    setRxCreating(true);
    try {
      const response = await apiService.createPrescription({
        patientName: rxForm.patientName.trim(),
        patientPhone: invoiceCustomer.phone?.trim() || null,
        doctorName: rxForm.doctorName.trim() || null,
        issuedDate: new Date().toISOString(),
        items: rxCartProducts.map(p => {
          const durationRaw = rxDosages[p.id]?.durationDays?.trim();
          const duration = durationRaw ? parseInt(durationRaw, 10) : NaN;
          return {
            productId: p.id,
            quantity: invoiceItems
              .filter(item => item.productId === p.id)
              .reduce((sum, item) => sum + item.quantity, 0) || 1,
            dosage: rxDosages[p.id]?.dosage?.trim() || null,
            durationDays: Number.isFinite(duration) && duration > 0 ? duration : null,
          };
        }),
      });
      if (response.success && response.data) {
        setSelectedPrescription(response.data);
        setShowRxCreate(false);
        toast({ title: "Prescription recorded", description: `For ${response.data.patientName} — attached to this sale.` });
      } else {
        toast({ title: "Could not record prescription", description: response.message || "Please try again.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Could not record prescription", description: error?.message || "Please try again.", variant: "destructive" });
    } finally {
      setRxCreating(false);
    }
  };

  // A cart or manual-discount change invalidates the coupon estimate.
  useEffect(() => {
    setAppliedCoupon(null);
    setCouponError("");
  }, [invoiceItems, discountPercentage]);

  // Validate the typed coupon against the live cart. The items are
  // mapped with the same rules the sale payload uses (pieces as the
  // quantity, box/unit sale type, per-line discounts) so the estimate
  // matches what the server will grant.
  const handleApplyCoupon = async () => {
    const code = couponCodeInput.trim().toUpperCase();
    if (!code) return;
    if (invoiceItems.length === 0) {
      setCouponError("Add items to the cart first.");
      return;
    }
    setCouponBusy(true);
    setCouponError("");
    try {
      const items = invoiceItems.map((item) => {
        let productId = item.productId;
        if (!productId && item.id) {
          const uuidMatch = item.id.match(/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
          if (uuidMatch) {
            productId = uuidMatch[1];
          } else {
            const product = products.find(p => p.name === item.name);
            if (product) productId = product.id;
          }
        }
        const isBoxSale = (item.unitType || '').toString().toLowerCase() === 'box' || (item.unitType || '').toString().toLowerCase() === 'pack';
        const productForUnits = products.find(p => p.id === productId);
        const resolvedUnitsPerBox = item.unitsPerBox || productForUnits?.unitsPerBox || productForUnits?.unitsPerPack || 1;
        // Unit engine (Wave C2): leveled lines validate in the C2
        // contract, matching the sale payload below.
        if (item.unitLevel && item.unitFactor) {
          return {
            productId: productId || '',
            quantity: item.levelQuantity ?? item.quantity / item.unitFactor,
            unitLevel: item.unitLevel,
            saleType: isBoxSale ? 'BOX' : 'UNIT',
            unitsPerBox: resolvedUnitsPerBox,
            unitsDeducted: item.quantity,
            unitPrice: item.unitPrice,
            discountPercentage: item.discountPercentage || undefined,
            discountAmount: item.discountAmount || undefined,
          };
        }
        return {
          productId: productId || '',
          quantity: item.quantity,
          saleType: isBoxSale ? 'BOX' : 'UNIT',
          unitsPerBox: resolvedUnitsPerBox,
          unitsDeducted: item.quantity,
          unitPrice: item.unitPrice,
          discountPercentage: item.discountPercentage || undefined,
          discountAmount: item.discountAmount || undefined,
        };
      }).filter((entry) => entry.productId);
      const response = await apiService.validateCoupon({
        code,
        items,
        discountPercentage: discountPercentage || 0,
      });
      if (response.success && response.data?.valid && response.data.promotion) {
        setAppliedCoupon({
          code: response.data.promotion.code || code,
          name: response.data.promotion.name,
          estimatedDiscount: response.data.estimatedTotalPromotionDiscount ?? response.data.estimatedDiscount ?? 0,
        });
      } else {
        setAppliedCoupon(null);
        setCouponError(response.data?.reason || response.message || "This code could not be applied.");
      }
    } catch (error: any) {
      setAppliedCoupon(null);
      setCouponError(error?.message || "Could not check this code. Please try again.");
    } finally {
      setCouponBusy(false);
    }
  };

  // Fetch the loyalty point value once (settings row
  // `loyaltyPointValue`, PKR per point; default 1 when unset).
  useEffect(() => {
    let cancelled = false;
    apiService.getSettings()
      .then((response) => {
        if (!cancelled && response.success && response.data) {
          const parsed = parseFloat(String((response.data as any).loyaltyPointValue ?? ''));
          if (Number.isFinite(parsed) && parsed > 0) {
            setLoyaltyPointValue(parsed);
          }
          const rawBarcodeScanning = (response.data as any).barcodeScanningEnabled;
          setBarcodeScanningSetting(
            rawBarcodeScanning === null || rawBarcodeScanning === undefined
              ? null
              : String(rawBarcodeScanning)
          );
        }
      })
      .catch(() => { /* keep the default of 1 PKR per point */ });
    return () => { cancelled = true; };
  }, []);

  // Resolve the customer behind the entered phone so their points
  // balance can be offered. Phone is unique per customer; the match
  // must be exact (digits compared) so a partial number never
  // surfaces someone else's balance. Failures leave the walk-in flow
  // untouched.
  useEffect(() => {
    const phone = invoiceCustomer.phone.trim();
    if (phone.replace(/\D/g, '').length < 7) {
      setPosCustomer(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      apiService.getCustomers({ search: phone, limit: 10 })
        .then((response) => {
          if (cancelled || !response.success || !response.data) return;
          const digits = (value: string) => value.replace(/\D/g, '');
          const match = response.data.customers.find(
            (c) => digits(c.phone) === digits(phone)
          );
          setPosCustomer(match
            ? { id: match.id, name: match.name, phone: match.phone, loyaltyPoints: match.loyaltyPoints || 0 }
            : null);
        })
        .catch(() => { if (!cancelled) setPosCustomer(null); });
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [invoiceCustomer.phone]);

  // A different customer (or none) means a fresh points choice.
  useEffect(() => {
    setLoyaltyPointsInput("");
  }, [posCustomer?.id]);

  // Credit limit (khata, gap item 7): the selected customer's khata
  // balance + limit, so the payment dialog can warn before the sale
  // is rung and the server blocks it with 402. A new customer clears
  // any stale over-limit block from the previous one.
  useEffect(() => {
    setCreditLimitBlock(null);
    if (!posCustomer?.id) { setKhataCredit(null); return; }
    let cancelled = false;
    apiService.getCustomerLedger(posCustomer.id, { page: 1, limit: 1 })
      .then((response) => {
        if (cancelled || !response.success || !response.data) return;
        const s = response.data.summary;
        setKhataCredit({ balance: s.balance, creditLimit: s.creditLimit ?? null, availableCredit: s.availableCredit ?? null });
      })
      .catch(() => { if (!cancelled) setKhataCredit(null); });
    return () => { cancelled = true; };
  }, [posCustomer?.id]);

  const splitAllocated = splitPayments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const splitRemaining = Math.round((mainTotalAfterLoyalty - splitAllocated) * 100) / 100;

  // Credit limit (khata, gap item 7): the udhaar this sale would add
  // on top of the customer's khata balance.
  const creditDue = Math.round((mainTotalAfterLoyalty - (splitEnabled ? splitAllocated : (paidAmount || 0))) * 100) / 100;

  const updateSplitRow = (index: number, patch: Partial<SplitPaymentRow>) => {
    setSplitPayments(prev => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const removeSplitRow = (index: number) => {
    setSplitPayments(prev => prev.filter((_, i) => i !== index));
  };
  const addSplitRow = () => {
    setSplitPayments(prev => [
      ...prev,
      { method: 'CASH', amount: splitRemaining > 0 ? splitRemaining : 0, reference: '' },
    ]);
  };
  const toggleSplitPayment = () => {
    if (splitEnabled) {
      setSplitEnabled(false);
      setSplitPayments([]);
    } else {
      setSplitEnabled(true);
      setSplitPayments([{ method: paymentMethod, amount: mainTotalAfterLoyalty || 0, reference: '' }]);
    }
  };

  // Gift cards / eWallet (Wave C9): ledger tender always travels as
  // a split-tender allocation — the card code rides the row's
  // reference and a wallet spend needs the sale customer — while the
  // single-method path has no reference field. Picking one of these
  // methods therefore opens the split editor with a row of that
  // method, instead of leaving the sale un-submittable.
  const selectPaymentMethod = (key: string) => {
    setPaymentMethod(key);
    if ((key === 'GIFT_CARD' || key === 'EWALLET') && !splitEnabled) {
      setSplitEnabled(true);
      setSplitPayments([{ method: key, amount: mainTotalAfterLoyalty || 0, reference: '' }]);
    }
  };

  // Calculate totals for modal invoice
  const modalSubtotal = useMemo(() => {
    return modalInvoiceItems.reduce((sum, item) => sum + item.totalPrice, 0);
  }, [modalInvoiceItems]);

  const modalDiscountAmount = useMemo(() => {
    return (modalSubtotal * modalDiscountPercentage) / 100;
  }, [modalSubtotal, modalDiscountPercentage]);

  const modalTotalAmount = useMemo(() => {
    return modalSubtotal - modalDiscountAmount;
  }, [modalSubtotal, modalDiscountAmount]);

  // Track modal product IDs separately
  const lastModalProductIdsString = useRef<string>('');

  // Fetch batches for modal filtered products
  useEffect(() => {
    if (modalFilteredProducts.length === 0) {
      return;
    }

    // Get current product IDs as a sorted string for comparison
    const currentProductIds = modalFilteredProducts.map(p => p.id).sort().join(',');
    
    // Only process if product IDs have actually changed
    if (currentProductIds === lastModalProductIdsString.current) {
      return; // Product IDs haven't changed, skip
    }

    // Update the reference
    lastModalProductIdsString.current = currentProductIds;

    const timeoutId = setTimeout(() => {
      modalFilteredProducts.forEach(product => {
        // Skip if already processed or fetched
        if (processedProductIds.current.has(product.id) || fetchedProducts.has(product.id)) {
          return;
        }
        
        // Skip if already has batches
        if (productBatches[product.id] && productBatches[product.id].length > 0) {
          processedProductIds.current.add(product.id);
          return;
        }
        
        // Skip if currently loading
        if (loadingBatches[product.id]) {
          return;
        }
        
        // Mark as processed immediately to prevent duplicate fetches
        processedProductIds.current.add(product.id);
        fetchProductBatches(product.id);
      });
    }, 100);

    return () => clearTimeout(timeoutId);
    // Only re-run when product IDs actually change (not when batches are loaded)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalFilteredProducts.map(p => p.id).sort().join(',')]);

  // Get selected batch for a product, or auto-select nearest expiry
  // Product variants (Wave C6): the variant a product card is
  // currently selling. An untouched variant product defaults to its
  // FIRST variant (a variant product is sold by variant); an
  // explicit null selection is the "Standard" base pool.
  const getEffectiveVariant = (product: Product | undefined): ProductVariantLite | null => {
    const variants = product?.variants || [];
    if (!product || variants.length === 0) return null;
    const chosen = selectedVariants[product.id];
    if (chosen === null) return null;
    if (chosen) return variants.find(v => v.id === chosen) || variants[0];
    return variants[0];
  };

  // The batches a line for this product may draw from — the pool of
  // the effective variant (utils/variants.batchInLinePool mirrors
  // the server rule). Variant-less products: all batches, as before.
  // The modal quick-sale passes ignoreVariant (scoped out, C2-style).
  const getPoolBatches = (productId: string, opts?: { ignoreVariant?: boolean }): Batch[] => {
    const batches = productBatches[productId] || [];
    if (opts?.ignoreVariant) return batches;
    const product = products.find(p => p.id === productId);
    if (!product?.variants?.length) return batches;
    const variant = getEffectiveVariant(product);
    return batches.filter(b => batchInLinePool(b.variantId, variant ? variant.id : null, true));
  };

  const getSelectedBatch = (productId: string, opts?: { ignoreVariant?: boolean }): Batch | null => {
    const batches = getPoolBatches(productId, opts);
    if (batches.length === 0) return null;

    const selectedBatchId = selectedBatches[productId];
    if (selectedBatchId) {
      const batch = batches.find(b => b.id === selectedBatchId);
      if (batch && batch.quantity > 0) return batch;
    }

    // Auto-select batch with nearest expiry that has stock
    const availableBatches = batches.filter(b => b.quantity > 0);
    if (availableBatches.length > 0) {
      return availableBatches[0]; // Already sorted by expiry
    }

    return null;
  };

  const loadProducts = async (queryOverride?: string) => {
    try {
      setIsLoading(true);

      const q = (queryOverride ?? searchQuery).trim();
      // POS redesign: the register grid is a BROWSE catalog — an
      // empty query loads the branch's catalog (first page) instead of
      // an empty screen; typing still runs the same server search.
      // An OWNER with no branch chosen keeps the gate: no catalog
      // until a branch is picked (batches are branch-scoped).
      if (user?.role === 'OWNER' && !selectedBranchId) {
        setProducts([]);
        return;
      }

      // Determine which branch to load products from
      let branchId: string | undefined;

      if (user?.role === 'OWNER') {
        // Admin users use selected branch
        if (selectedBranchId) {
          branchId = selectedBranchId;
        } else {
        }
      } else {
        // Regular users use their assigned branch from membership
        branchId = user?.membership?.branchIds?.[0] || user?.branchId || undefined;
      }

      const params: any = { page: 1, limit: 50, companyId: selectedCompanyId || '' };
      if (q) {
        params.search = q;
      }
      if (branchId) {
        params.branchId = branchId;
      }

      const response = await apiService.getProducts(params);
      if (response.success && response.data && Array.isArray(response.data.products)) {
        // Transform the API response to match our Product interface
        const transformedProducts = response.data.products.map((product: any) => ({
          id: product.id,
          name: product.name,
          price: product.price || 0, // Price now comes from batch data
          stock: product.stock || 0, // Stock now comes from batch data
          // Unit-label fix (2026-10-26): the API carries no per-product
          // base-unit word (no unitType column in this tree), so the old
          // 'tablets' fallback LIED on every non-medicine product. The
          // neutral 'unit' keeps cart/receipt rendering non-empty ("UNIT")
          // and behaves identically in every box/pack/strip comparison
          // below; the card itself renders cardUnitChip() from real data.
          unitType: product.unitType || 'unit',
          batch: product.currentBatch?.batchNo || 'BATCH001',
          expiry: product.currentBatch?.expireDate ? new Date(product.currentBatch.expireDate).toLocaleDateString() : 'Dec 2025',
          formula: product.formula || '', // Product formula/composition for search
          barcode: product.barcode || '',
          categoryId: product.category?.id || product.categoryId || undefined,
          categoryName: product.category?.name || undefined,
          minStock: product.minStock ?? 0,
          reorderLevel: product.reorderLevel ?? null,
          requiresPrescription: product.requiresPrescription || false,
          unitsPerPack: product.unitsPerPack || product.unitsPerBox || product.currentBatch?.unitsPerBox || product.batches?.[0]?.unitsPerBox || 1,
          unitsPerBox: product.unitsPerBox || product.unitsPerPack || product.currentBatch?.unitsPerBox || product.batches?.[0]?.unitsPerBox || 1,
          unitsPerStrip: product.unitsPerStrip ?? null,
          variants: Array.isArray(product.variants) ? product.variants : []
        }));

        setProducts(transformedProducts);
      } else {
        setProducts([]);
      }
    } catch (error) {
      setProducts([]);
      toast({
        title: "Error",
        description: "Failed to load products",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getUnitIcon = (unitType: string) => {
    switch (unitType.toLowerCase()) {
      case 'tablets':
      case 'capsules':
        return <Package className="w-4 h-4" />;
      case 'syrup':
        return <Package className="w-4 h-4" />;
      case 'injection':
        return <Package className="w-4 h-4" />;
      default:
        return <Package className="w-4 h-4" />;
    }
  };

  const addToInvoiceCart = (product: Product, quantity: number, unitType: string, opts?: { batchOverride?: Batch | null; variantOverrideId?: string | null }) => {
    // Get the selected batch or auto-select nearest expiry. A
    // barcode scan of a batch-coded label pins its own batch (and
    // variant) instead — the cashier scanned that physical stock.
    const selectedBatch = opts?.batchOverride ?? getSelectedBatch(product.id);

    if (!selectedBatch) {
      toast({
        title: "No Batch Available",
        description: "No available batches found for this product. Please check inventory.",
        variant: "destructive",
      });
      return;
    }

    // Product variants (Wave C6): the line sells the card's
    // effective variant; getSelectedBatch already drew the batch
    // from that variant's pool. The unit price pre-fills as batch
    // price + the variant's delta (the server does not force it —
    // unitPrice flows as sent, like every other line).
    const lineVariant = opts?.variantOverrideId
      ? (product.variants || []).find(v => v.id === opts.variantOverrideId) ?? getEffectiveVariant(product)
      : getEffectiveVariant(product);

    const inferredUnitsPerBox = selectedBatch.totalBoxes && selectedBatch.quantity
      ? Math.round(selectedBatch.quantity / selectedBatch.totalBoxes)
      : 0;
    const resolvedUnitsPerBox = selectedBatch.unitsPerBox && selectedBatch.unitsPerBox > 1
      ? selectedBatch.unitsPerBox
      : (inferredUnitsPerBox || product.unitsPerBox || product.unitsPerPack || 1);
    const unitsPerBox = resolvedUnitsPerBox;
    // Loose / by-weight selling (Stage 1): "kg" is the kilo level —
    // the pack IS the kilo (1000 g). A kilo add is refused in
    // business types where weight selling does not belong (the API
    // would 400 the sale anyway); the KG button is hidden there, so
    // this only fires for scan/search adds of a KG product.
    const normalizedUnitType = (unitType || "").toString().toLowerCase();
    const isKgSale = normalizedUnitType === "kg";
    if (isKgSale && !isWeightSellingAllowed) {
      toast({
        title: "Not available",
        description: "Weight selling is not available for this business type.",
        variant: "destructive",
      });
      return;
    }
    const isBoxSale = normalizedUnitType === "box" || normalizedUnitType === "pack";
    const isStripSale = normalizedUnitType === "strip";

    // DEBUG: Log product data to verify unitsPerBox
    // CRITICAL: If box is selected but unitsPerBox is 1, warn the user
    if (isBoxSale && unitsPerBox === 1) {
    }
    // Unit engine (Wave C2): for pack-structured products the line
    // is expressed in a selling LEVEL (pack / strip / tablet). The
    // cart keeps quantity in pieces and unitPrice per LEVEL unit;
    // levelQuantity remembers the entered amount and the submit
    // path sends the C2 payload. Products without pack structure
    // take the exact legacy flow (factor 1, no level fields).
    const resolvedUnitsPerStrip = product.unitsPerStrip && product.unitsPerStrip > 1 ? product.unitsPerStrip : null;
    const isStructuredProduct = (product.unitsPerPack || 0) > 1 || !!resolvedUnitsPerStrip;
    const saleLevel: UnitLevel = (isBoxSale || isKgSale) ? "PACK" : (isStripSale && resolvedUnitsPerStrip ? "STRIP" : "UNIT");
    const levelFactor = saleLevel === "PACK" ? (isKgSale ? KG_GRAMS_PER_KG : unitsPerBox) : saleLevel === "STRIP" ? (resolvedUnitsPerStrip as number) : 1;

    const finalQuantity = isKgSale ? Math.round(quantity * levelFactor) : quantity * levelFactor;
    const finalUnitType = isKgSale ? "kg" : (isBoxSale ? "box" : (isStripSale ? "strip" : product.unitType));
    const batchPrice = variantUnitPrice(selectedBatch.sellingPrice || product.price, lineVariant?.priceDelta);

    // Calculate unit price: per LEVEL unit (batchPrice is per tablet,
    // so a level unit costs batchPrice x its factor)
    const unitPrice = batchPrice * levelFactor;

    // Calculate total price: unitPrice * original quantity (boxes or units)
    const totalPrice = unitPrice * quantity;
    // Validate quantity against batch stock (use finalQuantity which is in pieces)
    if (finalQuantity > selectedBatch.quantity) {
      toast({
        title: "Insufficient Stock",
        description: `Available stock in batch ${selectedBatch.batchNo}: ${selectedBatch.quantity} units.`,
        variant: "destructive",
      });
      return;
    }

    // Find existing item by productId (merge same products regardless
    // of saleType/UNIT/BOX) — Wave C6: and by VARIANT, so two
    // variants of one product stay separate lines with separate
    // stock pools. Variant-less products merge exactly as before.
    const existingItem = invoiceItems.find(item =>
      item.productId === product.id &&
      (item.variantId || null) === (lineVariant ? lineVariant.id : null)
    );

    // Loose / by-weight selling (Stage 1): merging two kilo adds
    // keeps the PACK level (grams add up, per-kg price averages) —
    // the legacy merge below would normalize the line to per-gram
    // UNIT pricing and lose the kg display.
    if (existingItem && existingItem.unitType === "kg") {
      const totalUnits = existingItem.quantity + finalQuantity;
      if (totalUnits > selectedBatch.quantity) {
        toast({
          title: "Insufficient Stock",
          description: `Available stock in batch ${selectedBatch.batchNo}: ${selectedBatch.quantity} units.`,
          variant: "destructive",
        });
        return;
      }
      const addedTotal = unitPrice * quantity; // unitPrice is per-kg here
      const mergedTotal = existingItem.totalPrice + addedTotal;
      const levelQty = totalUnits / KG_GRAMS_PER_KG;
      setInvoiceItems(invoiceItems.map(item => {
        if (item.id === existingItem.id) {
          return {
            ...item,
            quantity: totalUnits,
            levelQuantity: levelQty,
            unitPrice: mergedTotal / levelQty,
            totalPrice: mergedTotal,
            unitType: "kg",
            unitLevel: "PACK" as UnitLevel,
            unitFactor: KG_GRAMS_PER_KG,
            batchUnitPrice: batchPrice,
            batchId: selectedBatch.id,
            batch: selectedBatch.batchNo,
            expiry: selectedBatch.expireDate
              ? new Date(selectedBatch.expireDate).toLocaleDateString()
              : "N/A"
          };
        }
        return item;
      }));
      return;
    }

    if (existingItem) {
      // Convert existing item quantity to units for comparison
      const existingUnits = existingItem.quantity; // Already in pieces
      
      // Calculate new quantity in units
      const newQuantityInUnits = finalQuantity; // Already in pieces
      
      // Total units after merge
      const totalUnits = existingUnits + newQuantityInUnits;

      // Check stock from the selected batch
      if (totalUnits > selectedBatch.quantity) {
        toast({
          title: "Insufficient Stock",
          description: `Available stock in batch ${selectedBatch.batchNo}: ${selectedBatch.quantity} units.`,
          variant: "destructive",
        });
        return;
      }

      // Calculate new unit price (per level unit of the added amount)
      const batchPrice = variantUnitPrice(selectedBatch.sellingPrice || product.price, lineVariant?.priceDelta);
      const newUnitPrice = batchPrice * levelFactor;
      
      // Calculate total price: existing total + new total
      const existingTotalPrice = existingItem.totalPrice;
      const newTotalPrice = newUnitPrice * quantity; // quantity is boxes or units
      const totalPrice = existingTotalPrice + newTotalPrice;

      // Calculate average unit price
      const averageUnitPrice = totalPrice / totalUnits;
      
      // Update existing item - always use UNIT format for merged items
      setInvoiceItems(invoiceItems.map(item => {
        if (item.id === existingItem.id) {
          return {
            ...item,
            quantity: totalUnits,
            unitType: 'UNIT',
            unitsDeducted: totalUnits,
            unitPrice: averageUnitPrice,
            totalPrice: totalPrice,
            // Wave C2: a merged line is plain per-piece pricing again
            unitLevel: undefined,
            unitFactor: undefined,
            levelQuantity: undefined,
            batchUnitPrice: batchPrice,
            // Update batch info to latest batch
            batchId: selectedBatch.id,
            batch: selectedBatch.batchNo,
            expiry: selectedBatch.expireDate
              ? new Date(selectedBatch.expireDate).toLocaleDateString()
              : "N/A"
          };
        }
        return item;
      }));
    } else {
      const expiryDate = selectedBatch.expireDate
        ? new Date(selectedBatch.expireDate).toLocaleDateString()
        : "N/A";

      const newItem: CartItem = {
        id: `${product.id}-${finalUnitType}-${selectedBatch.id}-${Date.now()}`, // Composite ID for React key
        productId: product.id, // CRITICAL FIX: Store actual product ID separately
        name: product.name,
        quantity: finalQuantity, // Store as pieces for inventory tracking
        unitPrice: unitPrice, // Use calculated unit price (per level unit)
        totalPrice: totalPrice, // Total = unitPrice * original quantity (packs/strips/pieces)
        unitType: finalUnitType, // Store "box" if box was selected, otherwise product.unitType
        unitsPerBox: isKgSale ? KG_GRAMS_PER_KG : unitsPerBox,
        unitLevel: isStructuredProduct || isKgSale ? saleLevel : undefined,
        unitFactor: isStructuredProduct || isKgSale ? levelFactor : undefined,
        levelQuantity: isStructuredProduct || isKgSale ? quantity : undefined,
        batchUnitPrice: batchPrice,
        unitsPerPack: isKgSale ? KG_GRAMS_PER_KG : (product.unitsPerPack || unitsPerBox),
        unitsPerStrip: resolvedUnitsPerStrip,
        variantId: lineVariant ? lineVariant.id : null,
        variantName: lineVariant ? lineVariant.name : null,
        batch: selectedBatch.batchNo,
        batchId: selectedBatch.id,
        expiry: expiryDate,
        // A kilo line carries no "Take as directed" instruction.
        instructions: isKgSale ? undefined : (isBoxSale ? "Take as directed" : `Take ${quantity} ${unitType} as directed`),
        discountPercentage: 0,
        discountAmount: 0,
        requiresPrescription: product.requiresPrescription || false
      };
      setInvoiceItems([...invoiceItems, newItem]);
    }
  };

  const updateInvoiceQuantity = (itemId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      setInvoiceItems(invoiceItems.filter(item => item.id !== itemId));
    } else {
      setInvoiceItems(invoiceItems.map(item => {
        if (item.id === itemId) {
          // Wave C2: leveled lines price by the LEVEL quantity
          // (the stepper moves in whole level units = factor pieces).
          if (item.unitLevel && item.unitFactor) {
            const levelQty = newQuantity / item.unitFactor;
            const subtotal = item.unitPrice * levelQty;
            const itemDiscount = item.discountPercentage ? (subtotal * item.discountPercentage / 100) : (item.discountAmount || 0);
            return { ...item, quantity: newQuantity, levelQuantity: levelQty, totalPrice: subtotal - itemDiscount };
          }
          // Find product to get units per box
          const product = products.find(p => p.id === item.productId);
          const unitsPerPack = item.unitsPerBox || product?.unitsPerBox || product?.unitsPerPack || 1;

          // Calculate based on unitType: if box/pack, convert pieces back to boxes
          const packOrPieceQty = (item.unitType === "pack" || item.unitType === "box")
            ? newQuantity / unitsPerPack
            : newQuantity;
          const subtotal = item.unitPrice * packOrPieceQty;
          const itemDiscount = item.discountPercentage ? (subtotal * item.discountPercentage / 100) : (item.discountAmount || 0);
          const totalPrice = subtotal - itemDiscount;
          return { ...item, quantity: newQuantity, totalPrice: totalPrice };
        }
        return item;
      }));
    }
  };

  // Unit engine (Wave C2): switch a cart line's selling level. The
  // entered quantity NUMBER stays (it is now read in the new level),
  // the per-level price re-derives from the batch's per-tablet price,
  // and pieces/total follow.
  const changeCartItemLevel = (itemId: string, level: UnitLevel) => {
    setInvoiceItems(invoiceItems.map(item => {
      if (item.id !== itemId) return item;
      const product = products.find(p => p.id === item.productId);
      // Loose / by-weight selling (Stage 1): a kilo line has one
      // level only (PACK = the kilo) — switching it to strip/unit
      // would silently change grams into tablets.
      const isKgLine = item.unitType === "kg" || isWeightUnitType(product?.unitType);
      if (isKgLine && level !== "PACK") return item;
      const structure = {
        unitsPerPack: item.unitsPerPack || product?.unitsPerPack || item.unitsPerBox || 1,
        unitsPerStrip: item.unitsPerStrip ?? product?.unitsPerStrip ?? null
      };
      const factor = level === "PACK" ? structure.unitsPerPack : level === "STRIP" ? structure.unitsPerStrip : 1;
      if (!factor || factor < 1) return item;
      const levelQty = item.levelQuantity ?? item.quantity / (item.unitFactor || 1);
      const perUnit = item.batchUnitPrice ?? item.unitPrice / (item.unitFactor || 1);
      const unitPrice = levelPriceFromUnitPrice(perUnit, level, structure);
      const subtotal = unitPrice * levelQty;
      const discountAmount = item.discountPercentage ? (subtotal * item.discountPercentage / 100) : (item.discountAmount || 0);
      return {
        ...item,
        unitLevel: level,
        unitFactor: factor,
        levelQuantity: levelQty,
        quantity: Math.round(levelQty * factor),
        unitPrice: unitPrice,
        totalPrice: subtotal - discountAmount,
        discountAmount: discountAmount,
        unitType: isKgLine ? "kg" : (level === "PACK" ? "box" : level === "STRIP" ? "strip" : (product?.unitType || "unit")),
        unitsPerBox: level === "PACK" ? factor : item.unitsPerBox
      };
    }));
  };

  const updateItemDiscount = (itemId: string, discountPercentage: number) => {
    setInvoiceItems(invoiceItems.map(item => {
      if (item.id === itemId) {
        const subtotal = item.unitPrice * (item.levelQuantity ?? item.quantity);
        const discountAmount = discountPercentage > 0 ? (subtotal * discountPercentage / 100) : 0;
        const totalPrice = subtotal - discountAmount;
        return {
          ...item,
          discountPercentage: discountPercentage,
          discountAmount: discountAmount,
          totalPrice: totalPrice
        };
      }
      return item;
    }));
  };

  // Modal Invoice Functions (separate state for quick sales)
  const addToModalCart = (product: Product, quantity: number, unitType: string, opts?: { batchOverride?: Batch | null }) => {
    // Product variants (Wave C6): SCOPED OUT of the modal rail —
    // modal lines stay variant-less and batch selection ignores the
    // main rail's variant choice (the C2 levels precedent). A
    // batch-barcode scan still pins its batch here.
    const selectedBatch = opts?.batchOverride ?? getSelectedBatch(product.id, { ignoreVariant: true });

    if (!selectedBatch) {
      toast({
        title: "No Batch Available",
        description: "No available batches found for this product. Please check inventory.",
        variant: "destructive",
      });
      return;
    }

    const inferredUnitsPerBox = selectedBatch.totalBoxes && selectedBatch.quantity
      ? Math.round(selectedBatch.quantity / selectedBatch.totalBoxes)
      : 0;
    const resolvedUnitsPerBox = selectedBatch.unitsPerBox && selectedBatch.unitsPerBox > 1
      ? selectedBatch.unitsPerBox
      : (inferredUnitsPerBox || product.unitsPerBox || product.unitsPerPack || 1);
    const unitsPerBox = resolvedUnitsPerBox;
    // Loose / by-weight selling (Stage 1): "kg" is the kilo level —
    // the pack IS the kilo (1000 g). Refused in business types
    // where weight selling does not belong (see addToInvoiceCart).
    const normalizedUnitType = (unitType || "").toString().toLowerCase();
    const isKgSale = normalizedUnitType === "kg";
    if (isKgSale && !isWeightSellingAllowed) {
      toast({
        title: "Not available",
        description: "Weight selling is not available for this business type.",
        variant: "destructive",
      });
      return;
    }
    const isBoxSale = normalizedUnitType === "box" || normalizedUnitType === "pack";
    const isStripSale = normalizedUnitType === "strip";
    // Unit engine (Wave C2): for pack-structured products the line
    // is expressed in a selling LEVEL (pack / strip / tablet). The
    // cart keeps quantity in pieces and unitPrice per LEVEL unit;
    // levelQuantity remembers the entered amount and the submit
    // path sends the C2 payload. Products without pack structure
    // take the exact legacy flow (factor 1, no level fields).
    const resolvedUnitsPerStrip = product.unitsPerStrip && product.unitsPerStrip > 1 ? product.unitsPerStrip : null;
    const isStructuredProduct = (product.unitsPerPack || 0) > 1 || !!resolvedUnitsPerStrip;
    const saleLevel: UnitLevel = (isBoxSale || isKgSale) ? "PACK" : (isStripSale && resolvedUnitsPerStrip ? "STRIP" : "UNIT");
    const levelFactor = saleLevel === "PACK" ? (isKgSale ? KG_GRAMS_PER_KG : unitsPerBox) : saleLevel === "STRIP" ? (resolvedUnitsPerStrip as number) : 1;

    const finalQuantity = isKgSale ? Math.round(quantity * levelFactor) : quantity * levelFactor;
    const finalUnitType = isKgSale ? "kg" : (isBoxSale ? "box" : (isStripSale ? "strip" : product.unitType));
    const batchPrice = selectedBatch.sellingPrice || product.price;
    const unitPrice = batchPrice * levelFactor;
    const totalPrice = unitPrice * quantity;

    if (finalQuantity > selectedBatch.quantity) {
      toast({
        title: "Insufficient Stock",
        description: `Available stock in batch ${selectedBatch.batchNo}: ${selectedBatch.quantity} units.`,
        variant: "destructive",
      });
      return;
    }

    const existingItem = modalInvoiceItems.find(item =>
      item.productId === product.id
    );

    // Loose / by-weight selling (Stage 1): merging two kilo adds
    // keeps the PACK level (grams add up, per-kg price averages) —
    // the legacy merge below would normalize to per-gram UNIT pricing.
    if (existingItem && existingItem.unitType === "kg") {
      const totalUnits = existingItem.quantity + finalQuantity;
      if (totalUnits > selectedBatch.quantity) {
        toast({
          title: "Insufficient Stock",
          description: `Available stock in batch ${selectedBatch.batchNo}: ${selectedBatch.quantity} units.`,
          variant: "destructive",
        });
        return;
      }
      const addedTotal = unitPrice * quantity; // unitPrice is per-kg here
      const mergedTotal = existingItem.totalPrice + addedTotal;
      const levelQty = totalUnits / KG_GRAMS_PER_KG;
      setModalInvoiceItems(modalInvoiceItems.map(item => {
        if (item.id === existingItem.id) {
          return {
            ...item,
            quantity: totalUnits,
            levelQuantity: levelQty,
            unitPrice: mergedTotal / levelQty,
            totalPrice: mergedTotal,
            unitType: "kg",
            unitLevel: "PACK" as UnitLevel,
            unitFactor: KG_GRAMS_PER_KG,
            batchUnitPrice: batchPrice,
            batchId: selectedBatch.id,
            batch: selectedBatch.batchNo,
            expiry: selectedBatch.expireDate
              ? new Date(selectedBatch.expireDate).toLocaleDateString()
              : "N/A"
          };
        }
        return item;
      }));
      return;
    }

    if (existingItem) {
      const existingUnits = existingItem.quantity;
      const newQuantityInUnits = finalQuantity;
      const totalUnits = existingUnits + newQuantityInUnits;

      if (totalUnits > selectedBatch.quantity) {
        toast({
          title: "Insufficient Stock",
          description: `Available stock in batch ${selectedBatch.batchNo}: ${selectedBatch.quantity} units.`,
          variant: "destructive",
        });
        return;
      }

      const newUnitPrice = batchPrice * levelFactor;
      const existingTotalPrice = existingItem.totalPrice;
      const newTotalPrice = newUnitPrice * quantity;
      const totalPrice = existingTotalPrice + newTotalPrice;
      const averageUnitPrice = totalPrice / totalUnits;

      setModalInvoiceItems(modalInvoiceItems.map(item => {
        if (item.id === existingItem.id) {
          return {
            ...item,
            quantity: totalUnits,
            unitType: 'UNIT',
            unitsDeducted: totalUnits,
            unitPrice: averageUnitPrice,
            totalPrice: totalPrice,
            // Wave C2: a merged line is plain per-piece pricing again
            unitLevel: undefined,
            unitFactor: undefined,
            levelQuantity: undefined,
            batchUnitPrice: batchPrice,
            batchId: selectedBatch.id,
            batch: selectedBatch.batchNo,
            expiry: selectedBatch.expireDate
              ? new Date(selectedBatch.expireDate).toLocaleDateString()
              : "N/A"
          };
        }
        return item;
      }));
    } else {
      const expiryDate = selectedBatch.expireDate
        ? new Date(selectedBatch.expireDate).toLocaleDateString()
        : "N/A";

      const newItem: CartItem = {
        id: `${product.id}-${finalUnitType}-${selectedBatch.id}-${Date.now()}`,
        productId: product.id,
        name: product.name,
        quantity: finalQuantity,
        unitPrice: unitPrice,
        totalPrice: totalPrice,
        unitType: finalUnitType,
        unitsPerBox: isKgSale ? KG_GRAMS_PER_KG : unitsPerBox,
        unitLevel: isStructuredProduct || isKgSale ? saleLevel : undefined,
        unitFactor: isStructuredProduct || isKgSale ? levelFactor : undefined,
        levelQuantity: isStructuredProduct || isKgSale ? quantity : undefined,
        batchUnitPrice: batchPrice,
        unitsPerPack: isKgSale ? KG_GRAMS_PER_KG : (product.unitsPerPack || unitsPerBox),
        unitsPerStrip: resolvedUnitsPerStrip,
        batch: selectedBatch.batchNo,
        batchId: selectedBatch.id,
        expiry: expiryDate,
        // A kilo line carries no "Take as directed" instruction.
        instructions: isKgSale ? undefined : (isBoxSale ? "Take as directed" : `Take ${quantity} ${unitType} as directed`),
        discountPercentage: 0,
        discountAmount: 0
      };
      setModalInvoiceItems([...modalInvoiceItems, newItem]);
    }
  };

  // ---- Barcode scanning -------------------------------------------------
  // One resolver for every scan source: the USB/Bluetooth wedge
  // (useWedgeScanner below), the camera dialog, and the search box's
  // burst-Enter. A hit goes through the SAME add path as a card tap —
  // FEFO batch choice, prescription flagging and the unit engine
  // included — with the batch pinned when the scanned code belongs
  // to one specific batch. A miss is reported truthfully and offers
  // assignment / product creation (the UnknownBarcodeDialog).
  const scanBusinessType =
    (selectedCompany as any)?.businessType || (user as any)?.company?.businessType || "";
  const barcodeScanningEnabled = resolveBarcodeScanningEnabled(
    barcodeScanningSetting,
    scanBusinessType
  );

  const showScanFeedback = useCallback((kind: "success" | "error", text: string) => {
    setScanFeedback({ kind, text });
    if (scanFeedbackTimer.current) window.clearTimeout(scanFeedbackTimer.current);
    scanFeedbackTimer.current = window.setTimeout(() => setScanFeedback(null), 4000);
  }, []);

  // Map an API batch row onto the POS Batch shape — the same field
  // rules fetchProductBatches applies.
  const toPosBatchFromScan = (batch: any): Batch | null => {
    if (!batch || !batch.id) return null;
    const totalBoxes = batch.totalBoxes || 0;
    const quantity = batch.quantity || batch.totalStock || batch.stockQuantity || 0;
    const computedUnitsPerBox =
      totalBoxes > 0 && quantity > 0 ? Math.round(quantity / totalBoxes) : 0;
    const expireDate = batch.expireDate || batch.expiryDate;
    let expiryStatus: Batch["expiryStatus"] = "GOOD";
    let daysUntilExpiry: number | undefined;
    if (expireDate) {
      daysUntilExpiry = Math.ceil(
        (new Date(expireDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysUntilExpiry < 0) expiryStatus = "EXPIRED";
      else if (daysUntilExpiry <= 7) expiryStatus = "CRITICAL";
      else if (daysUntilExpiry <= 30) expiryStatus = "WARNING";
    }
    return {
      id: batch.id,
      batchNo: batch.batchNo || batch.batchNumber || `BATCH-${batch.id}`,
      quantity,
      variantId: batch.variantId ?? null,
      sellingPrice: batch.sellingPrice || batch.unitPrice || 0,
      unitsPerBox:
        batch.unitsPerBox || (computedUnitsPerBox > 0 ? computedUnitsPerBox : undefined),
      totalBoxes: totalBoxes || undefined,
      expireDate,
      expiryStatus,
      daysUntilExpiry,
    };
  };

  // Map an API product row onto the POS Product shape — the same
  // transform loadProducts applies to the catalog list.
  const toPosProductFromScan = (apiProduct: any): Product => ({
    id: apiProduct.id,
    name: apiProduct.name,
    price: apiProduct.price || 0,
    stock:
      apiProduct.stock ||
      (Array.isArray(apiProduct.batches)
        ? apiProduct.batches.reduce((sum: number, b: any) => sum + (b.quantity || 0), 0)
        : 0),
    // Unit-label fix (2026-10-26): see loadProducts — no 'tablets'
    // fallback; the API returns no unitType in this tree.
    unitType: apiProduct.unitType || "unit",
    batch: apiProduct.batches?.[0]?.batchNo || "BATCH001",
    expiry: apiProduct.batches?.[0]?.expireDate
      ? new Date(apiProduct.batches[0].expireDate).toLocaleDateString()
      : "Dec 2025",
    formula: apiProduct.formula || "",
    barcode: apiProduct.barcode || "",
    categoryId: apiProduct.category?.id || apiProduct.categoryId || undefined,
    categoryName: apiProduct.category?.name || undefined,
    minStock: apiProduct.minStock ?? 0,
    reorderLevel: apiProduct.reorderLevel ?? null,
    requiresPrescription: apiProduct.requiresPrescription || false,
    unitsPerPack:
      apiProduct.unitsPerPack || apiProduct.unitsPerBox || apiProduct.batches?.[0]?.unitsPerBox || 1,
    unitsPerBox:
      apiProduct.unitsPerBox || apiProduct.unitsPerPack || apiProduct.batches?.[0]?.unitsPerBox || 1,
    unitsPerStrip: apiProduct.unitsPerStrip ?? null,
    variants: Array.isArray(apiProduct.variants) ? apiProduct.variants : [],
  });

  // Deliberately NOT memoized: the cart add functions close over the
  // current cart state, so this handler must be rebuilt every render
  // (the wedge hook reads the latest options through a ref).
  const handleBarcodeScanned = async (rawCode: string, target: "main" | "modal" = "main") => {
      const code = (rawCode || "").trim();
      if (!code || !barcodeScanningEnabled) return;

      if (requiresBranchSelection) {
        playScanFailureSound();
        toast({
          title: "Select a branch first",
          description: "Choose the branch above before scanning products.",
          variant: "destructive",
        });
        return;
      }

      let response: any = null;
      try {
        response = await apiService.lookupBarcode(code);
      } catch {
        response = null;
      }
      const resolution = resolveScanLookup(response, code);

      if (resolution.type === "miss") {
        playScanFailureSound();
        showScanFeedback("error", `No product found for barcode ${code}`);
        toast({
          title: "Product not found",
          description: `No product found for barcode ${code}`,
          variant: "destructive",
        });
        setScanTarget(target);
        setUnknownBarcode(code);
        if (target === "main") setSearchQuery("");
        else setModalSearchQuery("");
        return;
      }

      const apiProduct = resolution.product;
      const pinnedBatch =
        resolution.matchType === "batch" ? toPosBatchFromScan(resolution.batch) : null;

      // A batch-coded label on expired stock must not sell.
      if (pinnedBatch && pinnedBatch.expiryStatus === "EXPIRED") {
        playScanFailureSound();
        showScanFeedback("error", `${apiProduct.name} — batch ${pinnedBatch.batchNo} is expired`);
        toast({
          title: "Batch expired",
          description: `${apiProduct.name} — batch ${pinnedBatch.batchNo} has expired and cannot be sold.`,
          variant: "destructive",
        });
        return;
      }

      const product = toPosProductFromScan(apiProduct);

      // Make the scanned product's batches known to the cart
      // machinery (its card may not be in the loaded catalog page).
      // Branch guard: a scan must only ever draw stock from the
      // branch being sold at, never another branch's batch.
      const scannedBatches = (Array.isArray(apiProduct.batches) ? apiProduct.batches : [])
        .filter((b: any) => !b?.branchId || b.branchId === selectedBranch?.id)
        .map(toPosBatchFromScan)
        .filter((b: Batch | null): b is Batch => !!b);
      const allBatches = [...scannedBatches];
      if (pinnedBatch && !allBatches.some((b) => b.id === pinnedBatch.id)) {
        allBatches.push(pinnedBatch);
      }
      if (allBatches.length > 0) {
        setProductBatches((prev) => ({ ...prev, [product.id]: allBatches }));
      }
      if (pinnedBatch) {
        setSelectedBatches((prev) => ({ ...prev, [product.id]: pinnedBatch.id }));
        if (pinnedBatch.variantId) {
          setSelectedVariants((prev) => ({ ...prev, [product.id]: pinnedBatch.variantId }));
        }
      }

      // Batch to sell from: the pinned batch for batch codes; the
      // FEFO batch the lookup returned for product codes — unless the
      // cashier already picked a batch on the product's card, which
      // an unpinned scan respects.
      const fefoBatch =
        resolution.batch && (!resolution.batch.branchId || resolution.batch.branchId === selectedBranch?.id)
          ? toPosBatchFromScan(resolution.batch)
          : null;
      const cashierPickedBatch =
        !!selectedBatches[product.id] && (productBatches[product.id] || []).length > 0;
      const batchOverride =
        pinnedBatch ?? (cashierPickedBatch ? null : fefoBatch);

      if (target === "modal") {
        addToModalCart(product, 1, product.unitType, { batchOverride });
      } else {
        addToInvoiceCart(product, 1, product.unitType, {
          batchOverride,
          variantOverrideId: pinnedBatch?.variantId ?? null,
        });
      }

      playScanSuccessSound();
      showScanFeedback("success", `Added ${product.name}`);
      if (target === "main") setSearchQuery("");
      else setModalSearchQuery("");
  };

  // Wedge capture for the main register. Suspended automatically
  // while any dialog is open (payment / shift / camera / unknown),
  // so a scan can never fire mid-payment.
  useWedgeScanner({
    enabled: barcodeScanningEnabled,
    onScan: (code) => {
      void handleBarcodeScanned(code, "main");
    },
  });

  // Unknown-barcode "create product": the product form lives on the
  // Products page — it opens with this barcode prefilled. Only
  // offered to roles that may create products.
  const handleCreateProductFromScan = (code: string) => {
    const slug = (selectedCompany as any)?.slug;
    if (slug) {
      navigate(
        `/business/${encodeURIComponent(slug)}/products?addBarcode=${encodeURIComponent(code)}`
      );
    }
  };

  const updateModalQuantity = (itemId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      setModalInvoiceItems(modalInvoiceItems.filter(item => item.id !== itemId));
    } else {
      setModalInvoiceItems(modalInvoiceItems.map(item => {
        if (item.id === itemId) {
          // Wave C2: leveled lines price by the LEVEL quantity.
          if (item.unitLevel && item.unitFactor) {
            const levelQty = newQuantity / item.unitFactor;
            const subtotal = item.unitPrice * levelQty;
            const itemDiscount = item.discountPercentage ? (subtotal * item.discountPercentage / 100) : (item.discountAmount || 0);
            return { ...item, quantity: newQuantity, levelQuantity: levelQty, totalPrice: subtotal - itemDiscount };
          }
          const product = products.find(p => p.id === item.productId);
          const unitsPerPack = item.unitsPerBox || product?.unitsPerBox || product?.unitsPerPack || 1;
          const packOrPieceQty = (item.unitType === "pack" || item.unitType === "box")
            ? newQuantity / unitsPerPack
            : newQuantity;
          const subtotal = item.unitPrice * packOrPieceQty;
          const itemDiscount = item.discountPercentage ? (subtotal * item.discountPercentage / 100) : (item.discountAmount || 0);
          const totalPrice = subtotal - itemDiscount;
          return { ...item, quantity: newQuantity, totalPrice: totalPrice };
        }
        return item;
      }));
    }
  };

  const updateModalItemDiscount = (itemId: string, discountPercentage: number) => {
    setModalInvoiceItems(modalInvoiceItems.map(item => {
      if (item.id === itemId) {
        const subtotal = item.unitPrice * (item.levelQuantity ?? item.quantity);
        const discountAmount = discountPercentage > 0 ? (subtotal * discountPercentage / 100) : 0;
        const totalPrice = subtotal - discountAmount;
        return {
          ...item,
          discountPercentage: discountPercentage,
          discountAmount: discountAmount,
          totalPrice: totalPrice
        };
      }
      return item;
    }));
  };

  const createInvoice = async () => {
    if (invoiceItems.length === 0) {
      toast({
        title: "No items selected",
        description: "Please add at least one item to create an invoice.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsLoading(true);
      // Create customer if details provided
      let customerId = null;
      let customerName = "Walk-in Customer";
      let customerPhone = "";

      if (invoiceCustomer.name && invoiceCustomer.phone) {
        customerName = invoiceCustomer.name;
        customerPhone = invoiceCustomer.phone;
      } else if (invoiceCustomer.phone) {
        customerName = invoiceCustomer.name || `Customer-${invoiceCustomer.phone}`;
        customerPhone = invoiceCustomer.phone;
      } else if (invoiceCustomer.name) {
        customerName = invoiceCustomer.name;
        customerPhone = "";
      }
      // Determine branch ID for customer creation
      let customerBranchId: string | undefined;
      if (user?.role === 'OWNER') {
        customerBranchId = selectedBranchId;
      } else {
        customerBranchId = user?.membership?.branchIds?.[0] || user?.branchId;
      }

      // Create customer (optional)
      // CRITICAL FIX: Try to create customer, but if it fails, let the sale endpoint auto-create it
      if (invoiceCustomer.name || invoiceCustomer.phone) {
        try {
          const customerResponse = await apiService.createCustomer({
            name: customerName,
            phone: customerPhone,
            email: "",
            address: "",
            branchId: customerBranchId || user?.branchId || ""
          });

          if (customerResponse.success && customerResponse.data) {
            customerId = customerResponse.data.id;
          } else {
            // Don't set customerId - let sale endpoint auto-create
          }
        } catch (error) {
          // Continue with sale - the sale endpoint will auto-create customer if name/phone provided
          // Don't set customerId - let sale endpoint handle it
        }
      }

      // Calculate totals (using pre-calculated values from useMemo).
      // The total the customer actually pays is AFTER the loyalty
      // discount (Wave B3) — the server computes the same figure —
      // so split validation and change are reckoned against it.
      const subtotal = mainSubtotal;
      const discountAmount = mainDiscountAmount;
      const totalAmount = mainTotalAfterLoyalty;

      // Split tender (Wave B1): build the allocations payload. Rows
      // sharing a method are merged (references joined); the stored
      // paidAmount becomes exactly the allocated sum, which is what
      // the server validates the allocations against.
      let splitPayload: Array<{ method: 'CASH' | 'CARD' | 'JAZZCASH' | 'EASYPAISA' | 'MOBILE' | 'BANK_TRANSFER' | 'GIFT_CARD' | 'EWALLET'; amount: number; reference?: string }> | undefined;
      let effectivePaidAmount = paidAmount || 0;
      if (splitEnabled) {
        const rows = splitPayments.filter(row => (Number(row.amount) || 0) > 0);
        if (rows.length === 0) {
          toast({
            title: "Split payment is empty",
            description: "Add at least one payment row, or turn off split payment.",
            variant: "destructive",
          });
          return;
        }
        const allocated = Math.round(rows.reduce((sum, row) => sum + Number(row.amount), 0) * 100) / 100;
        if (allocated > totalAmount + 0.01) {
          toast({
            title: "Split exceeds the bill",
            description: `Allocated PKR ${allocated.toFixed(2)} is more than the PKR ${totalAmount.toFixed(2)} total.`,
            variant: "destructive",
          });
          return;
        }
        if (paymentStatus === 'COMPLETED' && Math.abs(allocated - totalAmount) > 0.01) {
          toast({
            title: "Split does not balance",
            description: `PKR ${(totalAmount - allocated).toFixed(2)} is still unallocated. A Paid sale must be allocated in full.`,
            variant: "destructive",
          });
          return;
        }
        const merged = new Map<string, { method: 'CASH' | 'CARD' | 'JAZZCASH' | 'EASYPAISA' | 'MOBILE' | 'BANK_TRANSFER' | 'GIFT_CARD' | 'EWALLET'; amount: number; reference?: string }>();
        for (const row of rows) {
          const method = row.method.toUpperCase();
          // Gift cards (Wave C9): one allocation PER CARD — rows for
          // different codes must never merge (their references are
          // distinct card codes, not a joinable note). Same-code rows
          // still merge, amounts summed.
          const key = method === 'GIFT_CARD' ? `GIFT_CARD:${row.reference.trim().toUpperCase()}` : method;
          const existing = merged.get(key);
          if (existing) {
            existing.amount = Math.round((existing.amount + Number(row.amount)) * 100) / 100;
            const ref = row.reference.trim();
            if (ref) existing.reference = existing.reference ? `${existing.reference}, ${ref}` : ref;
          } else {
            merged.set(key, {
              method: method as 'CASH' | 'CARD' | 'JAZZCASH' | 'EASYPAISA' | 'MOBILE' | 'BANK_TRANSFER' | 'GIFT_CARD' | 'EWALLET',
              amount: Number(row.amount),
              reference: row.reference.trim() || undefined,
            });
          }
        }
        splitPayload = [...merged.values()].sort((a, b) => b.amount - a.amount);
        effectivePaidAmount = allocated;
      }

      // Validate required fields
      let branchId: string | undefined;

      if (user?.role === 'OWNER') {
        // Admin users use selected branch
        if (selectedBranchId) {
          branchId = selectedBranchId;
        } else {
          toast({
            title: "Error",
            description: "Please select a branch from the admin dashboard first.",
            variant: "destructive",
          });
          return;
        }
      } else {
        // Regular users use their assigned branch from membership
        branchId = user?.membership?.branchIds?.[0] || user?.branchId;
        if (!branchId) {
          toast({
            title: "Error",
            description: "Branch ID is required. Please contact support.",
            variant: "destructive",
          });
          return;
        }
      }

      // Create sale - match API expected format
      // CRITICAL FIX: Use productId from CartItem (stored when item was added to cart)
      const saleData = {
        items: invoiceItems.map(item => {
          // CRITICAL FIX: Use productId if available, otherwise try to extract from composite id
          let productId = item.productId;

          if (!productId && item.id) {
            // Fallback: Try to extract UUID pattern from composite id
            // Composite id format: productId-unitType-batchId-timestamp
            // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (36 chars)
            const uuidMatch = item.id.match(/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
            if (uuidMatch) {
              productId = uuidMatch[1];
            } else {
              // Last resort: find product by name (not ideal but better than failing)
              const product = products.find(p => p.name === item.name);
              if (product) {
                productId = product.id;
              }
            }
          }

          if (!productId) {
            throw new Error(`Product ID not found for item: ${item.name}. Please remove and re-add this item.`);
          }

          const isBoxSale = (item.unitType || '').toString().toLowerCase() === 'box' || (item.unitType || '').toString().toLowerCase() === 'pack';
          const productForUnits = products.find(p => p.id === productId);
          const resolvedUnitsPerBox = item.unitsPerBox || productForUnits?.unitsPerBox || productForUnits?.unitsPerPack || 1;
          const normalizedSaleType = isBoxSale ? 'BOX' : 'UNIT';
          
          // CRITICAL FIX: item.quantity is ALWAYS in pieces (units) - stored when item was added to cart
          // For box sales, calculate how many boxes this represents for display
          // But for inventory deduction, ALWAYS use item.quantity (pieces)
          const saleQuantity = isBoxSale && resolvedUnitsPerBox > 1
            ? Math.round(item.quantity / resolvedUnitsPerBox)
            : item.quantity;
          
          // CRITICAL FIX: unitsDeducted should ALWAYS be item.quantity (pieces) - this is what gets deducted from batch
          const unitsDeducted = item.quantity; // Always in pieces

          // Unit engine (Wave C2): leveled lines go out in the C2
          // contract — quantity in the LEVEL, per-level price, level
          // snapshot. The server resolves base units from the
          // product; everything else keeps the legacy payload.
          if (item.unitLevel && item.unitFactor) {
            return {
              productId: productId,
              quantity: item.levelQuantity ?? item.quantity / item.unitFactor,
              unitLevel: item.unitLevel,
              saleType: item.unitLevel === 'PACK' ? 'BOX' : item.unitLevel,
              unitsPerBox: item.unitLevel === 'PACK' ? item.unitFactor : resolvedUnitsPerBox,
              unitsDeducted: item.quantity,
              unitPrice: item.unitPrice,
              // Product variants (Wave C6): levels and variants are
              // orthogonal — a leveled line may also carry a variant.
              variantId: item.variantId || undefined,
              batchId: item.batchId || undefined,
              batchNumber: item.batch || undefined,
              expiryDate: item.expiry || undefined,
              discountPercentage: item.discountPercentage || undefined,
              discountAmount: item.discountAmount || undefined,
              totalPrice: item.totalPrice
            };
          }

          return {
            productId: productId, // CRITICAL FIX: Use actual productId, not composite id
            quantity: unitsDeducted, // CRITICAL FIX: Send unitsDeducted (pieces) as quantity - this is what gets deducted from batch
            saleType: normalizedSaleType,
            unitsPerBox: resolvedUnitsPerBox,
            unitsDeducted: unitsDeducted, // Also send explicitly for backend verification
            unitPrice: item.unitPrice,
            // Product variants (Wave C6): the variant this line
            // sells; the server validates it and pools the stock.
            variantId: item.variantId || undefined,
            batchId: item.batchId || undefined, // Use batchId if available
            batchNumber: item.batch || undefined, // Fallback to batchNumber
            expiryDate: item.expiry || undefined,
            discountPercentage: item.discountPercentage || undefined, // Item-level discount
            discountAmount: item.discountAmount || undefined, // Item-level discount amount
            totalPrice: item.totalPrice // Item total after discount (for verification)
          };
        }),
        customerId: customerId || undefined, // API expects undefined, not null
        // CRITICAL FIX: Include customer name and phone for auto-creation if customerId is not available
        customerName: (!customerId && invoiceCustomer.name) ? invoiceCustomer.name : undefined,
        customerPhone: (!customerId && invoiceCustomer.phone) ? invoiceCustomer.phone : undefined,
        // Loyalty redemption (Wave B3): the points chosen in the rail,
        // already clamped to the customer's balance and the bill. The
        // server re-validates both inside the sale transaction.
        loyaltyPointsToRedeem: loyaltyPointsToUse > 0 ? loyaltyPointsToUse : undefined,
        // Promotions (Wave B4): only the validated coupon CODE travels
        // with the sale — the server re-evaluates every promotion
        // (this coupon, Buy X Get Y, automatic offers) itself.
        couponCode: appliedCoupon ? appliedCoupon.code : undefined,
        // Prescriptions (Wave C1): the register record attached in
        // the rail. The server validates it (exists in this business,
        // not voided, covers the cart's Rx items) and enforces the
        // requirePrescriptionAtPos rule when none is attached.
        prescriptionId: selectedPrescription?.id || undefined,
        // Salesperson attribution (Wave C6): the staff member
        // credited with this sale when it is not the cashier —
        // commissions aggregate on salespersonId ?? cashier.
        salespersonId: salespersonId || undefined,
        // Credit-limit override (gap item 7): set only by the
        // manager override button after a 402 block; the flag is
        // disarmed in the finally below so it applies to exactly
        // one submission and can never leak into the next sale.
        creditLimitOverride: creditLimitOverrideArmed || undefined,
        branchId: branchId,
        // With split tender the server derives the headline method
        // ('MIXED' or the largest allocation) from `payments`; the
        // value sent here is the largest allocation's method.
        paymentMethod: (splitPayload ? splitPayload[0].method : paymentMethod.toUpperCase()) as 'CASH' | 'CARD' | 'JAZZCASH' | 'EASYPAISA' | 'MOBILE' | 'BANK_TRANSFER' | 'GIFT_CARD' | 'EWALLET',
        paymentStatus: paymentStatus.toUpperCase() as 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED',
        ...(splitPayload ? { payments: splitPayload } : {}),
        discountAmount: discountAmount, // Global discount amount
        discountPercentage: discountPercentage || 0, // Global discount percentage
        paidAmount: effectivePaidAmount, // Amount paid by customer (allocated sum when split)
        returnedAmount: splitPayload ? 0 : Math.max(0, (paidAmount || 0) - totalAmount), // Change (single-tender flow only)
        saleDate: new Date().toISOString()
      };
      const saleResponse = await apiService.createSale(saleData);
      if (!saleResponse.success) {
        // Prescriptions (Wave C1): a blocked Rx sale gets a dedicated
        // dialog that points at the Prescription section of the rail,
        // not a bare toast the cashier can miss.
        const saleErrorCode = (saleResponse as any).code as string | undefined;
        if (saleErrorCode && saleErrorCode.startsWith('PRESCRIPTION_')) {
          setRxBlock({
            message: saleResponse.message || "A prescription is required for this sale.",
            products: ((saleResponse as any).data?.products as Array<{ id: string; name: string }>) || [],
          });
          setIsPaymentDialogOpen(false);
          return;
        }
        // Credit limit (gap item 7): an over-limit credit sale is
        // blocked by the server (402) — surface the block INSIDE the
        // payment dialog (which stays open) instead of a bare toast,
        // so an owner/manager can approve the override right there.
        if (saleErrorCode === 'CREDIT_LIMIT_EXCEEDED') {
          const d = (saleResponse as any).data || {};
          setCreditLimitBlock({
            message: saleResponse.message || "This sale exceeds the customer's credit limit.",
            balance: d.balance ?? 0,
            creditLimit: d.creditLimit ?? 0,
            projectedBalance: d.projectedBalance ?? 0,
            overBy: d.overBy ?? 0,
            dueAmount: d.dueAmount ?? 0,
          });
          return;
        }
        const errorMessage = (saleResponse as any).errors ?
          (saleResponse as any).errors.join(', ') :
          saleResponse.message || "Failed to create invoice. Please try again.";

        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
        return;
      }

      // Prescriptions (Wave C1): enforcement was OFF and no record
      // was attached — the sale went through, but the cashier should
      // know Rx items left without a prescription on file.
      if ((saleResponse.data as any)?.prescriptionWarning) {
        toast({
          title: "Sold without a prescription on file",
          description: "This sale contained prescription-only items and no prescription was attached. Attach one next time so the register stays complete.",
          variant: "destructive",
          duration: 6000,
        });
      }

      // Refresh product stock after sale
      loadProducts();

      // Dispatch sale change event to notify inventory system
      window.dispatchEvent(new CustomEvent('saleChanged', {
        detail: {
          action: 'created',
          sale: saleResponse.data
        }
      }));

      // Create receipt data
      const receipt: Receipt = {
        id: saleResponse.data.id,
        receiptNumber: saleResponse.data.receiptNumber || `INV-${Date.now()}`,
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString(),
        cashier: user?.name || "Cashier",
        customer: invoiceCustomer.name || invoiceCustomer.phone ? {
          name: customerName,
          phone: customerPhone,
          email: "",
          address: ""
        } : undefined,
        items: invoiceItems,
        subtotal: subtotal,
        discountAmount: discountAmount,
        discountPercentage: discountPercentage,
        // Loyalty (Wave B3): the server's own figures for this sale,
        // shown on the receipt.
        loyaltyDiscount: saleResponse.data.loyaltyDiscount || 0,
        pointsRedeemed: saleResponse.data.pointsRedeemed || 0,
        pointsEarned: saleResponse.data.pointsEarned || 0,
        // Promotions (Wave B4): the server's figures — the discount
        // and a label (the coupon code when one was used, else the
        // first applied promotion's name). When a promotion applied,
        // the receipt total is the server's stored totalAmount so the
        // printed lines reconcile exactly.
        promotionDiscount: saleResponse.data.promotionDiscount || 0,
        promotionLabel: (saleResponse.data.appliedPromotions && saleResponse.data.appliedPromotions.length > 0)
          ? (saleResponse.data.appliedPromotions.map(p => p.code || p.name).filter(Boolean).join(', ') || undefined)
          : undefined,
        // Tax classes (Wave B5): per-class groups from the server.
        taxBreakdown: saleResponse.data.taxBreakdown || [],
        // Provincial tax (Gap item 1): per-authority lines from the
        // server (empty when no provincial config applied).
        provincialTaxBreakdown: saleResponse.data.provincialTaxBreakdown || [],
        provincialTaxAmount: saleResponse.data.provincialTaxAmount || 0,
        // FBR POS (Wave B7): fiscal fields from the server (status is
        // PENDING at this point when FBR is enabled; the number is
        // filled in by the worker and shows on reprints).
        fbrInvoiceNumber: saleResponse.data.fbrInvoiceNumber ?? null,
        fbrStatus: saleResponse.data.fbrStatus ?? null,
        // Prescriptions (Wave C1): linked register record for the
        // receipt's "Rx: <patient> (Dr. <doctor>)" line.
        prescription: saleResponse.data.prescription ?? null,
        total: (saleResponse.data.promotionDiscount || 0) > 0 && saleResponse.data.totalAmount != null
          ? saleResponse.data.totalAmount
          : totalAmount,
        paymentMethod: splitPayload ? splitPayload.map(p => p.method).join(' + ') : paymentMethod.toUpperCase(),
        paymentStatus: paymentStatus.toUpperCase() === 'COMPLETED' ? 'COMPLETED' : 'PENDING'
      };

      // Set current receipt and show dialog
      setCurrentReceipt(receipt);
      setIsPaymentDialogOpen(false);
      setIsReceiptDialogOpen(true);

      // Success toast
      toast({
        title: "Invoice Created Successfully!",
        description: `Invoice #${receipt.receiptNumber} has been created.`,
        duration: 3000,
      });

      // POS Hold: if this sale began as a resumed held order, consume
      // the parked record now that its invoice exists. A failed sale
      // returns above and never reaches here, so the held order stays
      // parked in that case.
      if (resumedParkedId) {
        const consumedParkedId = resumedParkedId;
        setResumedParkedId(null);
        apiService.deleteParkedSale(consumedParkedId).catch(() => {
          console.warn('[POS Hold] Failed to consume parked sale', consumedParkedId);
        });
      }

      // Reset form but keep the screen open
      setInvoiceItems([]);
      setInvoiceCustomer({ name: "", phone: "" });
      setPosCustomer(null);
      setLoyaltyPointsInput("");
      // Reset the attached prescription for the next sale
      setSelectedPrescription(null);
      // Salesperson attribution (Wave C6): each sale starts
      // un-attributed (the cashier) again.
      setSalespersonId('');
      // Credit limit (gap item 7): a completed sale clears any
      // over-limit block.
      setCreditLimitBlock(null);
      setRxSearch("");
      setRxResults([]);
      setShowRxCreate(false);
      setRxForm({ patientName: "", doctorName: "" });
      setRxDosages({});
      setCouponCodeInput("");
      setAppliedCoupon(null);
      setCouponError("");
      setDiscountPercentage(0);
      setPaymentMethod('CASH');
      setPaymentStatus('COMPLETED');
      setSplitEnabled(false);
      setSplitPayments([]);
      setSearchQuery("");

    } catch (error) {
      toast({
        title: "Error",
        description: `An error occurred while creating the invoice: ${error.message || 'Unknown error'}`,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      // Credit limit (gap item 7): the override flag is one-shot —
      // disarm it after every submission so it can never leak into
      // the next sale.
      setCreditLimitOverrideArmed(false);
    }
  };

  // Create invoice from modal (quick sale)
  const createModalInvoice = async () => {
    if (modalInvoiceItems.length === 0) {
      toast({
        title: "No items selected",
        description: "Please add at least one item to create an invoice.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsLoading(true);

      // Create customer if details provided
      let customerId = null;
      let customerName = "Walk-in Customer";
      let customerPhone = "";

      if (modalInvoiceCustomer.name && modalInvoiceCustomer.phone) {
        customerName = modalInvoiceCustomer.name;
        customerPhone = modalInvoiceCustomer.phone;
      } else if (modalInvoiceCustomer.phone) {
        customerName = modalInvoiceCustomer.name || `Customer-${modalInvoiceCustomer.phone}`;
        customerPhone = modalInvoiceCustomer.phone;
      } else if (modalInvoiceCustomer.name) {
        customerName = modalInvoiceCustomer.name;
        customerPhone = "";
      }

      // Determine branch ID for customer creation
      let customerBranchId: string | undefined;
      if (user?.role === 'OWNER') {
        customerBranchId = selectedBranchId;
      } else {
        customerBranchId = user?.membership?.branchIds?.[0] || user?.branchId;
      }

      // Create customer (optional)
      if (modalInvoiceCustomer.name || modalInvoiceCustomer.phone) {
        try {
          const customerResponse = await apiService.createCustomer({
            name: customerName,
            phone: customerPhone,
            email: "",
            address: "",
            branchId: customerBranchId || user?.branchId || ""
          });

          if (customerResponse.success && customerResponse.data) {
            customerId = customerResponse.data.id;
          }
        } catch (error) {
        }
      }

      // Calculate totals (using pre-calculated values from useMemo)
      const subtotal = modalSubtotal;
      const discountAmount = modalDiscountAmount;
      const totalAmount = modalTotalAmount;

      // Validate required fields
      let branchId: string | undefined;

      if (user?.role === 'OWNER') {
        if (selectedBranchId) {
          branchId = selectedBranchId;
        } else {
          toast({
            title: "Error",
            description: "Please select a branch from the admin dashboard first.",
            variant: "destructive",
          });
          return;
        }
      } else {
        branchId = user?.membership?.branchIds?.[0] || user?.branchId;
        if (!branchId) {
          toast({
            title: "Error",
            description: "Branch ID is required. Please contact support.",
            variant: "destructive",
          });
          return;
        }
      }

      // Create sale
      const saleData = {
        items: modalInvoiceItems.map(item => {
          let productId = item.productId;

          if (!productId && item.id) {
            const uuidMatch = item.id.match(/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
            if (uuidMatch) {
              productId = uuidMatch[1];
            } else {
              const product = products.find(p => p.name === item.name);
              if (product) {
                productId = product.id;
              }
            }
          }

          if (!productId) {
            throw new Error(`Product ID not found for item: ${item.name}. Please remove and re-add this item.`);
          }

          const isBoxSale = (item.unitType || '').toString().toLowerCase() === 'box' || (item.unitType || '').toString().toLowerCase() === 'pack';
          const productForUnits = products.find(p => p.id === productId);
          const resolvedUnitsPerBox = item.unitsPerBox || productForUnits?.unitsPerBox || productForUnits?.unitsPerPack || 1;
          const normalizedSaleType = isBoxSale ? 'BOX' : 'UNIT';
          const saleQuantity = isBoxSale && resolvedUnitsPerBox > 1
            ? Math.round(item.quantity / resolvedUnitsPerBox)
            : item.quantity;
          const unitsDeducted = item.quantity;

          // Unit engine (Wave C2): leveled lines go out in the C2
          // contract — quantity in the LEVEL, per-level price, level
          // snapshot. The server resolves base units from the
          // product; everything else keeps the legacy payload.
          if (item.unitLevel && item.unitFactor) {
            return {
              productId: productId,
              quantity: item.levelQuantity ?? item.quantity / item.unitFactor,
              unitLevel: item.unitLevel,
              saleType: item.unitLevel === 'PACK' ? 'BOX' : item.unitLevel,
              unitsPerBox: item.unitLevel === 'PACK' ? item.unitFactor : resolvedUnitsPerBox,
              unitsDeducted: item.quantity,
              unitPrice: item.unitPrice,
              batchId: item.batchId || undefined,
              batchNumber: item.batch || undefined,
              expiryDate: item.expiry || undefined,
              discountPercentage: item.discountPercentage || undefined,
              discountAmount: item.discountAmount || undefined,
              totalPrice: item.totalPrice
            };
          }

          return {
            productId: productId,
            quantity: unitsDeducted,
            saleType: normalizedSaleType,
            unitsPerBox: resolvedUnitsPerBox,
            unitsDeducted: unitsDeducted,
            unitPrice: item.unitPrice,
            batchId: item.batchId || undefined,
            batchNumber: item.batch || undefined,
            expiryDate: item.expiry || undefined,
            discountPercentage: item.discountPercentage || undefined,
            discountAmount: item.discountAmount || undefined,
            totalPrice: item.totalPrice
          };
        }),
        customerId: customerId || undefined,
        customerName: (!customerId && modalInvoiceCustomer.name) ? modalInvoiceCustomer.name : undefined,
        customerPhone: (!customerId && modalInvoiceCustomer.phone) ? modalInvoiceCustomer.phone : undefined,
        branchId: branchId,
        paymentMethod: modalPaymentMethod.toUpperCase() as 'CASH' | 'CARD' | 'JAZZCASH' | 'EASYPAISA' | 'MOBILE' | 'BANK_TRANSFER' | 'GIFT_CARD' | 'EWALLET',
        paymentStatus: modalPaymentStatus.toUpperCase() as 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED',
        discountAmount: discountAmount,
        discountPercentage: modalDiscountPercentage || 0,
        paidAmount: modalPaidAmount || 0,
        returnedAmount: Math.max(0, (modalPaidAmount || 0) - totalAmount),
        saleDate: new Date().toISOString()
      };

      const saleResponse = await apiService.createSale(saleData);

      if (!saleResponse.success) {
        const errorMessage = (saleResponse as any).errors ?
          (saleResponse as any).errors.join(', ') :
          saleResponse.message || "Failed to create invoice. Please try again.";

        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
        return;
      }

      // Refresh product stock after sale
      loadProducts();

      // Dispatch sale change event
      window.dispatchEvent(new CustomEvent('saleChanged', {
        detail: {
          action: 'created',
          sale: saleResponse.data
        }
      }));

      // Create receipt data
      const receipt: Receipt = {
        id: saleResponse.data.id,
        receiptNumber: saleResponse.data.receiptNumber || `INV-${Date.now()}`,
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString(),
        cashier: user?.name || "Cashier",
        customer: modalInvoiceCustomer.name || modalInvoiceCustomer.phone ? {
          name: customerName,
          phone: customerPhone,
          email: "",
          address: ""
        } : undefined,
        items: modalInvoiceItems,
        subtotal: subtotal,
        discountAmount: discountAmount,
        discountPercentage: modalDiscountPercentage,
        total: totalAmount,
        paymentMethod: modalPaymentMethod.toUpperCase(),
        paymentStatus: modalPaymentStatus.toUpperCase() === 'COMPLETED' ? 'COMPLETED' : 'PENDING'
      };

      // Set current receipt and show dialog
      setCurrentReceipt(receipt);
      setIsReceiptDialogOpen(true);

      // Success toast
      toast({
        title: "Invoice Created Successfully!",
        description: `Invoice #${receipt.receiptNumber} has been created.`,
        duration: 3000,
      });

      // Reset modal form but keep it open
      setModalInvoiceItems([]);
      setModalInvoiceCustomer({ name: "", phone: "" });
      setModalDiscountPercentage(0);
      setModalPaymentMethod('CASH');
      setModalPaymentStatus('COMPLETED');
      setModalPaidAmount(0);
      setModalSearchQuery("");

    } catch (error: any) {
      toast({
        title: "Error",
        description: `An error occurred while creating the invoice: ${error.message || 'Unknown error'}`,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const printReceipt = () => {
    if (!currentReceipt) return;

    // Get pharmacy information
    const companyName = selectedCompany?.name || selectedBranch?.name || 'Zapeera';
    const branchName = selectedBranch?.name || '';
    const companyAddress = selectedCompany?.address || selectedBranch?.address || '';
    const companyPhone = selectedCompany?.phone || selectedBranch?.phone || '';
    const companyEmail = selectedCompany?.email || selectedBranch?.email || '';
    const companyWebsite = 'www.zapeera.pk'; // Default website

    // Generate receipt HTML content with improved design
    const receiptHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Receipt - ${currentReceipt.receiptNumber}</title>
          <style>
          * { box-sizing: border-box; }
            body {
              font-family: 'Arial', sans-serif;
              font-size: 12px;
              line-height: 1.5;
              margin: 0;
              padding: 20px;
              background: white;
              color: black;
              max-width: 400px;
              margin: 0 auto;
            }
            .receipt-header {
              text-align: center;
              border-bottom: 3px solid #2563eb;
              padding-bottom: 15px;
              margin-bottom: 20px;
            }
            .receipt-header h1 {
              margin: 0;
              font-size: 24px;
              font-weight: bold;
              color: #2563eb;
              margin-bottom: 5px;
            }
            .receipt-header .branch-name {
              font-size: 16px;
              font-weight: 600;
              color: #1e40af;
              margin: 5px 0;
            }
            .receipt-header .tagline {
              margin: 5px 0;
              font-size: 11px;
              color: #666;
              font-style: italic;
            }
            .pharmacy-info {
              margin-top: 15px;
              padding-top: 15px;
              border-top: 1px solid #e5e7eb;
              text-align: left;
              font-size: 10px;
              color: #374151;
            }
            .pharmacy-info div {
              margin: 3px 0;
            }
            .receipt-info {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 10px;
              margin-bottom: 15px;
              font-size: 11px;
              background: #f9fafb;
              padding: 10px;
              border-radius: 4px;
            }
            .receipt-info div {
              margin: 2px 0;
            }
            .receipt-info strong {
              color: #1f2937;
            }
            .customer-info {
              margin-bottom: 15px;
              padding: 10px;
              background: #f9fafb;
              border: 1px solid #e5e7eb;
              border-radius: 4px;
              font-size: 11px;
            }
            .customer-info h3 {
              margin: 0 0 8px 0;
              font-size: 12px;
              font-weight: 600;
              color: #1f2937;
            }
            .items {
              margin-bottom: 15px;
            }
            .items h3 {
              margin: 0 0 10px 0;
              font-size: 13px;
              font-weight: 600;
              border-bottom: 2px solid #2563eb;
              padding-bottom: 5px;
              color: #1e40af;
            }
            .item {
              display: flex;
              justify-content: space-between;
              margin-bottom: 10px;
              padding: 8px 0;
              border-bottom: 1px dotted #d1d5db;
            }
            .item-name {
              font-weight: 600;
              font-size: 12px;
              color: #1f2937;
            }
            .item-details {
              font-size: 10px;
              color: #6b7280;
              margin-top: 3px;
            }
            .item-price {
              text-align: right;
              font-weight: 600;
              font-size: 12px;
              color: #1f2937;
            }
            .totals {
              border-top: 2px solid #2563eb;
              padding-top: 10px;
              margin-top: 15px;
            }
            .total-line {
              display: flex;
              justify-content: space-between;
              margin-bottom: 5px;
              font-size: 12px;
            }
            .total-final {
              font-weight: bold;
              font-size: 16px;
              border-top: 2px solid #1e40af;
              padding-top: 8px;
              margin-top: 8px;
              color: #1e40af;
            }
            .payment-info {
              margin-top: 15px;
              padding: 10px;
              background: #eff6ff;
              border: 1px solid #bfdbfe;
              border-radius: 4px;
              font-size: 11px;
            }
            .payment-info strong {
              color: #1e40af;
            }
            .footer {
              text-align: center;
              margin-top: 25px;
              padding-top: 15px;
              border-top: 1px solid #e5e7eb;
            font-size: 9px;
              color: #6b7280;
            }
            .footer p {
              margin: 5px 0;
            }
            .footer .software-note {
              margin-top: 10px;
              font-style: italic;
              color: #9ca3af;
            }
            @media print {
              body { margin: 0; padding: 15px; width: 100%; max-width: 100%; }
              @page { size: A4 auto; margin: 10mm; }
            }
          </style>
        </head>
        <body>
          <div class="receipt-header">
            <h1>${escapeHtml(companyName)}</h1>
            ${branchName ? `<div class="branch-name">${escapeHtml(branchName)}</div>` : ''}
            <div class="tagline">Your Health, Our Priority</div>

            ${companyAddress || companyPhone || companyEmail || companyWebsite ? `
            <div class="pharmacy-info">
              ${companyAddress ? `<div><strong>Address:</strong> ${escapeHtml(companyAddress)}</div>` : ''}
              ${companyPhone ? `<div><strong>Phone:</strong> ${escapeHtml(companyPhone)}</div>` : ''}
              ${companyEmail ? `<div><strong>Email:</strong> ${escapeHtml(companyEmail)}</div>` : ''}
              ${companyWebsite ? `<div><strong>Website:</strong> ${companyWebsite}</div>` : ''}
            </div>
            ` : ''}
          </div>

          <div class="receipt-info">
            <div>
              <strong>Receipt #:</strong> ${currentReceipt.receiptNumber}<br>
              <strong>Date:</strong> ${currentReceipt.date}
            </div>
            <div>
              <strong>Time:</strong> ${currentReceipt.time}<br>
              <strong>Cashier:</strong> ${currentReceipt.cashier}
            </div>
          </div>

          ${currentReceipt.customer ? `
          <div class="customer-info">
            <h3>Customer Information</h3>
            <strong>Name:</strong> ${currentReceipt.customer.name}<br>
            <strong>Phone:</strong> ${currentReceipt.customer.phone}<br>
            ${currentReceipt.customer.email ? `<strong>Email:</strong> ${currentReceipt.customer.email}<br>` : ''}
            ${currentReceipt.customer.address ? `<strong>Address:</strong> ${currentReceipt.customer.address}` : ''}
          </div>
          ` : ''}

          ${currentReceipt.prescription ? `
          <div class="customer-info">
            <strong>Rx:</strong> ${escapeHtml(currentReceipt.prescription.patientName)}${currentReceipt.prescription.doctorName ? ` (Dr. ${escapeHtml(currentReceipt.prescription.doctorName)})` : ''}
          </div>
          ` : ''}

          <div class="items">
            <h3>Items Purchased:</h3>
            ${currentReceipt.items.map(item => {
              const product = products.find(p => p.id === item.productId);
              const unitsPerPack = item.unitsPerBox || product?.unitsPerBox || product?.unitsPerPack || 1;
              let displayQuantity = item.quantity;
              let displayUnitType = item.unitType;
              let displayUnitPrice = item.unitPrice;
              let detailsLine = "";

              // Loose / by-weight selling (Stage 1): a kilo line
              // reads "0.500 kg @ PKR 180.00/kg" — all four numbers,
              // never "500 KG" and never "tablets".
              const isKgLine = item.unitType === "kg" || isWeightUnitType(product?.unitType);
              if (isKgLine && item.unitLevel === "PACK" && item.unitFactor === KG_GRAMS_PER_KG) {
                displayQuantity = item.quantity / KG_GRAMS_PER_KG;
                displayUnitType = "kg";
                displayUnitPrice = item.unitPrice; // Already price per kg
                detailsLine = `${displayQuantity.toFixed(3)} kg @ PKR ${displayUnitPrice.toFixed(2)}/kg`;
              } else if (item.unitType === "pack" || item.unitType === "box") {
                // Convert pieces to boxes for display if unitType is box/pack
                displayQuantity = item.quantity / unitsPerPack;
                displayUnitType = "BOX";
                displayUnitPrice = item.unitPrice; // Already price per box
                detailsLine = `${displayQuantity.toFixed(0)} ${displayUnitType} × PKR ${displayUnitPrice.toFixed(2)}`;
              } else {
                displayUnitType = item.unitType.toUpperCase();
                detailsLine = `${displayQuantity.toFixed(0)} ${displayUnitType} × PKR ${displayUnitPrice.toFixed(2)}`;
              }

              return `
              <div class="item">
                <div>
                  <div class="item-name">${escapeHtml(item.name)}${item.variantName ? ` (${escapeHtml(item.variantName)})` : ''}</div>
                  <div class="item-details">${detailsLine}</div>
                  ${item.instructions ? `<div class="item-details">${escapeHtml(item.instructions)}</div>` : ''}
                </div>
                <div class="item-price">PKR ${item.totalPrice.toFixed(2)}</div>
              </div>
            `;
            }).join('')}
          </div>

          <div class="totals">
            <div class="total-line">
              <span>Subtotal:</span>
              <span>PKR ${currentReceipt.subtotal.toFixed(2)}</span>
            </div>
            ${currentReceipt.discountPercentage && currentReceipt.discountPercentage > 0 ? `
            <div class="total-line" style="color: #16a34a;">
              <span>Discount (${currentReceipt.discountPercentage}%):</span>
              <span>-PKR ${currentReceipt.discountAmount?.toFixed(2) || '0.00'}</span>
            </div>
            ` : ''}
            ${currentReceipt.loyaltyDiscount && currentReceipt.loyaltyDiscount > 0 ? `
            <div class="total-line" style="color: #16a34a;">
              <span>Loyalty Discount (${currentReceipt.pointsRedeemed || 0} pts):</span>
              <span>-PKR ${currentReceipt.loyaltyDiscount.toFixed(2)}</span>
            </div>
            ` : ''}
            ${currentReceipt.promotionDiscount && currentReceipt.promotionDiscount > 0 ? `
            <div class="total-line" style="color: #16a34a;">
              <span>Promotion${currentReceipt.promotionLabel ? ` (${escapeHtml(currentReceipt.promotionLabel)})` : ''}:</span>
              <span>-PKR ${currentReceipt.promotionDiscount.toFixed(2)}</span>
            </div>
            ` : ''}
            ${shouldShowTaxBreakdown(currentReceipt) ? (currentReceipt.taxBreakdown || []).map((line) => `
            <div class="total-line">
              <span>Tax — ${escapeHtml(line.className)} (${Number(line.rate)}%):</span>
              <span>PKR ${Number(line.taxAmount).toFixed(2)}</span>
            </div>
            `).join('') : ''}
            ${(currentReceipt.provincialTaxBreakdown || []).map((line) => `
            <div class="total-line">
              <span>Provincial tax — ${escapeHtml(line.authorityName)} (${escapeHtml(line.authority)}, ${Number(line.rate)}%):</span>
              <span>PKR ${Number(line.taxAmount).toFixed(2)}</span>
            </div>
            `).join('')}
            <div class="total-line total-final">
              <span>TOTAL:</span>
              <span>PKR ${currentReceipt.total.toFixed(2)}</span>
            </div>
          </div>

          <div class="payment-info">
            <strong>Payment Method:</strong> ${currentReceipt.paymentMethod.toUpperCase()}<br>
            <strong>Status:</strong> ${currentReceipt.paymentStatus}
            ${currentReceipt.pointsEarned ? `<br><strong>Loyalty Points Earned:</strong> ${currentReceipt.pointsEarned}` : ''}
          </div>
          ${currentReceipt.fbrInvoiceNumber ? `
          <div class="payment-info" style="text-align: center;">
            <strong>FBR Invoice #:</strong> ${currentReceipt.fbrInvoiceNumber}
            ${currentReceiptQr ? `<br><img src="${currentReceiptQr}" alt="FBR invoice QR" style="width: 110px; height: 110px; margin-top: 6px;">` : ''}
          </div>` : ''}

          <div class="footer">
            <p>Thank you for choosing ${companyName}!</p>
            ${companyPhone ? `<p>For any queries, contact us at: ${companyPhone}</p>` : '<p>For any queries, contact us</p>'}
            <p class="software-note">This invoice is generated using Zapeera A business management software</p>
          </div>
        </body>
      </html>
    `;

    // Create a hidden iframe for printing (works in Electron)
    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = 'none';
    document.body.appendChild(printFrame);

    const frameDoc = printFrame.contentWindow?.document;
    if (frameDoc) {
      frameDoc.open();
      frameDoc.write(receiptHTML);
      frameDoc.close();

      // Wait for content to load, then print
      printFrame.onload = () => {
      setTimeout(() => {
          try {
            printFrame.contentWindow?.focus();
            printFrame.contentWindow?.print();
          } catch (e) {
            // Fallback: Try window.print() on the main window
            const newWindow = window.open('', '_blank');
            if (newWindow) {
              newWindow.document.write(receiptHTML);
              newWindow.document.close();
              setTimeout(() => {
                newWindow.print();
                newWindow.close();
      }, 500);
    }
          }
          // Clean up iframe after printing
          setTimeout(() => {
            document.body.removeChild(printFrame);
          }, 1000);
        }, 300);
      };
    }
  };

  const downloadReceipt = async () => {
    if (!currentReceipt) return;

    try {
      // Generate HTML content for the receipt
      const receiptHTML = generateReceiptHTML(currentReceipt);
      const filename = `receipt-${currentReceipt.receiptNumber}.html`;

      // Check if running in Electron
      if (window.electronAPI?.saveFile) {
        // Use Electron's save dialog
        const result = await window.electronAPI.saveFile({
          content: receiptHTML,
          filename: filename,
          type: 'html'
        });

        if (result.success) {
          toast({
            title: "Receipt Downloaded",
            description: `Receipt saved to: ${result.filePath}`,
          });
        } else if (!result.canceled) {
          throw new Error(result.error || 'Failed to save file');
        }
      } else {
        // Fallback for browser: Use blob download
      const blob = new Blob([receiptHTML], { type: 'text/html' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
        link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(url);

      toast({
        title: "Receipt Downloaded",
        description: "Receipt has been downloaded successfully!",
      });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Error downloading receipt. Please try again.",
        variant: "destructive",
      });
    }
  };

  const generateReceiptHTML = (receipt: Receipt) => {
    const companyName = selectedCompany?.name || selectedBranch?.name || 'Zapeera';
    const branchName = selectedBranch?.name || '';
    const companyAddress = selectedCompany?.address || selectedBranch?.address || '';
    const companyPhone = selectedCompany?.phone || selectedBranch?.phone || '';
    const companyEmail = selectedCompany?.email || selectedBranch?.email || '';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Receipt - ${receipt.receiptNumber}</title>
        <style>
          body {
            font-family: 'Arial', sans-serif;
            font-size: 12px;
            line-height: 1.5;
            margin: 0;
            padding: 20px;
            background: white;
            color: black;
          }
          .receipt-header {
            text-align: center;
            border-bottom: 3px solid #2563eb;
            padding-bottom: 15px;
            margin-bottom: 20px;
          }
          .receipt-header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: bold;
            color: #2563eb;
            margin-bottom: 5px;
          }
          .receipt-header .branch-name {
            font-size: 16px;
            font-weight: 600;
            color: #1e40af;
            margin: 5px 0;
          }
          .receipt-header .tagline {
            margin: 5px 0;
            font-size: 11px;
            color: #666;
            font-style: italic;
          }
          .pharmacy-info {
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid #ddd;
            text-align: left;
            font-size: 10px;
            color: #555;
          }
          .pharmacy-info div {
            margin: 3px 0;
          }
          .receipt-info {
            display: flex;
            justify-content: space-between;
            margin-bottom: 15px;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 5px;
            font-size: 11px;
          }
          .customer-info {
            margin-bottom: 15px;
            padding: 12px;
            background: #f5f5f5;
            border: 1px solid #ddd;
            border-radius: 5px;
          }
          .customer-info h3 {
            margin: 0 0 8px 0;
            font-size: 13px;
            font-weight: bold;
            color: #2563eb;
          }
          .items {
            margin-bottom: 15px;
          }
          .items h3 {
            margin: 0 0 12px 0;
            font-size: 14px;
            font-weight: bold;
            color: #2563eb;
            border-bottom: 2px solid #2563eb;
            padding-bottom: 8px;
          }
          .item {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
            padding: 10px;
            background: #f8f9fa;
            border: 1px solid #e5e7eb;
            border-radius: 5px;
          }
          .item-name {
            font-weight: bold;
            flex: 1;
            font-size: 12px;
          }
          .item-details {
            font-size: 10px;
            color: #666;
            margin-top: 3px;
          }
          .item-price {
            text-align: right;
            font-weight: bold;
            font-size: 14px;
            color: #2563eb;
          }
          .totals {
            border-top: 2px solid #2563eb;
            padding: 15px;
            margin-top: 15px;
            background: #eff6ff;
            border-radius: 5px;
          }
          .total-line {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 12px;
          }
          .total-final {
            font-weight: bold;
            font-size: 18px;
            border-top: 2px solid #2563eb;
            padding-top: 10px;
            margin-top: 10px;
            color: #2563eb;
          }
          .payment-info {
            margin-top: 15px;
            padding: 12px;
            background: linear-gradient(to right, #eff6ff, #dbeafe);
            border: 1px solid #bfdbfe;
            border-radius: 5px;
            font-size: 11px;
          }
          .footer {
            text-align: center;
            margin-top: 25px;
            padding-top: 15px;
            border-top: 2px solid #e5e7eb;
            font-size: 10px;
            color: #666;
          }
          .footer-brand {
            font-weight: 600;
            color: #1e40af;
            margin-bottom: 5px;
          }
          .footer-software {
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid #e5e7eb;
            color: #9ca3af;
            font-style: italic;
          }
        </style>
      </head>
      <body>
        <div class="receipt-header">
          <h1>${escapeHtml(companyName)}</h1>
          ${branchName ? `<div class="branch-name">${escapeHtml(branchName)}</div>` : ''}
          <p class="tagline">Your Health, Our Priority</p>
          ${companyAddress || companyPhone || companyEmail ? `
          <div class="pharmacy-info">
            ${companyAddress ? `<div><strong>Address:</strong> ${escapeHtml(companyAddress)}</div>` : ''}
            ${companyPhone ? `<div><strong>Phone:</strong> ${escapeHtml(companyPhone)}</div>` : ''}
            ${companyEmail ? `<div><strong>Email:</strong> ${escapeHtml(companyEmail)}</div>` : ''}
          </div>
          ` : ''}
        </div>

        <div class="receipt-info">
          <div>
            <strong>Receipt #:</strong> <span style="font-family: monospace;">${receipt.receiptNumber}</span><br>
            <strong>Date:</strong> ${receipt.date}
          </div>
          <div>
            <strong>Time:</strong> ${receipt.time}<br>
            <strong>Cashier:</strong> ${escapeHtml(receipt.cashier)}
          </div>
        </div>

        ${receipt.customer ? `
        <div class="customer-info">
          <h3>Customer Information</h3>
          <strong>Name:</strong> ${escapeHtml(receipt.customer.name)}<br>
          <strong>Phone:</strong> ${escapeHtml(receipt.customer.phone)}<br>
          ${receipt.customer.email ? `<strong>Email:</strong> ${escapeHtml(receipt.customer.email)}<br>` : ''}
          ${receipt.customer.address ? `<strong>Address:</strong> ${escapeHtml(receipt.customer.address)}` : ''}
        </div>
        ` : ''}

        ${receipt.prescription ? `
        <div class="customer-info">
          <strong>Rx:</strong> ${escapeHtml(receipt.prescription.patientName)}${receipt.prescription.doctorName ? ` (Dr. ${escapeHtml(receipt.prescription.doctorName)})` : ''}
        </div>
        ` : ''}

        <div class="items">
          <h3>Items Purchased:</h3>
          ${receipt.items.map(item => {
            const product = products.find(p => p.id === item.productId);
            const unitsPerPack = item.unitsPerBox || product?.unitsPerBox || product?.unitsPerPack || 1;
            let displayQuantity = item.quantity;
            let displayUnitType = item.unitType;
            let displayUnitPrice = item.unitPrice;
            let detailsLine = "";

            // Loose / by-weight selling (Stage 1): a kilo line
            // reads "0.500 kg @ PKR 180.00/kg" — all four numbers,
            // never "BOX (500 tablets)".
            const isKgLine = item.unitType === "kg" || isWeightUnitType(product?.unitType);
            if (isKgLine && item.unitLevel === "PACK" && item.unitFactor === KG_GRAMS_PER_KG) {
              displayQuantity = item.quantity / KG_GRAMS_PER_KG;
              displayUnitType = "kg";
              displayUnitPrice = item.unitPrice; // Already price per kg
              detailsLine = `${displayQuantity.toFixed(3)} kg @ PKR ${displayUnitPrice.toFixed(2)}/kg`;
            } else if (item.unitLevel && item.unitFactor && item.unitFactor > 1) {
              // Wave C2: leveled lines read in their level, with the
              // tablet count alongside ("2 STRIP (20 tablets)").
              displayQuantity = item.quantity / item.unitFactor;
              displayUnitType = `${item.unitLevel === "PACK" ? "BOX" : item.unitLevel} (${item.quantity} tablets)`;
              displayUnitPrice = item.unitPrice;
              detailsLine = `${displayQuantity.toFixed(0)} ${displayUnitType} × PKR ${displayUnitPrice.toFixed(2)}`;
            } else if (item.unitType === "pack" || item.unitType === "box") {
              // Convert pieces to boxes for display if unitType is box/pack
              displayQuantity = item.quantity / unitsPerPack;
              displayUnitType = "BOX";
              displayUnitPrice = item.unitPrice; // Already price per box
              detailsLine = `${displayQuantity.toFixed(0)} ${displayUnitType} × PKR ${displayUnitPrice.toFixed(2)}`;
            } else {
              displayUnitType = item.unitType.toUpperCase();
              detailsLine = `${displayQuantity.toFixed(0)} ${displayUnitType} × PKR ${displayUnitPrice.toFixed(2)}`;
            }

            return `
            <div class="item">
              <div>
                <div class="item-name">${escapeHtml(item.name)}${item.variantName ? ` (${escapeHtml(item.variantName)})` : ''}</div>
                <div class="item-details">${detailsLine}</div>
                ${item.instructions ? `<div class="item-details">${escapeHtml(item.instructions)}</div>` : ''}
              </div>
              <div class="item-price">PKR ${item.totalPrice.toFixed(2)}</div>
            </div>
          `;
          }).join('')}
        </div>

        <div class="totals">
          <div class="total-line">
            <span>Subtotal:</span>
            <span>PKR ${receipt.subtotal.toFixed(2)}</span>
          </div>
          ${receipt.discountPercentage && receipt.discountPercentage > 0 ? `
          <div class="total-line" style="color: #16a34a;">
            <span>Discount (${receipt.discountPercentage}%):</span>
            <span>-PKR ${receipt.discountAmount?.toFixed(2) || '0.00'}</span>
          </div>
          ` : ''}
          <div class="total-line total-final">
            <span>TOTAL:</span>
            <span>PKR ${receipt.total.toFixed(2)}</span>
          </div>
        </div>

        <div class="payment-info">
          <div style="display: flex; justify-content: space-between;">
            <div>
              <strong>Payment Method:</strong> ${receipt.paymentMethod.toUpperCase()}
            </div>
            <div>
              <strong>Status:</strong> <span style="color: ${receipt.paymentStatus === 'COMPLETED' ? '#16a34a' : '#ca8a04'}; font-weight: bold;">${receipt.paymentStatus === 'COMPLETED' ? 'Paid' : 'Unpaid'}</span>
            </div>
          </div>
        </div>

        <div class="footer">
          <p class="footer-brand">Thank you for choosing ${companyName}!</p>
          ${companyPhone ? `<p>For any queries, contact us at: ${companyPhone}</p>` : ''}
          <p style="font-style: italic; margin-top: 5px;">Your Health, Our Priority</p>
          <p class="footer-software">This invoice is generated using Zapeera A business management software</p>
        </div>
      </body>
      </html>
    `;
  };

  // Invoice lookup functionality - Changed to search by invoice number instead of receipt number
  const lookupInvoice = async () => {
    if (!refundInvoiceNumber.trim()) {
      toast({
        title: "Error",
        description: "Please enter an invoice number",
        variant: "destructive",
      });
      return;
    }

    try {
      setInvoiceLookupLoading(true);

      // Make API call to get sales data
      const response = await apiService.getSales({
        limit: 1000,
        startDate: undefined,
        endDate: undefined,
        branchId: undefined,
        companyId: selectedCompanyId || '',
      });

      if (response.success && response.data?.sales) {
        // Find invoice by invoice number (short format: INV-XXXXX)
        const searchNumber = refundInvoiceNumber.trim().toUpperCase();
        const foundInvoice = response.data.sales.find((sale: any) => {
          // Match by invoiceNumber (short format) or fallback to id for backward compatibility
          const invoiceNum = sale.invoiceNumber || sale.id;
          return invoiceNum && (
            invoiceNum.toUpperCase() === searchNumber ||
            invoiceNum.toUpperCase().includes(searchNumber) ||
            sale.id.toLowerCase() === searchNumber.toLowerCase()
          );
        });

        if (foundInvoice) {
          // Transform the sale data to match the expected format
          const transformedInvoice = {
            id: foundInvoice.id,
            invoiceNumber: (foundInvoice as any).invoiceNumber || foundInvoice.id,
            customerId: foundInvoice.customerId,
            userId: foundInvoice.userId,
            branchId: foundInvoice.branchId,
            subtotal: foundInvoice.subtotal,
            taxAmount: foundInvoice.taxAmount,
            discountAmount: foundInvoice.discountAmount,
            totalAmount: foundInvoice.totalAmount,
            paymentMethod: foundInvoice.paymentMethod,
            paymentStatus: foundInvoice.paymentStatus,
            status: foundInvoice.status,
            createdAt: foundInvoice.createdAt,
            updatedAt: foundInvoice.createdAt,
            customer: foundInvoice.customer,
            user: foundInvoice.user,
            branch: foundInvoice.branch,
            items: foundInvoice.items.map((item: any) => ({
              id: item.id,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              batchNumber: item.batchNumber,
              expiryDate: item.expiryDate,
              // Wave C2: stored level snapshot for the quantity label
              unitLevel: item.unitLevel,
              unitFactor: item.unitFactor,
              product: item.product
            })),
            receipts: [],
            receiptNumber: foundInvoice.id
          };

          setFoundInvoice(transformedInvoice);
        } else {
          toast({
            title: "Invoice Not Found",
            description: `Invoice with invoice number "${refundInvoiceNumber}" not found.`,
            variant: "destructive",
          });
        }
      } else {
        toast({
          title: "Error",
          description: "Failed to load invoices. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: 'Error looking up invoice. Please try again.',
        variant: "destructive",
      });
    } finally {
      setInvoiceLookupLoading(false);
    }
  };

  // Refund and return functionality - Changed to use invoice number instead of receipt number
  const processRefund = async () => {
    if (!refundInvoiceNumber.trim()) {
      toast({
        title: "Error",
        description: "Please enter an invoice number",
        variant: "destructive",
      });
      return;
    }

    if (!refundReason.trim()) {
      toast({
        title: "Error",
        description: "Please enter a refund reason",
        variant: "destructive",
      });
      return;
    }

    // Use foundInvoice if available (from lookup), otherwise search again
    let originalSale = null;

    if (foundInvoice && foundInvoice.id) {
      // Use the already found invoice
      originalSale = foundInvoice;
    } else {
      // Search for the invoice if not already found
      try {
        const salesResponse = await apiService.getSales({
          limit: 1000,
          companyId: selectedCompanyId || '',
        });
        if (!salesResponse.success || !salesResponse.data?.sales?.length) {
          toast({
            title: "Error",
            description: "Sale not found with the given invoice number",
            variant: "destructive",
          });
          return;
        }

        // Find the specific sale by invoice number (short format: INV-XXXXX)
        const sales = salesResponse.data.sales;
        const searchNumber = refundInvoiceNumber.trim().toUpperCase();
        originalSale = sales.find((sale: any) => {
          // Match by invoiceNumber (short format) or fallback to id for backward compatibility
          const invoiceNum = sale.invoiceNumber || sale.id;
          return invoiceNum && (
            invoiceNum.toUpperCase() === searchNumber ||
            invoiceNum.toUpperCase().includes(searchNumber) ||
            sale.id.toLowerCase() === searchNumber.toLowerCase()
          );
        });

        if (!originalSale) {
          toast({
            title: "Error",
            description: `Invoice number ${refundInvoiceNumber} not found. Please use "Show Invoice" button first to verify the invoice.`,
            variant: "destructive",
          });
          return;
        }
      } catch (error: any) {
        toast({
          title: "Error",
          description: "Failed to search for invoice. Please try again.",
          variant: "destructive",
        });
        return;
      }
    }

    if (!originalSale) {
      toast({
        title: "Error",
        description: `Invoice number ${refundInvoiceNumber} not found`,
        variant: "destructive",
      });
      return;
    }

    try {
      // Automatically use all items from the original sale for refund
      const itemsToRefund = originalSale.items.map((item: any) => {
        const saleType = (item.saleType || 'UNIT').toString().toUpperCase();
        const resolvedUnitsPerBox = item.unitsPerBox || 1;
        const unitsDeducted = item.unitsDeducted && item.unitsDeducted > 0
          ? item.unitsDeducted
          : (saleType === 'BOX' && resolvedUnitsPerBox > 1 ? item.quantity * resolvedUnitsPerBox : item.quantity);

        return {
        productId: item.productId,
        quantity: item.quantity,
        unitsDeducted: unitsDeducted,
        unitPrice: item.unitPrice,
        reason: refundReason || "Customer requested refund",
        batchId: item.batchId || null, // Include batch ID for stock return
        saleItemId: item.id || null
        };
      });

      const totalRefundAmount = originalSale.totalAmount;

      // Prepare refund data - use invoiceNumber if available, otherwise use sale ID
      const refundData = {
        invoiceNumber: originalSale.invoiceNumber || refundInvoiceNumber.trim(), // Use invoice number for lookup
        originalSaleId: originalSale.id, // Keep for backward compatibility
        refundReason: refundReason || "Customer requested refund",
        items: itemsToRefund,
      };
      // Call the refund API
      const refundResponse = await apiService.createRefund(refundData);
      if (refundResponse.success) {
        toast({
          title: "Refund Processed Successfully",
          description: `Invoice Number: ${refundInvoiceNumber}\nRefund Amount: PKR ${totalRefundAmount.toFixed(2)}\nReason: ${refundReason}\n\nStock has been updated and items are back in inventory.`,
        });

        // Reset refund form
        setRefundInvoiceNumber("");
        setRefundReason("");
        setFoundInvoice(null);
        setIsRefundDialogOpen(false);

        // Refresh products to show updated stock
        loadProducts();

        // Trigger refresh of refunds list by dispatching a custom event
        window.dispatchEvent(new CustomEvent('refundCreated', {
          detail: { refund: refundResponse.data.refund }
        }));
      } else {
        const errorMessage = refundResponse.message || "Failed to process refund. Please try again.";
        // Check if error message contains "already refunded" or check response data for error flag
        const responseData = refundResponse as any;
        const isAlreadyRefunded = errorMessage.toLowerCase().includes('already refunded') 
          || responseData?.error === 'ALREADY_REFUNDED'
          || responseData?.data?.error === 'ALREADY_REFUNDED';
        
        toast({
          title: isAlreadyRefunded ? "Already Refunded" : "Error",
          description: errorMessage,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      const errorMessage = error?.response?.message 
        || error?.response?.data?.message 
        || error?.message 
        || 'Error processing refund. Please try again.';
      
      const isAlreadyRefunded = errorMessage.toLowerCase().includes('already refunded') 
        || error?.response?.error === 'ALREADY_REFUNDED'
        || error?.response?.data?.error === 'ALREADY_REFUNDED';
      
      toast({
        title: isAlreadyRefunded ? "Already Refunded" : "Error",
        description: isAlreadyRefunded ? errorMessage : errorMessage,
        variant: "destructive",
      });
    }
  };

  // CRITICAL FIX: Check if branch is selected for OWNER/ADMIN users
  // MANAGER/CASHIER use their assigned branch from membership
  const requiresBranchSelection = user?.role === 'OWNER' && !selectedBranchId;
  const companyBranches = (allBranches || []).filter((branch: any) => branch.companyId === selectedCompanyId);
  const userBranchId = user?.role === 'OWNER' ? selectedBranchId : (user?.membership?.branchIds?.[0] || user?.branchId);
  // POS redesign: the billing panel's top section is "Patient &
  // Prescription" for pharmacies (the reference layout) and the
  // plain customer block for every other business type.
  const businessType = (selectedCompany as any)?.businessType || (user as any)?.company?.businessType || "";
  const isPharmacyBusiness = businessType === "PHARMACY";
  // Loose / by-weight selling (Stage 1) — business-type scoping
  // (standing rule 2026-10-26): the KG UI (card button, decimal KG
  // input, amount→weight) renders only for general-retail types.
  // The API refuses KG products/sales elsewhere, so the UI must
  // never offer it there either.
  const isWeightSellingAllowed = isWeightSellingAllowedForBusinessType(businessType);

  // L-10 fix (2026-10-26): strip selling only applies to product-selling
  // business types (pharmacy / general store / retail) — the strip
  // selector is hidden on POS cards and cart lines for other types.
  const showStripOption = isBarcodeApplicableBusinessType(businessType);

  // Keyboard shortcuts (POS) — revised map (research, 2026-10-26):
  // tender moved off Alt+digits (Alt+C cash / Alt+B card), so the
  // old capture-phase exception that owned Alt+1/Alt+2 is gone —
  // Alt+1–6 are navigation-only everywhere and the global listener
  // handles them (this listener runs in the normal bubble phase).
  // The matcher skips every binding while the user is typing, except
  // the allowWhileTyping ones (function keys, Alt/Ctrl combos, Ctrl+S),
  // which cannot type characters. Esc is left to Radix dialogs.
  const getCartLineQuantityStep = (line: (typeof invoiceItems)[number]) => {
    const lineProduct = products.find((p: any) => p.id === line.productId);
    const batchForLine = productBatches[line.productId || ""]?.find(
      (batch: any) => batch.id === line.batchId,
    );
    const inferred = batchForLine?.totalBoxes && batchForLine?.quantity
      ? Math.round(batchForLine.quantity / batchForLine.totalBoxes)
      : 0;
    const unitsPerBox =
      line.unitsPerBox && line.unitsPerBox > 1
        ? line.unitsPerBox
        : batchForLine?.unitsPerBox && batchForLine?.unitsPerBox > 1
          ? batchForLine.unitsPerBox
          : inferred || lineProduct?.unitsPerBox || lineProduct?.unitsPerPack || 1;
    const isBox = line.unitType === "pack" || line.unitType === "box";
    return line.unitLevel ? line.unitFactor || 1 : isBox ? unitsPerBox : 1;
  };
  const adjustLastLineQuantity = (direction: 1 | -1) => {
    const last = invoiceItems[invoiceItems.length - 1];
    if (!last) return;
    updateInvoiceQuantity(
      last.id,
      last.quantity + direction * getCartLineQuantityStep(last),
    );
  };
  const isAnyDialogOpen = () =>
    Boolean(document.querySelector('[role="dialog"]'));
  // The payment dialog is NOT blocking for the tender keys: Alt+C/Alt+B
  // select the method INSIDE it. Every other dialog (receipt, help,
  // transactions, …) blocks all POS shortcuts.
  const isBlockingDialogOpen = () =>
    !isPaymentDialogOpen && Boolean(document.querySelector('[role="dialog"]'));
  // Quantity keys work while the search box is focused ONLY when it is
  // empty — the state right after Enter adds an item, when the cashier's
  // hands are on the keyboard and the next action is a quantity tweak.
  // With a query typed, +/− type normally; in any other text field they
  // never hijack typed text.
  const qtyKeyAllowed = () => {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.id === "pos-search-input") {
      return active.value === "";
    }
    return !isTypingTarget(active);
  };
  const isPlainKey = (e: KeyboardEvent) =>
    !e.ctrlKey && !e.metaKey && !e.altKey;
  useKeyboardShortcuts(
    [
      {
        combo: { key: "F2" },
        handler: () => {
          if (isAnyDialogOpen()) return;
          const input = document.getElementById(
            "pos-search-input",
          ) as HTMLInputElement | null;
          input?.focus();
          input?.select();
        },
        allowWhileTyping: true,
      },
      {
        test: (e) =>
          (e.key === "+" || e.key === "=") && isPlainKey(e) && qtyKeyAllowed(),
        handler: () => adjustLastLineQuantity(1),
        allowWhileTyping: true,
      },
      {
        test: (e) =>
          (e.key === "-" || e.key === "_") && isPlainKey(e) && qtyKeyAllowed(),
        handler: () => adjustLastLineQuantity(-1),
        allowWhileTyping: true,
      },
      {
        // F4 = discount (pharmacy standard, Medishelf): focus the
        // invoice discount field. It is a number input, so focus
        // only — select() throws on number inputs.
        combo: { key: "F4" },
        handler: () => {
          if (isAnyDialogOpen()) return;
          if (invoiceItems.length === 0) return;
          document.getElementById("global-discount")?.focus();
        },
        allowWhileTyping: true,
      },
      {
        combo: { key: "F8" },
        handler: () => {
          if (isAnyDialogOpen()) return;
          if (!isParking) handleParkSale();
        },
        allowWhileTyping: true,
      },
      {
        combo: { key: "t", alt: true },
        handler: () => {
          if (isAnyDialogOpen()) return;
          fetchTodaySales();
          fetchParkedSales();
          setIsTxnDialogOpen(true);
        },
        allowWhileTyping: true,
      },
      {
        combo: { key: "c", alt: true },
        handler: () => {
          if (isBlockingDialogOpen()) return;
          if (invoiceItems.length === 0) return;
          setPaymentMethod("CASH");
          setIsPaymentDialogOpen(true);
        },
        allowWhileTyping: true,
      },
      {
        combo: { key: "b", alt: true },
        handler: () => {
          if (isBlockingDialogOpen()) return;
          if (invoiceItems.length === 0) return;
          setPaymentMethod("CARD");
          setIsPaymentDialogOpen(true);
        },
        allowWhileTyping: true,
      },
      {
        test: (e) =>
          isPaymentDialogOpen &&
          /^[1-8]$/.test(e.key) &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey,
        handler: (e) => {
          const option = PAYMENT_METHOD_OPTIONS[Number(e.key) - 1];
          if (option) selectPaymentMethod(option.key);
        },
      },
      {
        // Ctrl+Enter is context-sensitive — one "advance the sale"
        // key: payment dialog closed → Proceed to Payment; dialog
        // open → Complete Sale (same guards as the button).
        combo: { key: "Enter", ctrl: true },
        handler: () => {
          if (isPaymentDialogOpen) {
            if (
              invoiceItems.length === 0 ||
              isLoading ||
              (splitEnabled &&
                (splitRemaining < 0 ||
                  (paymentStatus === "COMPLETED" && splitRemaining !== 0)))
            ) {
              return;
            }
            void createInvoice();
            return;
          }
          if (isAnyDialogOpen()) return;
          if (invoiceItems.length > 0) setIsPaymentDialogOpen(true);
        },
        allowWhileTyping: true,
      },
      {
        // Ctrl+P is context-scoped, never global: the `test` only
        // matches when there is a receipt to print — the open
        // receipt dialog, or the last sale's receipt on the register
        // with no dialog open (reprint). When it does not match, the
        // matcher never preventDefaults, so the browser's own print
        // works as normal everywhere else.
        test: (e) =>
          e.key.toLowerCase() === "p" &&
          e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          !e.shiftKey &&
          (isReceiptDialogOpen || (!isAnyDialogOpen() && !!currentReceipt)),
        handler: () => {
          if (isReceiptDialogOpen) {
            printReceipt();
          } else if (currentReceipt) {
            setIsReceiptDialogOpen(true);
          }
        },
        allowWhileTyping: true,
      },
      {
        // Delete removes the last line (Amber/Odoo behaviour). It is
        // test-gated on qtyKeyAllowed() — the same guard as +/−: it
        // fires from the register state (search focused, query empty)
        // but never steals the key while the user is editing a query
        // or any other text field (there it deletes characters, as
        // normal). Without the gate Delete could never fire at all:
        // focus sits in the search box after every Enter-add.
        test: (e) =>
          e.key === "Delete" &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          qtyKeyAllowed(),
        handler: () => {
          if (isAnyDialogOpen()) return;
          const last = invoiceItems[invoiceItems.length - 1];
          if (last) updateInvoiceQuantity(last.id, 0);
        },
        allowWhileTyping: true,
      },
      {
        // Ctrl+U = add / set customer (Shopify): focus the customer
        // name field — the same target as the "Change Patient" button.
        combo: { key: "u", ctrl: true },
        handler: () => {
          if (isAnyDialogOpen()) return;
          const input = document.getElementById(
            "customerName",
          ) as HTMLInputElement | null;
          input?.focus();
          input?.select();
        },
        allowWhileTyping: true,
      },
      {
        combo: { key: "n" },
        handler: () => {
          if (isReceiptDialogOpen) setIsReceiptDialogOpen(false);
        },
      },
    ],
  );

  return (
    <div className={cn("flex w-full flex-col bg-[#f0f2f7]", registerLayout && "h-full")}>
      {/* POS header — dark register bar (Muhammad's reference layout):
          branding + cashier context pill + live clock + register
          actions. Everything shown is real: the signed-in user, the
          active branch/business, and the user's own active register
          shift when one exists — nothing is invented.
          SINGLE ROW by design (Muhammad 2026-10-25): the row never
          wraps — action labels stay icon-only below 2xl so Back,
          brand, branch select, cashier pill, clock and all actions
          fit at 1280/1440. Order (Muhammad 2026-10-25 23:14): Back |
          brand | Branch select | Cashier | clock | actions. The Back
          button is kept unless the row cannot fit; only then it
          becomes a right-corner ×. */}
      <div className="relative z-20 shrink-0 bg-[#0a1128] px-3 py-2.5 text-white shadow-[0_2px_12px_rgba(10,17,40,0.35)] sm:px-4 lg:px-5">
        {/*
          Mobile header (2026-10-26): below xl the bar is TWO rows —
          row 1 Back | brand | Branch | Cashier, row 2 the actions in a
          horizontally scrollable strip — because the single nowrap row
          measured 494px wide at a 360px viewport and pushed the Scan /
          Refunds / New Invoice buttons 146px off-screen. At xl+ the
          row is EXACTLY the verified single row (Branch first,
          Cashier after, no wrap): the xl: classes below restore it.
        */}
        <div className="flex min-w-0 flex-col gap-2 xl:flex-row xl:flex-nowrap xl:items-center xl:gap-x-1.5 2xl:gap-x-2">
          <div className="flex min-w-0 flex-nowrap items-center gap-x-1.5 2xl:gap-x-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              if (selectedCompany?.slug) {
                navigate(`/business/${encodeURIComponent(selectedCompany.slug)}/dashboard`);
              } else {
                navigate("/");
              }
            }}
            className="h-10 shrink-0 gap-2 rounded-[10px] px-3 text-sm font-semibold text-white/85 hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            <span className="hidden sm:inline">Back</span>
          </Button>
          <div className="flex min-w-0 shrink items-center gap-2">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-[#28c2ce] text-white shadow-[0_4px_14px_rgba(26,82,197,0.45)]">
              <Zap className="h-5 w-5" strokeWidth={2.2} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-[15px] font-extrabold leading-tight tracking-tight">
                  {selectedCompany?.name || "Zapeera"}
                </p>
                <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
                  {registerLayout ? "POS" : "Invoice"}
                </span>
              </div>
              {/* Subtitle hidden below 2xl (fix-up 2026-10-26): it
                  repeats the branch name a third time and truncated
                  to "Zapeera Point of S…" at 1280/1440; hiding it
                  frees the width the brand name needs. */}
              <p className="hidden truncate text-xs leading-tight text-white/60 2xl:block">
                Zapeera {registerLayout ? "Point of Sale" : "Sales"}{selectedBranch?.name ? ` • ${selectedBranch.name}` : ""}
              </p>
            </div>
          </div>

          {/* Branch select FIRST, cashier pill after it (Muhammad 2026-10-25 23:14):
              Back | brand | Branch | Cashier | clock | actions. */}
          {user?.role === 'OWNER' && companyBranches.length > 0 && (
            <Select
              value={selectedBranchId || ""}
              onValueChange={(value) => setSelectedBranchId(value)}
            >
              <SelectTrigger
                aria-label="Active branch"
                title={selectedBranch?.name || "Select branch"}
                // The app's global CSS forces select triggers to a
                // white background (!important), so on the dark bar
                // this reads as a deliberate white pill with dark
                // text rather than fighting the rule.
                className="h-10 w-[148px] shrink-0 rounded-[10px] border-transparent text-sm font-semibold text-[#0a1128] [&>svg]:text-[#4a5578]"
              >
                {/* Short branch name (fix-up 2026-10-26): Radix
                    SelectValue would render the full
                    "Seikho Medicos -…" and truncate it unreadably
                    at 1280. The short name ("DHA" / "Gulberg" /
                    "Main Branch") fits; the full name is on the
                    title tooltip and in the dropdown list below. */}
                {selectedBranch ? (
                  <span className="min-w-0 truncate">{shortBranchName(selectedBranch.name, selectedCompany?.name)}</span>
                ) : (
                  <span className="font-medium text-[#8c95b0]">Select branch</span>
                )}
              </SelectTrigger>
              <SelectContent>
                {companyBranches.map((branch: any) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {user?.role !== 'OWNER' && selectedBranch?.name && (
            <span
              title={selectedBranch.name}
              className="inline-flex h-10 max-w-[220px] shrink-0 items-center gap-2 truncate rounded-[10px] border border-white/15 bg-white/10 px-3.5 text-sm font-semibold text-white"
            >
              <MapPin className="h-4 w-4 shrink-0 text-white/70" strokeWidth={2} />
              <span className="truncate">{shortBranchName(selectedBranch.name, selectedCompany?.name)}</span>
            </span>
          )}
          {/* Center context pill — cashier / real shift. (Fix-up
              2026-10-26: the "Branch: …" segment was removed here —
              it duplicated the dedicated Branch select immediately
              before this pill and its ~130px forced the cashier name
              to truncate. The branch is still shown, first, in the
              select.) */}
          <div className="hidden min-w-0 shrink items-center gap-3 truncate rounded-full bg-white/10 px-3 py-2 text-xs font-medium text-white/85 ring-1 ring-white/10 lg:flex 2xl:px-3.5">
            <span className="inline-flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              Cashier:&nbsp;<span className="max-w-[200px] truncate font-bold text-white">{user?.name || "—"}</span>
            </span>
            {activeShift && (
              <span className="hidden items-center gap-3 2xl:inline-flex">
                <span className="h-4 w-px bg-white/15" />
                <span>
                  Shift:&nbsp;
                  <span className="font-bold text-white">
                    Open since {new Date(activeShift.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </span>
                </span>
                <span className="h-4 w-px bg-white/15" />
                <span>
                  Drawer:&nbsp;
                  <span className="font-bold text-white">
                    PKR {(Number(activeShift.openingBalance || 0) + Number(activeShift.cashIn || 0) - Number(activeShift.cashOut || 0)).toFixed(2)}
                  </span>
                </span>
              </span>
            )}
          </div>

          </div>
          {/* Row 2 on phones (row 1's continuation at xl+): all actions
              icon-only below 2xl as before; the strip scrolls
              horizontally (scrollbar hidden) instead of pushing the
              last buttons off the viewport. */}
          <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden xl:ml-auto xl:shrink-0 xl:flex-nowrap xl:overflow-visible">
            <span className="hidden items-center gap-2 rounded-full bg-white/10 px-3.5 py-2 font-mono text-xs font-semibold tabular-nums text-white ring-1 ring-white/10 md:inline-flex">
              <Clock className="h-3.5 w-3.5 text-white/60" strokeWidth={2} />
              {clockNow.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
              <span className="text-white/40">|</span>
              {clockNow.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <Button
              type="button"
              variant="ghost"
              onClick={handleParkSale}
              disabled={isParking}
              title="Park this cart and serve the next customer — resume it from Transactions → Held"
              className="h-10 gap-2 rounded-[10px] border border-white/15 bg-white/10 px-3 2xl:px-3.5 text-sm font-semibold text-white shadow-none hover:bg-white/15 hover:text-white"
            >
              <PauseCircle className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span className="hidden items-center gap-1.5 2xl:inline-flex">{isParking ? "Holding…" : "Hold"}<Kbd className="border-white/25 bg-white/15 text-white">F8</Kbd></span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => { fetchTodaySales(); fetchParkedSales(); setIsTxnDialogOpen(true); }}
              className="h-10 gap-2 rounded-[10px] border border-white/15 bg-white/10 px-3 2xl:px-3.5 text-sm font-semibold text-white shadow-none hover:bg-white/15 hover:text-white"
            >
              <History className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span className="hidden items-center gap-1.5 2xl:inline-flex">Transactions<Kbd className="border-white/25 bg-white/15 text-white">Alt+T</Kbd></span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => { fetchTodaySales(); setIsShiftDialogOpen(true); }}
              className="h-10 gap-2 rounded-[10px] border border-white/15 bg-white/10 px-3 2xl:px-3.5 text-sm font-semibold text-white shadow-none hover:bg-white/15 hover:text-white"
            >
              <ClipboardList className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span className="hidden 2xl:inline">Shift Report</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => openShortcutsHelp()}
              title="Keyboard shortcuts (?)"
              className="h-10 gap-2 rounded-[10px] border border-white/15 bg-white/10 px-3 2xl:px-3.5 text-sm font-semibold text-white shadow-none hover:bg-white/15 hover:text-white"
            >
              <Keyboard className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span className="hidden items-center gap-1.5 2xl:inline-flex">Shortcuts<Kbd className="border-white/25 bg-white/15 text-white">?</Kbd></span>
            </Button>
            {scanFeedback && (
              <span
                role="status"
                className={cn(
                  // Floating toast under the header (absolute) so the 4s
                  // feedback never widens the single header row and pushes
                  // actions off-screen at 1280/1440.
                  "absolute right-3 top-[calc(100%+8px)] z-30 flex h-10 items-center gap-2 whitespace-nowrap rounded-[10px] border px-3 text-[13px] font-semibold shadow-lg",
                  scanFeedback.kind === "success"
                    ? "border-emerald-500 bg-emerald-600 text-white"
                    : "border-red-500 bg-red-600 text-white"
                )}
              >
                {scanFeedback.kind === "success" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2.2} />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={2.2} />
                )}
                <span className="max-w-[280px] truncate">{scanFeedback.text}</span>
              </span>
            )}
            <Button
              type="button"
              onClick={() => {
                if (barcodeScanningEnabled) {
                  setScanTarget("main");
                  setIsCameraScannerOpen(true);
                } else {
                  document.getElementById("pos-search-input")?.focus();
                }
              }}
              title={
                barcodeScanningEnabled
                  ? "Scan with the camera — a USB/Bluetooth scanner works anytime without this window"
                  : "Barcode scanning is turned off for this business (Settings → POS)"
              }
              className="h-10 gap-2 rounded-[10px] px-4 text-sm font-bold shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-medium"
            >
              <ScanBarcode className="h-4 w-4 shrink-0" strokeWidth={2.2} />
              <span className="hidden 2xl:inline">Scan Barcode</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsRefundDialogOpen(true)}
              className="h-10 gap-2 rounded-[10px] border border-white/15 bg-white/10 px-3 2xl:px-3.5 text-sm font-semibold text-white shadow-none hover:bg-white/15 hover:text-white"
            >
              <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span className="hidden 2xl:inline">Refunds &amp; returns</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsNewSaleDialogOpen(true)}
              className="h-10 gap-2 rounded-[10px] border border-white/15 bg-white/10 px-3 2xl:px-3.5 text-sm font-semibold text-white shadow-none hover:bg-white/15 hover:text-white"
            >
              <Plus className="h-4 w-4 shrink-0 stroke-[2.5]" strokeLinecap="round" />
              <span className="hidden 2xl:inline">New Invoice</span>
            </Button>
          </div>
        </div>
      </div>

      <main className={cn(
        "flex min-h-0 flex-1 flex-col px-4 pt-2 sm:px-5 md:pt-3 lg:px-6",
        // Sticky payment bar (2026-10-27): below md, once the cart has
        // items, the fixed bar takes ~68px at the viewport bottom — the
        // main gets the same room as bottom padding so the bar sits over
        // empty space and never covers a control. Empty cart: no bar, no
        // padding — the default view stays a single viewport exactly.
        invoiceItems.length > 0 ? "pb-[84px] md:pb-4 lg:pb-5" : "pb-4 lg:pb-5",
      )}>
        <div className="flex min-h-0 flex-1 flex-col gap-3 md:gap-4 lg:flex-row lg:items-stretch lg:gap-5">
          {/* Products column — search + results.
              Mobile floor (2026-10-26, mobile POS search fix): the POS page
              is a fixed-height flex column and the cart rail below is
              content-sized, so without a floor this flex-1 column collapsed
              to ~0px on phones — the results grid shrank to 4px (results in
              the DOM but invisible) and after a barcode scan the search box
              itself was clipped away. 480px guarantees ~320px of visible,
              internally-scrollable results below lg; lg:min-h-0 restores the
              desktop behaviour exactly.
              Flyout (2026-10-27): below md the results grid is gone — the
              search input is the only thing in this column and results
              live in the flyout overlay — so the floor starts at md,
              where the in-flow grid still shows. Below md the column is
              content-sized (flex-none) and the cart rail below absorbs
              the leftover height (flex-1), so the search card does not
              stretch into an empty white gap. */}
          <div className="flex min-h-0 min-w-0 flex-none flex-col md:min-h-[480px] md:flex-1 lg:min-h-0 lg:basis-0">
            <ProductSearchSection
              layout="split"
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              filteredProducts={filteredProducts}
              isLoading={isLoading}
              categories={posCategories}
              activeCategoryId={activeCategoryId}
              onSelectCategory={setActiveCategoryId}
              productBatches={productBatches}
              selectedBatches={selectedBatches}
              loadingBatches={loadingBatches}
              requiresBranchSelection={requiresBranchSelection}
              getSelectedBatch={getSelectedBatch}
              getBatchesForProduct={(productId) => getPoolBatches(productId)}
              getEffectiveVariantId={(product) => getEffectiveVariant(product as Product)?.id ?? null}
              onSelectVariant={(productId, variantId) => {
                setSelectedVariants(prev => ({ ...prev, [productId]: variantId }));
              }}
              onSelectBatch={(productId, batchId) => {
                setSelectedBatches(prev => ({ ...prev, [productId]: batchId }));
              }}
              onAddToCart={addToInvoiceCart}
              onScanSubmit={(code) => { void handleBarcodeScanned(code, "main"); }}
              showStripOption={showStripOption}
              isWeightSellingAllowed={isWeightSellingAllowed}
            />
          </div>

          {/* Cart rail — current sale, checkout pinned at the bottom.
              Below md the rail is flex-1 (it absorbs the leftover
              viewport height once the search column went content-sized
              for the flyout); md+ it is content-sized as before. */}
          <aside className="flex min-h-0 w-full flex-1 flex-col md:flex-none lg:w-[400px] xl:w-[420px]">
            <Card className="relative flex min-h-[12rem] flex-1 flex-col overflow-hidden rounded-[20px] border border-[rgba(15,23,60,0.08)] bg-white shadow-[0_2px_16px_rgba(15,23,60,0.04)] lg:h-full">
              <CardContent className="relative flex min-h-0 flex-1 flex-col p-0">
                {/* Rail header */}
                <div className="flex shrink-0 items-center gap-3 border-b border-[rgba(15,23,60,0.06)] px-4 py-2 sm:px-5 md:py-3.5">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-gradient-to-br from-[#1a52c5]/14 to-[#28c2ce]/12 md:h-10 md:w-10">
                    <ShoppingCart className="h-5 w-5 text-[#1a52c5]" strokeWidth={2} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[16px] font-bold leading-tight tracking-tight text-[#0a1128]">Current sale</h3>
                    <p className="text-xs leading-tight text-[#8c95b0]">Line items for this invoice</p>
                  </div>
                  {invoiceItems.length > 0 && (
                    <>
                      <Badge className="rounded-full border-0 bg-[#1a52c5]/10 px-2.5 py-1 text-xs font-bold text-[#1a52c5] hover:bg-[#1a52c5]/14">
                        {invoiceItems.length} {invoiceItems.length === 1 ? "item" : "items"}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setInvoiceItems([]);
                          setDiscountPercentage(0);
                          setPaidAmount(0);
                        }}
                        className="h-8 rounded-lg px-2 text-xs font-semibold text-red-600 hover:bg-red-50 hover:text-red-700"
                      >
                        Clear all
                      </Button>
                    </>
                  )}
                </div>

                {/* Patient & Prescription / Customer — POS redesign:
                    the reference layout puts who the sale is for at
                    the TOP of the billing panel. Same invoiceCustomer
                    state the checkout has always used (sale payload,
                    khata, loyalty lookup, prescription patient). */}
                <div className="shrink-0 border-b border-[rgba(15,23,60,0.06)] px-4 py-2 sm:px-5 md:py-3.5">
                  {/* Mobile flyout (2026-10-27): below md the section
                      title row is hidden — the two fields are
                      placeholder-only and the Change link moves under
                      them (see below the grid). */}
                  <div className="hidden items-center justify-between gap-2 md:flex">
                    <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#8c95b0]">
                      <UserRound className="h-3.5 w-3.5 text-primary" strokeWidth={2.2} />
                      {isPharmacyBusiness ? "Patient & Prescription" : "Customer"}
                    </p>
                    <button
                      type="button"
                      onClick={() => document.getElementById("customerName")?.focus()}
                      className="text-xs font-bold text-primary hover:underline"
                    >
                      {isPharmacyBusiness ? "Change Patient" : "Change"}
                    </button>
                  </div>
                  {/* Mobile flyout (2026-10-27): below md the fields are
                      flat 36px inputs, placeholder-only, no labels —
                      the boxed wrapper + label return at md+. */}
                  <div className="grid grid-cols-2 gap-2 md:mt-2.5">
                    <div className="rounded-xl bg-transparent p-0 ring-0 md:bg-[#f4f6fa] md:px-3 md:py-2 md:ring-1 md:ring-[rgba(15,23,60,0.05)]">
                      <Label htmlFor="customerName" className="hidden text-[10px] font-bold uppercase tracking-wide text-[#8c95b0] md:block">
                        {isPharmacyBusiness ? "Patient Name" : "Customer Name"}
                      </Label>
                      <Input
                        id="customerName"
                        autoComplete="name"
                        placeholder={isPharmacyBusiness ? "Patient name" : "Customer name"}
                        value={invoiceCustomer.name}
                        onChange={(e) => setInvoiceCustomer({ ...invoiceCustomer, name: e.target.value })}
                        className="h-9 rounded-[9px] border border-[rgba(15,23,60,0.1)] bg-[#f8fafc] px-3 text-sm font-bold text-[#0a1128] shadow-none placeholder:font-medium placeholder:text-[#8c95b0] focus-visible:ring-0 md:h-7 md:rounded-none md:border-0 md:bg-transparent md:px-0"
                      />
                    </div>
                    <div className="rounded-xl bg-transparent p-0 ring-0 md:bg-[#f4f6fa] md:px-3 md:py-2 md:ring-1 md:ring-[rgba(15,23,60,0.05)]">
                      <Label htmlFor="customerPhone" className="hidden text-[10px] font-bold uppercase tracking-wide text-[#8c95b0] md:block">
                        {isPharmacyBusiness ? "Phone" : "Phone (WhatsApp)"}
                      </Label>
                      <Input
                        id="customerPhone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="Phone number"
                        value={invoiceCustomer.phone}
                        onChange={(e) => setInvoiceCustomer({ ...invoiceCustomer, phone: e.target.value })}
                        className="h-9 rounded-[9px] border border-[rgba(15,23,60,0.1)] bg-[#f8fafc] px-3 font-mono text-sm font-bold tabular-nums text-[#0a1128] shadow-none placeholder:font-medium placeholder:text-[#8c95b0] focus-visible:ring-0 md:h-7 md:rounded-none md:border-0 md:bg-transparent md:px-0"
                      />
                    </div>
                  </div>
                  <div className="mt-1 flex justify-end md:hidden">
                    <button
                      type="button"
                      onClick={() => document.getElementById("customerName")?.focus()}
                      className="text-xs font-bold text-primary hover:underline"
                    >
                      {isPharmacyBusiness ? "Change Patient" : "Change"}
                    </button>
                  </div>
                  {selectedPrescription && (
                    <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-medium text-[#4a5578]">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2} />
                      <span>
                        Rx attached: <span className="font-bold text-[#0a1128]">{(selectedPrescription as any).patientName || "Patient"}</span>
                        {(selectedPrescription as any).doctorName ? <> (Dr. {(selectedPrescription as any).doctorName})</> : null}
                      </span>
                      <button
                        type="button"
                        onClick={() => document.getElementById("pos-prescription-section")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                        className="font-bold text-primary hover:underline"
                      >
                        Change
                      </button>
                    </p>
                  )}
                </div>

                {/* Line items */}
                <div className="min-h-[120px] min-w-0 flex-1 basis-0 overflow-y-auto overscroll-y-contain bg-[#f8f9fc] px-3 py-1.5 sm:px-4 md:min-h-[150px] md:py-3">
                {invoiceItems.length > 0 && (
                  <div className="flex items-center justify-between px-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#8c95b0] md:pb-2">
                    <span>Item Description</span>
                    <span>Qty / Price / Total</span>
                  </div>
                )}
                {invoiceItems.length > 0 ? (
                  <div className="space-y-2 md:space-y-2.5">
                  {invoiceItems.map((item) => {
                    const itemSubtotal = item.totalPrice;
                    const itemDiscount = item.discountPercentage || 0;
                    const itemDiscountAmount = item.discountAmount || 0;
                    const displayPrice = itemSubtotal - itemDiscountAmount;
                    const product = products.find(p => p.id === item.productId);
                    const batchForItem = productBatches[item.productId || ""]?.find(
                      batch => batch.id === item.batchId
                    );
                    const inferredBatchUnitsPerBox = batchForItem?.totalBoxes && batchForItem?.quantity
                      ? Math.round(batchForItem.quantity / batchForItem.totalBoxes)
                      : 0;
                    const unitsPerBox = (item.unitsPerBox && item.unitsPerBox > 1)
                      ? item.unitsPerBox
                      : (batchForItem?.unitsPerBox && batchForItem?.unitsPerBox > 1)
                        ? batchForItem.unitsPerBox
                        : (inferredBatchUnitsPerBox || product?.unitsPerBox || product?.unitsPerPack || 1);
                    const isBoxItem = item.unitType === "pack" || item.unitType === "box";
                    // Loose / by-weight selling (Stage 1): a kilo line
                    // steps in 0.1 kg (100 g) and never shows "tablets".
                    const isKgLine = item.unitType === "kg" || isWeightUnitType(product?.unitType);
                    // Wave C2: leveled lines step in whole level units.
                    const quantityStep = isKgLine ? 100 : (item.unitLevel ? (item.unitFactor || 1) : (isBoxItem ? unitsPerBox : 1));

                    return (
                      <div
                        key={item.id}
                        className="rounded-[14px] border border-[rgba(15,23,60,0.06)] bg-white p-2.5 shadow-[0_1px_3px_rgba(15,23,60,0.05)] md:p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-bold leading-snug text-[#0a1128]">
                              {item.name}
                              {item.variantName ? <span className="text-[#1a52c5]"> — {item.variantName}</span> : null}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-[#8c95b0]">
                              {item.batch ? `Batch ${item.batch}` : "—"}
                              {item.expiry ? ` • Exp ${item.expiry}` : ""}
                              {isKgLine
                                ? ` • PKR ${item.unitPrice.toFixed(2)} / kg • ${formatKgFromGrams(item.quantity)}`
                                : item.unitLevel
                                  ? ` • PKR ${item.unitPrice.toFixed(2)} per ${levelLabel(item.unitLevel)} • ${item.quantity} tablets`
                                  : ` • PKR ${item.unitPrice.toFixed(2)} each`}
                            </p>
                          </div>
                          <p className="shrink-0 text-sm font-extrabold tabular-nums text-[#0a1128]">
                            PKR {displayPrice.toFixed(2)}
                          </p>
                        </div>
                        {item.unitLevel && (
                          <div className="mt-1.5 flex items-center gap-2 md:mt-2">
                            <Label className="text-[11px] font-semibold uppercase tracking-wide text-[#8c95b0]">Sold by</Label>
                            {isKgLine ? (
                              // Loose / by-weight selling (Stage 1): a
                              // kilo line has one level only (KG).
                              <span className="inline-flex h-8 items-center rounded-[8px] border border-[rgba(15,23,60,0.1)] bg-white px-2 text-xs font-semibold text-[#0a1128]">
                                KG — PKR {item.unitPrice.toFixed(2)} / kg
                              </span>
                            ) : (
                            <select
                              value={item.unitLevel}
                              onChange={(e) => changeCartItemLevel(item.id, e.target.value as UnitLevel)}
                              className="h-8 rounded-[8px] border border-[rgba(15,23,60,0.1)] bg-white px-2 text-xs font-semibold text-[#0a1128]"
                              aria-label="Selling level"
                            >
                              <option value="PACK">Pack ({item.unitsPerPack || item.unitFactor} tablets) — PKR {levelPriceFromUnitPrice(item.batchUnitPrice ?? item.unitPrice / (item.unitFactor || 1), "PACK", { unitsPerPack: item.unitsPerPack || 1, unitsPerStrip: item.unitsPerStrip ?? null }).toFixed(2)}</option>
                              {item.unitsPerStrip && showStripOption ? (
                                <option value="STRIP">Strip ({item.unitsPerStrip} tablets) — PKR {levelPriceFromUnitPrice(item.batchUnitPrice ?? item.unitPrice / (item.unitFactor || 1), "STRIP", { unitsPerPack: item.unitsPerPack || 1, unitsPerStrip: item.unitsPerStrip ?? null }).toFixed(2)}</option>
                              ) : null}
                              <option value="UNIT">Tablet — PKR {levelPriceFromUnitPrice(item.batchUnitPrice ?? item.unitPrice / (item.unitFactor || 1), "UNIT", { unitsPerPack: item.unitsPerPack || 1, unitsPerStrip: item.unitsPerStrip ?? null }).toFixed(2)}</option>
                            </select>
                            )}
                          </div>
                        )}
                        <div className="mt-2 flex items-center gap-2 md:mt-2.5">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 w-9 rounded-[10px] border-[rgba(15,23,60,0.1)] p-0 hover:bg-[#f4f6fa]"
                              onClick={() => updateInvoiceQuantity(item.id, item.quantity - quantityStep)}
                              aria-label="Decrease quantity"
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            {isKgLine ? (
                              // Loose / by-weight selling (Stage 1):
                              // decimal KG input, 3 dp (1 g resolution).
                              // Local string state so typing "0." does
                              // not snap back mid-typing; committed on
                              // blur / Enter as whole grams.
                              <input
                                type="number"
                                min="0.001"
                                step="0.1"
                                inputMode="decimal"
                                aria-label="Weight in kilograms"
                                value={kgInputByItem[item.id] ?? (item.levelQuantity ?? item.quantity / KG_GRAMS_PER_KG).toFixed(3)}
                                onChange={(e) => setKgInputByItem(prev => ({ ...prev, [item.id]: e.target.value }))}
                                onBlur={(e) => {
                                  const kg = parseFloat(e.target.value);
                                  if (Number.isFinite(kg) && kg > 0) updateInvoiceQuantity(item.id, Math.round(kg * KG_GRAMS_PER_KG));
                                  setKgInputByItem(prev => { const next = { ...prev }; delete next[item.id]; return next; });
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                }}
                                className="h-9 w-20 rounded-[10px] border-[rgba(15,23,60,0.1)] bg-white text-center text-[15px] font-extrabold tabular-nums text-[#0a1128]"
                              />
                            ) : (
                            <span className="w-11 text-center text-[15px] font-extrabold tabular-nums text-[#0a1128]">
                              {item.unitLevel ? (item.levelQuantity ?? item.quantity / (item.unitFactor || 1)) : (isBoxItem ? item.quantity : Math.max(0, item.quantity))}
                            </span>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 w-9 rounded-[10px] border-[rgba(15,23,60,0.1)] p-0 hover:bg-[#f4f6fa]"
                              onClick={() => updateInvoiceQuantity(item.id, item.quantity + quantityStep)}
                              aria-label="Increase quantity"
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="ml-auto flex items-center gap-1.5">
                            <Label htmlFor={`discount-${item.id}`} className="text-[11px] font-semibold uppercase tracking-wide text-[#8c95b0]">
                              Disc %
                            </Label>
                            <Input
                              id={`discount-${item.id}`}
                              type="number"
                              min="0"
                              max="100"
                              placeholder="0"
                              value={itemDiscount || ''}
                              onChange={(e) => {
                                const discount = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0));
                                updateItemDiscount(item.id, discount);
                              }}
                              className="h-9 w-16 rounded-[10px] border-[rgba(15,23,60,0.1)] bg-white text-center text-xs font-semibold"
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => updateInvoiceQuantity(item.id, 0)}
                              className="h-9 w-9 rounded-[10px] p-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                              aria-label="Remove item"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        {isKgLine && (
                          // Loose / by-weight selling (Stage 1):
                          // amount→weight — "Rs 100 ka" → kg =
                          // amount ÷ price-per-KG, rounded to whole
                          // grams. The derived weight + actual total
                          // are shown BEFORE the sale completes.
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Label className="text-[11px] font-semibold uppercase tracking-wide text-[#8c95b0]">Rs ka</Label>
                            <Input
                              type="number"
                              min="0"
                              placeholder="100"
                              aria-label="Amount in rupees"
                              value={weightAmountByItem[item.id] ?? ""}
                              onChange={(e) => setWeightAmountByItem(prev => ({ ...prev, [item.id]: e.target.value }))}
                              className="h-9 w-24 rounded-[10px] border-[rgba(15,23,60,0.1)] bg-white text-center text-xs font-semibold"
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 rounded-[10px] border-[rgba(15,23,60,0.1)] px-3 text-xs font-semibold"
                              onClick={() => {
                                const amount = parseFloat(weightAmountByItem[item.id] || "");
                                if (!Number.isFinite(amount) || amount <= 0 || item.unitPrice <= 0) return;
                                const grams = Math.round(amount / item.unitPrice * KG_GRAMS_PER_KG);
                                if (grams <= 0) return;
                                updateInvoiceQuantity(item.id, grams);
                                setWeightAmountByItem(prev => { const next = { ...prev }; delete next[item.id]; return next; });
                              }}
                            >
                              Set weight
                            </Button>
                            {(() => {
                              const amount = parseFloat(weightAmountByItem[item.id] || "");
                              if (!Number.isFinite(amount) || amount <= 0 || item.unitPrice <= 0) return null;
                              const grams = Math.round(amount / item.unitPrice * KG_GRAMS_PER_KG);
                              const actual = grams * item.unitPrice / KG_GRAMS_PER_KG;
                              return <span className="text-xs font-semibold text-[#1a52c5]">≈ {formatKgFromGrams(grams)} · PKR {actual.toFixed(2)}</span>;
                            })()}
                          </div>
                        )}
                        {itemDiscount > 0 && (
                          <p className="mt-1.5 text-right text-[11px] font-semibold text-emerald-600">
                            Discount −PKR {itemDiscountAmount.toFixed(2)}
                          </p>
                        )}
                      </div>
                    );
                  })}
                  </div>
                ) : (
                  <div className="flex min-h-[8rem] flex-col items-center justify-center px-4 py-6 text-center md:min-h-[11rem] md:py-10">
                    <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-[0_4px_20px_rgba(15,23,60,0.06)]">
                      <ShoppingCart className="h-7 w-7 text-[#1a52c5]/45" strokeWidth={1.5} />
                    </div>
                    <p className="text-sm font-semibold text-[#0a1128]">No items yet</p>
                    <p className="mt-1 max-w-[240px] text-[13px] leading-relaxed text-[#8c95b0]">
                      <span className="hidden md:inline">Scan or search on the left and add products to build this sale.</span>
                      <span className="md:hidden">Scan or search above and add products to build this sale.</span>
                    </p>
                  </div>
                )}
                </div>

                {/* Checkout footer — always visible. (The customer
                    block moved to the top of the rail — POS redesign.) */}
                <div className="shrink-0 border-t border-[rgba(15,23,60,0.08)] bg-white px-4 py-2 sm:px-5 md:py-3.5">
                {invoiceItems.length > 0 && (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="global-discount" className="text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">
                        Discount
                      </Label>
                      <div className="flex items-center gap-1.5">
                        <Input
                          id="global-discount"
                          type="number"
                          min="0"
                          max="100"
                          placeholder="0"
                          value={discountPercentage || ''}
                          onChange={(e) => setDiscountPercentage(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                          className="h-9 w-[4.25rem] rounded-[10px] border-[rgba(15,23,60,0.1)] bg-white text-center text-sm font-semibold"
                        />
                        <span className="text-sm font-semibold text-[#4a5578]">%</span>
                      </div>
                    </div>

                    <div className="mt-1.5 space-y-1 md:mt-3 md:space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-[#8c95b0]">Subtotal</span>
                        <span className="font-semibold tabular-nums text-[#0a1128]">PKR {invoiceItems.reduce((sum, item) => sum + item.totalPrice, 0).toFixed(2)}</span>
                      </div>
                      {discountPercentage > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-[#8c95b0]">Invoice discount ({discountPercentage}%)</span>
                          <span className="font-semibold tabular-nums text-emerald-600">−PKR {((invoiceItems.reduce((sum, item) => sum + item.totalPrice, 0) * discountPercentage) / 100).toFixed(2)}</span>
                        </div>
                      )}
                      {loyaltyDiscountValue > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-[#8c95b0]">Loyalty discount ({loyaltyPointsToUse} pts)</span>
                          <span className="font-semibold tabular-nums text-emerald-600">−PKR {loyaltyDiscountValue.toFixed(2)}</span>
                        </div>
                      )}
                      {promoEstimate > 0 && appliedCoupon && (
                        <div className="flex justify-between text-sm">
                          <span className="text-[#8c95b0]">Promotion ({appliedCoupon.code})</span>
                          <span className="font-semibold tabular-nums text-emerald-600">−PKR {promoEstimate.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex items-baseline justify-between border-t border-dashed border-[rgba(15,23,60,0.1)] pt-1.5 md:pt-2">
                        <span className="text-sm font-bold uppercase tracking-wide text-[#0a1128]">Grand Total</span>
                        <span className="text-[22px] font-extrabold tabular-nums tracking-tight text-[#0a1128]">
                          PKR {mainTotalAfterLoyalty.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {/* Coupon code (Wave B4): Apply validates the code
                        against the live cart via the server; only the
                        code is sent with the sale and the server
                        recomputes the discount. Automatic promotions
                        and Buy X Get Y need no input — they apply at
                        checkout and appear on the receipt. */}
                    <div className="mt-1.5 rounded-[10px] border border-[rgba(15,23,60,0.08)] bg-[#f8f9fc] p-2.5 md:mt-3 md:p-3">
                      <Label htmlFor="coupon-code" className="text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">
                        Coupon code
                      </Label>
                      {appliedCoupon ? (
                        <div className="mt-1.5 flex items-center gap-2 md:mt-2">
                          <span className="rounded-md bg-emerald-50 px-2 py-1 font-mono text-xs font-bold tracking-wide text-emerald-700">
                            {appliedCoupon.code}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-[#4a5578]">{appliedCoupon.name}</span>
                          <span className="text-sm font-semibold tabular-nums text-emerald-600">−PKR {appliedCoupon.estimatedDiscount.toFixed(2)}</span>
                          <button
                            type="button"
                            onClick={() => { setAppliedCoupon(null); setCouponCodeInput(""); setCouponError(""); }}
                            aria-label="Remove coupon"
                            className="text-xs font-bold text-red-500 hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <div className="mt-1.5 flex items-center gap-2 md:mt-2">
                          <Input
                            id="coupon-code"
                            placeholder="e.g. EID10"
                            value={couponCodeInput}
                            onChange={(e) => { setCouponCodeInput(e.target.value.toUpperCase()); setCouponError(""); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleApplyCoupon(); } }}
                            className="h-9 flex-1 rounded-[10px] border-[rgba(15,23,60,0.1)] bg-white font-mono text-sm font-semibold uppercase"
                          />
                          <Button
                            type="button"
                            onClick={handleApplyCoupon}
                            disabled={couponBusy || !couponCodeInput.trim()}
                            className="h-9 shrink-0 rounded-[10px] px-4 text-sm font-semibold"
                          >
                            {couponBusy ? "Checking…" : "Apply"}
                          </Button>
                        </div>
                      )}
                      {couponError && (
                        <p className="mt-2 text-xs font-medium text-red-500">{couponError}</p>
                      )}
                    </div>

                    {/* Loyalty redemption (Wave B3): offered only when
                        the entered phone resolved to a customer who
                        actually has points. */}
                    {posCustomer && posCustomer.loyaltyPoints > 0 && (
                      <div className="mt-3 rounded-[10px] border border-[rgba(15,23,60,0.08)] bg-[#f8f9fc] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor="loyalty-points" className="text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">
                            Use loyalty points
                          </Label>
                          <span className="text-xs font-medium text-[#4a5578]">
                            {posCustomer.loyaltyPoints} pts ≈ PKR {(posCustomer.loyaltyPoints * loyaltyPointValue).toFixed(2)}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <Input
                            id="loyalty-points"
                            type="number"
                            min="0"
                            max={loyaltyMaxPoints}
                            step="1"
                            placeholder="0"
                            value={loyaltyPointsInput}
                            onChange={(e) => setLoyaltyPointsInput(e.target.value)}
                            className="h-9 w-24 rounded-[10px] border-[rgba(15,23,60,0.1)] bg-white text-sm font-semibold tabular-nums"
                          />
                          <span className="text-sm font-semibold tabular-nums text-emerald-600">
                            = −PKR {loyaltyDiscountValue.toFixed(2)}
                          </span>
                          <button
                            type="button"
                            onClick={() => setLoyaltyPointsInput(String(loyaltyMaxPoints))}
                            className="ml-auto text-xs font-bold text-[#1a52c5] hover:underline"
                          >
                            Use max ({loyaltyMaxPoints})
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Prescriptions (Wave C1): appears only when the
                        cart holds prescription-only items. Attach an
                        existing register record or record a new one
                        inline; the server enforces the POS rule. */}
                    {rxCartProducts.length > 0 && (
                      <div id="pos-prescription-section" className="mt-3 rounded-[12px] border border-amber-200 bg-amber-50 p-3">
                        <div className="flex items-center gap-2">
                          <Stethoscope className="w-4 h-4 text-amber-700" />
                          <p className="text-sm font-bold text-amber-900">Prescription required</p>
                        </div>
                        <p className="mt-1 text-xs text-amber-800">
                          {rxCartProducts.map(p => p.name).join(", ")}
                        </p>

                        {selectedPrescription ? (
                          <div className="mt-2 rounded-[10px] bg-white border border-amber-200 p-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-bold text-[#0f173c]">{selectedPrescription.patientName}</p>
                                <p className="text-xs text-[#5b6478]">
                                  {selectedPrescription.doctorName ? `Dr. ${selectedPrescription.doctorName}` : "No doctor recorded"}
                                  {" · "}
                                  {new Date(selectedPrescription.issuedDate).toLocaleDateString()}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setSelectedPrescription(null)}
                                className="text-xs font-bold text-[#1a52c5] hover:underline"
                              >
                                Change
                              </button>
                            </div>
                            {rxMissingFromSelected.length > 0 ? (
                              <p className="mt-1.5 text-xs font-semibold text-red-600">
                                This prescription does not list: {rxMissingFromSelected.map(p => p.name).join(", ")} — the sale will be blocked.
                              </p>
                            ) : (
                              <p className="mt-1.5 text-xs font-semibold text-emerald-600">Covers all Rx items in this cart.</p>
                            )}
                          </div>
                        ) : (
                          <>
                            <Input
                              value={rxSearch}
                              onChange={(e) => setRxSearch(e.target.value)}
                              placeholder="Search prescriptions by patient or phone…"
                              className="mt-2 h-9 rounded-[10px] bg-white text-sm"
                            />
                            {rxSearching && <p className="mt-1 text-xs text-amber-800">Searching…</p>}
                            {rxResults.length > 0 && (
                              <div className="mt-1.5 max-h-40 overflow-y-auto rounded-[10px] border border-amber-200 bg-white divide-y divide-amber-100">
                                {rxResults.map(rx => (
                                  <button
                                    key={rx.id}
                                    type="button"
                                    onClick={() => setSelectedPrescription(rx)}
                                    className="w-full text-left px-2.5 py-2 hover:bg-amber-50"
                                  >
                                    <span className="block text-sm font-semibold text-[#0f173c]">{rx.patientName}</span>
                                    <span className="block text-xs text-[#5b6478]">
                                      {rx.patientPhone || "No phone"} · {rx.doctorName ? `Dr. ${rx.doctorName}` : "No doctor"} · {new Date(rx.issuedDate).toLocaleDateString()}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                            {!showRxCreate ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setRxForm({ patientName: invoiceCustomer.name || "", doctorName: "" });
                                  setShowRxCreate(true);
                                }}
                                className="mt-2 text-xs font-bold text-[#1a52c5] hover:underline"
                              >
                                + New prescription for this patient
                              </button>
                            ) : (
                              <div className="mt-2 rounded-[10px] bg-white border border-amber-200 p-2.5 space-y-2">
                                <Input
                                  value={rxForm.patientName}
                                  onChange={(e) => setRxForm(prev => ({ ...prev, patientName: e.target.value }))}
                                  placeholder="Patient name (required)"
                                  className="h-9 rounded-[10px] text-sm"
                                />
                                <Input
                                  value={rxForm.doctorName}
                                  onChange={(e) => setRxForm(prev => ({ ...prev, doctorName: e.target.value }))}
                                  placeholder="Doctor (optional)"
                                  className="h-9 rounded-[10px] text-sm"
                                />
                                {rxCartProducts.map(p => (
                                  <div key={p.id} className="flex items-center gap-2">
                                    <span className="flex-1 text-xs font-semibold text-[#0f173c] truncate">{p.name}</span>
                                    <Input
                                      value={rxDosages[p.id]?.dosage || ""}
                                      onChange={(e) => setRxDosages(prev => ({ ...prev, [p.id]: { dosage: e.target.value, durationDays: prev[p.id]?.durationDays || "" } }))}
                                      placeholder="Dosage 1+0+1"
                                      className="h-8 w-24 rounded-[8px] text-xs"
                                    />
                                    <Input
                                      value={rxDosages[p.id]?.durationDays || ""}
                                      onChange={(e) => setRxDosages(prev => ({ ...prev, [p.id]: { dosage: prev[p.id]?.dosage || "", durationDays: e.target.value.replace(/[^0-9]/g, "") } }))}
                                      placeholder="Days"
                                      inputMode="numeric"
                                      className="h-8 w-16 rounded-[8px] text-xs"
                                    />
                                  </div>
                                ))}
                                <div className="flex gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={rxCreating}
                                    onClick={handleCreatePrescriptionInline}
                                    className="rounded-[10px] bg-gradient-to-r from-[#173e9e] to-[#1a52c5] text-white hover:from-[#1a52c5] hover:to-[#2361dd]"
                                  >
                                    {rxCreating ? "Saving…" : "Save & attach"}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setShowRxCreate(false)}
                                    className="rounded-[10px]"
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {/* POS redesign: tendering itself (methods,
                        amount paid, split tender, paid/unpaid,
                        salesperson) lives in the payment dialog now;
                        this line keeps the current choice visible. */}
                    <p className="mt-1.5 flex items-center justify-between gap-2 rounded-[10px] bg-[#f8f9fc] px-3 py-2 text-xs font-semibold text-[#4a5578] md:mt-3">
                      <span>
                        Payment:{" "}
                        <span className="font-bold text-[#0a1128]">
                          {splitEnabled
                            ? `Split across ${splitPayments.length} method${splitPayments.length === 1 ? "" : "s"}`
                            : `${PAYMENT_METHOD_OPTIONS.find(o => o.key === paymentMethod)?.label || paymentMethod} • ${paymentStatus === 'COMPLETED' ? "Paid" : "Unpaid (khata)"}`}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsPaymentDialogOpen(true)}
                        className="shrink-0 font-bold text-primary hover:underline"
                      >
                        Change
                      </button>
                    </p>
                  </>
                )}

                  {/* POS reference pass: the reference billing panel
                      carries LARGE tender buttons of its own. Cash and
                      Card are real Zapeera tenders — tapping one
                      preselects that method and opens the same payment
                      dialog (tendered / change / split live there).
                      The reference's third panel button, Insurance,
                      has no Zapeera backend and is deliberately absent. */}
                  <div className="mt-2 grid grid-cols-2 gap-2 md:mt-3.5">
                    {PAYMENT_METHOD_OPTIONS.filter(o => o.key === 'CASH' || o.key === 'CARD').map(({ key, label, Icon }) => (
                      <button
                        key={key}
                        type="button"
                        disabled={invoiceItems.length === 0}
                        onClick={() => { setPaymentMethod(key); setIsPaymentDialogOpen(true); }}
                        className="flex h-11 items-center justify-center gap-2 rounded-[12px] border border-[rgba(15,23,60,0.12)] bg-white text-[15px] font-bold text-[#0a1128] transition-all hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 md:h-12"
                      >
                        <Icon className="h-5 w-5" strokeWidth={2} />
                        {label}
                        <Kbd>{key === "CASH" ? "Alt+C" : "Alt+B"}</Kbd>
                      </button>
                    ))}
                  </div>

                  {/* POS redesign: the rail's primary action opens the
                      payment dialog (reference layout); completing the
                      sale happens there. Clear Cart mirrors the rail
                      header's Clear all. Hold lives in the header —
                      it parks this cart server-side (resume from
                      Transactions → Held). */}
                  <Button
                    data-testid="inflow-proceed"
                    onClick={() => setIsPaymentDialogOpen(true)}
                    disabled={invoiceItems.length === 0}
                    className="mt-1.5 h-[52px] w-full rounded-[12px] text-base font-bold shadow-medium transition-all hover:-translate-y-0.5 hover:shadow-strong disabled:translate-y-0 disabled:opacity-60 disabled:shadow-none md:mt-2"
                  >
                    <Receipt className="mr-2 h-5 w-5" />
                    {invoiceItems.length > 0
                      ? `Proceed to Payment • PKR ${mainTotalAfterLoyalty.toFixed(2)}`
                      : "Proceed to Payment"}
                    <Kbd className="ml-2 border-white/25 bg-white/15 text-white">Ctrl+Enter</Kbd>
                  </Button>
                  {invoiceItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setInvoiceItems([]);
                        setDiscountPercentage(0);
                        setPaidAmount(0);
                        // Abandoning a resumed cart does NOT consume
                        // the held order — it stays parked.
                        setResumedParkedId(null);
                      }}
                      className="mt-1.5 h-10 w-full rounded-[10px] bg-rose-50 text-sm font-bold text-rose-600 transition-colors hover:bg-rose-100 md:mt-2"
                    >
                      Clear Cart
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>

      {/* Mobile sticky payment bar (2026-10-27): below md, once the
          cart has items, the complete-sale action is always reachable.
          The in-flow Proceed button falls below the fold as soon as
          the cart grows — the POS page is a fixed-height column and
          the document does not scroll (body overflow hidden), so the
          footer is clipped, not scrollable-to. Duplicate of the ACTION
          only (same handler, same total); the in-flow totals, coupon,
          tender buttons and Proceed button stay where they are. z-40
          keeps it under the search flyout (z-50) and every dialog. */}
      {invoiceItems.length > 0 && (
        <div
          data-testid="sticky-payment-bar"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-[rgba(15,23,60,0.08)] bg-white/95 px-4 py-2.5 shadow-[0_-4px_16px_rgba(15,23,60,0.08)] backdrop-blur md:hidden"
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#8c95b0]">Grand Total</p>
              <p className="truncate text-lg font-extrabold tabular-nums leading-tight text-[#0a1128]">
                PKR {mainTotalAfterLoyalty.toFixed(2)}
              </p>
            </div>
            <Button
              type="button"
              data-testid="sticky-proceed"
              onClick={() => setIsPaymentDialogOpen(true)}
              className="h-12 shrink-0 rounded-[12px] px-4 text-[15px] font-bold shadow-medium transition-all hover:-translate-y-0.5 hover:shadow-strong"
            >
              Proceed to Payment
            </Button>
          </div>
        </div>
      )}

      {/* POS redesign: PAYMENT dialog — the reference layout's payment
          modal, carrying Zapeera's REAL checkout controls: the six
          tender methods, amount tendered with quick chips and change,
          Paid/Unpaid (khata), split tender (Wave B1) and salesperson
          attribution (Wave C6) — same state and handlers as the rail
          always used; only the surface moved. */}
      <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
        <DialogContent className="flex max-h-[92vh] flex-col overflow-hidden rounded-[20px] p-0 sm:max-w-[560px]">
          <div className="shrink-0 bg-[#0a1128] px-5 py-4 text-white">
            <p className="flex items-center gap-2 text-base font-extrabold tracking-tight">
              <Wallet className="h-5 w-5 text-white/70" strokeWidth={2} />
              Process Payment
            </p>
            <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.08em] text-white/50">Amount due</p>
            <p className="text-[32px] font-extrabold leading-tight tabular-nums tracking-tight">
              PKR {mainTotalAfterLoyalty.toFixed(2)}
            </p>
            <p className="text-xs text-white/60">
              {invoiceItems.length} item{invoiceItems.length === 1 ? "" : "s"}
              {invoiceCustomer.name ? ` • ${invoiceCustomer.name}` : " • Walk-in customer"}
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {!splitEnabled && (
              <>
                <p className="text-xs font-bold uppercase tracking-wide text-[#8c95b0]">Payment method</p>
                <div className="mt-2 grid grid-cols-3 gap-1.5" role="group" aria-label="Payment method">
                  {PAYMENT_METHOD_OPTIONS.map(({ key, label, Icon }, index) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => selectPaymentMethod(key)}
                      aria-pressed={paymentMethod === key}
                      className={cn(
                        "flex h-14 flex-col items-center justify-center gap-1 rounded-[12px] border text-[13px] font-bold transition-all",
                        paymentMethod === key
                          ? "border-transparent bg-primary text-primary-foreground shadow-soft"
                          : "border-border bg-card text-muted-foreground hover:border-primary/30",
                      )}
                    >
                      <Icon className="h-5 w-5" strokeWidth={2} />
                      <span className="flex items-center gap-1.5">{label}<Kbd>{index + 1}</Kbd></span>
                    </button>
                  ))}
                </div>

                <div className="mt-4 space-y-1.5">
                  <Label htmlFor="pos-amount-tendered" className="text-xs font-bold uppercase tracking-wide text-[#8c95b0]">
                    Amount tendered
                  </Label>
                  <Input
                    id="pos-amount-tendered"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={paidAmount || ''}
                    onChange={(e) => setPaidAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="h-12 rounded-[12px] border-[rgba(15,23,60,0.1)] bg-[#f4f6fa] text-lg font-bold tabular-nums focus-visible:bg-white focus-visible:ring-[#1a52c5]/12"
                  />
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {[100, 500, 1000, 5000].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => setPaidAmount((paidAmount || 0) + amount)}
                        className="rounded-full bg-[#eef1f7] px-3 py-1.5 text-xs font-bold text-[#4a5578] transition-colors hover:bg-[#e2e8f4]"
                      >
                        + Rs {amount.toLocaleString()}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setPaidAmount(mainTotalAfterLoyalty)}
                      className="ml-auto text-xs font-bold text-primary hover:underline"
                    >
                      Set Exact Amount
                    </button>
                  </div>
                </div>

                <div
                  className={cn(
                    "mt-3 flex items-center justify-between rounded-[12px] px-4 py-3",
                    paidAmount >= mainTotalAfterLoyalty ? "bg-emerald-50" : "bg-rose-50",
                  )}
                >
                  <span className={cn(
                    "text-xs font-bold uppercase tracking-wide",
                    paidAmount >= mainTotalAfterLoyalty ? "text-emerald-700" : "text-rose-700",
                  )}>
                    {paidAmount >= mainTotalAfterLoyalty ? "Change return" : "Balance due"}
                  </span>
                  <span className={cn(
                    "text-xl font-extrabold tabular-nums",
                    paidAmount >= mainTotalAfterLoyalty ? "text-emerald-700" : "text-rose-700",
                  )}>
                    PKR {Math.abs((paidAmount || 0) - mainTotalAfterLoyalty).toFixed(2)}
                  </span>
                </div>
              </>
            )}

            <div className="mt-4 grid grid-cols-2 gap-1.5" role="group" aria-label="Payment status">
              <button
                type="button"
                onClick={() => setPaymentStatus('COMPLETED')}
                aria-pressed={paymentStatus === 'COMPLETED'}
                className={cn(
                  "h-10 rounded-[10px] border text-sm font-bold transition-all",
                  paymentStatus === 'COMPLETED'
                    ? "border-transparent bg-gradient-to-br from-emerald-600 to-teal-600 text-white shadow-[0_4px_14px_rgba(5,150,105,0.28)]"
                    : "border-[rgba(15,23,60,0.12)] bg-white text-[#4a5578] hover:border-emerald-300/60",
                )}
              >
                Paid
              </button>
              <button
                type="button"
                onClick={() => setPaymentStatus('PENDING')}
                aria-pressed={paymentStatus === 'PENDING'}
                className={cn(
                  "h-10 rounded-[10px] border text-sm font-bold transition-all",
                  paymentStatus === 'PENDING'
                    ? "border-transparent bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-[0_4px_14px_rgba(245,158,11,0.3)]"
                    : "border-[rgba(15,23,60,0.12)] bg-white text-[#4a5578] hover:border-amber-300/70",
                )}
              >
                Unpaid
              </button>
            </div>

            <button
              type="button"
              onClick={toggleSplitPayment}
              aria-pressed={splitEnabled}
              className="mt-3 flex w-full items-center justify-between gap-3 rounded-[10px] border border-[rgba(15,23,60,0.12)] bg-white px-3 py-2 text-left transition-all hover:border-[#1a52c5]/30"
            >
              <span>
                <span className="block text-xs font-bold text-[#0a1128]">Split payment</span>
                <span className="block text-[11px] text-[#8c95b0]">Split this bill across two or more methods</span>
              </span>
              <span className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", splitEnabled ? "bg-primary" : "bg-gray-300")}>
                <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", splitEnabled ? "left-[18px]" : "left-0.5")} />
              </span>
            </button>
                    {splitEnabled && (
                      <div className="mt-3 space-y-2">
                        {splitPayments.map((row, index) => (
                          <div key={index} className="space-y-2 rounded-[10px] border border-[rgba(15,23,60,0.1)] bg-[#f8f9fc] p-2">
                            <div className="flex items-center gap-2">
                              <Select value={row.method} onValueChange={(value) => updateSplitRow(index, { method: value })}>
                                <SelectTrigger className="h-9 w-[128px] shrink-0 bg-white text-xs font-semibold">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {PAYMENT_METHOD_OPTIONS.map(option => (
                                    <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="Amount"
                                value={row.amount || ''}
                                onChange={(e) => updateSplitRow(index, { amount: Math.max(0, parseFloat(e.target.value) || 0) })}
                                className="h-9 flex-1 bg-white font-semibold tabular-nums"
                              />
                              <button
                                type="button"
                                onClick={() => removeSplitRow(index)}
                                aria-label="Remove payment row"
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-[rgba(15,23,60,0.1)] bg-white text-red-500 transition-colors hover:bg-red-50"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                            <Input
                              placeholder={row.method === 'GIFT_CARD' ? 'Gift card code — e.g. GC-XXXX-XXXX (required)' : row.method === 'EWALLET' ? 'eWallet — charged to the sale customer' : 'Reference (optional) — txn id, account title…'}
                              value={row.reference}
                              onChange={(e) => updateSplitRow(index, { reference: e.target.value })}
                              className="h-8 bg-white text-xs"
                            />
                          </div>
                        ))}
                        <div className="flex items-end justify-between gap-2">
                          <button
                            type="button"
                            onClick={addSplitRow}
                            className="flex shrink-0 items-center gap-1 rounded-[8px] border border-dashed border-[#1a52c5]/40 px-2.5 py-1.5 text-xs font-bold text-[#1a52c5] transition-colors hover:bg-[#1a52c5]/5"
                          >
                            <Plus className="h-3.5 w-3.5" /> Add method
                          </button>
                          <div className="text-right">
                            <span className="block text-[11px] font-semibold uppercase tracking-wide text-[#8c95b0]">
                              Allocated PKR {splitAllocated.toFixed(2)} of PKR {mainTotalAfterLoyalty.toFixed(2)}
                            </span>
                            <span className={cn("block text-sm font-extrabold tabular-nums", splitRemaining === 0 ? "text-green-600" : "text-red-600")}>
                              {splitRemaining === 0 ? 'Fully allocated' : splitRemaining > 0 ? `Remaining PKR ${splitRemaining.toFixed(2)}` : `Over by PKR ${Math.abs(splitRemaining).toFixed(2)}`}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Credit limit (khata, gap item 7): the selected
                        customer's khata position, plus a warning when
                        this sale's credit would exceed what is left
                        of their limit. The server still enforces it
                        (402) — this is the early warning, not the
                        gate. */}
                    {posCustomer && khataCredit && (
                      <div className="mt-3 space-y-1.5">
                        <Label className="text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Khata (Credit)</Label>
                        <div className="rounded-[10px] bg-[#f4f6fa] px-3 py-2 text-[13px] font-medium text-[#3d4356]">
                          Balance PKR {khataCredit.balance.toFixed(2)}
                          {khataCredit.creditLimit != null ? (
                            <> • Limit PKR {khataCredit.creditLimit.toFixed(2)} • Available PKR {Math.max(0, khataCredit.availableCredit ?? 0).toFixed(2)}</>
                          ) : (
                            <> • No limit set</>
                          )}
                        </div>
                        {khataCredit.creditLimit != null && creditDue > 0 && creditDue > (khataCredit.availableCredit ?? 0) && (
                          <p className="text-xs font-bold text-red-600">
                            This sale adds PKR {creditDue.toFixed(2)} of credit — PKR {(creditDue - (khataCredit.availableCredit ?? 0)).toFixed(2)} over the available limit. It will be blocked unless an owner/manager approves it.
                          </p>
                        )}
                      </div>
                    )}

                    {/* Over-limit block (gap item 7): the server's 402
                        lands here, inside the payment dialog, so an
                        owner/manager can approve the override without
                        losing the sale. Cashiers only see the ask. */}
                    {creditLimitBlock && (
                      <div className="mt-3 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5">
                        <p className="text-[13px] font-bold text-red-700">Credit limit exceeded</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-red-600">
                          Balance PKR {creditLimitBlock.balance.toFixed(2)} • Limit PKR {creditLimitBlock.creditLimit.toFixed(2)} • This sale would reach PKR {creditLimitBlock.projectedBalance.toFixed(2)} (over by PKR {creditLimitBlock.overBy.toFixed(2)}).
                        </p>
                        {canOverrideCreditLimit ? (
                          <Button
                            type="button"
                            onClick={() => { setCreditLimitOverrideArmed(true); createInvoice(); }}
                            disabled={isLoading}
                            className="mt-2 h-9 rounded-[8px] bg-red-600 px-3 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-60"
                          >
                            Approve over-limit sale
                          </Button>
                        ) : (
                          <p className="mt-1 text-xs font-semibold text-red-600">Ask an owner or manager to approve this sale, or collect a payment first.</p>
                        )}
                      </div>
                    )}

                    {/* Salesperson attribution (Wave C6 → gap item 7):
                        credit this sale to a designated salesman
                        other than the cashier. Hidden when no
                        salesmen are designated. */}
                    {salesStaff.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        <Label className="text-xs font-semibold uppercase tracking-wide text-[#8c95b0]">Salesperson</Label>
                        <Select value={salespersonId || '__cashier__'} onValueChange={(v) => setSalespersonId(v === '__cashier__' ? '' : v)}>
                          <SelectTrigger className="h-10 rounded-[10px] border-[rgba(15,23,60,0.1)] bg-[#f4f6fa] font-medium focus:ring-[#1a52c5]/12">
                            <SelectValue placeholder="Me (cashier)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__cashier__">Me (cashier)</SelectItem>
                            {salesStaff.map((person) => (
                              <SelectItem key={person.userId} value={person.userId}>{person.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

          </div>

          {/* Payment footer (2026-10-26): stacked below sm — side by
              side the two buttons need ~408px (min-content) against a
              328px dialog, so "Complete Sale & Print Receipt" was cut
              off mid-label at 360px. Stacked, both labels fit in full;
              sm+ keeps the verified side-by-side row. The Ctrl+Enter
              chip is hidden below sm (rebase find): with it, the button
              content measured 315px against 286px available and the chip
              was cut to "Ctrl+E…". */}
          <div className="flex shrink-0 flex-col gap-2 border-t border-[rgba(15,23,60,0.08)] px-5 py-4 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsPaymentDialogOpen(false)}
              className="h-12 rounded-[12px] px-4 text-sm font-bold"
            >
              Back to Sale
            </Button>
            <Button
              onClick={createInvoice}
              disabled={invoiceItems.length === 0 || isLoading || (splitEnabled && (splitRemaining < 0 || (paymentStatus === 'COMPLETED' && splitRemaining !== 0)))}
              className="h-12 flex-1 rounded-[12px] text-[15px] font-bold shadow-medium transition-all hover:-translate-y-0.5 hover:shadow-strong disabled:translate-y-0 disabled:opacity-60 disabled:shadow-none"
            >
              {isLoading ? (
                "Creating..."
              ) : (
                <>
                  <Receipt className="mr-2 h-5 w-5" />
                  Complete Sale &amp; Print Receipt
                  <Kbd className="ml-2 hidden border-white/25 bg-white/15 text-white sm:inline-flex">Ctrl+Enter</Kbd>
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* POS redesign: TRANSACTIONS dialog — today's real sales for
          this branch (the same getSales data the refunds lookup uses).
          No invented rows. */}
      <Dialog open={isTxnDialogOpen} onOpenChange={setIsTxnDialogOpen}>
        <DialogContent className="flex max-h-[88vh] flex-col overflow-hidden rounded-[20px] p-0 sm:max-w-[640px]">
          <div className="shrink-0 bg-[#0a1128] px-5 py-4 text-white">
            <p className="flex items-center gap-2 text-base font-extrabold tracking-tight">
              <History className="h-5 w-5 text-white/70" strokeWidth={2} />
              {txnTab === "held" ? "Held Orders" : "Recent Transactions"}
            </p>
            <p className="mt-0.5 text-xs text-white/60">
              {txnTab === "held" ? "Parked sales" : "Today"} • {selectedBranch?.name || "Current branch"}
            </p>
          </div>
          <div className="flex shrink-0 gap-2 px-4 pt-3">
            <button
              type="button"
              onClick={() => setTxnTab("recent")}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-[13px] font-bold transition-colors",
                txnTab === "recent" ? "bg-[#0a1128] text-white" : "bg-[#eef1f7] text-[#4a5578] hover:bg-[#e2e8f4]"
              )}
            >
              Recent
            </button>
            <button
              type="button"
              onClick={() => { setTxnTab("held"); fetchParkedSales(); }}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-[13px] font-bold transition-colors",
                txnTab === "held" ? "bg-[#0a1128] text-white" : "bg-[#eef1f7] text-[#4a5578] hover:bg-[#e2e8f4]"
              )}
            >
              Held{parkedSales.length > 0 ? ` (${parkedSales.length})` : ""}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {txnTab === "held" ? (
              isLoadingParked ? (
                <div className="flex flex-col items-center justify-center py-10 text-[#8c95b0]">
                  <Loader2 className="mb-2 h-6 w-6 animate-spin text-primary" />
                  <p className="text-sm font-medium">Loading held orders…</p>
                </div>
              ) : parkedSales.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <PauseCircle className="mb-2 h-8 w-8 text-[#c3cbdd]" strokeWidth={1.5} />
                  <p className="text-sm font-semibold text-[#0a1128]">No held orders</p>
                  <p className="mt-0.5 text-[13px] text-[#8c95b0]">Park a sale with the Hold button and it will wait here.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {parkedSales.map((parked: any) => (
                    <div key={parked.id} className="flex items-center gap-3 rounded-xl border border-[rgba(15,23,60,0.08)] bg-white px-3.5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-[#0a1128]">
                          {parked.customerName || parked.label || "Walk-in"}
                        </p>
                        <p className="truncate text-xs text-[#8c95b0]">
                          {new Date(parked.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                          {" • "}
                          {parked.createdByName || "Cashier"}
                          {" • "}
                          {parked.itemCount} item{parked.itemCount === 1 ? "" : "s"}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-[#0a1128]">
                        PKR {Number(parked.grandTotal || 0).toFixed(2)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleResumeParked(parked.id)}
                        className="flex shrink-0 items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-white transition-opacity hover:opacity-90"
                      >
                        <Play className="h-3.5 w-3.5" strokeWidth={2.5} />
                        Resume
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDiscardParked(parked.id)}
                        aria-label="Discard held order"
                        title="Discard held order"
                        className="shrink-0 rounded-full p-2 text-rose-600 transition-colors hover:bg-rose-50"
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                </div>
              )
            ) : isLoadingTodaySales ? (
              <div className="flex flex-col items-center justify-center py-10 text-[#8c95b0]">
                <Loader2 className="mb-2 h-6 w-6 animate-spin text-primary" />
                <p className="text-sm font-medium">Loading today's sales…</p>
              </div>
            ) : todaySales.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <History className="mb-2 h-8 w-8 text-[#c3cbdd]" strokeWidth={1.5} />
                <p className="text-sm font-semibold text-[#0a1128]">No sales yet today</p>
                <p className="mt-0.5 text-[13px] text-[#8c95b0]">Completed sales for this branch will appear here.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {todaySales.map((sale: any) => (
                  <div key={sale.id} className="flex items-center gap-3 rounded-xl border border-[rgba(15,23,60,0.08)] bg-white px-3.5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-[#0a1128]">
                        #{sale.invoiceNumber || sale.receiptNumber || String(sale.id).slice(0, 8)}
                      </p>
                      <p className="truncate text-xs text-[#8c95b0]">
                        {new Date(sale.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                        {" • "}
                        {sale.customer?.name || "Walk-in"}
                        {Array.isArray(sale.items) ? ` • ${sale.items.length} item${sale.items.length === 1 ? "" : "s"}` : ""}
                      </p>
                    </div>
                    <span className="hidden shrink-0 rounded-full bg-[#eef1f7] px-2 py-0.5 text-[11px] font-bold text-[#4a5578] sm:inline-flex">
                      {PAYMENT_METHOD_OPTIONS.find(o => o.key === String(sale.paymentMethod || "").toLowerCase())?.label || sale.paymentMethod || "—"}
                    </span>
                    <span className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold",
                      sale.paymentStatus === "COMPLETED" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
                    )}>
                      {sale.paymentStatus === "COMPLETED" ? "Paid" : "Unpaid"}
                    </span>
                    <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-[#0a1128]">
                      PKR {Number(sale.totalAmount || 0).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-between border-t border-[rgba(15,23,60,0.08)] px-5 py-3.5">
            {txnTab === "held" ? (
              <>
                <span className="text-sm font-semibold text-[#4a5578]">Held Orders: {parkedSales.length}</span>
                <span className="text-base font-extrabold tabular-nums text-[#0a1128]">
                  PKR {parkedSales.reduce((sum: number, p: any) => sum + Number(p.grandTotal || 0), 0).toFixed(2)}
                </span>
              </>
            ) : (
              <>
                <span className="text-sm font-semibold text-[#4a5578]">Total Sales Today: {todaySales.length}</span>
                <span className="text-base font-extrabold tabular-nums text-[#0a1128]">
                  PKR {todaySales.reduce((sum: number, s: any) => sum + Number(s.totalAmount || 0), 0).toFixed(2)}
                </span>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* POS redesign: SHIFT REPORT dialog — the cashier's REAL active
          register shift from Shift Management (opened/closed there;
          this dialog never invents a float) plus today's real tender
          totals grouped by payment method. Split sales are recorded
          under the MIXED method by the server, so they appear as
          their own honest bucket. */}
      <Dialog open={isShiftDialogOpen} onOpenChange={setIsShiftDialogOpen}>
        <DialogContent className="flex max-h-[88vh] flex-col overflow-hidden rounded-[20px] p-0 sm:max-w-[520px]">
          <div className="shrink-0 bg-[#0a1128] px-5 py-4 text-white">
            <p className="flex items-center gap-2 text-base font-extrabold tracking-tight">
              <ClipboardList className="h-5 w-5 text-white/70" strokeWidth={2} />
              Shift Summary &amp; Cash Drawer
            </p>
            <p className="mt-0.5 text-xs text-white/60">
              {user?.name || "Cashier"} • {selectedBranch?.name || "Current branch"}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {activeShift ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-[#f4f6fa] px-3.5 py-3 ring-1 ring-[rgba(15,23,60,0.05)]">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[#8c95b0]">Shift opened</p>
                    <p className="mt-0.5 text-sm font-bold text-[#0a1128]">
                      {new Date(activeShift.startTime).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </p>
                  </div>
                  <div className="rounded-xl bg-[#f4f6fa] px-3.5 py-3 ring-1 ring-[rgba(15,23,60,0.05)]">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[#8c95b0]">Opening float</p>
                    <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-[#0a1128]">PKR {Number(activeShift.openingBalance || 0).toFixed(2)}</p>
                  </div>
                  <div className="rounded-xl bg-[#f4f6fa] px-3.5 py-3 ring-1 ring-[rgba(15,23,60,0.05)]">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[#8c95b0]">Cash in</p>
                    <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-emerald-700">PKR {Number(activeShift.cashIn || 0).toFixed(2)}</p>
                  </div>
                  <div className="rounded-xl bg-[#f4f6fa] px-3.5 py-3 ring-1 ring-[rgba(15,23,60,0.05)]">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[#8c95b0]">Cash out</p>
                    <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-rose-600">PKR {Number(activeShift.cashOut || 0).toFixed(2)}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between rounded-xl bg-[#0a1128] px-4 py-3 text-white">
                  <span className="text-xs font-bold uppercase tracking-wide text-white/60">Expected drawer cash</span>
                  <span className="font-mono text-lg font-extrabold tabular-nums">
                    PKR {(Number(activeShift.openingBalance || 0) + Number(activeShift.cashIn || 0) - Number(activeShift.cashOut || 0)).toFixed(2)}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#8c95b0]">
                  Drawer movements and closing the shift are managed in Shift Management — sales are not tied to a shift in Zapeera, so the expected cash above is the shift record's own float arithmetic.
                </p>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-[rgba(15,23,60,0.15)] bg-[#f8f9fc] px-4 py-5 text-center">
                <ClipboardList className="mx-auto mb-2 h-7 w-7 text-[#c3cbdd]" strokeWidth={1.5} />
                <p className="text-sm font-semibold text-[#0a1128]">No active register shift</p>
                <p className="mx-auto mt-0.5 max-w-[340px] text-[13px] leading-relaxed text-[#8c95b0]">
                  You don't have an open shift right now. Shifts (with opening float and drawer counts) are opened and closed in Shift Management.
                </p>
              </div>
            )}

            <p className="mt-5 text-xs font-bold uppercase tracking-wide text-[#8c95b0]">Collected today by tender</p>
            {isLoadingTodaySales ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-[#8c95b0]">
                <Loader2 className="h-4 w-4 animate-spin text-primary" /> Loading…
              </p>
            ) : todaySales.length === 0 ? (
              <p className="mt-2 text-sm text-[#8c95b0]">No sales recorded today yet.</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {(() => {
                  const byMethod = new Map<string, { count: number; total: number }>();
                  todaySales.forEach((s: any) => {
                    const key = String(s.paymentMethod || "CASH").toUpperCase();
                    const entry = byMethod.get(key) || { count: 0, total: 0 };
                    entry.count += 1;
                    entry.total += Number(s.totalAmount || 0);
                    byMethod.set(key, entry);
                  });
                  return [...byMethod.entries()].map(([method, entry]) => (
                    <div key={method} className="flex items-center justify-between rounded-lg bg-[#f8f9fc] px-3 py-2 text-sm">
                      <span className="font-semibold text-[#4a5578]">
                        {PAYMENT_METHOD_OPTIONS.find(o => o.key === method.toLowerCase())?.label || (method === "MIXED" ? "Mixed / Split" : method)}
                        <span className="ml-1.5 text-xs font-medium text-[#8c95b0]">× {entry.count}</span>
                      </span>
                      <span className="font-mono font-bold tabular-nums text-[#0a1128]">PKR {entry.total.toFixed(2)}</span>
                    </div>
                  ));
                })()}
                <div className="flex items-center justify-between border-t border-dashed border-[rgba(15,23,60,0.12)] px-3 pt-2 text-sm">
                  <span className="font-bold text-[#0a1128]">Total collected</span>
                  <span className="font-mono font-extrabold tabular-nums text-[#0a1128]">
                    PKR {todaySales.reduce((sum: number, s: any) => sum + Number(s.totalAmount || 0), 0).toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="shrink-0 border-t border-[rgba(15,23,60,0.08)] px-5 py-3.5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsShiftDialogOpen(false)}
              className="h-11 w-full rounded-[12px] text-sm font-bold"
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Receipt Dialog */}
      {/* Prescriptions (Wave C1): blocked-sale dialog. The server
          refused the sale because Rx items need a prescription on
          file (or the attached record does not cover them) — point
          the cashier straight at the rail's Prescription section. */}
      <Dialog open={!!rxBlock} onOpenChange={(open) => { if (!open) setRxBlock(null); }}>
        <DialogContent className="sm:max-w-[440px] rounded-[16px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <Stethoscope className="w-5 h-5" />
              Prescription required
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-[#3d4356]">{rxBlock?.message}</p>
            {rxBlock && rxBlock.products.length > 0 && (
              <div className="rounded-[10px] bg-amber-50 border border-amber-200 p-3">
                <p className="text-xs font-bold text-amber-900 uppercase tracking-wide">Prescription-only items</p>
                <ul className="mt-1 list-disc list-inside text-sm text-amber-900">
                  {rxBlock.products.map(p => <li key={p.id}>{p.name}</li>)}
                </ul>
              </div>
            )}
            <p className="text-sm text-[#5b6478]">
              Attach a prescription in the <strong>Prescription</strong> section of the checkout panel — search the register by patient or phone, or record a new one — then create the invoice again.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-[10px]"
                onClick={() => setRxBlock(null)}
              >
                Close
              </Button>
              <Button
                type="button"
                className="rounded-[10px] bg-gradient-to-r from-[#173e9e] to-[#1a52c5] text-white hover:from-[#1a52c5] hover:to-[#2361dd]"
                onClick={() => {
                  setRxBlock(null);
                  document.getElementById("pos-prescription-section")?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              >
                Go to Prescription section
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isReceiptDialogOpen} onOpenChange={setIsReceiptDialogOpen}>
        <DialogContent className="flex max-h-[92vh] flex-col overflow-hidden rounded-[20px] p-0 sm:max-w-[520px]">
          {/* Dark header — POS redesign: thermal receipt preview. The
              share actions are the same handlers the receipt always
              had (print / download / SMS / WhatsApp / email). */}
          <div className="shrink-0 bg-[#0a1128] px-5 py-4 text-white">
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex items-center gap-2 text-base font-extrabold tracking-tight">
                <Receipt className="h-5 w-5 text-white/70" strokeWidth={2} />
                Thermal Receipt Preview
              </p>
              <div className="ml-auto flex flex-wrap gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={printReceipt}
                  className="border border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white"
                >
                  <Printer className="mr-1.5 h-4 w-4" />
                  Print
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={downloadReceipt}
                  className="border border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white"
                >
                  <Download className="mr-1.5 h-4 w-4" />
                  Download
                </Button>
                {currentReceipt?.customer?.phone && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const smsUrl = `sms:${currentReceipt.customer.phone}?body=${encodeURIComponent(`Zapeera Receipt\nReceipt: ${currentReceipt.receiptNumber}\nTotal: PKR ${currentReceipt.total.toFixed(2)}\nDate: ${currentReceipt.date} ${currentReceipt.time}\n\nThank you for choosing us!`)}`;
                        window.location.href = smsUrl;
                      }}
                      className="border border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white"
                    >
                      <Phone className="mr-1.5 h-4 w-4" />
                      SMS
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const url = buildWhatsAppReceiptUrl(currentReceipt, selectedCompany?.name || selectedBranch?.name || 'Zapeera');
                        window.open(url, '_blank', 'noopener');
                      }}
                      className="border border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white"
                    >
                      <MessageCircle className="mr-1.5 h-4 w-4" />
                      WhatsApp
                    </Button>
                  </>
                )}
                {currentReceipt?.customer?.email && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const emailSubject = `Receipt from Zapeera - ${currentReceipt.receiptNumber}`;
                      const emailBody = `Dear ${currentReceipt.customer.name},\n\nThank you for your purchase at Zapeera!\n\nReceipt Details:\n- Receipt Number: ${currentReceipt.receiptNumber}\n- Date: ${currentReceipt.date}\n- Time: ${currentReceipt.time}\n- Total: PKR ${currentReceipt.total.toFixed(2)}\n\nThank you for choosing us!`;
                      const emailUrl = `mailto:${currentReceipt.customer.email}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
                      window.location.href = emailUrl;
                    }}
                    className="border border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white"
                  >
                    <Mail className="mr-1.5 h-4 w-4" />
                    Email
                  </Button>
                )}
              </div>
            </div>
            {currentReceipt && (
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(currentReceipt.receiptNumber);
                  toast({
                    title: "Copied!",
                    description: `Receipt number ${currentReceipt.receiptNumber} copied to clipboard`,
                  });
                }}
                className="mt-2.5 flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-left ring-1 ring-white/10 transition-colors hover:bg-white/15"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span className="text-sm font-semibold">
                  Payment Successful — Receipt <span className="font-mono font-bold">{currentReceipt.receiptNumber}</span>
                </span>
                <Copy className="ml-auto h-3.5 w-3.5 shrink-0 text-white/50" />
              </button>
            )}
          </div>

          {currentReceipt && (
            <div className="min-h-0 flex-1 overflow-y-auto bg-[#eef1f7] px-4 py-5">
              {/* The thermal slip: narrow, centered, monospace — the
                  same real data the wide receipt card showed (business,
                  cashier, customer, Rx, items, discounts, tax classes,
                  FBR). Tendered/change are NOT printed here because the
                  sale record does not store them on the receipt. */}
              <div className="mx-auto w-full max-w-[360px] bg-white px-5 py-5 font-mono text-[12px] leading-relaxed text-neutral-700 shadow-[0_2px_14px_rgba(15,23,60,0.10)]">
                <div className="text-center">
                  <p className="text-[15px] font-bold uppercase tracking-wide text-neutral-900">
                    {selectedCompany?.name || selectedBranch?.name || 'Zapeera'}
                  </p>
                  {selectedBranch && selectedCompany?.name && (
                    <p className="font-semibold text-neutral-800">{selectedBranch.name}</p>
                  )}
                  {(selectedCompany?.address || selectedBranch?.address) && (
                    <p className="text-[11px]">{selectedCompany?.address || selectedBranch?.address}</p>
                  )}
                  {(selectedCompany?.phone || selectedBranch?.phone) && (
                    <p className="text-[11px]">Tel: {selectedCompany?.phone || selectedBranch?.phone}</p>
                  )}
                  {(selectedCompany?.email || selectedBranch?.email) && (
                    <p className="text-[11px]">{selectedCompany?.email || selectedBranch?.email}</p>
                  )}
                  <p className="text-[11px] italic text-neutral-500">Your Health, Our Priority</p>
                </div>

                <div className="my-3 border-t border-dashed border-neutral-300" />

                <div className="space-y-0.5">
                  <p className="flex justify-between gap-2"><span>Receipt #:</span><span className="font-bold text-neutral-900">{currentReceipt.receiptNumber}</span></p>
                  <p className="flex justify-between gap-2"><span>Date:</span><span>{currentReceipt.date}</span></p>
                  <p className="flex justify-between gap-2"><span>Time:</span><span>{currentReceipt.time}</span></p>
                  <p className="flex justify-between gap-2"><span>Cashier:</span><span>{currentReceipt.cashier}</span></p>
                  {currentReceipt.customer && (
                    <p className="flex justify-between gap-2">
                      <span>Customer:</span>
                      <span className="text-right">
                        {currentReceipt.customer.name}
                        {currentReceipt.customer.phone ? ` (${currentReceipt.customer.phone})` : ''}
                      </span>
                    </p>
                  )}
                  {currentReceipt.prescription && (
                    <p className="flex justify-between gap-2">
                      <span>Rx:</span>
                      <span className="text-right">
                        {currentReceipt.prescription.patientName}
                        {currentReceipt.prescription.doctorName ? ` (Dr. ${currentReceipt.prescription.doctorName})` : ''}
                      </span>
                    </p>
                  )}
                </div>

                <div className="my-3 border-t border-dashed border-neutral-300" />

                <div className="space-y-2.5">
                  {currentReceipt.items.map((item, index) => (
                    <div key={index}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-bold text-neutral-900">
                          {item.name}{item.variantName ? ` (${item.variantName})` : ''}
                        </span>
                        <span className="shrink-0 font-bold text-neutral-900">PKR {Number(item.totalPrice || 0).toFixed(2)}</span>
                      </div>
                      <p className="text-[11px] text-neutral-500">
                        {cartItemQtyPhrase(item)} × PKR {Number(item.unitPrice || 0).toFixed(2)}{isKgReceiptLine(item) ? " / kg" : ""}
                      </p>
                      {item.instructions && (
                        <p className="text-[11px] italic text-neutral-500">{item.instructions}</p>
                      )}
                    </div>
                  ))}
                </div>

                <div className="my-3 border-t border-dashed border-neutral-300" />

                <div className="space-y-1">
                  <p className="flex justify-between gap-2"><span>Subtotal:</span><span>PKR {currentReceipt.subtotal.toFixed(2)}</span></p>
                  {(currentReceipt.discountPercentage ?? 0) > 0 && (
                    <p className="flex justify-between gap-2"><span>Discount ({currentReceipt.discountPercentage}%):</span><span>-PKR {currentReceipt.discountAmount?.toFixed(2) || '0.00'}</span></p>
                  )}
                  {(currentReceipt.loyaltyDiscount ?? 0) > 0 && (
                    <p className="flex justify-between gap-2"><span>Loyalty ({currentReceipt.pointsRedeemed || 0} pts):</span><span>-PKR {currentReceipt.loyaltyDiscount.toFixed(2)}</span></p>
                  )}
                  {(currentReceipt.promotionDiscount ?? 0) > 0 && (
                    <p className="flex justify-between gap-2"><span>Promotion{currentReceipt.promotionLabel ? ` (${currentReceipt.promotionLabel})` : ''}:</span><span>-PKR {currentReceipt.promotionDiscount.toFixed(2)}</span></p>
                  )}
                  {shouldShowTaxBreakdown(currentReceipt) && (currentReceipt.taxBreakdown || []).map((line) => (
                    <p key={line.className} className="flex justify-between gap-2">
                      <span>Tax — {line.className} ({Number(line.rate)}%):</span>
                      <span>PKR {Number(line.taxAmount).toFixed(2)}</span>
                    </p>
                  ))}
                  {(currentReceipt.provincialTaxBreakdown || []).map((line) => (
                    <p key={line.authority} className="flex justify-between gap-2">
                      <span>Provincial tax — {line.authorityName} ({line.authority}, {Number(line.rate)}%):</span>
                      <span>PKR {Number(line.taxAmount).toFixed(2)}</span>
                    </p>
                  ))}
                  <p className="flex justify-between gap-2 border-t-2 border-neutral-800 pt-1.5 text-[14px] font-bold text-neutral-900">
                    <span>GRAND TOTAL:</span>
                    <span>PKR {currentReceipt.total.toFixed(2)}</span>
                  </p>
                  <p className="flex justify-between gap-2 pt-1">
                    <span>Payment:</span>
                    <span className="font-bold text-neutral-900">
                      {currentReceipt.paymentMethod.toUpperCase()} • {currentReceipt.paymentStatus === 'COMPLETED' ? 'Paid' : 'Unpaid'}
                    </span>
                  </p>
                  {(currentReceipt.pointsEarned ?? 0) > 0 && (
                    <p className="flex justify-between gap-2"><span>Points earned:</span><span>+{currentReceipt.pointsEarned} pts</span></p>
                  )}
                </div>

                {currentReceipt.fbrInvoiceNumber ? (
                  <div className="mt-3 flex flex-col items-center gap-1.5 border-t border-dashed border-neutral-300 pt-3 text-center">
                    <FbrQrImage value={currentReceipt.fbrInvoiceNumber} size={84} />
                    <p className="text-[11px]">FBR Invoice #: <span className="font-bold break-all">{currentReceipt.fbrInvoiceNumber}</span></p>
                    <p className="text-[10px] text-neutral-500">Verify at FBR's invoice verification portal.</p>
                  </div>
                ) : currentReceipt.fbrStatus ? (
                  <p className="mt-3 border-t border-dashed border-neutral-300 pt-3 text-center text-[11px]">
                    Fiscal status: <strong>{currentReceipt.fbrStatus}</strong> — the FBR invoice number will appear once FBR confirms it.
                  </p>
                ) : null}

                <div className="mt-4 border-t border-dashed border-neutral-300 pt-3 text-center">
                  <p className="text-[13px] font-bold tracking-wide text-neutral-900">THANK YOU!</p>
                  <p className="text-[11px]">Thank you for choosing {selectedCompany?.name || selectedBranch?.name || 'Zapeera'}!</p>
                  {(selectedCompany?.phone || selectedBranch?.phone) && (
                    <p className="text-[11px]">For any queries, contact us at: {selectedCompany?.phone || selectedBranch?.phone}</p>
                  )}
                  <p className="mt-2 text-[10px] text-neutral-400">Powered by Zapeera Business Management Software</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex shrink-0 gap-2 border-t border-[rgba(15,23,60,0.08)] bg-white px-5 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={printReceipt}
              className="h-12 flex-1 rounded-[12px] text-sm font-bold"
            >
              <Printer className="mr-2 h-4 w-4" />
              Print Receipt
              <Kbd className="ml-2">Ctrl+P</Kbd>
            </Button>
            <Button
              type="button"
              onClick={() => setIsReceiptDialogOpen(false)}
              className="h-12 flex-1 rounded-[12px] text-sm font-bold"
            >
              New Sale
              <Kbd className="ml-2 border-white/25 bg-white/15 text-white">N</Kbd>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Refunds & Returns Dialog */}
      <Dialog open={isRefundDialogOpen} onOpenChange={setIsRefundDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <AlertCircle className="w-5 h-5 text-red-600" />
              <span>Refunds & Returns</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Invoice Lookup Form */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Invoice Lookup</h3>
              <div className="flex space-x-2">
                <Input
                  placeholder="Enter invoice number"
                  value={refundInvoiceNumber}
                  onChange={(e) => setRefundInvoiceNumber(e.target.value)}
                  className="flex-1"
                />
                <Button
                  onClick={lookupInvoice}
                  variant="outline"
                  disabled={invoiceLookupLoading}
                >
                  {invoiceLookupLoading ? 'Loading...' : 'Show Invoice'}
                </Button>
              </div>
            </div>

            {/* Found Invoice Display */}
            {foundInvoice && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Found Invoice</h3>
                <Card className="border-green-200 bg-green-50">
                  <CardContent className="p-4">
                    <div className="space-y-3">
                      {/* Invoice Header */}
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-semibold text-lg">Receipt: {foundInvoice.receipts[0]?.receiptNumber || 'N/A'}</h4>
                          <p className="text-sm text-muted-foreground">
                            Date: {new Date(foundInvoice.createdAt).toLocaleDateString()} {new Date(foundInvoice.createdAt).toLocaleTimeString()}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Cashier: {foundInvoice.user.name}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-green-600">
                            PKR {foundInvoice.totalAmount.toFixed(2)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {foundInvoice.paymentMethod} • {foundInvoice.paymentStatus}
                          </p>
                        </div>
                      </div>

                      {/* Customer Info */}
                      {foundInvoice.customer && (
                        <div className="border-t pt-3">
                          <h5 className="font-medium text-sm mb-2">Customer Information</h5>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <p><strong>Name:</strong> {foundInvoice.customer.name}</p>
                            <p><strong>Phone:</strong> {foundInvoice.customer.phone}</p>
                            {foundInvoice.customer.email && (
                              <p><strong>Email:</strong> {foundInvoice.customer.email}</p>
                            )}
                            {foundInvoice.customer.address && (
                              <p><strong>Address:</strong> {foundInvoice.customer.address}</p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Items List */}
                      <div className="border-t pt-3">
                        <h5 className="font-medium text-sm mb-2">Items in Invoice</h5>
                        <div className="space-y-2">
                          {foundInvoice.items.map((item: any, index: number) => (
                            <div key={index} className="flex justify-between items-center p-2 bg-white rounded border">
                              <div className="flex-1">
                                <p className="font-medium text-sm">{item.product.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {describeStoredLine({ ...item, unitType: (item as any).product?.unitType }) ?? `${item.quantity} ${item.product?.unitType || "units"}`} × PKR {item.unitPrice.toFixed(2)}{isKgReceiptLine({ ...item, unitType: (item as any).product?.unitType }) ? " / kg" : ""}
                                  {item.batchNumber && ` • Batch: ${item.batchNumber}`}
                                  {item.expiryDate && ` • Exp: ${new Date(item.expiryDate).toLocaleDateString()}`}
                                </p>
                              </div>
                              <p className="font-semibold text-sm">PKR {item.totalPrice.toFixed(2)}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Invoice Summary */}
                      <div className="border-t pt-3">
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span>Subtotal:</span>
                            <span>PKR {foundInvoice.subtotal.toFixed(2)}</span>
                          </div>
                          {foundInvoice.discountAmount > 0 && (
                            <div className="flex justify-between text-green-600">
                              <span>Discount:</span>
                              <span>-PKR {foundInvoice.discountAmount.toFixed(2)}</span>
                            </div>
                          )}
                          <div className="flex justify-between font-bold text-lg border-t pt-1">
                            <span>Total:</span>
                            <span>PKR {foundInvoice.totalAmount.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Action Button */}
                      <div className="border-t pt-3">
                        <Button
                          onClick={processRefund}
                          className="w-full text-white bg-red-600 hover:bg-red-700"
                        >
                          <AlertCircle className="w-4 h-4 mr-2" />
                          Process Full Refund & Return Items to Stock
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Refund Reason */}
            {foundInvoice && (
              <div className="space-y-2">
                <Label htmlFor="refundReason">Refund Reason *</Label>
                <Input
                  id="refundReason"
                  placeholder="Enter reason for refund"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                />
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end space-x-3 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => {
                  setIsRefundDialogOpen(false);
                  setRefundInvoiceNumber("");
                  setRefundReason("");
                  setFoundInvoice(null);
                }}
              >
                Cancel
              </Button>
              {foundInvoice && (
                <Button
                  onClick={processRefund}
                  className="text-white bg-red-600 hover:bg-red-700"
                  disabled={!refundReason.trim()}
                >
                  <AlertCircle className="w-4 h-4 mr-2" />
                  Process Refund
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Sale Modal Dialog */}
      <Dialog open={isNewSaleDialogOpen} onOpenChange={(open) => {
        setIsNewSaleDialogOpen(open);
        if (!open) {
          // Reset modal form when closed
          setModalInvoiceItems([]);
          setModalInvoiceCustomer({ name: "", phone: "" });
          setModalDiscountPercentage(0);
          setModalPaymentMethod('CASH');
          setModalPaymentStatus('COMPLETED');
          setModalPaidAmount(0);
          setModalSearchQuery("");
        }
      }}>
        <DialogContent
          className="max-w-6xl max-h-[90vh] overflow-y-auto"
          onOpenAutoFocus={(e) => {
            // Wedge scanners type wherever focus is: pin it to the
            // modal search box so a scan lands in the input (its
            // BurstTracker owns the scan), never in a customer field.
            e.preventDefault();
            document.getElementById('modal-search-input')?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Receipt className="w-5 h-5 text-primary" />
              <span>New Invoice — quick entry</span>
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
            {/* Left Side: Search & Customer Details */}
            <div className="space-y-4">
              {/* Product Search Section */}
              <ProductSearchSection
                inputId="modal-search-input"
                searchQuery={modalSearchQuery}
                onSearchChange={setModalSearchQuery}
                filteredProducts={modalFilteredProducts}
                isLoading={isLoading}
                productBatches={productBatches}
                selectedBatches={selectedBatches}
                loadingBatches={loadingBatches}
                requiresBranchSelection={requiresBranchSelection}
                getSelectedBatch={(productId) => getSelectedBatch(productId, { ignoreVariant: true })}
                onSelectBatch={(productId, batchId) => {
                  setSelectedBatches(prev => ({ ...prev, [productId]: batchId }));
                }}
                onAddToCart={addToModalCart}
                onScanSubmit={(code) => { void handleBarcodeScanned(code, "modal"); }}
                onScanClick={() => {
                  setScanTarget("modal");
                  setIsCameraScannerOpen(true);
                }}
                showStripOption={showStripOption}
                isWeightSellingAllowed={isWeightSellingAllowed}
              />

              {/* Customer Details Section */}
              <Card>
                <CardContent className="p-4">
                  <h3 className="text-base font-semibold mb-3">Customer Details (Optional)</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="modalCustomerName" className="text-sm">Customer Name</Label>
                      <Input
                        id="modalCustomerName"
                        placeholder="Customer Name"
                        value={modalInvoiceCustomer.name}
                        onChange={(e) => setModalInvoiceCustomer({ ...modalInvoiceCustomer, name: e.target.value })}
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="modalCustomerPhone" className="text-sm">Phone Number</Label>
                      <Input
                        id="modalCustomerPhone"
                        placeholder="Phone Number"
                        value={modalInvoiceCustomer.phone}
                        onChange={(e) => setModalInvoiceCustomer({ ...modalInvoiceCustomer, phone: e.target.value })}
                        className="h-9"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right Side: Selected Items & Totals */}
            <div className="space-y-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <h3 className="text-base font-semibold">Selected Items</h3>
                      {modalInvoiceItems.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setModalInvoiceItems([]);
                            setModalDiscountPercentage(0);
                            setModalPaidAmount(0);
                          }}
                          className="text-red-600 border-red-600 hover:bg-red-50"
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                    {modalInvoiceItems.length > 0 && (
                      <Badge variant="outline">{modalInvoiceItems.length}</Badge>
                    )}
                  </div>

                  {/* Selected Items Table */}
                  {modalInvoiceItems.length > 0 ? (
                    <div className="overflow-x-auto max-h-64 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-gray-50">
                            <TableHead className="w-[30%] py-2 text-xs">Name</TableHead>
                            <TableHead className="text-center w-[12%] py-2 text-xs">Qty</TableHead>
                            <TableHead className="text-right w-[12%] py-2 text-xs">Price</TableHead>
                            <TableHead className="text-right w-[15%] py-2 text-xs">Total</TableHead>
                            <TableHead className="text-center w-[15%] py-2 text-xs">Discount</TableHead>
                            <TableHead className="text-center w-[10%] py-2 text-xs">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {modalInvoiceItems.map((item) => {
                            const itemSubtotal = item.totalPrice;
                            const itemDiscount = item.discountPercentage || 0;
                            const itemDiscountAmount = item.discountAmount || 0;
                            const displayPrice = itemSubtotal - itemDiscountAmount;
                            const product = products.find(p => p.id === item.productId);
                            const batchForItem = productBatches[item.productId || ""]?.find(
                              batch => batch.id === item.batchId
                            );
                            const inferredBatchUnitsPerBox = batchForItem?.totalBoxes && batchForItem?.quantity
                              ? Math.round(batchForItem.quantity / batchForItem.totalBoxes)
                              : 0;
                            const unitsPerBox = (item.unitsPerBox && item.unitsPerBox > 1)
                              ? item.unitsPerBox
                              : (batchForItem?.unitsPerBox && batchForItem?.unitsPerBox > 1)
                                ? batchForItem.unitsPerBox
                                : (inferredBatchUnitsPerBox || product?.unitsPerBox || product?.unitsPerPack || 1);
                            const isBoxItem = item.unitType === "pack" || item.unitType === "box";
                            // Loose / by-weight selling (Stage 1): a
                            // kilo line steps in 0.1 kg (100 g).
                            const isKgLine = item.unitType === "kg" || isWeightUnitType(product?.unitType);
                            const quantityStep = isKgLine ? 100 : (isBoxItem ? unitsPerBox : 1);

                            return (
                              <TableRow key={item.id} className="hover:bg-gray-50">
                                <TableCell className="py-2">
                                  <div className="font-medium text-xs">{item.name}</div>
                                </TableCell>
                                <TableCell className="text-center py-2">
                                  <div className="flex items-center justify-center gap-1">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="w-6 h-6 p-0"
                                      onClick={() => updateModalQuantity(item.id, item.quantity - quantityStep)}
                                    >
                                      <Minus className="w-3 h-3" />
                                    </Button>
                                    <span className="font-medium w-16 text-center text-xs">
                                      {isKgLine ? `${(item.levelQuantity ?? item.quantity / KG_GRAMS_PER_KG).toFixed(3)} kg` : (isBoxItem ? item.quantity : Math.max(0, item.quantity))}
                                    </span>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="w-6 h-6 p-0"
                                      onClick={() => updateModalQuantity(item.id, item.quantity + quantityStep)}
                                    >
                                      <Plus className="w-3 h-3" />
                                    </Button>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right py-2 text-xs">
                                  PKR {item.unitPrice.toFixed(2)}{isKgLine ? " / kg" : ""}
                                </TableCell>
                                <TableCell className="text-right py-2">
                                  <div className="font-semibold text-xs text-green-600">
                                    PKR {displayPrice.toFixed(2)}
                                  </div>
                                </TableCell>
                                <TableCell className="text-center py-2">
                                  <div className="flex flex-col items-center gap-1">
                                    <Input
                                      id={`modal-discount-${item.id}`}
                                      type="number"
                                      min="0"
                                      max="100"
                                      placeholder="0"
                                      value={itemDiscount || ''}
                                      onChange={(e) => {
                                        const discount = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0));
                                        updateModalItemDiscount(item.id, discount);
                                      }}
                                      className="w-14 h-6 text-xs text-center"
                                    />
                                    {itemDiscount > 0 && (
                                      <div className="text-xs text-green-600 font-medium">
                                        -PKR {itemDiscountAmount.toFixed(2)}
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-center py-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => updateModalQuantity(item.id, 0)}
                                    className="text-destructive hover:text-destructive h-6 w-6 p-0"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <ShoppingCart className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p className="text-sm font-medium">No items selected</p>
                      <p className="text-xs mt-1">Search and add medicines</p>
                    </div>
                  )}

                  {/* Discount Section */}
                  {modalInvoiceItems.length > 0 && (
                    <div className="space-y-2 border-t pt-3 mt-3">
                      <div className="flex items-center space-x-2">
                        <Label htmlFor="modal-global-discount" className="text-sm">Discount %</Label>
                        <Input
                          id="modal-global-discount"
                          type="number"
                          min="0"
                          max="100"
                          placeholder="0"
                          value={modalDiscountPercentage || ''}
                          onChange={(e) => setModalDiscountPercentage(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                          className="w-20 h-8 text-sm text-center"
                        />
                      </div>
                    </div>
                  )}

                  {/* Totals */}
                  {modalInvoiceItems.length > 0 && (
                    <div className="space-y-2 border-t pt-3 mt-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span className="font-medium">PKR {modalInvoiceItems.reduce((sum, item) => sum + item.totalPrice, 0).toFixed(2)}</span>
                      </div>
                      {modalDiscountPercentage > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Discount ({modalDiscountPercentage}%)</span>
                          <span className="font-medium text-green-600">-PKR {((modalInvoiceItems.reduce((sum, item) => sum + item.totalPrice, 0) * modalDiscountPercentage) / 100).toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-base font-bold border-t pt-2">
                        <span>Total</span>
                        <span className="text-green-600">PKR {(modalInvoiceItems.reduce((sum, item) => sum + item.totalPrice, 0) * (1 - modalDiscountPercentage / 100)).toFixed(2)}</span>
                      </div>
                    </div>
                  )}

                  {/* Payment Amount & Returned Amount */}
                  {modalInvoiceItems.length > 0 && (
                    <div className="space-y-2 border-t pt-3 mt-3">
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Amount Paid</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Enter amount paid"
                          value={modalPaidAmount || ''}
                          onChange={(e) => setModalPaidAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                          className="w-full h-9"
                        />
                      </div>
                      <div className="flex justify-between items-center p-2 bg-gray-50 rounded-lg border">
                        <span className="text-sm font-medium text-gray-700">{(() => {
                          const total = modalInvoiceItems.reduce((sum, item) => sum + item.totalPrice, 0);
                          const finalTotal = total - (total * (modalDiscountPercentage / 100));
                          return modalPaidAmount >= finalTotal ? 'Returned Amount' : 'Balance Due';
                        })()}</span>
                        <span className={`text-base font-bold ${(() => {
                          const total = modalInvoiceItems.reduce((sum, item) => sum + item.totalPrice, 0);
                          const discountAmount = total * (modalDiscountPercentage / 100);
                          const finalTotal = total - discountAmount;
                          const returned = modalPaidAmount - finalTotal;
                          return returned >= 0 ? 'text-green-600' : 'text-red-600';
                        })()}`}>
                          PKR {(() => {
                            const total = modalInvoiceItems.reduce((sum, item) => sum + item.totalPrice, 0);
                            const discountAmount = total * (modalDiscountPercentage / 100);
                            const finalTotal = total - discountAmount;
                            const returned = modalPaidAmount - finalTotal;
                            return Math.abs(returned).toFixed(2);
                          })()}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Payment Method & Status */}
                  {modalInvoiceItems.length > 0 && (
                    <div className="border-t pt-3 mt-3 space-y-3">
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Payment Method</Label>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant={modalPaymentMethod === 'CASH' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setModalPaymentMethod('CASH')}
                            className={modalPaymentMethod === 'CASH' ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}
                          >
                            Cash
                          </Button>
                          <Button
                            type="button"
                            variant={modalPaymentMethod === 'CARD' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setModalPaymentMethod('CARD')}
                            className={modalPaymentMethod === 'CARD' ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}
                          >
                            Card
                          </Button>
                          <Button
                            type="button"
                            variant={modalPaymentMethod === 'MOBILE' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setModalPaymentMethod('MOBILE')}
                            className={modalPaymentMethod === 'MOBILE' ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}
                          >
                            Mobile
                          </Button>
                          <Button
                            type="button"
                            variant={modalPaymentMethod === 'BANK_TRANSFER' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setModalPaymentMethod('BANK_TRANSFER')}
                            className={modalPaymentMethod === 'BANK_TRANSFER' ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}
                          >
                            Bank
                          </Button>
                          <Button
                            type="button"
                            variant={modalPaymentMethod === 'JAZZCASH' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setModalPaymentMethod('JAZZCASH')}
                            className={modalPaymentMethod === 'JAZZCASH' ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}
                          >
                            JazzCash
                          </Button>
                          <Button
                            type="button"
                            variant={modalPaymentMethod === 'EASYPAISA' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setModalPaymentMethod('EASYPAISA')}
                            className={modalPaymentMethod === 'EASYPAISA' ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}
                          >
                            Easypaisa
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Payment Status</Label>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant={modalPaymentStatus === 'COMPLETED' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setModalPaymentStatus('COMPLETED')}
                            className={modalPaymentStatus === 'COMPLETED' ? 'bg-green-600 hover:bg-green-700 text-white' : ''}
                          >
                            Paid
                          </Button>
                          <Button
                            type="button"
                            variant={modalPaymentStatus === 'PENDING' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setModalPaymentStatus('PENDING')}
                            className={modalPaymentStatus === 'PENDING' ? 'bg-yellow-600 hover:bg-yellow-700 text-white' : ''}
                          >
                            Unpaid
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex space-x-3 pt-4 border-t mt-4">
                    <Button
                      onClick={createModalInvoice}
                      disabled={isLoading || modalInvoiceItems.length === 0}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {isLoading ? (
                        "Creating..."
                      ) : (
                        <>
                          <Receipt className="w-4 h-4 mr-2" />
                          Create Invoice
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Barcode scanning: camera capture + unknown-code resolution */}
      <CameraScannerDialog
        open={isCameraScannerOpen}
        onOpenChange={setIsCameraScannerOpen}
        onScan={(code) => { void handleBarcodeScanned(code, scanTarget); }}
      />
      <UnknownBarcodeDialog
        open={!!unknownBarcode}
        barcode={unknownBarcode || ""}
        onClose={() => setUnknownBarcode(null)}
        onCreateProduct={canCreateProducts ? handleCreateProductFromScan : undefined}
        onAssigned={() => {
          if (unknownBarcode) void handleBarcodeScanned(unknownBarcode, scanTarget);
        }}
      />
    </div>
  );
};

// Memoize the component to prevent unnecessary re-renders
export default React.memo(CreateInvoice);