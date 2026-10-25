import { config } from '../lib/config';
import {
  clearStoredSession,
  readStoredUser,
  USER_STORAGE_KEY,
  writeStoredUser,
} from '../lib/session-storage';
import { waitForBackend } from '../utils/backendHealthCheck';
import { normalizeAppRole } from '../utils/app-role';

const API_BASE_URL = config.api.baseUrl;
const API_TIMEOUT = config.api.timeout;
const DEBUG_MODE = config.debug.enabled;
const LOG_LEVEL = config.debug.logLevel;

// Track if backend is ready
let backendReady = false;
let backendCheckPromise: Promise<boolean> | null = null;

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  // Machine-readable error code from the API body (e.g.
  // PRESCRIPTION_REQUIRED) — passed through on failures so callers
  // can react specifically instead of parsing the message.
  code?: string;
}

// POS Hold (parked sales): one held order as the held-orders list
// shows it. `payload` (the full cart state) is only returned by the
// single-record GET used by Resume.
export interface ParkedSaleRecord {
  id: string;
  businessId: string;
  branchId: string;
  createdById: string;
  createdByName?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  label?: string | null;
  itemCount: number;
  grandTotal: number;
  createdAt: string;
  updatedAt: string;
  payload?: Record<string, any>;
}

export interface PartnerApplicationItem {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  website?: string | null;
  message?: string | null;
  source: 'WEB' | 'APP' | string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | string;
  rejectionReason?: string | null;
  createdPartnerId?: string | null;
  createdPartner?: { id: string; name: string; slug: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupportTicketMessageItem {
  id: string;
  ticketId: string;
  authorType: 'TENANT' | 'ADMIN';
  authorId?: string | null;
  body: string;
  createdAt: string;
}

export interface StockTransferItemRecord {
  id: string;
  transferId: string;
  productId: string;
  sourceBatchId: string;
  destBatchId?: string | null;
  quantity: number;
  product: {
    id: string;
    name: string;
    sku: string;
    barcode?: string;
  };
  sourceBatch: {
    id: string;
    batchNo: string;
    quantity: number;
    expireDate?: string;
  };
  destBatch?: {
    id: string;
    batchNo: string;
    quantity: number;
    expireDate?: string;
  } | null;
}

export interface StockTransferRecord {
  id: string;
  transferNumber: string;
  companyId: string;
  fromBranchId: string;
  toBranchId: string;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  notes?: string | null;
  createdBy?: string | null;
  completedBy?: string | null;
  completedAt?: string | null;
  cancelledBy?: string | null;
  cancelledAt?: string | null;
  createdAt: string;
  updatedAt: string;
  fromBranch: { id: string; name: string; address: string };
  toBranch: { id: string; name: string; address: string };
  items: StockTransferItemRecord[];
}

export type PromotionType = 'PERCENT' | 'FLAT' | 'BUY_X_GET_Y';
export type PromotionScope = 'ALL' | 'CATEGORY' | 'PRODUCT';

export interface PromotionRecord {
  id: string;
  companyId: string;
  name: string;
  type: PromotionType;
  value: number;
  buyQty?: number | null;
  getQty?: number | null;
  scope: PromotionScope;
  categoryId?: string | null;
  productId?: string | null;
  code?: string | null;
  minBill?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  usageLimit?: number | null;
  usedCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  category?: { id: string; name: string } | null;
  product?: { id: string; name: string; barcode?: string } | null;
}

export interface PromotionPayload {
  name: string;
  type: PromotionType;
  value?: number;
  buyQty?: number | null;
  getQty?: number | null;
  scope: PromotionScope;
  categoryId?: string | null;
  productId?: string | null;
  code?: string | null;
  minBill?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  usageLimit?: number | null;
  isActive?: boolean;
}

// Tax classes (Wave B5): named rate groups a business sells under.
// Products point at one via taxClassId; products without one use the
// company's default (its isDefault class, else the defaultTax setting).
export interface TaxClassRecord {
  id: string;
  companyId: string;
  name: string;
  rate: number;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaxClassPayload {
  name: string;
  rate: number;
  isDefault?: boolean;
  isActive?: boolean;
}

// Controlled / narcotics register (Gap item 2): append-only dispense
// log for scheduled/controlled medicines. One entry per POS sale line
// of a controlled product (DISPENSE, positive quantity, running
// balance = batch stock after the sale); corrections are REVERSAL
// rows (negative quantity, linked via reversesId) — entries are never
// edited or deleted.
export interface ControlledRegisterEntry {
  id: string;
  companyId: string;
  branchId: string;
  productId: string;
  batchId: string | null;
  batchNo: string | null;
  saleId: string | null;
  saleItemId: string | null;
  entryType: 'DISPENSE' | 'REVERSAL';
  quantity: number;
  balanceAfter: number;
  reversesId: string | null;
  reason: string | null;
  staffUserId: string;
  staffName: string | null;
  customerId: string | null;
  customerName: string | null;
  prescriptionId: string | null;
  prescriptionRef: string | null;
  invoiceNumber: string | null;
  createdAt: string;
  product?: { id: string; name: string; controlledSchedule: string | null; isControlled: boolean };
  batch?: { id: string; batchNo: string; expireDate: string | null } | null;
  sale?: { id: string; invoiceNumber: string | null } | null;
}

export interface ControlledRegisterSummary {
  productId: string;
  productName: string | null;
  batchId: string | null;
  batchNo: string | null;
  totalDispensed: number;
  totalReversed: number;
  netDispensed: number;
  currentBalance: number;
  lastEntryAt: string;
  entryCount: number;
}

export interface ControlledStaffAuditRow {
  staffUserId: string;
  staffName: string | null;
  totalDispensed: number;
  totalReversed: number;
  netDispensed: number;
  entryCount: number;
  dispenseCount: number;
  reversalCount: number;
  lastEntryAt: string | null;
}

export interface ControlledInspectionPack {
  businessName: string | null;
  branchNames: string[];
  period: { from: string | null; to: string | null };
  generatedAt: string;
  generatedBy: string | null;
  totals: { totalDispensed: number; totalReversed: number; netDispensed: number; entryCount: number };
  summary: ControlledRegisterSummary[];
  entries: Array<ControlledRegisterEntry & { branchName: string | null }>;
}

// Prescriptions (Wave C1 — Pharmacy pack): the register of paper
// prescriptions a pharmacy received. A record is never deleted —
// voiding flips isActive off and stamps voidReason/voidedAt; voided
// records cannot be edited or attached to a new sale.
export interface PrescriptionItemRecord {
  id: string;
  prescriptionId: string;
  productId: string;
  productName: string;
  quantity: number;
  dosage?: string | null;
  durationDays?: number | null;
}

export interface PrescriptionRecord {
  id: string;
  companyId: string;
  branchId?: string | null;
  patientName: string;
  patientPhone?: string | null;
  doctorName?: string | null;
  doctorReg?: string | null;
  notes?: string | null;
  imageUrl?: string | null;
  issuedDate: string;
  isActive: boolean;
  voidReason?: string | null;
  voidedAt?: string | null;
  voidedBy?: string | null;
  // Pharmacist review (Wave C5 — gap item 5): PENDING uploads wait
  // for review; REVIEWED can be dispensed against; REJECTED cannot.
  // Staff-entered records are REVIEWED at entry; source marks uploads.
  reviewStatus?: 'PENDING' | 'REVIEWED' | 'REJECTED' | string;
  source?: 'STAFF' | 'ONLINE_UPLOAD' | string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  items?: PrescriptionItemRecord[];
  sales?: Array<{
    id: string;
    invoiceNumber?: string | null;
    totalAmount: number;
    createdAt: string;
  }>;
  _count?: { sales: number };
}

export interface PrescriptionItemPayload {
  productId: string;
  quantity: number;
  dosage?: string | null;
  durationDays?: number | null;
}

export interface PrescriptionPayload {
  branchId?: string | null;
  patientName: string;
  patientPhone?: string | null;
  doctorName?: string | null;
  doctorReg?: string | null;
  notes?: string | null;
  imageUrl?: string | null;
  issuedDate: string;
  items: PrescriptionItemPayload[];
}

// Online pharmacy store — public storefront types (Wave C5 — gap item 5).
export interface StoreInfo {
  business: { id: string; name: string; slug?: string | null };
  branch: { id: string; name: string; address?: string | null; phone?: string | null; email?: string | null };
  onlineStoreEnabled: boolean;
  // Prescription upload is its own pack (Wave C5 — gap item 5, split 2026-10-25)
  prescriptionUploadEnabled: boolean;
  currency: string;
  paymentMethods: string[];
}

export interface StoreProduct {
  id: string;
  name: string;
  description?: string | null;
  formula?: string | null;
  sku?: string | null;
  category?: { id: string; name: string } | null;
  unitsPerPack: number;
  unitsPerStrip?: number | null;
  requiresPrescription: boolean;
  price: number;
  stock: number;
  inStock: boolean;
}

export interface StorePrescriptionUpload {
  patientName: string;
  patientPhone?: string | null;
  doctorName?: string | null;
  doctorReg?: string | null;
  notes?: string | null;
  imageUrl: string;
  issuedDate?: string;
}

export interface StorePrescriptionStatus {
  id: string;
  patientName: string;
  reviewStatus: string;
  reviewNote?: string | null;
  issuedDate: string;
  createdAt: string;
  items?: Array<{ productName: string; quantity: number; dosage?: string | null }>;
}

export interface StoreCheckoutPayload {
  customerName: string;
  customerPhone: string;
  deliveryAddress?: string | null;
  deliveryNotes?: string | null;
  prescriptionId?: string | null;
  items: Array<{ productId: string; quantity: number }>;
}

export interface StoreCheckoutResult {
  id?: string;
  invoiceNumber?: string | null;
  totalAmount?: number;
  paymentStatus?: string;
  status?: string;
  [key: string]: unknown;
}

// Clinic pack (Wave C4): Patient-Lite, Doctors, Appointments/OPD.
// Patients are the CLINIC's register — deliberately separate from the
// sales Customer register (no khata/loyalty); a visit invoice links
// to the patient only through its Appointment.
export interface PatientRecord {
  id: string;
  companyId: string;
  branchId?: string | null;
  name: string;
  phone?: string | null;
  age?: number | null;
  gender?: string | null;
  cnic?: string | null;
  address?: string | null;
  notes?: string | null;
  isActive: boolean;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  appointments?: AppointmentRecord[];
  _count?: { appointments: number };
}

export interface PatientPayload {
  branchId?: string | null;
  name: string;
  phone?: string | null;
  age?: number | null;
  gender?: string | null;
  cnic?: string | null;
  address?: string | null;
  notes?: string | null;
}

export interface DoctorRecord {
  id: string;
  companyId: string;
  name: string;
  specialization?: string | null;
  phone?: string | null;
  consultationFee: number;
  // The DOCTOR's share of the consultation fee, in percent; the
  // clinic keeps the rest. Applies to future visits only — completed
  // visits keep their snapshotted fee/share on the appointment.
  sharePercent: number;
  serviceProductId?: string | null;
  isActive: boolean;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { appointments: number; settlements?: number };
}

export interface DoctorPayload {
  name: string;
  specialization?: string | null;
  phone?: string | null;
  consultationFee?: number;
  sharePercent?: number;
}

export type AppointmentStatus =
  | 'BOOKED'
  | 'CHECKED_IN'
  | 'IN_VISIT'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export interface AppointmentRecord {
  id: string;
  companyId: string;
  branchId?: string | null;
  patientId: string;
  doctorId: string;
  appointmentDate: string;
  tokenNumber: number;
  status: AppointmentStatus;
  reason?: string | null;
  notes?: string | null;
  saleId?: string | null;
  prescriptionId?: string | null;
  feeCharged?: number | null;
  doctorShareAmount?: number | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  patient?: { id: string; name: string; phone?: string | null; age?: number | null; gender?: string | null };
  doctor?: { id: string; name: string; specialization?: string | null };
  sale?: {
    id: string;
    invoiceNumber?: string | null;
    totalAmount: number;
    paymentStatus: string;
    createdAt: string;
  } | null;
  prescription?: {
    id: string;
    patientName: string;
    doctorName?: string | null;
    issuedDate: string;
  } | null;
}

export interface AppointmentPayload {
  patientId: string;
  doctorId: string;
  branchId?: string | null;
  appointmentDate: string;
  reason?: string | null;
  notes?: string | null;
}

export interface CompleteVisitItemPayload {
  productId: string;
  quantity: number;
  unitPrice: number;
  batchId?: string | null;
}

export interface CompleteVisitPayload {
  feeCharged?: number;
  items?: CompleteVisitItemPayload[];
  prescriptionItems?: PrescriptionItemPayload[];
  prescriptionNotes?: string | null;
  paymentMethod?: string;
  paymentStatus?: string;
  paidAmount?: number;
  payments?: Array<{ method: string; amount: number; reference?: string | null }>;
}

export interface CompleteVisitResult {
  appointment: AppointmentRecord;
  sale: any | null;
  prescription: { id: string; patientName: string; doctorName?: string | null } | null;
}

export interface DoctorSettlementRow {
  doctor: { id: string; name: string; specialization?: string | null; isActive: boolean };
  doctorId: string;
  visits: number;
  consultationRevenue: number;
  doctorShare: number;
  clinicShare: number;
  settled: number;
  outstanding: number;
}

export interface DoctorSettlementReport {
  period: { from: string; to: string };
  doctors: DoctorSettlementRow[];
  totals: {
    visits: number;
    consultationRevenue: number;
    doctorShare: number;
    clinicShare: number;
    settled: number;
    outstanding: number;
  };
}

export interface DoctorSettlementRecord {
  id: string;
  companyId: string;
  doctorId: string;
  periodFrom: string;
  periodTo: string;
  amount: number;
  note?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  doctor?: { id: string; name: string; specialization?: string | null };
}

// Hotel pack (Wave C5): PMS-lite — room types + rooms, reservations,
// folios. A folio is the stay's bill: its balance is computed by the
// server from charge/payment rows (summary below), never stored.
export type RoomStatus = 'AVAILABLE' | 'OCCUPIED' | 'DIRTY' | 'MAINTENANCE';

export interface RoomTypeRecord {
  id: string;
  companyId: string;
  name: string;
  ratePerNight: number;
  capacity?: number | null;
  description?: string | null;
  isActive: boolean;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { rooms: number };
}

export interface RoomTypePayload {
  name: string;
  ratePerNight?: number;
  capacity?: number | null;
  description?: string | null;
}

export interface RoomRecord {
  id: string;
  companyId: string;
  branchId?: string | null;
  roomTypeId: string;
  number: string;
  floor?: string | null;
  status: RoomStatus;
  isActive: boolean;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  roomType?: { id: string; name: string; ratePerNight: number; capacity?: number | null };
  folios?: Array<{ id: string; guestName: string; openedAt: string }>;
}

export interface RoomPayload {
  roomTypeId: string;
  number: string;
  branchId?: string | null;
  floor?: string | null;
}

export interface AvailabilityRoom extends RoomRecord {
  bookable: boolean;
  conflicts: Array<{
    id: string;
    guestName: string;
    checkInDate: string;
    checkOutDate: string;
    status: string;
  }>;
}

export type ReservationStatus =
  | 'BOOKED'
  | 'CHECKED_IN'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export interface ReservationRecord {
  id: string;
  companyId: string;
  branchId?: string | null;
  guestName: string;
  guestPhone?: string | null;
  guestCnic?: string | null;
  cnicDocumentUrl?: string | null;
  guestPhotoUrls?: string[] | null;
  roomId: string;
  checkInDate: string;
  checkOutDate: string;
  adults?: number | null;
  children?: number | null;
  source?: string | null;
  status: ReservationStatus;
  folioId?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  room?: {
    id: string;
    number: string;
    floor?: string | null;
    status: string;
    roomType?: { id: string; name: string; ratePerNight: number };
  };
  folio?: {
    id: string;
    status: string;
    openedAt: string;
    closedAt?: string | null;
    rateSnapshot: number;
  } | null;
}

export interface ReservationPayload {
  guestName: string;
  guestPhone?: string | null;
  guestCnic?: string | null;
  cnicDocumentUrl?: string | null;
  guestPhotoUrls?: string[] | null;
  roomId: string;
  branchId?: string | null;
  checkInDate: string;
  checkOutDate: string;
  adults?: number | null;
  children?: number | null;
  source?: string | null;
  notes?: string | null;
}

export type FolioChargeKind = 'ROOM_NIGHT' | 'SERVICE' | 'MANUAL';

export interface FolioChargeRecord {
  id: string;
  folioId: string;
  description: string;
  amount: number;
  kind: FolioChargeKind;
  saleId?: string | null;
  chargeDate: string;
  createdBy?: string | null;
  createdAt: string;
}

export interface FolioPaymentRecord {
  id: string;
  folioId: string;
  amount: number;
  method: string;
  paidAt: string;
  note?: string | null;
  createdBy?: string | null;
  createdAt: string;
}

export interface FolioSummary {
  totalCharges: number;
  totalPayments: number;
  balance: number;
  roomNightCount: number;
  roomNightTotal: number;
  nativeTotal: number;
  chargedToRoomTotal: number;
}

export interface FolioRecord {
  id: string;
  companyId: string;
  branchId?: string | null;
  reservationId?: string | null;
  roomId: string;
  guestName: string;
  guestPhone?: string | null;
  rateSnapshot: number;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt?: string | null;
  saleId?: string | null;
  writeOffAmount?: number | null;
  writeOffNote?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  room?: RoomRecord;
  reservation?: {
    id: string;
    checkInDate: string;
    checkOutDate: string;
    status: string;
    source?: string | null;
  } | null;
  charges?: FolioChargeRecord[];
  payments?: FolioPaymentRecord[];
  summary?: FolioSummary;
  checkoutSale?: {
    id: string;
    invoiceNumber?: string | null;
    totalAmount: number;
    paymentStatus: string;
  } | null;
}

export interface NightAuditRecord {
  date: string;
  occupiedRooms: number;
  arrivals: number;
  departures: number;
  openFolios: number;
  folioRevenuePosted: number;
  paymentsReceived: number;
  expectedDepartures: number;
}

// The register summary a sale carries when it dispensed against a
// prescription (receipts print "Rx: <patient> (Dr. <doctor>)").
export interface SalePrescriptionSummary {
  id: string;
  patientName: string;
  patientPhone?: string | null;
  doctorName?: string | null;
  doctorReg?: string | null;
  issuedDate?: string;
}

// One tax-class group of a sale, as stored on its SaleTaxLine rows
// (name/rate are snapshots from sale creation). taxClassId is null
// for the implicit default group (the defaultTax setting applied).
export interface TaxBreakdownLine {
  taxClassId: string | null;
  className: string;
  rate: number;
  taxableAmount: number;
  taxAmount: number;
}

// Provincial tax (Gap program item 1): PRA / SRB / KPRA / BRA
// alongside FBR. One row per business (branchId null) or per branch
// (branchId set — overrides the business row for that branch). The
// rate/registration are snapshots on each sale's provincial tax
// lines; the sale's provincialTaxAmount is SEPARATE from taxAmount,
// so FBR payloads (which read taxAmount only) never change.
export type ProvincialAuthority = 'PRA' | 'SRB' | 'KPRA' | 'BRA';

export interface ProvincialTaxAuthorityInfo {
  authority: ProvincialAuthority;
  name: string;
  province: string;
}

export interface ProvincialTaxConfigRecord {
  id: string;
  companyId: string;
  branchId: string | null;
  branch?: { id: string; name: string } | null;
  authority: ProvincialAuthority;
  authorityName: string;
  province: string | null;
  registrationNumber: string | null;
  rate: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProvincialTaxConfigPayload {
  authority: ProvincialAuthority;
  registrationNumber?: string | null;
  rate: number;
  branchId?: string | null;
  enabled?: boolean;
}

// One provincial authority line of a sale, as stored on its
// SaleProvincialTaxLine rows (authority/rate are snapshots from sale
// creation). The sale's provincialTaxAmount is the sum of these.
export interface ProvincialTaxBreakdownLine {
  authority: ProvincialAuthority;
  authorityName: string;
  registrationNumber: string | null;
  rate: number;
  taxableAmount: number;
  taxAmount: number;
}

export interface ProvincialTaxSummary {
  from: string | null;
  to: string | null;
  branchId: string | null;
  byAuthority: Array<{
    authority: ProvincialAuthority;
    authorityName: string;
    registrationNumber: string | null;
    rates: number[];
    salesCount: number;
    taxableAmount: number;
    taxAmount: number;
  }>;
  totals: { salesCount: number; taxableAmount: number; taxAmount: number };
}

// FBR POS fiscal integration (Wave B7): per-business IMS config.
// The API token is write-only — reads expose only `hasToken`.
export type FbrEnvironment = 'TEST' | 'SANDBOX' | 'PRODUCTION';

export interface FbrConfigRecord {
  enabled: boolean;
  posId: string;
  environment: FbrEnvironment;
  sellerName: string;
  sellerStrn: string;
  hasToken: boolean;
  updatedAt: string | null;
}

// Backup & Restore: the summary the restore endpoint returns per
// restored business.
export interface BackupRestoreResult {
  restored: Array<{
    businessId: string;
    name: string;
    counts: Record<string, number>;
    skippedStaff: Array<{ email: string; name?: string; roleName?: string }>;
    warnings: string[];
  }>;
}

// Backup UPDATE mode: a backup applied INTO a selected business —
// matching rows updated, missing rows re-created, target-only rows
// kept (an update never deletes). A safety backup of the target's
// previous state is stored server-side before anything changes.
export interface BackupUpdateBusinessResult {
  sourceBusinessId: string;
  businessId: string;
  name: string;
  sameBusiness: boolean;
  updated: Record<string, number>;
  added: Record<string, number>;
  kept: Record<string, number>;
  updatedTotal: number;
  addedTotal: number;
  keptTotal: number;
  safetySnapshotId: string;
  skippedStaff: Array<{ email: string; name?: string; roleName?: string }>;
  warnings: string[];
}

export interface BackupUpdateResult {
  updated: BackupUpdateBusinessResult[];
}

export interface BackupUpdatePreview {
  sourceBusinessId: string;
  sourceBusinessName: string;
  targetBusinessId: string;
  targetBusinessName: string;
  sameBusiness: boolean;
  perTable: Record<string, { update: number; add: number; kept: number }>;
  toUpdate: number;
  toAdd: number;
  keptTargetOnly: number;
  skippedMembers: number;
}

export interface BackupUpdatePreviewResult {
  previews: BackupUpdatePreview[];
}

export interface BackupSafetySnapshotRecord {
  id: string;
  businessId: string;
  businessName: string;
  sizeBytes: number;
  reason: string;
  sourceKind: string | null;
  createdAt: string;
}

export interface FbrConfigPayload {
  enabled?: boolean;
  posId?: string;
  apiToken?: string;
  clearApiToken?: boolean;
  environment?: FbrEnvironment;
  sellerName?: string;
  sellerStrn?: string;
}

export interface FbrStatusRecord {
  config: FbrConfigRecord;
  counts: Record<'PENDING' | 'SENDING' | 'SENT' | 'TEST' | 'FAILED' | 'SKIPPED', number>;
  recentFailures: Array<{
    id: string;
    saleId: string;
    invoiceNumber: string | null;
    kind: string;
    attempts: number;
    lastError: string | null;
    updatedAt: string;
  }>;
}

export interface BillingProfileRecord {
  id: string;
  userId: string;
  businessId?: string | null;
  name: string;
  email: string;
  phone?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  taxId?: string | null;
  companyName?: string | null;
  paymentMethodId?: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AffiliatePayoutDetails {
  method: 'BANK_TRANSFER' | 'JAZZCASH' | 'EASYPAISA';
  accountTitle: string;
  accountNumber: string;
  bankName?: string | null;
}

export interface AffiliateDashboardData {
  hasProfile: boolean;
  config: { defaultRate: number; minPayout: number };
  affiliate?: {
    id: string;
    code: string;
    status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
    commissionRate: number | null;
    effectiveRate: number;
    payoutDetails: AffiliatePayoutDetails | null;
    createdAt: string;
  };
  stats?: {
    referralsCount: number;
    activeReferredBusinesses: number;
    totalEarned: number;
    pendingApproval: number;
    approvedUnpaid: number;
    paidCommissions: number;
    payoutsPaid: number;
    payoutsRequested: number;
    availableBalance: number;
    canRequestPayout: boolean;
  };
  referralLink?: string;
}

export interface AffiliateReferralItem {
  id: string;
  businessId: string;
  businessName: string | null;
  businessType: string | null;
  signedUpAt: string;
  subscriptionStatus: string | null;
  billingStatus: string | null;
  planName: string | null;
}

export interface AffiliateCommissionItem {
  id: string;
  businessId: string;
  businessName: string | null;
  basisAmount: number;
  rateApplied: number;
  amount: number;
  status: string;
  createdAt: string;
  paidAt: string | null;
}

export interface AffiliatePayoutItem {
  id: string;
  affiliateId: string;
  amount: number;
  status: string;
  note: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface SupportTicketItem {
  id: string;
  businessId?: string | null;
  businessName?: string | null;
  userId?: string | null;
  subject: string;
  description: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  assignedTo?: string | null;
  createdAt: string;
  updatedAt: string;
  messages?: SupportTicketMessageItem[];
  _count?: { messages: number };
}

export class ApiService {
  private baseURL: string;
  private timeout: number;
  private contextGetter: (() => { companyId?: string | number; branchId?: string | number }) | null = null;
  private authRequestLocks = new Map<string, Promise<any>>();
  private pendingRequests = new Map<string, Promise<any>>();
  private lastRequestTime = new Map<string, number>();
  private _suppressAuthRequired = false;
  private _accessToken: string | null = null;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
    this.timeout = API_TIMEOUT;
  }

  set suppressAuthRequired(val: boolean) { this._suppressAuthRequired = val; }

  get accessToken(): string | null { return this._accessToken; }

  setAccessToken(token: string | null): void {
    this._accessToken = token;
  }

  setContextGetter(getter: (() => { companyId?: string; branchId?: string }) | null) {
    this.contextGetter = getter;
  }

  // Get CSRF token from cookie
  private getCSRFToken(): string | null {
    try {
      const cookies = document.cookie.split(';');
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'csrf-token' || name === 'XSRF-TOKEN') {
          return decodeURIComponent(value);
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  private async ensureBackendReadyIfElectron() {
    const isElectron = typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined';
    if (!isElectron) return;

    if (backendReady) return;
    if (!backendCheckPromise) {
      backendCheckPromise = (async () => {
        try {
          await waitForBackend(this.baseURL);
          backendReady = true;
          return true;
        } finally {
          backendCheckPromise = null;
        }
      })();
    }

    await backendCheckPromise;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    await this.ensureBackendReadyIfElectron();

    const url = `${this.baseURL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers = new Headers(options.headers || undefined);
      if (!headers.has('Content-Type') && options.body) {
        headers.set('Content-Type', 'application/json');
      }

      // Add Authorization header from instance token first, then fallback to localStorage
      if (!headers.has('Authorization')) {
        if (this._accessToken) {
          headers.set('Authorization', `Bearer ${this._accessToken}`);
        } else {
          try {
            // Desktop persists the embedded-backend token under 'localAccessToken'
            // (provisioned after cloud login); web uses 'token'. Prefer the local
            // token so desktop API calls authenticate against the embedded server.
            const storedToken = localStorage.getItem('localAccessToken') || localStorage.getItem('token');
            if (storedToken) {
              headers.set('Authorization', `Bearer ${storedToken}`);
            }
          } catch { /* ignore */ }
        }
      }

      try {
        const ctx = this.contextGetter ? this.contextGetter() : null;
        const explicitCompanyId = (options as any)?.companyId ? String((options as any).companyId) : '';
        const explicitBranchId = (options as any)?.branchId ? String((options as any).branchId) : '';
        const companyId = explicitCompanyId || (ctx?.companyId ? String(ctx.companyId) : '');
        const branchId = explicitBranchId || (ctx?.branchId ? String(ctx.branchId) : '');
        if (companyId) headers.set('X-Business-ID', companyId);
        if (branchId && !headers.has('X-Zapeera-Omit-Branch-Context')) headers.set('X-Branch-ID', branchId);
        headers.delete('X-Zapeera-Omit-Branch-Context');
      } catch {
        // ignore
      }

      // Add CSRF token for state-changing requests
      const method = (options.method || 'GET').toUpperCase();
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const csrfToken = this.getCSRFToken();
        if (csrfToken) {
          headers.set('X-CSRF-Token', csrfToken);
        }
      }

      // Request deduplication - prevent duplicate requests
      // Include X-Business-ID in the key so requests for different companies don't collide
      const requestKey = `${method}:${url}:${headers.get('X-Business-ID') || ''}`;
      if (method === 'GET' && this.pendingRequests.has(requestKey)) {
        return await this.pendingRequests.get(requestKey)!;
      }

      // Rate limiting disabled during development to prevent loading delays
      // if (method === 'GET') {
      //   const lastTime = this.lastRequestTime.get(requestKey) || 0;
      //   const now = Date.now();
      //   const minDelay = 100;
      //   if (now - lastTime < minDelay) {
      //     await new Promise(resolve => setTimeout(resolve, minDelay - (now - lastTime)));
      //   }
      //   this.lastRequestTime.set(requestKey, Date.now());
      // }

      let response: Response;
      let text: string;

      // Do NOT retry 429 — each retry counts against the rate limit
      const requestPromise = (async () => {
        response = await fetch(url, { ...options, headers, signal: controller.signal, credentials: 'include' });
        text = await response.text();
        return { response, text };
      })();

      const processedRequestPromise: Promise<ApiResponse<T>> = (async () => {
        const { response: finalResponse, text: finalText } = await requestPromise;
        response = finalResponse;
        text = finalText;

        let data: any = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text;
        }

        const contentType = response.headers.get('content-type') || '';
        const looksLikeHtml = typeof data === 'string' && data.trim().startsWith('<');
        if (looksLikeHtml || contentType.includes('text/html')) {
          return {
            success: false,
            message: 'Invalid API response: received HTML instead of JSON. Check API base URL and backend connectivity.',
          };
        }

        if (!response.ok) {
          const message = (data && typeof data === 'object' && data.message) ? data.message : `Request failed (${response.status})`;
          const errorCode = (data && typeof data === 'object' && data.error) ? data.error : null;

          // Force logout only for true authentication failures. Do NOT logout for
          // business-membership 401s (errorCode === 'NO_MEMBERSHIP').
          // When _suppressAuthRequired is set (cloud API), never dispatch authRequired.
          if (response.status === 401 && typeof window !== 'undefined' && !this._suppressAuthRequired) {
            const lowerMsg = (message || '').toLowerCase();
            const isInvalidToken = lowerMsg.includes('invalid token') || lowerMsg.includes('invalid token type') || lowerMsg.includes('unauthorized');

            if (errorCode === 'NO_MEMBERSHIP') {
              // Membership issue - do not treat as auth-required (don't logout)
            } else if (errorCode) {
              // Other error codes (unknown) — treat as auth-required
              window.dispatchEvent(new CustomEvent('authRequired', { detail: { message, errorCode } }));
            } else if (isInvalidToken) {
              // Message-based invalid token detection
              window.dispatchEvent(new CustomEvent('authRequired', { detail: { message, errorCode } }));
            } else {
              // Unknown 401 without explicit token error — do not logout to avoid
              // clearing valid sessions for membership-related responses.
            }
          }

          // Handle module access errors
          if (response.status === 403 && errorCode === 'MODULE_NOT_ALLOWED') {
            // Import and call the error handler
            import('./api-error-handler').then(({ handleApiError }) => {
              handleApiError({
                response: {
                  status: 403,
                  data: {
                    success: false,
                    error: 'MODULE_NOT_ALLOWED',
                    message: message,
                    module: data?.module,
                    upgradeUrl: data?.upgradeUrl,
                  },
                },
              } as any);
            });
          }

          return {
            success: false,
            message: message,
            code: (data && typeof data === 'object' && 'code' in data ? data.code : undefined) as any,
            data: (data && typeof data === 'object' && 'data' in data ? data.data : undefined) as any,
          };
        }

        if (data && typeof data === 'object' && 'success' in data) {
          const result = data as ApiResponse<T>;
          if (endpoint.includes('entitlements')) {
          }
          return result;
        }

        const successResult = { success: true, data: data as T };
        if (endpoint.includes('entitlements')) {
        }
        return successResult;
      })();

      if (method === 'GET') {
        this.pendingRequests.set(requestKey, processedRequestPromise);
        void processedRequestPromise.then(
          () => setTimeout(() => this.pendingRequests.delete(requestKey), 100),
          () => setTimeout(() => this.pendingRequests.delete(requestKey), 100),
        );
      }

      return await processedRequestPromise;
    } catch (e: any) {
      return { success: false, message: e?.message || 'Request failed' };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Authentication
  async login(credentials: { usernameOrEmail: string; password: string }) {
    // CRITICAL: Request lock to prevent multiple simultaneous login requests
    const lockKey = 'auth:login';
    if (this.authRequestLocks.has(lockKey)) {
      return this.authRequestLocks.get(lockKey)!;
    }

    if (DEBUG_MODE) {
    }

    const loginPromise = (async () => {
      try {
      const response = await this.request<{
        user: {
          id: string;
          username: string;
          name: string;
          email?: string;
          profileImage?: string;
          role: string;
          branchId: string;
          companyId?: string;
          createdBy?: string;
          isActive?: boolean;
          businessAccessGranted?: boolean;
          membership?: {
            id: string;
            roleId?: string | null;
            roleName?: string | null;
            status?: string | null;
          } | null;
          memberships?: Array<{
            id: string;
            businessId: string;
            roleId?: string | null;
            roleName?: string | null;
            branchIds?: string[];
            status?: string | null;
          }>;
          platformRole?: string | null;
          platformPermissions?: string[];
        };
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });

      if (!response) {
        return {
          success: false,
          message: 'No response received from server'
        };
      }

      // Two-factor challenge: the password was accepted but a TOTP or
      // recovery code is still required. Pass the challenge through
      // untouched — the login UI collects the code and completes the
      // sign-in via login2fa(). There is deliberately no user/token here.
      if (response.success && (response.data as any)?.twoFactorRequired) {
        return response;
      }

      if (response.success && response.data) {
        const { user, token, sessionToken } = response.data as any;

        // Store JWT token for Authorization header on subsequent requests
        if (token) {
          try {
            localStorage.setItem('token', token);
          } catch { /* ignore */ }
        }

        // Store session token for offline session persistence
        if (sessionToken) {
          try {
            localStorage.setItem('sessionToken', sessionToken);
          } catch { /* ignore */ }
        }

        if (!user || !user.id) {
          return {
            success: false,
            message: 'Invalid user data received from server'
          };
        }

        try {
          const userForStore = {
            ...user,
            role: normalizeAppRole(user.role),
            membership: user.membership
              ? {
                  ...user.membership,
                  roleName: user.membership.roleName ? normalizeAppRole(user.membership.roleName) : undefined,
                }
              : user.membership,
            memberships: Array.isArray(user.memberships)
              ? user.memberships.map((m) => ({
                  ...m,
                  roleName: m.roleName ? normalizeAppRole(m.roleName) : undefined,
                }))
              : user.memberships,
          };
          writeStoredUser(userForStore);
          const storedUser = readStoredUser();

          if (!storedUser) {
            // storage failed; continue but API may fail later
          }
        } catch (storageError: any) {
          return {
            success: false,
            message: 'Failed to save authentication data: ' + storageError?.message
          };
        }
      }

      return response;
    } catch (error: any) {
      // Return error response in expected format
      return {
        success: false,
        message: error?.message || 'Login request failed',
        accountDisabled: error?.response?.accountDisabled || false
      };
      } finally {
        // Always remove lock when done
        this.authRequestLocks.delete(lockKey);
      }
    })();

    // Store the promise in the lock
    this.authRequestLocks.set(lockKey, loginPromise);
    return loginPromise;
  }

  /**
   * Complete a two-factor-challenged login. The challengeToken came from
   * login() when the account has real 2FA enabled; exactly one of `code`
   * (6-digit authenticator code) or `recoveryCode` (single-use) is sent.
   * On success the response is the standard login payload and is stored
   * exactly like a normal login.
   */
  async login2fa(payload: { challengeToken: string; code?: string; recoveryCode?: string }): Promise<ApiResponse<any>> {
    try {
      const response = await this.request<any>('/auth/login/2fa', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!response) {
        return { success: false, message: 'No response received from server' };
      }

      if (response.success && response.data) {
        const { user, token, sessionToken } = response.data as any;

        if (token) {
          try { localStorage.setItem('token', token); } catch { /* ignore */ }
        }
        if (sessionToken) {
          try { localStorage.setItem('sessionToken', sessionToken); } catch { /* ignore */ }
        }

        if (!user || !user.id) {
          return { success: false, message: 'Invalid user data received from server' };
        }

        try {
          const userForStore = {
            ...user,
            role: normalizeAppRole(user.role),
            membership: user.membership
              ? {
                  ...user.membership,
                  roleName: user.membership.roleName ? normalizeAppRole(user.membership.roleName) : undefined,
                }
              : user.membership,
            memberships: Array.isArray(user.memberships)
              ? user.memberships.map((m: any) => ({
                  ...m,
                  roleName: m.roleName ? normalizeAppRole(m.roleName) : undefined,
                }))
              : user.memberships,
          };
          writeStoredUser(userForStore);
        } catch (storageError: any) {
          return {
            success: false,
            message: 'Failed to save authentication data: ' + storageError?.message
          };
        }
      }

      return response;
    } catch (error: any) {
      return {
        success: false,
        message: error?.message || 'Verification request failed'
      };
    }
  }

  // ── Two-factor authentication management (Profile & Security) ──────────

  /** Step 1 of enrollment: password re-confirm → pending secret + otpauth URI. */
  async setup2fa(password: string) {
    return this.request<{ secret: string; otpauthUri: string }>('/auth/2fa/setup', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  }

  /** Step 2 of enrollment: prove a TOTP code → enabled + recovery codes (shown once). */
  async enable2fa(code: string) {
    return this.request<{ recoveryCodes: string[] }>('/auth/2fa/enable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  /** Disable 2FA with a current TOTP code, a recovery code, or (legacy flag-only accounts) the password. */
  async disable2fa(payload: { code?: string; recoveryCode?: string; password?: string }) {
    return this.request('/auth/2fa/disable', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /** Issue a fresh recovery-code set (requires a valid TOTP); old codes stop working. */
  async regenerate2faRecoveryCodes(code: string) {
    return this.request<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes/regenerate', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  // Offline session login - validates existing session without password
  async sessionLogin() {
    const sessionToken = localStorage.getItem('sessionToken');
    if (!sessionToken) {
      return { success: false, message: 'No session token available', needsReauth: true };
    }

    const response = await this.request<{
      user: any;
      token: string;
      sessionToken: string;
      offline: boolean;
      offlineGrace: boolean;
    }>('/auth/session/login', {
      method: 'POST',
      body: JSON.stringify({ sessionToken }),
    });

    if (response.success && response.data) {
      const { token, sessionToken: newSessionToken } = response.data as any;

      if (token) {
        try { localStorage.setItem('token', token); } catch { }
      }
      if (newSessionToken) {
        try { localStorage.setItem('sessionToken', newSessionToken); } catch { }
      }
    }

    return response;
  }

  // Sync account data from cloud (memberships, businesses, roles)
  async syncAccount() {
    return this.request<{
      localIdentity: any;
      memberships: any[];
      businesses: any[];
      roles: string[];
    }>('/sync/account', {
      method: 'POST',
    });
  }

  async register(userData: {
    username: string;
    email: string;
    password: string;
    name: string;
    role?: string;
    refCode?: string;
    branchId: string;
    partnerSlug?: string;
    branchData?: {
      name: string;
      address: string;
      phone: string;
    };
  }) {
    // CRITICAL: Request lock to prevent multiple simultaneous register requests
    const lockKey = 'auth:register';
    if (this.authRequestLocks.has(lockKey)) {
      return this.authRequestLocks.get(lockKey)!;
    }

    const registerPromise = (async () => {
      try {
        const response = await this.request<{
          user: {
            id: string;
            username: string;
            name: string;
            role: string;
            branchId: string;
            adminId?: string;
          };
        }>('/auth/register', {
          method: 'POST',
          body: JSON.stringify(userData),
        });

        // Only store user data if registration was successful AND user was returned
        // For accounts pending activation, no user data is returned - don't store anything
        if (response.success && response.data && response.data.user) {
          const u = response.data.user;
          const userForStore = { ...u, role: normalizeAppRole(u.role) };
          writeStoredUser(userForStore);
        } else if (response.success) {
          // Registration successful but no token (pending activation) - ensure no stale data
          clearStoredSession();
          localStorage.removeItem('auth_initialized');
        }

        return response;
      } finally {
        // Always remove lock when done
        this.authRequestLocks.delete(lockKey);
      }
    })();

    // Store the promise in the lock
    this.authRequestLocks.set(lockKey, registerPromise);
    return registerPromise;
  }

  // ─── White-label branding + partner portal (Feature 3) ─────────────
  // GET /branding is public (optional auth): with a slug it returns
  // that partner's public branding; authenticated without a slug it
  // resolves the partner behind the caller's current business.
  async getBranding(slug?: string) {
    const query = slug ? `?slug=${encodeURIComponent(slug)}` : '';
    return this.request<{
      productName: string;
      logoUrl: string | null;
      primaryColor: string | null;
      tagline: string | null;
      supportEmail: string | null;
      partnerSlug: string | null;
      viewer: {
        isPartnerAdmin: boolean;
        partnerSlug: string | null;
        partnerStatus: string | null;
      };
    }>(`/branding${query}`);
  }

  async getMyPartner() {
    return this.request<{
      partner: {
        id: string;
        name: string;
        slug: string;
        logoUrl: string | null;
        primaryColor: string | null;
        supportEmail: string | null;
        tagline: string | null;
        status: string;
        createdAt: string;
        updatedAt: string;
      };
      totals: { businessCount: number; activeBusinessCount: number };
    }>('/partners/me');
  }

  async getMyPartnerBusinesses() {
    return this.request<
      Array<{
        id: string;
        name: string;
        slug: string | null;
        businessType: string | null;
        isActive: boolean;
        createdAt: string;
        planName: string | null;
        planPrice: number | null;
        subscriptionStatus: string | null;
        billingStatus: string | null;
        currentPeriodEnd: string | null;
      }>
    >('/partners/me/businesses');
  }

  async updateMyPartnerBranding(data: {
    name?: string;
    logoUrl?: string | null;
    primaryColor?: string | null;
    tagline?: string | null;
    supportEmail?: string | null;
  }) {
    return this.request<{ partner: { id: string; name: string; slug: string } }>('/partners/me/branding', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // ── Partner applications (white-label reseller onboarding) ──────────
  async applyForPartner(data: {
    companyName: string;
    contactName?: string;
    phone: string;
    website?: string;
    message?: string;
  }) {
    return this.request<PartnerApplicationItem>('/partners/apply-authenticated', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getMyPartnerApplication() {
    return this.request<{ application: PartnerApplicationItem | null }>('/partners/my-application');
  }

  async getProfile() {
    return this.request<{
      id: string;
      username: string;
      name: string;
      role: string;
      email: string;
      profileImage?: string;
      phone?: string | null;
      address?: string | null;
      city?: string | null;
      country?: string | null;
      dateOfBirth?: string | null;
      bio?: string | null;
      twoFactorEnabled?: boolean;
      twoFactorConfigured?: boolean;
      branchId: string;
      branch?: {
        id: string;
        name: string;
      };
    }>('/auth/profile');
  }

  // Device presence — the account dashboard's "Desktop Connected" count.
  // Presence is recorded on the server by the desktop app's check-ins
  // (per user, never per this client), so this is the one source of truth
  // on web and desktop alike. On desktop the embedded server proxies the
  // call to the cloud with the stored cloud token.
  async getMyDevices() {
    return this.request<{
      devices: Array<{
        deviceId: string;
        platform?: string | null;
        hostname?: string | null;
        status: string;
        lastSeenAt?: string | null;
        connected: boolean;
      }>;
      desktopConnected: number;
    }>('/devices/my');
  }

  // Forgot Password - Request password reset
  // Accepts either email or username (for consistency with login)
  async forgotPassword(emailOrUsername: string): Promise<{
    success: boolean;
    message: string;
    contactNumber?: string;
  }> {
    const response = await this.request<{
      contactNumber?: string;
    }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({
        email: emailOrUsername, // Backend will check both email and username
        username: emailOrUsername // Send both for backend flexibility
      }),
    });

    // Return the response directly with contactNumber at root level
    return {
      success: response.success,
      message: response.message || 'If an account with that email exists, you will receive a password reset link shortly.',
      contactNumber: response.data?.contactNumber || (response as any).contactNumber
    };
  }

  // Verify Reset Token - Check if reset token is valid
  async verifyResetToken(token: string): Promise<{
    success: boolean;
    message: string;
    data?: { email: string; name: string };
  }> {
    const queryParams = new URLSearchParams({ token });
    const response = await this.request<{
      email: string;
      name: string;
    }>(`/auth/verify-reset-token?${queryParams.toString()}`, {
      method: 'GET',
    });

    return {
      success: response.success,
      message: response.message || '',
      data: response.data
    };
  }

  // Verify Email
  async verifyEmail(token: string): Promise<{
    success: boolean;
    message: string;
    expired?: boolean;
  }> {
    const response = await this.request(`/auth/verify-email?token=${encodeURIComponent(token)}`, {
      method: 'GET',
    });
    return {
      success: response.success,
      message: response.message || '',
      expired: (response as any).expired,
    };
  }

  // Resend Verification Email
  async resendVerificationEmail(email: string): Promise<{
    success: boolean;
    message: string;
  }> {
    const response = await this.request('/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    return {
      success: response.success,
      message: response.message || 'If an account exists, a new verification link has been sent.',
    };
  }

  // Reset Password with Token - Reset password using token from email
  async resetPasswordWithToken(token: string, newPassword: string): Promise<{
    success: boolean;
    message: string;
  }> {
    const response = await this.request('/auth/reset-password-with-token', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    });

    return {
      success: response.success,
      message: response.message || 'Password reset successful'
    };
  }

  // Reset Password (Admin only)
  async resetPassword(data: { userId?: string; email?: string; newPassword: string }) {
    return this.request<{
      email: string;
      name: string;
    }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async changePassword(passwordData: {
    currentPassword: string;
    newPassword: string;
  }) {
    return this.request<{
      success: boolean;
      message: string;
    }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(passwordData),
    });
  }

  async updateProfile(profileData: {
    name?: string;
    username?: string;
    email?: string;
    profileImage?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    country?: string | null;
    dateOfBirth?: string | null;
    bio?: string | null;
    // twoFactorEnabled is intentionally NOT settable here — 2FA state only
    // changes through the /auth/2fa/* endpoints below.
  }) {
    const result = await this.request<{
      id: string;
      username: string;
      name: string;
      email: string;
      profileImage?: string;
      phone?: string | null;
      address?: string | null;
      city?: string | null;
      country?: string | null;
      dateOfBirth?: string | null;
      bio?: string | null;
      twoFactorEnabled?: boolean;
      twoFactorConfigured?: boolean;
      role: string;
      branchId: string;
      updatedAt: string;
    }>('/auth/update-profile', {
      method: 'PUT',
      body: JSON.stringify(profileData),
    });

    // Keep the stored session user in sync with the saved profile. The web
    // AuthContext restores the user from the localStorage snapshot written
    // at login and (unlike desktop) never refetches /auth/profile on boot —
    // so without this merge, a saved change (most visibly the profile
    // picture) never reaches the avatar/header after the page reloads; the
    // UI kept rendering the login-time snapshot while the server had the
    // new value. Same write pattern as login/register above. Only the
    // profile fields the update endpoint authoritatively returns are
    // merged; role/membership in the snapshot are left untouched.
    if (result.success && result.data && result.data.id) {
      try {
        const storedRaw = readStoredUser();
        if (storedRaw) {
          const stored = JSON.parse(storedRaw);
          if (stored && String(stored.id) === String(result.data.id)) {
            const d = result.data as Record<string, unknown>;
            const merged = { ...stored };
            for (const key of [
              'name', 'username', 'email', 'profileImage', 'phone', 'address',
              'city', 'country', 'dateOfBirth', 'bio', 'twoFactorEnabled',
            ]) {
              if (d[key] !== undefined) merged[key] = d[key];
            }
            writeStoredUser(merged);
          }
        }
      } catch {
        // Storage sync is best-effort; the update itself already succeeded.
      }
    }

    return result;
  }

  // Branches
  async getBranches(options?: { skipCache?: boolean }) {
    const headers: Record<string, string> = {};
    if (options?.skipCache) {
      headers['X-Zapeera-Skip-Cache'] = '1';
    }
    headers['X-Zapeera-Omit-Branch-Context'] = '1';

    return this.request<{
      branches: Array<{
        id: string;
        name: string;
        address: string;
        phone: string;
        email: string;
        managerId?: string;
        companyId: string;
        isActive: boolean;
        createdAt: string;
        company?: {
          id: string;
          name: string;
        };
        _count?: {
          users: number;
          products: number;
          customers: number;
        };
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
      pages: number;
    };
  }>('/branches', {
    headers
  });
  }

  // Products
  async getProducts(params?: {
    page?: number;
    limit?: number;
    search?: string;
    category?: string;
    categoryType?: string;
    branchId?: string;
    companyId?: string;
    lowStock?: boolean;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      products: Array<{
        id: string;
        name: string;
        description?: string;
        category: { id: string; name: string };
        supplier: { id: string; name: string };
        branch: { id: string; name: string };
        costPrice: number;
        sellingPrice: number;
        stock: number;
        minStock: number;
        maxStock?: number;
        reorderLevel?: number | null;
        reorderQuantity?: number | null;
        unitType: string;
        unitsPerPack: number;
        unitsPerStrip: number | null;
        barcode?: string;
        requiresPrescription: boolean;
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/products${query ? `?${query}` : ''}`);
  }

  async getProduct(productId: string) {
    return this.request<{
      id: string;
      name: string;
      description?: string;
      formula?: string;
      category: { id: string; name: string };
      supplier: { id: string; name: string };
      branch: { id: string; name: string };
      costPrice: number;
      sellingPrice: number;
      stock: number;
      minStock: number;
      maxStock?: number;
      reorderLevel?: number | null;
      reorderQuantity?: number | null;
      unitType: string;
      unitsPerPack: number;
        unitsPerStrip: number | null;
      barcode?: string;
      requiresPrescription: boolean;
      // Controlled / narcotics register (Gap item 2).
      isControlled?: boolean;
      controlledSchedule?: string | null;
      taxClassId?: string | null;
      pctCode?: string | null;
      taxClass?: { id: string; name: string; rate: number } | null;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      stockMovements: Array<{
        id: string;
        type: string;
        quantity: number;
        reason?: string;
        reference?: string;
        createdAt: string;
      }>;
    }>(`/products/${productId}`);
  }

  async getStockMovements(params?: {
    page?: number;
    limit?: number;
    productId?: string;
    startDate?: string;
    endDate?: string;
    type?: string;
    branchId?: string;
    companyId?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      stockMovements: Array<{
        id: string;
        type: string;
        quantity: number;
        reason?: string;
        reference?: string;
        createdAt: string;
        product: {
          id: string;
          name: string;
          sku?: string;
          unitType: string;
          branch: {
            id: string;
            name: string;
          };
        };
        createdBy?: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/products/stock-movements${query ? `?${query}` : ''}`);
  }

  async createProduct(productData: {
    name: string;
    description?: string;
    formula?: string;
    categoryId?: string | null;
    supplierId?: string | null;
    branchId?: string | null;
    barcode?: string | null;
    requiresPrescription?: boolean;
    isControlled?: boolean; // Gap item 2 - controlled/scheduled medicine
    controlledSchedule?: string | null; // Gap item 2 - schedule/category label
    isActive?: boolean;
    taxClassId?: string | null;
    pctCode?: string | null;
    // Temporary fields for backend compatibility
    costPrice?: number;
    sellingPrice?: number;
    stock?: number;
    minStock?: number;
    maxStock?: number;
    reorderLevel?: number | null;
    reorderQuantity?: number | null;
    unitsPerPack?: number;
    unitsPerStrip?: number | null;
  }) {
    return this.request<{
      id: string;
      name: string;
      description?: string;
      formula?: string;
      category: { id: string; name: string };
      supplier: { id: string; name: string };
      taxClass?: { id: string; name: string; rate: number } | null;
      branch: { id: string; name: string };
      barcode?: string;
      requiresPrescription: boolean;
      isControlled?: boolean; // Gap item 2
      controlledSchedule?: string | null; // Gap item 2
      isActive: boolean;
      createdAt: string;
      // Temporary fields for backend compatibility
      costPrice?: number;
      sellingPrice?: number;
      stock?: number;
      minStock?: number;
      maxStock?: number;
      unitsPerPack?: number;
    unitsPerStrip?: number | null;
    }>('/products', {
      method: 'POST',
      body: JSON.stringify(productData),
    });
  }

  async bulkImportProducts(products: Array<{
    name: string;
    description?: string;
    categoryId: string;
    categoryName?: string; // For auto-creating categories
    supplierId: string;
    branchId: string;
    costPrice: number;
    sellingPrice: number;
    stock: number;
    minStock?: number;
    maxStock?: number;
    unitType: string;
    unitsPerPack: number;
        unitsPerStrip: number | null;
    barcode?: string;
    requiresPrescription?: boolean;
  }>) {
    return this.request<{
      successful: Array<{
        id: string;
        name: string;
        description?: string;
        category: { id: string; name: string };
        supplier: { id: string; name: string };
        branch: { id: string; name: string };
        costPrice: number;
        sellingPrice: number;
        stock: number;
        minStock: number;
        maxStock?: number;
        unitType: string;
        unitsPerPack: number;
        unitsPerStrip: number | null;
        barcode?: string;
        requiresPrescription: boolean;
        isActive: boolean;
        createdAt: string;
      }>;
      failed: Array<{
        product: any;
        error: string;
      }>;
      total: number;
      successCount: number;
      failureCount: number;
    }>('/products/bulk-import', {
      method: 'POST',
      body: JSON.stringify({ products }),
    });
  }

  async updateProduct(productId: string, productData: {
    name?: string;
    description?: string;
    categoryId?: string;
    supplierId?: string;
    taxClassId?: string | null;
    pctCode?: string | null;
    costPrice?: number;
    sellingPrice?: number;
    stock?: number;
    minStock?: number;
    maxStock?: number;
    reorderLevel?: number | null;
    reorderQuantity?: number | null;
    unitType?: string;
    unitsPerPack?: number;
    unitsPerStrip?: number | null;
    barcode?: string;
    requiresPrescription?: boolean;
    isControlled?: boolean; // Gap item 2
    controlledSchedule?: string | null; // Gap item 2
    isActive?: boolean;
  }) {
    return this.request<{
      id: string;
      name: string;
      description?: string;
      category: { id: string; name: string };
      supplier: { id: string; name: string };
      branch: { id: string; name: string };
      costPrice: number;
      sellingPrice: number;
      stock: number;
      minStock: number;
      maxStock?: number;
      unitType: string;
      unitsPerPack: number;
        unitsPerStrip: number | null;
      taxClass?: { id: string; name: string; rate: number } | null;
      barcode?: string;
      requiresPrescription: boolean;
      isControlled?: boolean; // Gap item 2
      controlledSchedule?: string | null; // Gap item 2
      isActive: boolean;
      updatedAt: string;
    }>(`/products/${productId}`, {
      method: 'PUT',
      body: JSON.stringify(productData),
    });
  }

  async deleteProduct(productId: string) {
    return this.request<{ message: string }>(`/products/${productId}`, {
      method: 'DELETE',
    });
  }

  // Medicine master catalog (Wave C3): curated starter dataset of common
  // Pakistani-pharmacy medicines, annotated with alreadyExists per business.
  async getMedicineMasterCatalog() {
    return this.request<{
      entries: Array<{
        index: number;
        id: string;
        brandName: string;
        genericName: string;
        strength: string;
        form: string;
        packSize: number;
        unitsPerStrip: number | null;
        manufacturer: string;
        category: string;
        requiresPrescription: boolean;
        productName: string;
        alreadyExists: boolean;
      }>;
      total: number;
      existingCount: number;
    }>('/products/master-catalog');
  }

  async importMedicineMaster(entries: Array<string | number>) {
    return this.request<{
      created: Array<{ entryId: string; productId: string; name: string }>;
      skipped: Array<{ entryId: string; name: string; reason: string }>;
      failed: Array<{ entryId: string; name: string; error: string }>;
    }>('/products/import-master', {
      method: 'POST',
      body: JSON.stringify({ entries }),
    });
  }

  // Product variants (Wave C6 — Retail pack): the size x colour
  // matrix of a product. Stock lives on batches of a variant; the
  // variant itself carries identity + a price delta.
  async getProductVariants(productId: string) {
    return this.request<Array<{
      id: string; productId: string; name: string;
      sku?: string | null; barcode?: string | null;
      attributes?: Record<string, string> | null;
      priceDelta: number; isActive: boolean; stock: number;
    }>>(`/products/${productId}/variants`);
  }

  async createProductVariant(productId: string, data: {
    name?: string;
    sku?: string | null;
    barcode?: string | null;
    attributes?: Record<string, string>;
    priceDelta?: number;
  }) {
    return this.request<any>(`/products/${productId}/variants`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async generateProductVariants(productId: string, data: { sizes?: string[]; colors?: string[] }) {
    return this.request<{ created: any[]; skipped: number; total: number }>(`/products/${productId}/variants/generate`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateProductVariant(productId: string, variantId: string, data: {
    name?: string;
    sku?: string | null;
    barcode?: string | null;
    attributes?: Record<string, string>;
    priceDelta?: number;
    isActive?: boolean;
  }) {
    return this.request<any>(`/products/${productId}/variants/${variantId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deactivateProductVariant(productId: string, variantId: string) {
    return this.request<any>(`/products/${productId}/variants/${variantId}`, {
      method: 'DELETE',
    });
  }

  // Stock-takes (Wave C6 — Retail pack): physical counts with
  // variance. Completing a session rewrites batch quantities to the
  // counted values and posts STOCK_TAKE_ADJUSTMENT movements.
  async getStockTakes(params?: { branchId?: string; status?: string }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          queryParams.append(key, value.toString());
        }
      });
    }
    const query = queryParams.toString();
    return this.request<any[]>(`/stock-takes${query ? `?${query}` : ''}`);
  }

  async createStockTake(data: { branchId: string; note?: string }) {
    return this.request<any>('/stock-takes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getStockTake(id: string) {
    return this.request<any>(`/stock-takes/${id}`);
  }

  async upsertStockTakeLine(id: string, data: { batchId: string; countedQty: number }) {
    return this.request<any>(`/stock-takes/${id}/lines`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteStockTakeLine(id: string, lineId: string) {
    return this.request<any>(`/stock-takes/${id}/lines/${lineId}`, {
      method: 'DELETE',
    });
  }

  async completeStockTake(id: string) {
    return this.request<any>(`/stock-takes/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async cancelStockTake(id: string) {
    return this.request<any>(`/stock-takes/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async bulkDeleteProducts(productIds: string[]) {
    return this.request<{
      message: string;
      data: {
        deletedCount: number;
        deletedProducts: Array<{ id: string; name: string }>
      }
    }>('/products/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ productIds }),
    });
  }

  async updateStock(productId: string, stockData: {
    type: 'IN' | 'OUT' | 'ADJUSTMENT' | 'RETURN';
    quantity: number;
    reason?: string;
    reference?: string;
  }) {
    return this.request<{
      id: string;
      name: string;
      stock: number;
      category: { id: string; name: string };
      supplier: { id: string; name: string };
      branch: { id: string; name: string };
    }>(`/products/${productId}/stock`, {
      method: 'PATCH',
      body: JSON.stringify(stockData),
    });
  }

  // Customers
  async getCustomers(params?: {
    page?: number;
    limit?: number;
    search?: string;
    branchId?: string;
    companyId?: string;
    vip?: boolean;
    createdByRole?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    const url = query ? `/customers?${query}` : '/customers';
    return this.request<{
      customers: Array<{
        id: string;
        name: string;
        phone: string;
        email?: string;
        address?: string;
        branch: { id: string; name: string };
        totalPurchases: number;
        loyaltyPoints: number;
        isVIP: boolean;
        creditLimit?: number | null;
        lastVisit?: string;
        isActive: boolean;
        // Khata balance (Wave B2): SUM of the customer's ledger rows —
        // positive means the customer owes the shop.
        balance: number;
        createdAt: string;
        updatedAt: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(url);
  }

  async createCustomer(customerData: {
    name: string;
    phone: string;
    email?: string;
    address?: string;
    branchId: string;
    // Credit limit (khata, gap item 7): max outstanding udhaar in PKR.
    // Null/absent = no limit.
    creditLimit?: number | null;
  }) {
    return this.request<{
      id: string;
      name: string;
      phone: string;
      email?: string;
      address?: string;
      branch: { id: string; name: string };
      totalPurchases: number;
      loyaltyPoints: number;
      isVIP: boolean;
      creditLimit?: number | null;
      lastVisit?: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }>('/customers', {
      method: 'POST',
      body: JSON.stringify(customerData),
    });
  }

  async updateCustomer(id: string, customerData: {
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
    isVIP?: boolean;
    isActive?: boolean;
    // Credit limit (khata, gap item 7): null clears the limit.
    creditLimit?: number | null;
  }) {
    return this.request<{
      id: string;
      name: string;
      phone: string;
      email?: string;
      address?: string;
      branch: { id: string; name: string };
      totalPurchases: number;
      loyaltyPoints: number;
      isVIP: boolean;
      creditLimit?: number | null;
      lastVisit?: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }>(`/customers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(customerData),
    });
  }

  async deleteCustomer(id: string) {
    return this.request<{ message: string }>(`/customers/${id}`, {
      method: 'DELETE',
    });
  }

  // Udhaar / khata ledger (Wave B2)
  async getCustomerLedger(customerId: string, params?: {
    page?: number;
    limit?: number;
  }) {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    const query = queryParams.toString();
    return this.request<{
      customer: { id: string; name: string; phone: string };
      summary: {
        balance: number;
        totalDue: number;
        totalPaid: number;
        entryCount: number;
        // Credit limit (gap item 7): null = no limit; availableCredit
        // is what more udhaar the customer may still take.
        creditLimit?: number | null;
        availableCredit?: number | null;
      };
      entries: Array<{
        id: string;
        type: 'SALE_DUE' | 'PAYMENT' | 'ADJUSTMENT' | 'REFUND';
        amount: number;
        method?: string | null;
        reference?: string | null;
        note?: string | null;
        saleId?: string | null;
        sale?: { invoiceNumber?: string | null } | null;
        createdBy?: string | null;
        createdAt: string;
        balanceAfter: number;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/customers/${customerId}/ledger${query ? `?${query}` : ''}`);
  }

  async recordCustomerPayment(customerId: string, data: {
    amount: number;
    method: 'CASH' | 'CARD' | 'JAZZCASH' | 'EASYPAISA' | 'BANK_TRANSFER' | 'MOBILE';
    reference?: string;
    note?: string;
  }) {
    return this.request<{
      entry: {
        id: string;
        type: string;
        amount: number;
        method?: string | null;
        reference?: string | null;
        note?: string | null;
        createdAt: string;
      };
      balance: number;
    }>(`/customers/${customerId}/payments`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async recordCustomerAdjustment(customerId: string, data: {
    amount: number;
    note: string;
  }) {
    return this.request<{
      entry: {
        id: string;
        type: string;
        amount: number;
        note?: string | null;
        createdAt: string;
      };
      balance: number;
    }>(`/customers/${customerId}/adjustments`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Loyalty points (Wave B3)
  async getCustomerLoyalty(customerId: string, params?: {
    page?: number;
    limit?: number;
  }) {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    const query = queryParams.toString();
    return this.request<{
      customer: { id: string; name: string; phone: string };
      balance: number;
      pointValue: number;
      transactions: Array<{
        id: string;
        type: 'EARN' | 'REDEEM' | 'REVERSAL' | 'ADJUST';
        points: number;
        saleId?: string | null;
        refundId?: string | null;
        note?: string | null;
        sale?: { invoiceNumber?: string | null } | null;
        createdBy?: string | null;
        createdAt: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/customers/${customerId}/loyalty${query ? `?${query}` : ''}`);
  }

  async recordLoyaltyAdjustment(customerId: string, data: {
    points: number;
    note: string;
  }) {
    return this.request<{
      entry: {
        id: string;
        type: string;
        points: number;
        note?: string | null;
        createdAt: string;
      };
      balance: number;
    }>(`/customers/${customerId}/loyalty/adjustments`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Promotions & coupons (Wave B4)
  async getPromotions(params?: {
    page?: number;
    limit?: number;
    type?: string;
    isActive?: boolean;
    search?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }
    const query = queryParams.toString();
    return this.request<PromotionRecord[]>(`/promotions${query ? `?${query}` : ''}`);
  }

  async getPromotion(promotionId: string) {
    return this.request<PromotionRecord>(`/promotions/${promotionId}`);
  }

  async createPromotion(data: PromotionPayload) {
    return this.request<PromotionRecord>('/promotions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updatePromotion(promotionId: string, data: Partial<PromotionPayload>) {
    return this.request<PromotionRecord>(`/promotions/${promotionId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // The backend deactivates (soft delete) so redemption history survives.
  async deletePromotion(promotionId: string) {
    return this.request<PromotionRecord>(`/promotions/${promotionId}`, {
      method: 'DELETE',
    });
  }

  // Tax classes (Wave B5)
  async getTaxClasses(params?: {
    page?: number;
    limit?: number;
    isActive?: boolean;
    search?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }
    const query = queryParams.toString();
    return this.request<TaxClassRecord[]>(`/tax-classes${query ? `?${query}` : ''}`);
  }

  async getTaxClass(taxClassId: string) {
    return this.request<TaxClassRecord>(`/tax-classes/${taxClassId}`);
  }

  async createTaxClass(data: TaxClassPayload) {
    return this.request<TaxClassRecord>('/tax-classes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTaxClass(taxClassId: string, data: Partial<TaxClassPayload>) {
    return this.request<TaxClassRecord>(`/tax-classes/${taxClassId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // The backend retires (soft delete) so past sales' snapshots survive.
  async deleteTaxClass(taxClassId: string) {
    return this.request<TaxClassRecord>(`/tax-classes/${taxClassId}`, {
      method: 'DELETE',
    });
  }

  // Prescriptions (Wave C1 — Pharmacy pack)
  async getPrescriptions(params?: {
    page?: number;
    limit?: number;
    search?: string;
    productId?: string;
    from?: string;
    to?: string;
    isActive?: boolean;
    reviewStatus?: string;
    source?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }
    const query = queryParams.toString();
    return this.request<PrescriptionRecord[]>(`/prescriptions${query ? `?${query}` : ''}`);
  }

  async getPrescription(prescriptionId: string) {
    return this.request<PrescriptionRecord>(`/prescriptions/${prescriptionId}`);
  }

  async createPrescription(data: PrescriptionPayload) {
    return this.request<PrescriptionRecord>('/prescriptions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updatePrescription(prescriptionId: string, data: Partial<PrescriptionPayload>) {
    return this.request<PrescriptionRecord>(`/prescriptions/${prescriptionId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Pharmacist review (Wave C5 — gap item 5): approve/reject a
  // customer upload; `items` transcribes the paper prescription's
  // medicines on approve (uploads arrive item-less).
  async reviewPrescription(
    prescriptionId: string,
    data: { decision: 'REVIEWED' | 'REJECTED'; note?: string | null; items?: PrescriptionItemPayload[] }
  ) {
    return this.request<PrescriptionRecord>(`/prescriptions/${prescriptionId}/review`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  // DELETE voids the record (legal register — never a hard delete);
  // the server requires a reason and an OWNER/MANAGER role.
  async voidPrescription(prescriptionId: string, reason: string) {
    return this.request<PrescriptionRecord>(`/prescriptions/${prescriptionId}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    });
  }

  // ── Online pharmacy store — public storefront (Wave C5 — gap item 5)
  // These hit the unauthenticated /api/store/* endpoints: no customer
  // account exists. `request` only attaches an Authorization header
  // when a token is stored, so logged-out customers call these bare;
  // the server ignores any staff headers a logged-in viewer carries.
  async getStoreInfo(branchId: string) {
    return this.request<StoreInfo>(`/store/${encodeURIComponent(branchId)}`);
  }

  async getStoreCatalog(
    branchId: string,
    params?: { search?: string; categoryId?: string; inStock?: boolean; page?: number; limit?: number }
  ) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, value.toString());
      });
    }
    const query = queryParams.toString();
    return this.request<StoreProduct[]>(`/store/${encodeURIComponent(branchId)}/products${query ? `?${query}` : ''}`);
  }

  async getStoreProduct(branchId: string, productId: string) {
    return this.request<StoreProduct>(`/store/${encodeURIComponent(branchId)}/products/${encodeURIComponent(productId)}`);
  }

  async uploadStorePrescription(branchId: string, data: StorePrescriptionUpload) {
    return this.request<{ id: string; patientName: string; reviewStatus: string; source: string; issuedDate: string; createdAt: string }>(
      `/store/${encodeURIComponent(branchId)}/prescriptions`,
      { method: 'POST', body: JSON.stringify(data) }
    );
  }

  async getStorePrescriptionStatus(branchId: string, prescriptionId: string, phone: string) {
    return this.request<StorePrescriptionStatus>(
      `/store/${encodeURIComponent(branchId)}/prescriptions/${encodeURIComponent(prescriptionId)}?phone=${encodeURIComponent(phone)}`
    );
  }

  async checkoutStoreOrder(branchId: string, data: StoreCheckoutPayload) {
    return this.request<StoreCheckoutResult>(`/store/${encodeURIComponent(branchId)}/checkout`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Clinic pack (Wave C4) — Patients
  async getPatients(params?: {
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }
    const query = queryParams.toString();
    return this.request<PatientRecord[]>(`/patients${query ? `?${query}` : ''}`);
  }

  async getPatient(patientId: string) {
    return this.request<PatientRecord>(`/patients/${patientId}`);
  }

  async createPatient(data: PatientPayload) {
    return this.request<PatientRecord>('/patients', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updatePatient(patientId: string, data: Partial<PatientPayload> & { isActive?: boolean }) {
    return this.request<PatientRecord>(`/patients/${patientId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // DELETE deactivates the record (soft — history survives);
  // OWNER/MANAGER only on the server.
  async deactivatePatient(patientId: string) {
    return this.request<PatientRecord>(`/patients/${patientId}`, {
      method: 'DELETE',
    });
  }

  // Clinic pack (Wave C4) — Doctors
  async getDoctors(params?: {
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }
    const query = queryParams.toString();
    return this.request<DoctorRecord[]>(`/doctors${query ? `?${query}` : ''}`);
  }

  async getDoctor(doctorId: string) {
    return this.request<DoctorRecord>(`/doctors/${doctorId}`);
  }

  async createDoctor(data: DoctorPayload) {
    return this.request<DoctorRecord>('/doctors', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateDoctor(doctorId: string, data: Partial<DoctorPayload> & { isActive?: boolean }) {
    return this.request<DoctorRecord>(`/doctors/${doctorId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deactivateDoctor(doctorId: string) {
    return this.request<DoctorRecord>(`/doctors/${doctorId}`, {
      method: 'DELETE',
    });
  }

  // Doctor-share settlement: the report reads COMPLETED appointments'
  // snapshotted fee/share for the window minus payouts made in it.
  async getDoctorSettlementReport(params?: { from?: string; to?: string; doctorId?: string }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }
    const query = queryParams.toString();
    return this.request<DoctorSettlementReport>(`/doctors/settlement-report${query ? `?${query}` : ''}`);
  }

  async getDoctorSettlements(params?: {
    page?: number;
    limit?: number;
    doctorId?: string;
    from?: string;
    to?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }
    const query = queryParams.toString();
    return this.request<DoctorSettlementRecord[]>(`/doctors/settlements${query ? `?${query}` : ''}`);
  }

  async createDoctorSettlement(data: {
    doctorId: string;
    from: string;
    to: string;
    amount: number;
    note?: string | null;
  }) {
    return this.request<DoctorSettlementRecord>('/doctors/settlements', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Clinic pack (Wave C4) — Appointments / OPD queue
  async getAppointments(params?: {
    page?: number;
    limit?: number;
    date?: string;
    from?: string;
    to?: string;
    doctorId?: string;
    patientId?: string;
    status?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }
    const query = queryParams.toString();
    return this.request<AppointmentRecord[]>(`/appointments${query ? `?${query}` : ''}`);
  }

  async getAppointment(appointmentId: string) {
    return this.request<AppointmentRecord>(`/appointments/${appointmentId}`);
  }

  async createAppointment(data: AppointmentPayload) {
    return this.request<AppointmentRecord>('/appointments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateAppointmentStatus(appointmentId: string, status: AppointmentStatus) {
    return this.request<AppointmentRecord>(`/appointments/${appointmentId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  // Completing a visit bills it (consultation fee + extra items)
  // through the sale engine and closes the appointment; the response
  // carries the appointment, the created sale and any prescription.
  async completeVisit(appointmentId: string, data: CompleteVisitPayload) {
    return this.request<CompleteVisitResult>(`/appointments/${appointmentId}/complete-visit`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Hotel pack (Wave C5) — Room types (ride the rooms module)
  async getRoomTypes(params?: { isActive?: boolean }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }
    const query = queryParams.toString();
    return this.request<RoomTypeRecord[]>(`/room-types${query ? `?${query}` : ''}`);
  }

  async createRoomType(data: RoomTypePayload) {
    return this.request<RoomTypeRecord>('/room-types', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateRoomType(roomTypeId: string, data: Partial<RoomTypePayload> & { isActive?: boolean }) {
    return this.request<RoomTypeRecord>(`/room-types/${roomTypeId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // DELETE deactivates the type (soft — rooms keep working);
  // OWNER/MANAGER only on the server.
  async deactivateRoomType(roomTypeId: string) {
    return this.request<RoomTypeRecord>(`/room-types/${roomTypeId}`, {
      method: 'DELETE',
    });
  }

  // Hotel pack (Wave C5) — Rooms
  async getRooms(params?: {
    roomTypeId?: string;
    status?: string;
    isActive?: boolean;
    search?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }
    const query = queryParams.toString();
    return this.request<RoomRecord[]>(`/rooms${query ? `?${query}` : ''}`);
  }

  async createRoom(data: RoomPayload) {
    return this.request<RoomRecord>('/rooms', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateRoom(roomId: string, data: Partial<RoomPayload> & { isActive?: boolean }) {
    return this.request<RoomRecord>(`/rooms/${roomId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Housekeeping board move — the server refuses to set or clear
  // OCCUPIED here (check-in/out own it).
  async updateRoomStatus(roomId: string, status: RoomStatus) {
    return this.request<RoomRecord>(`/rooms/${roomId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  async deactivateRoom(roomId: string) {
    return this.request<RoomRecord>(`/rooms/${roomId}`, {
      method: 'DELETE',
    });
  }

  // Hotel pack (Wave C5) — Reservations
  async getReservations(params?: {
    page?: number;
    limit?: number;
    date?: string;
    from?: string;
    to?: string;
    roomId?: string;
    status?: string;
    search?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }
    const query = queryParams.toString();
    return this.request<ReservationRecord[]>(`/reservations${query ? `?${query}` : ''}`);
  }

  async getAvailability(params: { from: string; to: string; roomTypeId?: string }) {
    const queryParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        queryParams.append(key, value.toString());
      }
    });
    return this.request<AvailabilityRoom[]>(`/reservations/availability?${queryParams.toString()}`);
  }

  async createReservation(data: ReservationPayload) {
    return this.request<ReservationRecord>('/reservations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateReservation(reservationId: string, data: Partial<ReservationPayload>) {
    return this.request<ReservationRecord>(`/reservations/${reservationId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async getReservationById(reservationId: string) {
    return this.request<ReservationRecord>(`/reservations/${reservationId}`);
  }

  /**
   * Upload one reservation guest document (the CNIC scan or a person
   * photo) and get back the ref to attach on create/update. Raw fetch
   * like submitPaymentProof — FormData can't ride this.request() (it
   * would force a JSON Content-Type) — but it still needs the Bearer
   * token, the business/branch context headers and the CSRF header.
   */
  async uploadReservationDocument(file: File, kind: 'cnic' | 'photo') {
    const headers = new Headers();
    const token = this._accessToken
      || (() => {
        try { return localStorage.getItem('localAccessToken') || localStorage.getItem('token'); } catch { return null; }
      })();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    try {
      const ctx = this.contextGetter ? this.contextGetter() : null;
      if (ctx?.companyId) headers.set('X-Business-ID', String(ctx.companyId));
      if (ctx?.branchId) headers.set('X-Branch-ID', String(ctx.branchId));
    } catch { /* ignore */ }
    const csrfToken = this.getCSRFToken();
    if (csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }
    const formData = new FormData();
    formData.append('kind', kind);
    formData.append('file', file);
    const response = await fetch(`${this.baseURL}/reservations/documents/upload`, {
      method: 'POST',
      body: formData,
      headers,
      credentials: 'include',
    });
    return response.json() as Promise<ApiResponse<{ ref: string; kind: string; mime: string }>>;
  }

  /**
   * Fetch an attached reservation document's bytes (authenticated,
   * business-scoped on the server) for blob-URL rendering — the same
   * treatment the backoffice gives payment-proof screenshots.
   */
  async fetchReservationDocumentBlob(reservationId: string, ref: string): Promise<Blob> {
    const filename = ref.split('/').pop();
    if (!filename) throw new Error('Invalid document reference');
    const headers = new Headers();
    const token = this._accessToken
      || (() => {
        try { return localStorage.getItem('localAccessToken') || localStorage.getItem('token'); } catch { return null; }
      })();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    try {
      const ctx = this.contextGetter ? this.contextGetter() : null;
      if (ctx?.companyId) headers.set('X-Business-ID', String(ctx.companyId));
    } catch { /* ignore */ }

    const response = await fetch(
      `${this.baseURL}/reservations/${reservationId}/documents/${encodeURIComponent(filename)}`,
      { method: 'GET', headers, credentials: 'include' }
    );
    if (!response.ok) {
      let message = `Failed to load document (${response.status})`;
      try {
        const data = await response.json();
        if (data?.message) message = data.message;
      } catch { /* non-JSON error body */ }
      throw new Error(message);
    }
    return response.blob();
  }

  // Cancel / no-show only — check-in and completion are flows.
  async updateReservationStatus(reservationId: string, status: 'CANCELLED' | 'NO_SHOW') {
    return this.request<ReservationRecord>(`/reservations/${reservationId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  // Check-in opens the stay's folio (first night posted, room →
  // OCCUPIED) and returns { folio, firstNight, reservation }.
  async checkInReservation(reservationId: string) {
    return this.request<{
      folio: FolioRecord;
      firstNight: FolioChargeRecord;
      reservation: ReservationRecord;
    }>(`/reservations/${reservationId}/check-in`, {
      method: 'POST',
    });
  }

  // Hotel pack (Wave C5) — Folios
  async getFolios(params?: {
    page?: number;
    limit?: number;
    status?: string;
    roomId?: string;
    search?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }
    const query = queryParams.toString();
    return this.request<FolioRecord[]>(`/folios${query ? `?${query}` : ''}`);
  }

  async getFolio(folioId: string) {
    return this.request<FolioRecord>(`/folios/${folioId}`);
  }

  async addFolioCharge(folioId: string, data: { description: string; amount: number; kind?: 'SERVICE' | 'MANUAL' }) {
    return this.request<FolioChargeRecord>(`/folios/${folioId}/charges`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // A negative amount is a refund of guest money (manager + note,
  // enforced on the server).
  async addFolioPayment(folioId: string, data: { amount: number; method: string; note?: string | null }) {
    return this.request<FolioPaymentRecord>(`/folios/${folioId}/payments`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async postNightCharge(folioId: string, date?: string) {
    return this.request<FolioChargeRecord>(`/folios/${folioId}/post-night-charge`, {
      method: 'POST',
      body: JSON.stringify(date ? { date } : {}),
    });
  }

  async postNightChargesBulk(date?: string) {
    return this.request<{
      date: string;
      posted: Array<{ folioId: string; chargeId: string; amount: number }>;
      skipped: Array<{ folioId: string; reason: string }>;
      postedCount: number;
      skippedCount: number;
      postedTotal: number;
    }>('/folios/post-night-charges-bulk', {
      method: 'POST',
      body: JSON.stringify(date ? { date } : {}),
    });
  }

  // Check-out settles the folio (optional final payment, or an
  // explicit manager write-off of the remainder) and returns the
  // closed folio plus the checkout invoice sale, if one was billed.
  async checkOutFolio(
    folioId: string,
    data: {
      payment?: { amount: number; method: string; note?: string | null };
      writeOff?: boolean;
      writeOffNote?: string;
    }
  ) {
    return this.request<{ folio: FolioRecord; sale: any | null }>(`/folios/${folioId}/check-out`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getNightAudit(date?: string) {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    return this.request<NightAuditRecord>(`/folios/night-audit${query}`);
  }

  // FBR POS (Wave B7)
  async getFbrConfig() {
    return this.request<FbrConfigRecord>('/fbr/config');
  }

  async updateFbrConfig(data: FbrConfigPayload) {
    return this.request<FbrConfigRecord>('/fbr/config', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async testFbrConnection() {
    return this.request<{ ok: boolean; environment?: string; message: string }>('/fbr/config/test-connection', {
      method: 'POST',
    });
  }

  async getFbrStatus() {
    return this.request<FbrStatusRecord>('/fbr/status');
  }

  async retryFbr(saleId: string) {
    return this.request<{ queueId: string; status: string }>(`/fbr/retry/${saleId}`, {
      method: 'POST',
    });
  }

  // Provincial tax (Gap program item 1): PRA / SRB / KPRA / BRA.
  // Config writes are owner-only on the server; reads are
  // owner/manager/admin. Retire is a soft disable (delete).
  // The backend returns { success, data: configs, authorities } and
  // the request wrapper passes the whole body through, so the
  // authorities list rides alongside `data` on the response.
  async getProvincialTaxConfigs(): Promise<ApiResponse<ProvincialTaxConfigRecord[]> & { authorities?: ProvincialTaxAuthorityInfo[] }> {
    return this.request<ProvincialTaxConfigRecord[]>('/provincial-tax');
  }

  async createProvincialTaxConfig(data: ProvincialTaxConfigPayload) {
    return this.request<ProvincialTaxConfigRecord>('/provincial-tax', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateProvincialTaxConfig(configId: string, data: Partial<ProvincialTaxConfigPayload>) {
    return this.request<ProvincialTaxConfigRecord>(`/provincial-tax/${configId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // The backend retires (enabled = false) so past sales' snapshots survive.
  async deleteProvincialTaxConfig(configId: string) {
    return this.request<ProvincialTaxConfigRecord>(`/provincial-tax/${configId}`, {
      method: 'DELETE',
    });
  }

  async getProvincialTaxSummary(params?: { from?: string; to?: string; branchId?: string }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, value);
      });
    }
    const query = queryParams.toString();
    return this.request<ProvincialTaxSummary>(`/provincial-tax/summary${query ? `?${query}` : ''}`);
  }

  // Backup & Restore (owner only). Exports are file downloads (the
  // server streams the whole business as one JSON document); a restore
  // posts the parsed file and creates a NEW business from it.
  private async downloadBackupFile(endpoint: string, fallbackName: string): Promise<void> {
    const headers = new Headers();
    const token = this._accessToken
      || (() => {
        try { return localStorage.getItem('localAccessToken') || localStorage.getItem('token'); } catch { return null; }
      })();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    try {
      const ctx = this.contextGetter ? this.contextGetter() : null;
      if (ctx?.companyId) headers.set('X-Business-ID', String(ctx.companyId));
    } catch { /* ignore */ }

    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      let message = `Failed to download backup (${response.status})`;
      try {
        const data = await response.json();
        if (data?.message) message = data.message;
      } catch { /* non-JSON error body */ }
      throw new Error(message);
    }

    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/);
    const filename = match?.[1] || fallbackName;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async downloadBusinessBackup(): Promise<void> {
    return this.downloadBackupFile('/backup/export', 'zapeera-backup.json');
  }

  async downloadAccountBackup(): Promise<void> {
    return this.downloadBackupFile('/backup/export-account', 'zapeera-account-backup.json');
  }

  async restoreBackup(payload: unknown) {
    return this.request<BackupRestoreResult>('/backup/restore', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Dry-run diff for the UPDATE mode — writes nothing.
  async previewRestoreUpdate(payload: unknown, targets: Record<string, string>) {
    return this.request<BackupUpdatePreviewResult>('/backup/restore-preview', {
      method: 'POST',
      body: JSON.stringify({ backup: payload, targets }),
    });
  }

  // Apply a backup INTO the selected business(es).
  async restoreBackupUpdate(payload: unknown, targets: Record<string, string>) {
    return this.request<BackupUpdateResult>('/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ mode: 'update', backup: payload, targets }),
    });
  }

  async listSafetyBackups(businessId?: string) {
    const qs = businessId ? `?businessId=${encodeURIComponent(businessId)}` : '';
    return this.request<{ snapshots: BackupSafetySnapshotRecord[] }>(`/backup/safety-backups${qs}`);
  }

  async downloadSafetyBackup(id: string): Promise<void> {
    return this.downloadBackupFile(
      `/backup/safety-backups/${encodeURIComponent(id)}/download`,
      'zapeera-safety-backup.json'
    );
  }

  async validateCoupon(data: {
    code: string;
    items?: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
      saleType?: string;
      unitLevel?: string; // Wave C2 - PACK | STRIP | UNIT
      unitsDeducted?: number;
      unitsPerBox?: number;
      discountPercentage?: number;
      discountAmount?: number;
    }>;
    discountPercentage?: number;
    discountAmount?: number;
    subtotal?: number;
  }) {
    return this.request<{
      valid: boolean;
      reason?: string;
      promotion?: PromotionRecord;
      estimatedDiscount?: number;
      estimatedTotalPromotionDiscount?: number;
    }>('/promotions/validate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Business settings (subset the POS needs — e.g. the loyalty point
  // value). Values come back as strings, as stored.
  async getSettings() {
    return this.request<Record<string, string>>('/settings');
  }

  // Sales
  async createSale(saleData: {
    customerId?: string;
    // Hotel pack (Wave C5): charge-to-room — set folioId together
    // with paymentMethod 'FOLIO'; the sale is stored unpaid and its
    // total lands on the folio as a SERVICE charge.
    folioId?: string;
    branchId: string;
    items: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
      // Unit engine (Wave C2): when unitLevel is set, quantity is
      // expressed in that level and unitPrice is per level unit.
      unitLevel?: string;
      saleType?: string;
      unitsDeducted?: number;
      unitsPerBox?: number;
      // Product variants (Wave C6): the variant this line sells;
      // the server draws stock only from that variant's batches and
      // snapshots the variant name on the line.
      variantId?: string;
      batchId?: string;
      batchNumber?: string;
      expiryDate?: string;
      discountPercentage?: number;
      discountAmount?: number;
      totalPrice?: number;
    }>;
    paymentMethod: 'CASH' | 'CARD' | 'JAZZCASH' | 'EASYPAISA' | 'MOBILE' | 'BANK_TRANSFER' | 'GIFT_CARD' | 'EWALLET';
    paymentStatus?: string;
    // Split tender (Wave B1): per-method allocations; their sum must
    // equal paidAmount. Omit for a single-tender sale — the server
    // synthesizes the single allocation from paymentMethod + paidAmount.
    // Gift cards / eWallet (Wave C9 — gap item 9): GIFT_CARD rows
    // carry the card code in `reference` (one allocation PER CARD);
    // EWALLET rows spend the sale customer's wallet.
    payments?: Array<{
      method: 'CASH' | 'CARD' | 'JAZZCASH' | 'EASYPAISA' | 'MOBILE' | 'BANK_TRANSFER' | 'GIFT_CARD' | 'EWALLET';
      amount: number;
      reference?: string;
    }>;
    // Gift cards / eWallet + kiosk (Wave C9): the channel this sale
    // came through (POS default; KIOSK for kiosk orders).
    channel?: string;
    // Loyalty redemption (Wave B3): points to spend on this sale.
    // Requires customerId; the server validates the balance and turns
    // the points into a discount at the loyaltyPointValue rate.
    loyaltyPointsToRedeem?: number;
    // Promotions (Wave B4): a coupon code is the only promotion input
    // — the server computes the discount. Automatic promotions need
    // no input at all.
    couponCode?: string;
    // Prescriptions (Wave C1): the register record this sale
    // dispenses against. Required by the server when the cart holds
    // prescription-only items and the business enforces it
    // (requirePrescriptionAtPos); the server validates coverage.
    prescriptionId?: string;
    // Salesperson attribution (Wave C6): the staff USER id credited
    // with the sale when it is not the cashier. Commissions read
    // salespersonId ?? cashier; omit for a cashier's own sale.
    salespersonId?: string;
    // Credit-limit override (gap item 7): explicit owner/manager flag
    // allowing this one credit sale to exceed the customer's limit.
    creditLimitOverride?: boolean;
    paidAmount?: number;
    returnedAmount?: number;
    discountAmount?: number;
    discountPercentage?: number;
    saleDate?: string;
  }) {
    return this.request<{
      id: string;
      customer?: {
        id: string;
        name: string;
        phone: string;
        email?: string;
        address?: string;
        totalPurchases: number;
        loyaltyPoints: number;
        isVIP: boolean;
        creditLimit?: number | null;
        lastVisit?: string;
      };
      items: Array<{
        id: string;
        product: {
          id: string;
          name: string;
          unitType: string;
          barcode?: string;
        };
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        batchNumber?: string;
        expiryDate?: string;
      }>;
      subtotal: number;
      taxAmount: number;
      discountAmount: number;
      // Loyalty (Wave B3): stored columns + friendly aliases the
      // create handler returns (plain numbers, never null).
      loyaltyPointsRedeemed?: number | null;
      loyaltyDiscount?: number;
      loyaltyPointsEarned?: number | null;
      pointsRedeemed?: number;
      pointsEarned?: number;
      // Promotions (Wave B4): stored column + the per-promotion
      // breakdown the create handler returns.
      promotionDiscount?: number;
      appliedPromotions?: Array<{
        promotionId: string;
        name?: string | null;
        code?: string | null;
        type?: string | null;
        discountAmount: number;
      }>;
      // Tax classes (Wave B5): per-class breakdown behind taxAmount.
      taxBreakdown?: TaxBreakdownLine[];
      // Provincial tax (Gap item 1): per-authority breakdown behind
      // provincialTaxAmount (separate from taxAmount / FBR).
      provincialTaxAmount?: number;
      provincialTaxBreakdown?: ProvincialTaxBreakdownLine[];
      // Prescriptions (Wave C1): the attached register summary, and
      // the warning flag set when Rx items were sold without one
      // while the business has enforcement off.
      prescription?: SalePrescriptionSummary | null;
      prescriptionId?: string | null;
      prescriptionWarning?: boolean;
      totalAmount: number;
      paymentMethod: string;
      payments?: Array<{
        id: string;
        method: string;
        amount: number;
        reference?: string | null;
      }>;
      paymentStatus: string;
      status: string;
      createdAt: string;
      receiptNumber: string;
    }>('/sales', {
      method: 'POST',
      body: JSON.stringify(saleData),
    });
  }

  // POS Hold (parked sales): park the current cart server-side and
  // resume it later from the held-orders list. `payload` is the full
  // cart state, stored verbatim; list reads return display snapshots.
  async createParkedSale(data: {
    branchId: string;
    customerId?: string | null;
    label?: string | null;
    itemCount?: number;
    grandTotal?: number;
    payload: Record<string, any>;
  }) {
    return this.request<ParkedSaleRecord>('/parked-sales', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getParkedSales(branchId?: string) {
    const query = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
    return this.request<{ parkedSales: ParkedSaleRecord[] }>(`/parked-sales${query}`);
  }

  async getParkedSale(parkedSaleId: string) {
    return this.request<ParkedSaleRecord>(`/parked-sales/${parkedSaleId}`);
  }

  async deleteParkedSale(parkedSaleId: string) {
    // POST action route, not DELETE: the platform's authorization
    // layer reserves the raw `delete` operation for OWNER, while
    // parking is a create-level action — every role that can park
    // must be able to discard/consume (see parked-sale.routes).
    return this.request<{ id: string }>(`/parked-sales/${parkedSaleId}/discard`, {
      method: 'POST',
    });
  }

  async updateSale(saleId: string, updateData: {
    discountPercentage?: number;
    saleDate?: string;
    notes?: string;
    paymentStatus?: string;
  }) {
    return this.request<{
      id: string;
      invoiceNumber: string;
      customerId?: string;
      userId: string;
      branchId: string;
      subtotal: number;
      taxAmount: number;
      discountAmount: number;
      discountPercentage?: number;
      totalAmount: number;
      paymentMethod: string;
      paymentStatus: string;
      status: string;
      saleDate?: string;
      createdAt: string;
      updatedAt: string;
      receiptNumber: string;
    }>(`/sales/${saleId}`, {
      method: 'PUT',
      body: JSON.stringify(updateData),
    });
  }

  async getSales(params?: {
    page?: number;
    limit?: number;
    startDate?: string;
    endDate?: string;
    branchId?: string;
    companyId?: string;
    customerId?: string;
    paymentMethod?: string;
    // Online store (Wave C5 — gap item 5): the staff online-orders
    // queue is getSales({ channel: 'ONLINE_STORE', status: 'PENDING' }).
    // Gift cards / eWallet + kiosk (Wave C9 — gap item 9): the kiosk
    // orders queue reads channel=KIOSK&status=PENDING.
    channel?: string;
    status?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      sales: Array<{
        id: string;
        customerId?: string;
        userId: string;
        branchId: string;
        subtotal: number;
        taxAmount: number;
        taxBreakdown?: TaxBreakdownLine[];
        // Provincial tax (Gap item 1): per-authority breakdown behind
        // provincialTaxAmount (separate from taxAmount / FBR).
        provincialTaxAmount?: number;
        provincialTaxBreakdown?: ProvincialTaxBreakdownLine[];
        discountAmount: number;
        totalAmount: number;
        paymentMethod: string;
        paymentStatus: string;
        status: string;
        invoiceNumber?: string | null;
        // Online store (Wave C5 — gap item 5)
        channel?: string;
        deliveryAddress?: string | null;
        deliveryPhone?: string | null;
        deliveryNotes?: string | null;
        prescriptionId?: string | null;
        createdAt: string;
        customer?: {
          id: string;
          name: string;
          phone: string;
        };
        user: {
          id: string;
          name: string;
          username: string;
        };
        branch: {
          id: string;
          name: string;
        };
        items: Array<{
          id: string;
          productId: string;
          quantity: number;
          unitPrice: number;
          totalPrice: number;
          product: {
            id: string;
            name: string;
            unitType: string;
          };
        }>;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/sales${query ? `?${query}` : ''}`);
  }

  async getSale(id: string) {
    return this.request<{
      id: string;
      customerId?: string;
      userId: string;
      branchId: string;
      subtotal: number;
      taxAmount: number;
      taxBreakdown?: TaxBreakdownLine[];
      // Provincial tax (Gap item 1): per-authority breakdown behind
      // provincialTaxAmount (separate from taxAmount / FBR).
      provincialTaxAmount?: number;
      provincialTaxBreakdown?: ProvincialTaxBreakdownLine[];
      discountAmount: number;
      totalAmount: number;
      paymentMethod: string;
      paymentStatus: string;
      status: string;
      createdAt: string;
      customer?: {
        id: string;
        name: string;
        phone: string;
        email?: string;
        address?: string;
      };
      user: {
        id: string;
        name: string;
        username: string;
      };
      branch: {
        id: string;
        name: string;
        address: string;
      };
      items: Array<{
        id: string;
        productId: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        batchNumber?: string;
        expiryDate?: string;
        product: {
          id: string;
          name: string;
          unitType: string;
          barcode?: string;
        };
      }>;
      receipts: Array<{
        id: string;
        receiptNumber: string;
        printedAt?: string;
      }>;
    }>(`/sales/${id}`);
  }

  async getSaleByReceiptNumber(receiptNumber: string) {
    return this.request<{
      id: string;
      customerId?: string;
      userId: string;
      branchId: string;
      subtotal: number;
      taxAmount: number;
      discountAmount: number;
      totalAmount: number;
      paymentMethod: string;
      paymentStatus: string;
      status: string;
      createdAt: string;
      customer?: {
        id: string;
        name: string;
        phone: string;
        email?: string;
        address?: string;
      };
      user: {
        id: string;
        name: string;
        username: string;
      };
      branch: {
        id: string;
        name: string;
        address: string;
      };
      items: Array<{
        id: string;
        productId: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        batchNumber?: string;
        expiryDate?: string;
        product: {
          id: string;
          name: string;
          unitType: string;
          barcode?: string;
        };
      }>;
      receipts: Array<{
        id: string;
        receiptNumber: string;
        printedAt?: string;
      }>;
    }>(`/sales/receipt/${receiptNumber}`);
  }

  async getAvailableReceiptNumbers() {
    return this.request<{
      receipts: Array<{
        id: string;
        receiptNumber: string;
        saleId: string;
        printedAt: string;
      }>;
    }>('/sales/receipts');
  }

  // Customer Purchase History
  async getCustomerPurchaseHistory(customerId: string, params?: {
    page?: number;
    limit?: number;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      customer: {
        id: string;
        name: string;
        phone: string;
      };
      sales: Array<{
        id: string;
        totalAmount: number;
        subtotal: number;
        taxAmount: number;
        paymentMethod: string;
        createdAt: string;
        items: Array<{
          id: string;
          product: {
            id: string;
            name: string;
            unitType: string;
          };
          quantity: number;
          unitPrice: number;
          totalPrice: number;
        }>;
        user: {
          name: string;
          username: string;
        };
        branch: {
          name: string;
        };
      }>;
      stats: {
        totalPurchases: number;
        totalSpent: number;
        averageOrder: number;
      };
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/customers/${customerId}/purchase-history${query ? `?${query}` : ''}`);
  }

  // Reports
  async getSalesReport(params?: {
    startDate?: string;
    endDate?: string;
    branchId?: string;
    companyId?: string;
    groupBy?: 'day' | 'week' | 'month' | 'year' | 'hour';
    period?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      summary: {
        totalSales: number;
        totalRevenue: number;
        totalSubtotal: number;
        totalTax: number;
        totalDiscount: number;
      };
      salesByPaymentMethod: Array<{
        paymentMethod: string;
        _sum: { totalAmount: number };
        _count: { id: number };
      }>;
      topProducts: Array<{
        productId: string;
        _sum: { quantity: number; totalPrice: number };
        product: {
          id: string;
          name: string;
          unitType: string;
          category: { name: string };
        };
      }>;
      salesTrend: Array<{
        createdAt: Date;
        _sum: { totalAmount: number };
        _count: { id: number };
      }>;
    }>(`/reports/sales${query ? `?${query}` : ''}`);
  }

  // Controlled / narcotics register (Gap item 2). Reads are
  // OWNER/MANAGER-only (reports.read on the server); corrections are
  // REVERSAL rows via createControlledReversal — entries are never
  // edited or deleted.
  async getControlledRegister(params?: {
    startDate?: string;
    endDate?: string;
    branchId?: string;
    productId?: string;
    batchId?: string;
    staffUserId?: string;
    entryType?: 'DISPENSE' | 'REVERSAL';
    page?: number;
    limit?: number;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }
    const query = queryParams.toString();
    return this.request<{
      entries: ControlledRegisterEntry[];
      summary: ControlledRegisterSummary[];
      totals: { totalDispensed: number; totalReversed: number; netDispensed: number; entryCount: number };
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/controlled-medicines${query ? `?${query}` : ''}`);
  }

  async getControlledRegisterEntry(entryId: string) {
    return this.request<ControlledRegisterEntry>(`/controlled-medicines/${entryId}`);
  }

  async getControlledStaffAudit(params?: {
    startDate?: string;
    endDate?: string;
    branchId?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }
    const query = queryParams.toString();
    return this.request<{
      staff: ControlledStaffAuditRow[];
      totals: { totalDispensed: number; totalReversed: number; netDispensed: number; entryCount: number };
    }>(`/controlled-medicines/audit/staff${query ? `?${query}` : ''}`);
  }

  async getControlledInspectionPack(params?: {
    startDate?: string;
    endDate?: string;
    branchId?: string;
    productId?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }
    const query = queryParams.toString();
    return this.request<ControlledInspectionPack>(`/controlled-medicines/inspection-pack${query ? `?${query}` : ''}`);
  }

  async downloadControlledInspectionPackCsv(params?: {
    startDate?: string;
    endDate?: string;
    branchId?: string;
    productId?: string;
  }): Promise<void> {
    const queryParams = new URLSearchParams({ format: 'csv' });
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }
    return this.downloadBackupFile(`/controlled-medicines/inspection-pack?${queryParams.toString()}`, 'controlled-register.csv');
  }

  async createControlledReversal(data: { originalEntryId: string; quantity: number; reason: string }) {
    return this.request<ControlledRegisterEntry>('/controlled-medicines/reversals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getInventoryReport(params?: {
    branchId?: string;
    companyId?: string;
    lowStock?: boolean;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      summary: {
        totalProducts: number;
        totalStock: number;
        lowStockCount: number;
      };
      productsByCategory: Array<{
        categoryId: string;
        _sum: { stock: number };
        _count: { id: number };
        category: {
          id: string;
          name: string;
        };
      }>;
      lowStockProducts: Array<{
        id: string;
        name: string;
        stock: number;
        minStock: number;
        category: { name: string };
        supplier: { name: string };
      }>;
    }>(`/reports/inventory${query ? `?${query}` : ''}`);
  }

  async getCustomerReport(params?: {
    startDate?: string;
    endDate?: string;
    branchId?: string;
    vip?: boolean;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      summary: {
        totalCustomers: number;
        totalSpent: number;
        totalLoyaltyPoints: number;
        averageSpent: number;
      };
      customersByVIP: Array<{
        isVIP: boolean;
        _count: { id: number };
        _sum: { totalPurchases: number; loyaltyPoints: number };
      }>;
      topCustomers: Array<{
        id: string;
        name: string;
        phone: string;
        totalPurchases: number;
        loyaltyPoints: number;
        lastVisit: string;
        isVIP: boolean;
        _count: { sales: number };
      }>;
      recentCustomers: Array<{
        id: string;
        name: string;
        phone: string;
        createdAt: string;
        totalPurchases: number;
      }>;
    }>(`/reports/customers${query ? `?${query}` : ''}`);
  }

  async getProductPerformanceReport(params?: {
    startDate?: string;
    endDate?: string;
    branchId?: string;
    categoryId?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      topProducts: Array<{
        productId: string;
        _sum: { quantity: number; totalPrice: number };
        _count: { id: number };
        product: {
          id: string;
          name: string;
          unitType: string;
          sellingPrice: number;
          stock: number;
          category: { name: string };
          supplier: { name: string };
        };
      }>;
      categoryPerformance: Array<{
        category: string;
        quantity: number;
        revenue: number;
        count: number;
      }>;
    }>(`/reports/products${query ? `?${query}` : ''}`);
  }

  async getExpenses(params?: {
    startDate?: string;
    endDate?: string;
    branchId?: string;
    companyId?: string;
    categoryId?: string;
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
    omitBranchContext?: boolean;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && key !== 'omitBranchContext') {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    const requestOptions: RequestInit & { headers?: Record<string, string> } = params?.omitBranchContext
      ? { headers: { 'X-Zapeera-Omit-Branch-Context': '1' } }
      : {};
    return this.request<{
      expenses: Array<{
        id: string;
        title: string;
        amount: number;
        category: string;
        categoryId?: string | null;
        categoryRef?: { id: string; name: string } | null;
        description?: string | null;
        vendor?: string | null;
        date: string;
        expenseDate: string;
        paymentMethod: string;
        reference?: string | null;
        status: string;
        branchId?: string | null;
        companyId?: string;
        branch?: { id: string; name: string } | null;
        createdBy?: string | null;
        createdAt: string;
        updatedAt: string;
      }>;
      pagination?: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
      summary: {
        totalExpenses: number;
        byCategory: Array<{
          categoryId?: string | null;
          category: string;
          total: number;
          count: number;
        }>;
      };
    }>(`/expenses${query ? `?${query}` : ''}`, requestOptions);
  }

  async createExpense(expenseData: {
    title?: string;
    description?: string;
    vendor?: string;
    amount: number;
    expenseDate: string;
    paymentMethod?: string;
    reference?: string;
    status?: string;
    categoryId?: string | null;
    branchId?: string | null;
  }) {
    return this.request<{
      id: string;
      title: string;
      description?: string | null;
      vendor?: string | null;
      amount: number;
      expenseDate: string;
      date: string;
      paymentMethod: string;
      reference?: string | null;
      status: string;
      categoryId?: string | null;
      branchId?: string | null;
      companyId: string;
      createdAt: string;
      updatedAt: string;
    }>('/expenses', {
      method: 'POST',
      body: JSON.stringify(expenseData),
      // An explicit null branchId means a company-level expense: stop the
      // request helper from attaching the globally selected branch instead.
      ...(expenseData.branchId === null
        ? { headers: { 'X-Zapeera-Omit-Branch-Context': '1' } }
        : {}),
    });
  }

  async updateExpense(expenseId: string, expenseData: {
    title?: string;
    description?: string;
    vendor?: string;
    amount?: number;
    expenseDate?: string;
    paymentMethod?: string;
    reference?: string;
    status?: string;
    categoryId?: string | null;
    branchId?: string | null;
  }) {
    return this.request<{
      id: string;
      title: string;
      description?: string | null;
      vendor?: string | null;
      amount: number;
      expenseDate: string;
      date: string;
      paymentMethod: string;
      reference?: string | null;
      status: string;
      categoryId?: string | null;
      branchId?: string | null;
      companyId: string;
      createdAt: string;
      updatedAt: string;
    }>(`/expenses/${expenseId}`, {
      method: 'PUT',
      body: JSON.stringify(expenseData),
    });
  }

  async deleteExpense(expenseId: string) {
    return this.request<{ success: boolean; message: string }>(`/expenses/${expenseId}`, {
      method: 'DELETE',
    });
  }

  async getExpenseCategories(params?: {
    search?: string;
    branchId?: string;
    isActive?: boolean;
    omitBranchContext?: boolean;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && key !== 'omitBranchContext') {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    const requestOptions: RequestInit & { headers?: Record<string, string> } = params?.omitBranchContext
      ? { headers: { 'X-Zapeera-Omit-Branch-Context': '1' } }
      : {};
    return this.request<{
      categories: Array<{
        id: string;
        name: string;
        description?: string | null;
        companyId: string;
        branchId?: string | null;
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
        _count?: { expenses: number };
      }>;
    }>(`/expenses/categories${query ? `?${query}` : ''}`, requestOptions);
  }

  async createExpenseCategory(categoryData: {
    name: string;
    description?: string;
    branchId?: string | null;
    isActive?: boolean;
  }) {
    return this.request<{
      id: string;
      name: string;
      description?: string | null;
      companyId: string;
      branchId?: string | null;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }>('/expenses/categories', {
      method: 'POST',
      body: JSON.stringify(categoryData),
    });
  }

  async updateExpenseCategory(categoryId: string, categoryData: {
    name?: string;
    description?: string;
    branchId?: string | null;
    isActive?: boolean;
  }) {
    return this.request<{
      id: string;
      name: string;
      description?: string | null;
      companyId: string;
      branchId?: string | null;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }>(`/expenses/categories/${categoryId}`, {
      method: 'PUT',
      body: JSON.stringify(categoryData),
    });
  }

  async deleteExpenseCategory(categoryId: string) {
    return this.request<{ success: boolean; message: string }>(`/expenses/categories/${categoryId}`, {
      method: 'DELETE',
    });
  }

  // ─── Support tickets ─────────────────────────────────────────────────────
  // Backed by /api/support/tickets (see backend controllers/support.controller.ts).
  // Tenancy is resolved server-side from the authenticated user + the
  // business context this service attaches — no businessId is ever sent.

  async getSupportTickets(params?: { status?: string; page?: number; limit?: number }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, value.toString());
      });
    }
    const query = queryParams.toString();
    return this.request<{
      tickets: SupportTicketItem[];
      pagination: { page: number; limit: number; total: number; pages: number };
    }>(`/support/tickets${query ? `?${query}` : ''}`);
  }

  async createSupportTicket(ticketData: { subject: string; description: string; priority?: string }) {
    return this.request<SupportTicketItem>('/support/tickets', {
      method: 'POST',
      body: JSON.stringify(ticketData),
    });
  }

  async getSupportTicket(ticketId: string) {
    return this.request<SupportTicketItem>(`/support/tickets/${ticketId}`);
  }

  async replyToSupportTicket(ticketId: string, body: string) {
    return this.request<SupportTicketMessageItem>(`/support/tickets/${ticketId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  // ─── Affiliate program ───────────────────────────────────────────────────
  // Backed by /api/affiliates (account-level; no business context needed).

  async joinAffiliate() {
    return this.request<{ id: string; code: string; status: string }>('/affiliates/join', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async getMyAffiliate() {
    return this.request<AffiliateDashboardData>('/affiliates/me');
  }

  async getMyAffiliateReferrals() {
    return this.request<AffiliateReferralItem[]>('/affiliates/me/referrals');
  }

  async getMyAffiliateCommissions(params?: { page?: number; limit?: number; status?: string }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, value.toString());
      });
    }
    const query = queryParams.toString();
    return this.request<{
      commissions: AffiliateCommissionItem[];
      pagination: { page: number; limit: number; total: number; pages: number };
    }>(`/affiliates/me/commissions${query ? `?${query}` : ''}`);
  }

  async getMyAffiliatePayouts() {
    return this.request<AffiliatePayoutItem[]>('/affiliates/me/payouts');
  }

  async requestAffiliatePayout() {
    return this.request<AffiliatePayoutItem>('/affiliates/me/payout-request', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async updateAffiliatePayoutDetails(details: {
    method: 'BANK_TRANSFER' | 'JAZZCASH' | 'EASYPAISA';
    accountTitle: string;
    accountNumber: string;
    bankName?: string;
  }) {
    return this.request<{ payoutDetails: AffiliatePayoutDetails }>('/affiliates/me/payout-details', {
      method: 'PUT',
      body: JSON.stringify(details),
    });
  }

  private buildAdvancedReportQuery(params?: any) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, value.toString());
      });
    }
    return queryParams.toString();
  }

  async getAdvancedSalesReport(params?: { startDate?: string; endDate?: string; period?: string; branchId?: string; companyId?: string }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, value.toString());
      });
    }
    return this.request<any>(`/reports/advanced/sales${queryParams.toString() ? `?${queryParams.toString()}` : ''}`);
  }

  async getAdvancedInventoryReport(params?: { branchId?: string; companyId?: string }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, value.toString());
      });
    }
    return this.request<any>(`/reports/advanced/inventory${queryParams.toString() ? `?${queryParams.toString()}` : ''}`);
  }

  async getAdvancedCustomerReport(params?: { startDate?: string; endDate?: string; period?: string; branchId?: string; companyId?: string }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, value.toString());
      });
    }
    return this.request<any>(`/reports/advanced/customers${queryParams.toString() ? `?${queryParams.toString()}` : ''}`);
  }

  async getAdvancedStaffReport(params?: { startDate?: string; endDate?: string; period?: string; branchId?: string; companyId?: string }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, value.toString());
      });
    }
    return this.request<any>(`/reports/advanced/staff${queryParams.toString() ? `?${queryParams.toString()}` : ''}`);
  }

  async getAdvancedFinancialReport(params?: { startDate?: string; endDate?: string; period?: string; branchId?: string; companyId?: string }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, value.toString());
      });
    }
    return this.request<any>(`/reports/advanced/financial${queryParams.toString() ? `?${queryParams.toString()}` : ''}`);
  }

  async getAdvancedPurchaseReport(params?: { startDate?: string; endDate?: string; period?: string; branchId?: string; companyId?: string; supplierId?: string }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, value.toString());
      });
    }
    return this.request<any>(`/reports/advanced/purchases${queryParams.toString() ? `?${queryParams.toString()}` : ''}`);
  }

  async getAdvancedRefundsReport(params?: any) {
    return this.request<any>(`/reports/advanced/refunds${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getAdvancedExpiryReport(params?: any) {
    return this.request<any>(`/reports/advanced/expiry${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getAdvancedCategoryReport(params?: any) {
    return this.request<any>(`/reports/advanced/category${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getAdvancedBranchReport(params?: any) {
    return this.request<any>(`/reports/advanced/branch${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getAdvancedTaxReport(params?: any) {
    return this.request<any>(`/reports/advanced/tax${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getAdvancedPaymentTrendsReport(params?: any) {
    return this.request<any>(`/reports/advanced/payment-trends${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getAdvancedAttendanceReport(params?: any) {
    return this.request<any>(`/reports/advanced/attendance${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getAdvancedStockMovementsReport(params?: any) {
    return this.request<any>(`/reports/advanced/stock-movements${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getAdvancedExpenseReport(params?: any) {
    return this.request<any>(`/reports/advanced/expense${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getAdvancedShiftReport(params?: any) {
    return this.request<any>(`/reports/advanced/shift${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getAdvancedSupplierReport(params?: any) {
    return this.request<any>(`/reports/advanced/supplier${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getAdvancedRetentionReport(params?: any) {
    return this.request<any>(`/reports/advanced/retention${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getAdvancedCommissionReport(params?: any) {
    return this.request<any>(`/reports/advanced/commission${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getAdvancedProfitReport(params?: any) {
    return this.request<any>(`/reports/advanced/profit${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getAdvancedCashflowReport(params?: any) {
    return this.request<any>(`/reports/advanced/cashflow${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getAdvancedBatchReport(params?: any) {
    return this.request<any>(`/reports/advanced/batch${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getAdvancedDiscountReport(params?: any) {
    return this.request<any>(`/reports/advanced/discount${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getAdvancedProductReport(params?: any) {
    return this.request<any>(`/reports/advanced/product${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getAdvancedTurnoverReport(params?: any) {
    return this.request<any>(`/reports/advanced/turnover${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getAdvancedDailyReport(params?: any) {
    return this.request<any>(`/reports/advanced/daily${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  // Accounting-lite (Wave B8): read-only P&L / ageing / payables / cashbook
  async getAccountingPnl(params?: any) {
    return this.request<any>(`/reports/accounting/pnl${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getReceivablesAgeing(params?: any) {
    return this.request<any>(`/reports/accounting/receivables-ageing${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getPayables(params?: any) {
    return this.request<any>(`/reports/accounting/payables${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getCashbook(params?: any) {
    return this.request<any>(`/reports/accounting/cashbook${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async getPnlComparison(params?: any) {
    return this.request<any>(`/reports/accounting/pnl/compare${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  // Bank reconciliation (Wave B — Item 8)
  async getBankAccounts(params?: any) {
    return this.request<any>(`/reports/accounting/bank-accounts${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async createBankAccount(payload: any) {
    return this.request<any>(`/reports/accounting/bank-accounts`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateBankAccount(id: string, payload: any) {
    return this.request<any>(`/reports/accounting/bank-accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async getBankStatements(params?: any) {
    return this.request<any>(`/reports/accounting/statements${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async createBankStatement(payload: any) {
    return this.request<any>(`/reports/accounting/statements`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getBankStatement(id: string) {
    return this.request<any>(`/reports/accounting/statements/${id}`);
  }

  async autoMatchStatement(id: string) {
    return this.request<any>(`/reports/accounting/statements/${id}/auto-match`, {
      method: "POST",
    });
  }

  async matchStatementLine(statementId: string, lineId: string, payload: any) {
    return this.request<any>(`/reports/accounting/statements/${statementId}/lines/${lineId}/match`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async unmatchStatementLine(statementId: string, lineId: string) {
    return this.request<any>(`/reports/accounting/statements/${statementId}/lines/${lineId}/unmatch`, {
      method: "POST",
    });
  }

  async ignoreStatementLine(statementId: string, lineId: string, payload?: any) {
    return this.request<any>(`/reports/accounting/statements/${statementId}/lines/${lineId}/ignore`, {
      method: "POST",
      body: JSON.stringify(payload || {}),
    });
  }

  async getReconciliations(params?: any) {
    return this.request<any>(`/reports/accounting/reconciliations${this.buildAdvancedReportQuery(params) ? `?${this.buildAdvancedReportQuery(params)}` : ''}`);
  }

  async createReconciliation(payload: any) {
    return this.request<any>(`/reports/accounting/reconciliations`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async completeReconciliation(id: string) {
    return this.request<any>(`/reports/accounting/reconciliations/${id}/complete`, {
      method: "POST",
    });
  }

  // Admin Management (Platform Admin only)
  async getAdmins(params?: {
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      admins: Array<{
        id: string;
        name: string;
        email: string;
        phone: string;
        company: string;
        address: string;
        userCount: number;
        managerCount: number;
        totalSales: number;
        lastActive: string;
        status: 'active' | 'inactive';
        plan: 'basic' | 'premium' | 'enterprise';
        createdAt: string;
        subscriptionEnd: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/admin${query ? `?${query}` : ''}`);
  }

  async getAdmin(adminId: string) {
    return this.request<{
      id: string;
      name: string;
      email: string;
      phone: string;
      company: string;
      address: string;
      userCount: number;
      managerCount: number;
      totalSales: number;
      lastActive: string;
      status: 'active' | 'inactive';
      plan: 'basic' | 'premium' | 'enterprise';
      createdAt: string;
      subscriptionEnd: string;
    }>(`/admin/${adminId}`);
  }

  async createAdmin(adminData: {
    name: string;
    email: string;
    phone: string;
    company: string;
    plan: 'basic' | 'premium' | 'enterprise';
    branchId: string | null;
    password: string;
  }) {
    return this.request<{
      id: string;
      name: string;
      email: string;
      phone: string;
      company: string;
      address: string;
      userCount: number;
      managerCount: number;
      totalSales: number;
      lastActive: string;
      status: 'active' | 'inactive';
      plan: 'basic' | 'premium' | 'enterprise';
      createdAt: string;
      subscriptionEnd: string;
    }>('/admin', {
      method: 'POST',
      body: JSON.stringify(adminData),
    });
  }

  // Company API methods
  async getCompanies() {
    return this.request<Array<{
      id: string;
      name: string;
      slug?: string | null;
      description: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
      website: string | null;
      createdBy: string | null;
      accessType?: 'owned' | 'shared';
      memberRole?: 'MANAGER' | 'CASHIER';
      memberBranchId?: string;
      createdByUser?: {
        id: string;
        name: string;
        email: string;
        role: string;
      } | null;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      branches: Array<{
        id: string;
        name: string;
        address: string;
        phone: string;
        email: string;
      }>;
      _count: {
        users: number;
        staff: number;
        products: number;
      };
    }>>('/companies');
  }

  async getMyCompanies() {
    return this.request<{
      owned: Array<{
        id: string;
        name: string;
        slug?: string | null;
        description: string | null;
        address: string | null;
        phone: string | null;
        email: string | null;
        createdBy: string | null;
        accessType: 'owned';
      }>;
      shared: Array<{
        id: string;
        name: string;
        slug?: string | null;
        description: string | null;
        address: string | null;
        phone: string | null;
        email: string | null;
        createdBy: string | null;
        accessType: 'shared';
        memberRole?: 'MANAGER' | 'CASHIER';
        memberBranchId?: string;
      }>;
    }>('/companies/my/list');
  }

  async getMyInvitations() {
    return this.request<{
      invitations: Array<{
        invitationId: string;
        token: string;
        businessName: string;
        roleName: string | null;
        status: string;
        expiresAt: string;
      }>;
      count: number;
    }>('/invitations/pending');
  }

  async acceptInvitation(token: string) {
    return this.request<{
      membershipId: string;
      message: string;
    }>('/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  async rejectInvitation(token: string) {
    return this.request<{
      message: string;
    }>('/invitations/reject', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  // ─── Notifications ──────────────────────────────────────────────────────────

  async getNotificationPreferences() {
    return this.request<Record<string, boolean>>('/notifications/preferences');
  }

  async updateNotificationPreference(category: string, enabled: boolean) {
    return this.request<{ category: string; enabled: boolean }>('/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify({ category, enabled }),
    });
  }

  async bulkUpdateNotificationPreferences(preferences: Record<string, boolean>) {
    return this.request<any>('/notifications/preferences/all', {
      method: 'PUT',
      body: JSON.stringify({ preferences }),
    });
  }

  async getNotifications(options?: { page?: number; limit?: number; unreadOnly?: boolean; businessId?: string }) {
    const params = new URLSearchParams();
    if (options?.page) params.set('page', String(options.page));
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.unreadOnly) params.set('unreadOnly', 'true');
    if (options?.businessId) params.set('businessId', options.businessId);
    const qs = params.toString();
    return this.request<{
      notifications: Array<{
        id: string;
        userId: string;
        businessId: string | null;
        type: string;
        title: string;
        body: string;
        actionUrl: string | null;
        metadata: any;
        read: boolean;
        createdAt: string;
      }>;
      total: number;
      unreadCount: number;
      page: number;
      limit: number;
      totalPages: number;
    }>(`/notifications${qs ? `?${qs}` : ''}`);
  }

  async getNotificationUnreadCount() {
    return this.request<{ unreadCount: number }>('/notifications/unread-count');
  }

  async markNotificationAsRead(id: string) {
    return this.request<any>(`/notifications/${id}/read`, { method: 'PUT' });
  }

  async markAllNotificationsAsRead() {
    return this.request<any>('/notifications/read-all', { method: 'PUT' });
  }

  async deleteNotification(id: string) {
    return this.request<any>(`/notifications/${id}`, { method: 'DELETE' });
  }

  async clearAllNotifications() {
    return this.request<any>('/notifications/clear-all', { method: 'DELETE' });
  }

  // ─── Companies ─────────────────────────────────────────────────────────────

  async getCompany(companyId: string) {
    return this.request<{
      id: string;
      name: string;
      slug?: string | null;
      description: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
      website: string | null;
      createdBy: string | null;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      branches: Array<{
        id: string;
        name: string;
        address: string;
        phone: string;
        email: string;
        _count: {
          users: number;
          staff: number;
          products: number;
        };
      }>;
      _count: {
        users: number;
        staff: number;
        products: number;
      };
      usageMetrics?: {
        branchesActive: number;
        countersActive: number;
        activeConcurrentSessions: number;
        inventoryItems: number;
        inventoryBreakdown: {
          products: number;
          categories: number;
          manufacturers: number;
          suppliers: number;
          shelves: number;
          batches: number;
        };
      };
    }>(`/companies/${companyId}`);
  }

  async getCompanyBySlug(slug: string) {
    const safe = encodeURIComponent(String(slug || '').trim());
    return this.request<{
      id: string;
      name: string;
      slug?: string | null;
      description: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
      website: string |null;
      createdBy: string | null;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      branches: Array<{
        id: string;
        name: string;
        address: string;
        phone: string;
        email: string;
      }>;
      _count: {
        users: number;
        staff: number;
        products: number;
      };
    }>(`/companies/slug/${safe}`);
  }

  async getBusinesses() {
    return this.getCompanies();
  }

  async getBusinessBySlug(slug: string) {
    return this.getCompanyBySlug(slug);
  }

  async createCompany(companyData: {
    name: string;
    description?: string;
    address?: string;
    phone?: string;
    email?: string;
    businessType?: 'PHARMACY' | 'STORE' | 'RETAIL_STORE' | 'HOTEL' | 'CLINIC';
    createdByUserId?: string;
    refCode?: string;
  }) {
    // Affiliate attribution: if the visitor arrived via a ?ref=CODE link
    // (persisted in localStorage by the auth screens), attach the code
    // so the backend can attribute this first business to the affiliate.
    if (!companyData.refCode) {
      try {
        const storedRef = localStorage.getItem('zapeera_ref_code');
        if (storedRef) companyData = { ...companyData, refCode: storedRef };
      } catch { /* localStorage unavailable — attribution is best-effort here; backoffice can attribute manually */ }
    }
    return this.request<{
      id: string;
      name: string;
      description: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
      businessType: string | null;
      createdBy: string | null;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      branches: Array<any>;
      _count: {
        users: number;
        staff: number;
        products: number;
      };
    }>('/companies', {
      method: 'POST',
      body: JSON.stringify(companyData),
    });
  }

  async createBusiness(businessData: {
    name: string;
    description?: string;
    address?: string;
    phone?: string;
    email?: string;
    businessType?: 'PHARMACY' | 'STORE' | 'RETAIL_STORE' | 'HOTEL' | 'CLINIC';
    createdByUserId?: string;
  }) {
    return this.createCompany(businessData);
  }

  async updateCompany(companyId: string, companyData: {
    name?: string;
    description?: string;
    address?: string;
    phone?: string;
    email?: string;
    businessType?: 'PHARMACY' | 'STORE' | 'RETAIL_STORE' | 'HOTEL' | 'CLINIC';
  }) {
    return this.request<{
      id: string;
      name: string;
      description: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
      createdBy: string | null;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      branches: Array<any>;
      _count: {
        users: number;
        staff: number;
        products: number;
      };
    }>(`/companies/${companyId}`, {
      method: 'PUT',
      body: JSON.stringify(companyData),
    });
  }

  async updateBusiness(businessId: string, businessData: {
    name?: string;
    description?: string;
    address?: string;
    phone?: string;
    email?: string;
    businessType?: 'PHARMACY' | 'STORE' | 'RETAIL_STORE' | 'HOTEL' | 'CLINIC';
  }) {
    return this.updateCompany(businessId, businessData);
  }

  async updateCompanyBusinessType(companyId: string, businessTypeData: {
    businessType: 'PHARMACY' | 'STORE' | 'RETAIL_STORE' | 'HOTEL' | 'CLINIC';
  }) {
    return this.request<{
      id: string;
      name: string;
      description: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
      businessType: string | null;
      createdBy: string | null;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      branches: Array<any>;
      _count: {
        users: number;
        staff: number;
        products: number;
      };
    }>(`/companies/${companyId}/business-type`, {
      method: 'PATCH',
      body: JSON.stringify(businessTypeData),
    });
  }

  async deleteCompany(companyId: string) {
    return this.request<{ message: string }>(`/companies/${companyId}`, {
      method: 'DELETE',
    });
  }

  async deleteBusiness(businessId: string) {
    return this.deleteCompany(businessId);
  }

  async getCompanyStats(companyId: string) {
    return this.request<{
      id: string;
      name: string;
      _count: {
        branches: number;
        users: number;
        staff: number;
        products: number;
        customers: number;
        sales: number;
      };
    }>(`/companies/${companyId}/stats`);
  }

  async updateAdmin(adminId: string, adminData: {
    name?: string;
    email?: string;
    phone?: string;
    company?: string;
    plan?: 'basic' | 'premium' | 'enterprise';
    isActive?: boolean;
  }) {
    return this.request<{
      id: string;
      name: string;
      email: string;
      phone: string;
      company: string;
      address: string;
      userCount: number;
      managerCount: number;
      totalSales: number;
      lastActive: string;
      status: 'active' | 'inactive';
      plan: 'basic' | 'premium' | 'enterprise';
      createdAt: string;
      subscriptionEnd: string;
    }>(`/admin/${adminId}`, {
      method: 'PUT',
      body: JSON.stringify(adminData),
    });
  }

  async deleteAdmin(adminId: string) {
    return this.request<{ message: string }>(`/admin/${adminId}`, {
      method: 'DELETE',
    });
  }

  async getAdminUsers(adminId: string) {
    return this.request<Array<{
      id: string;
      name: string;
      email: string;
      adminId: string;
      lastActive: string;
      status: 'active' | 'inactive';
      role: 'OWNER' | 'MANAGER' | 'CASHIER';
      createdAt: string;
    }>>(`/admin/${adminId}/users`);
  }

  async getSuperAdminStats() {
    return this.request<{
      totalAdmins: number;
      totalUsers: number;
      totalSales: number;
      totalSubscriptions: number;
      totalSubscriptionRevenue: number;
      activeSubscriptions: number;
      newSubscriptionsThisMonth: number;
      activeAdmins: number;
      activePharmacies: number;
      recentAdmins: Array<{
        id: string;
        name: string;
        company: string;
        userCount: number;
        totalSales: number;
      }>;
    }>('/admin/stats');
  }

  async getRecentActivities() {
    return this.request<Array<{
      id: string;
      type: 'admin_created' | 'subscription_updated' | 'payment_received' | 'user_registered' | 'system_alert' | 'branch_added';
      message: string;
      details: string;
      timestamp: string;
      adminId?: string;
      adminName?: string;
    }>>('/admin/activities');
  }

  // Plan Management
  async getPlans() {
    return this.request<any[]>('/admin/plans');
  }

  async createPlan(data: any) {
    return this.request<any>('/admin/plans', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async updatePlan(id: string, data: any) {
    return this.request<any>(`/admin/plans/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  async deactivatePlan(id: string) {
    return this.request<any>(`/admin/plans/${id}`, {
      method: 'DELETE'
    });
  }

  // Subscription Management
  async getSubscriptions() {
    return this.request<any[]>('/admin/subscriptions');
  }

  async assignSubscription(data: { businessId: string; planId: string; manualEndDate?: string }) {
    return this.request<any>('/admin/subscriptions/assign', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async cancelSubscription(id: string) {
    return this.request<any>(`/admin/subscriptions/cancel/${id}`, {
      method: 'POST'
    });
  }

  async getBillingSummary() {
    return this.request<{
      totalMRR: number;
      totalSubscriptions: number;
      trialCount: number;
      expiredCount: number;
      newBusinessesCount: number;
      growthPercentage: number;
    }>('/admin/billing-summary');
  }

  // Scheduled Shift Management Methods
  async getScheduledShifts() {
    return this.request<Array<{
      id: string;
      name: string;
      startTime: string;
      endTime: string;
      date: string;
      branchId: string;
      branchName: string;
      assignedUsers: Array<{
        id: string;
        name: string;
        role: string;
      }>;
      maxUsers: number;
      status: 'scheduled' | 'active' | 'completed' | 'cancelled';
      notes?: string;
      createdAt: string;
      updatedAt: string;
    }>>('/scheduled-shifts');
  }

  async createShift(shiftData: {
    name: string;
    startTime: string;
    endTime: string;
    date: string;
    branchId: string;
    maxUsers: number;
    notes?: string;
    assignedUserIds: string[];
  }) {
    return this.request<{
      id: string;
      name: string;
      startTime: string;
      endTime: string;
      date: string;
      branchId: string;
      branchName: string;
      assignedUsers: Array<{
        id: string;
        name: string;
        role: string;
      }>;
      maxUsers: number;
      status: 'scheduled' | 'active' | 'completed' | 'cancelled';
      notes?: string;
      createdAt: string;
      updatedAt: string;
    }>('/scheduled-shifts', {
      method: 'POST',
      body: JSON.stringify(shiftData),
    });
  }

  async updateScheduledShift(shiftId: string, shiftData: {
    name: string;
    startTime: string;
    endTime: string;
    date: string;
    branchId: string;
    maxUsers: number;
    notes?: string;
    assignedUserIds: string[];
  }) {
    return this.request<{
      id: string;
      name: string;
      startTime: string;
      endTime: string;
      date: string;
      branchId: string;
      branchName: string;
      assignedUsers: Array<{
        id: string;
        name: string;
        role: string;
      }>;
      maxUsers: number;
      status: 'scheduled' | 'active' | 'completed' | 'cancelled';
      notes?: string;
      createdAt: string;
      updatedAt: string;
    }>(`/scheduled-shifts/${shiftId}`, {
      method: 'PUT',
      body: JSON.stringify(shiftData),
    });
  }

  async deleteShift(shiftId: string) {
    return this.request<{ success: boolean; message: string }>(`/scheduled-shifts/${shiftId}`, {
      method: 'DELETE',
    });
  }

  async checkUserExists(params: { username?: string; email?: string }) {
    const queryParams = new URLSearchParams();
    if (params.username) queryParams.append('username', params.username);
    if (params.email) queryParams.append('email', params.email);
    
    return this.request<{
      exists: boolean;
      data?: {
        id: string;
        name: string;
        email: string;
        username: string;
      }
    }>(`/users/check-exists?${queryParams.toString()}`);
  }

  async getUsers(params?: { page?: number; limit?: number; role?: string; branchId?: string; search?: string }) {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.role) queryParams.append('role', params.role);
    if (params?.branchId) queryParams.append('branchId', params.branchId);
    if (params?.search) queryParams.append('search', params.search);

    const queryString = queryParams.toString();
    const url = queryString ? `/users?${queryString}` : '/users';

    return this.request<{
      users: Array<{
        id: string;
        username: string;
        name: string;
        email: string;
        role: string;
        branchId: string;
        branch: {
          id: string;
          name: string;
        };
        isActive: boolean;
        businessAccessGranted: boolean;
        createdAt: string;
        updatedAt: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(url);
  }

  async getUser(userId: string) {
    return this.request<{
      id: string;
      username: string;
      name: string;
      email: string;
      role: string;
      branchId: string;
      branch: {
        id: string;
        name: string;
      };
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }>(`/users/${userId}`);
  }

  async createUser(userData: {
    username: string;
    email: string;
    password: string;
    name: string;
    role: 'OWNER' | 'MANAGER' | 'CASHIER';
    branchId: string | null;
    companyId?: string | null;
  }) {
    return this.request<{
      id: string;
      username: string;
      name: string;
      email: string;
      role: string;
      branchId: string;
      branch: {
        id: string;
        name: string;
      };
      isActive: boolean;
      businessAccessGranted: boolean;
      createdAt: string;
    }>('/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  }

  async updateUser(userId: string, userData: {
    username?: string;
    email?: string;
    password?: string;
    name?: string;
    role?: 'MANAGER' | 'CASHIER';
    branchId?: string;
    isActive?: boolean;
  }) {
    return this.request<{
      id: string;
      username: string;
      name: string;
      email: string;
      role: string;
      branchId: string;
      branch: {
        id: string;
        name: string;
      };
      isActive: boolean;
      businessAccessGranted: boolean;
      updatedAt: string;
    }>(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(userData),
    });
  }

  async deleteUser(userId: string) {
    return this.request<{ message: string }>(`/users/${userId}`, {
      method: 'DELETE',
    });
  }

  /** Remove a user from one business only (does not delete their platform account). */
  async removeCompanyMember(companyId: string, userId: string) {
    return this.request<{ message: string; success?: boolean }>(
      `/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' }
    );
  }

  async addCompanyMember(
    companyId: string,
    body: { userId: string; role: 'MANAGER' | 'CASHIER'; branchId?: string }
  ) {
    return this.request<{ success: boolean; message?: string; data?: unknown }>(
      `/companies/${encodeURIComponent(companyId)}/members`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    );
  }

  async getCompanyMembers(
    companyId: string,
    params?: { page?: number; limit?: number; search?: string; role?: string }
  ) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          queryParams.append(key, value.toString());
        }
      });
    }

    return this.request<{ success: boolean; data: Array<any>; message?: string }>(
      `/companies/${encodeURIComponent(companyId)}/members${queryParams.toString() ? `?${queryParams.toString()}` : ''}`
    );
  }

  async activateUser(userId: string, isActive: boolean) {
    return this.request<{
      id: string;
      username: string;
      name: string;
      email: string;
      role: string;
      branchId: string;
      isActive: boolean;
      branch?: {
        id: string;
        name: string;
      };
    }>(`/users/${userId}/activate`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
  }

  async updateUserBusinessAccess(userId: string, hasBusinessAccess: boolean) {
    return this.request<{
      id: string;
      username: string;
      name: string;
      email: string;
      role: string;
      branchId: string;
      businessAccessGranted: boolean;
      branch?: {
        id: string;
        name: string;
      };
    }>(`/users/${userId}/business-access`, {
      method: 'PATCH',
      body: JSON.stringify({ businessAccessGranted: hasBusinessAccess }),
    });
  }

  // Categories
  async getCategories(params?: {
    page?: number;
    limit?: number;
    search?: string;
    branchId?: string;
    companyId?: string;
    type?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      categories: Array<{
        id: string;
        name: string;
        description?: string;
        createdAt: string;
        updatedAt: string;
        _count: {
          products: number;
        };
      }>;
      pagination?: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/categories${query ? `?${query}` : ''}`);
  }

  async getCategory(categoryId: string) {
    return this.request<{
      id: string;
      name: string;
      description: string;
      type: 'medical' | 'non-medical' | 'general';
      parentId?: string;
      isActive: boolean;
      productCount: number;
      color: string;
      icon: string;
      createdAt: string;
      updatedAt: string;
    }>(`/categories/${categoryId}`);
  }

  async createCategory(categoryData: {
    name: string;
    description?: string;
    type?: string;
    color?: string;
    branchId?: string;
  }) {
    return this.request<{
      id: string;
      name: string;
      description?: string;
      type?: string;
      color?: string;
      createdAt: string;
    }>('/categories', {
      method: 'POST',
      body: JSON.stringify(categoryData),
    });
  }

  async updateCategory(categoryId: string, categoryData: {
    name?: string;
    description?: string;
    type?: 'MEDICAL' | 'NON_MEDICAL' | 'GENERAL';
    parentId?: string;
    color?: string;
    icon?: string;
    isActive?: boolean;
  }) {
    return this.request<{
      id: string;
      name: string;
      description: string;
      type: 'MEDICAL' | 'NON_MEDICAL' | 'GENERAL';
      parentId?: string;
      isActive: boolean;
      productCount: number;
      color: string;
      icon: string;
      updatedAt: string;
    }>(`/categories/${categoryId}`, {
      method: 'PUT',
      body: JSON.stringify(categoryData),
    });
  }

  async deleteCategory(categoryId: string) {
    return this.request<{ success: boolean; message: string }>(`/categories/${categoryId}`, {
      method: 'DELETE',
    });
  }

  // Suppliers
  async getSuppliers(params?: {
    page?: number;
    limit?: number;
    search?: string;
    active?: boolean;
    branchId?: string;
    companyId?: string;
    manufacturerId?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      suppliers: Array<{
        id: string;
        name: string;
        contactPerson: string;
        phone: string;
        email: string;
        address: string;
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
        _count: {
          products: number;
        };
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/suppliers${query ? `?${query}` : ''}`);
  }

  async getSupplier(supplierId: string) {
    return this.request<{
      id: string;
      name: string;
      contactPerson: string;
      phone: string;
      email: string;
      address: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      _count: {
        products: number;
      };
    }>(`/suppliers/${supplierId}`);
  }

  async createSupplier(supplierData: {
    name: string;
    contactPerson: string;
    phone: string;
    email?: string;
    address?: string;
    manufacturerId?: string;
    branchId?: string;
  }) {
    return this.request<{
      id: string;
      name: string;
      contactPerson: string;
      phone: string;
      email: string;
      address: string;
      isActive: boolean;
      createdAt: string;
    }>('/suppliers', {
      method: 'POST',
      body: JSON.stringify(supplierData),
    });
  }

  async updateSupplier(supplierId: string, supplierData: {
    name?: string;
    contactPerson?: string;
    phone?: string;
    email?: string;
    address?: string;
    manufacturerId?: string;
    isActive?: boolean;
  }) {
    return this.request<{
      id: string;
      name: string;
      contactPerson: string;
      phone: string;
      email: string;
      address: string;
      isActive: boolean;
      updatedAt: string;
    }>(`/suppliers/${supplierId}`, {
      method: 'PUT',
      body: JSON.stringify(supplierData),
    });
  }

  async deleteSupplier(supplierId: string) {
    return this.request<{ message: string }>(`/suppliers/${supplierId}`, {
      method: 'DELETE',
    });
  }

  // Manufacturer APIs
  async getManufacturers(params?: {
    page?: number;
    limit?: number;
    search?: string;
    active?: boolean;
  }) {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.search) queryParams.append('search', params.search);
    if (params?.active !== undefined) queryParams.append('active', params.active.toString());

    const queryString = queryParams.toString();
    const url = queryString ? `/manufacturers?${queryString}` : '/manufacturers';

    return this.request<{
      manufacturers: Array<{
        id: string;
        name: string;
        description?: string;
        website?: string;
        country?: string;
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
        _count: {
          suppliers: number;
        };
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(url);
  }

  async getManufacturer(manufacturerId: string) {
    return this.request<{
      id: string;
      name: string;
      description?: string;
      website?: string;
      country?: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      _count: {
        suppliers: number;
      };
      suppliers: Array<{
        id: string;
        name: string;
        contactPerson: string;
        phone: string;
        email: string;
        isActive: boolean;
      }>;
    }>(`/manufacturers/${manufacturerId}`);
  }

  async createManufacturer(manufacturerData: {
    name: string;
    description?: string;
    phone?: string;
    website?: string;
    country?: string;
  }) {
    return this.request<{
      id: string;
      name: string;
      description?: string;
      website?: string;
      country?: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }>('/manufacturers', {
      method: 'POST',
      body: JSON.stringify(manufacturerData),
    });
  }

  async updateManufacturer(manufacturerId: string, manufacturerData: {
    name?: string;
    description?: string;
    phone?: string;
    website?: string;
    country?: string;
  }) {
    return this.request<{
      id: string;
      name: string;
      description?: string;
      website?: string;
      country?: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }>(`/manufacturers/${manufacturerId}`, {
      method: 'PUT',
      body: JSON.stringify(manufacturerData),
    });
  }

  async deleteManufacturer(manufacturerId: string) {
    return this.request<{ message: string }>(`/manufacturers/${manufacturerId}`, {
      method: 'DELETE',
    });
  }

  // Shelf APIs
  async getShelves(params?: {
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.search) queryParams.append('search', params.search);

    const queryString = queryParams.toString();
    const url = queryString ? `/shelves?${queryString}` : '/shelves';

    return this.request<{
      shelves: Array<{
        id: string;
        name: string;
        description?: string;
        location?: string;
        createdAt: string;
        updatedAt: string;
        _count: {
          batches: number;
        };
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(url);
  }

  async getShelf(shelfId: string) {
    return this.request<{
      id: string;
      name: string;
      description?: string;
      location?: string;
      createdAt: string;
      updatedAt: string;
      _count: {
        batches: number;
      };
      batches: Array<{
        id: string;
        batchNo: string;
        product: {
          id: string;
          name: string;
          sku: string;
        };
        quantity: number;
        expireDate?: string;
      }>;
    }>(`/shelves/${shelfId}`);
  }

  async createShelf(shelfData: {
    name: string;
    description?: string;
    location?: string;
  }) {
    return this.request<{
      id: string;
      name: string;
      description?: string;
      location?: string;
      createdAt: string;
      updatedAt: string;
    }>('/shelves', {
      method: 'POST',
      body: JSON.stringify(shelfData),
    });
  }

  async updateShelf(shelfId: string, shelfData: {
    name?: string;
    description?: string;
    location?: string;
  }) {
    return this.request<{
      id: string;
      name: string;
      description?: string;
      location?: string;
      createdAt: string;
      updatedAt: string;
    }>(`/shelves/${shelfId}`, {
      method: 'PUT',
      body: JSON.stringify(shelfData),
    });
  }

  async deleteShelf(shelfId: string) {
    return this.request<{ message: string }>(`/shelves/${shelfId}`, {
      method: 'DELETE',
    });
  }

  // Voice Assistant AI APIs (AI fallback for commands the rule parser
  // cannot handle; the backend proxy holds the provider key and
  // enforces the business's plan quota)
  async parseVoiceWithAi(payload: { utterance: string }) {
    return this.request<{
      status: string;
      envelope?: unknown;
      provider?: string;
      usage?: unknown;
    }>('/voice/ai-parse', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getVoiceAiUsage() {
    return this.request<{
      configured: boolean;
      planId: string | null;
      period: string;
      calls: number;
      tokensIn: number;
      tokensOut: number;
      tokensUsed: number;
      tokenLimit: number;
      approxCommandLimit: number;
      approxCommandsUsed: number;
      percentUsed: number;
    }>('/voice/ai-usage');
  }

  // Dashboard APIs
  async getDashboardStats(branchId?: string) {
    const params = new URLSearchParams();
    if (branchId) params.append('branchId', branchId);

    return this.request<{
      todayStats: {
        sales: number;
        revenue: number;
        subtotal: number;
        tax: number;
      };
      totalStats: {
        sales: number;
        revenue: number;
        subtotal: number;
        tax: number;
      };
      inventory: {
        totalProducts: number;
        lowStockProducts: number;
      };
      customers: {
        total: number;
      };
      recentSales: Array<{
        id: string;
        totalAmount: number;
        createdAt: string;
        customer: {
          id: string;
          name: string;
          phone: string;
        };
        user: {
          id: string;
          name: string;
          username: string;
        };
      }>;
    }>(`/dashboard/stats?${params.toString()}`);
  }

  async getSalesChart(branchId?: string, companyId?: string, period: string = '7d', groupBy: string = 'day') {
    const params = new URLSearchParams();
    if (branchId) params.append('branchId', branchId);
    if (companyId) params.append('companyId', companyId);
    params.append('period', period);
    params.append('groupBy', groupBy);

    return this.request<{
      period: string;
      groupBy: string;
      chartData: Array<{
        date?: string;
        week?: string;
        month?: string;
        revenue: number;
        sales: number;
      }>;
    }>(`/dashboard/chart?${params.toString()}`);
  }

  async getLowStockProducts(branchId?: string) {
    const params = new URLSearchParams();
    if (branchId) params.append('branchId', branchId);

    return this.request<{
      products: Array<{
        id: string;
        name: string;
        stock: number;
        minStock: number;
        unitType: string;
        expiryDate?: string;
      }>;
    }>(`/products/low-stock?${params.toString()}`);
  }

  // Admin Dashboard APIs
  async getAdminDashboardStats() {
    return this.request<{
      totalRevenue: number;
      totalSales: number;
      totalUsers: number;
      totalBranches: number;
      recentSales: Array<{
        id: string;
        totalAmount: number;
        createdAt: string;
        customer: {
          id: string;
          name: string;
          phone: string;
        };
        user: {
          id: string;
          name: string;
          username: string;
        };
        branch: {
          id: string;
          name: string;
        };
      }>;
      lowStockProducts: Array<{
        id: string;
        name: string;
        stock: number;
        minStock: number;
        unitType: string;
        expiryDate?: string;
        branch: {
          name: string;
        };
      }>;
      branchPerformance: Array<{
        id: string;
        name: string;
        users: number;
        sales: number;
        revenue: number;
      }>;
      recentUsers: Array<{
        id: string;
        name: string;
        username: string;
        branch: string;
        lastPurchase: string;
        lastPurchaseAmount: number;
      }>;
    }>('/dashboard/admin-stats');
  }

  async getTopSellingProducts(branchId?: string, limit: number = 10) {
    const params = new URLSearchParams();
    if (branchId && branchId !== '') params.append('branchId', branchId);
    params.append('limit', limit.toString());

    return this.request<Array<{
      productId: string;
      product: {
        id: string;
        name: string;
        unitType: string;
        category: {
          name: string;
        };
      };
      totalQuantity: number;
      totalRevenue: number;
      totalSales: number;
    }>>(`/reports/top-products?${params.toString()}`);
  }

  async getSalesByPaymentMethod(branchId?: string, companyId?: string) {
    const params = new URLSearchParams();
    if (branchId && branchId !== '') params.append('branchId', branchId);
    if (companyId && companyId !== '') params.append('companyId', companyId);

    return this.request<Array<{
      paymentMethod: string;
      _sum: {
        totalAmount: number;
      };
      _count: {
        id: number;
      };
    }>>(`/reports/payment-methods?${params.toString()}`);
  }

  async getEnabledModules(companyId?: string) {
    return this.request<Array<{ name: string; enabled: boolean; sortOrder?: number }>>('/modules/enabled', {
      companyId,
    } as RequestInit & { companyId?: string });
  }

  async getModuleHierarchy(companyId?: string) {
    return this.request<{
      hierarchy: Array<{
        module: string;
        label: string;
        displayName?: string;
        icon: string;
        section: 'main' | 'management' | 'admin';
        subModules: Array<{
          key: string;
          label: string;
          href: string;
          icon: string;
          module: string;
          roles: string[];
        }>;
        defaultRoles: string[];
      }>;
      userRole: string;
      businessId: string;
      lastUpdated: string;
    }>('/modules/hierarchy', {
      companyId,
    } as RequestInit & { companyId?: string });
  }

  async getBusinessTypeModules(businessTypeId: string) {
    return this.request<Array<{ name: string; enabled: boolean; sortOrder?: number }>>(`/business-types/${businessTypeId}/modules`);
  }

  async getDashboardData(branchId?: string, companyId?: string) {
    const params = new URLSearchParams();
    if (branchId && branchId !== '') params.append('branchId', branchId);
    if (companyId && companyId !== '') params.append('companyId', companyId);

    const queryString = params.toString();
    const endpoint = queryString ? `/reports/dashboard?${queryString}` : '/reports/dashboard';

    return this.request<{
      today: {
        revenue: number;
        profit: number;
        transactions: number;
        growth: number;
      };
      month: {
        revenue: number;
        profit: number;
        transactions: number;
        growth: number;
      };
      recentSales: Array<{
        id: string;
        totalAmount: number;
        createdAt: string;
        customer: {
          name: string;
          phone: string;
        } | null;
        items: Array<{
          product: {
            name: string;
          };
          quantity: number;
          totalPrice: number;
        }>;
      }>;
    }>(endpoint);
  }

  // Type-specific workspace dashboards (hotel / clinic / pharmacy / retail)
  async getHotelDashboard() {
    return this.request<any>('/dashboard/hotel');
  }

  async getClinicDashboard() {
    return this.request<any>('/dashboard/clinic');
  }

  async getPharmacyDashboard() {
    return this.request<any>('/dashboard/pharmacy');
  }

  async getRetailDashboard() {
    return this.request<any>('/dashboard/retail');
  }

  // Staff Management
  async searchUser(query: string) {
    return this.request<{
      found: boolean;
      user?: {
        id: string;
        name: string;
        email: string;
        phone?: string;
        profileImage?: string;
        isVerified?: boolean;
        createdAt?: string;
      };
    }>('/staff/search-user', {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
  }

  async getStaff(params?: { page?: number; limit?: number; search?: string; status?: string; branchId?: string; companyId?: string; isActive?: boolean }) {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.search) queryParams.append('search', params.search);
    if (params?.status) queryParams.append('status', params.status);
    if (params?.branchId) queryParams.append('branchId', params.branchId);
    if (params?.companyId) queryParams.append('companyId', params.companyId);
    if (params?.isActive !== undefined) queryParams.append('isActive', params.isActive.toString());

    return this.request<{
      staff: Array<{
        id: string;
        employeeId: string;
        designation: string;
        department?: string;
        salary?: number;
        joiningDate: string;
        status: string;
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
        membership: {
          id: string;
          role: { id: string; name: string } | null;
          user: {
            id: string;
            name: string;
            email: string;
            phone?: string;
            profileImage?: string;
          };
          branches: Array<{ id: string; name: string }>;
        };
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/staff?${queryParams.toString()}`);
  }

  async getStaffMember(id: string) {
    return this.request<{
      id: string;
      employeeId: string;
      designation: string;
      department?: string;
      salary?: number;
      joiningDate: string;
      status: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      membership: {
        id: string;
        role: { id: string; name: string } | null;
        user: {
          id: string;
          name: string;
          email: string;
          phone?: string;
          profileImage?: string;
        };
        branches: Array<{ id: string; name: string }>;
      };
    }>(`/staff/${id}`);
  }

  async createStaff(staffData: {
    userId?: string;
    name?: string;
    email?: string;
    phone?: string;
    password?: string;
    role: string;
    branchId: string;
    employeeId?: string;
    designation: string;
    department?: string;
    salary?: number;
    salaryType?: string;
    employmentType?: string;
    joiningDate?: string;
    status?: string;
    bankName?: string;
    bankAccountNumber?: string;
    cnicNumber?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    isNewUser?: boolean;
    // Salesman flag (gap item 7): designate this staff member as a
    // salesman — they appear in the POS picker + performance views.
    isSalesman?: boolean;
    newUserData?: {
      name: string;
      email: string;
      phone?: string;
      password?: string;
    };
  }) {
    return this.request<{
      id: string;
      employeeId: string;
      designation: string;
      department?: string;
      salary?: number;
      joiningDate: string;
      status: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      membership: {
        id: string;
        role: { id: string; name: string } | null;
        user: {
          id: string;
          name: string;
          email: string;
          phone?: string;
          profileImage?: string;
        };
        branches: Array<{ id: string; name: string }>;
      };
    }>('/staff', {
      method: 'POST',
      body: JSON.stringify(staffData)
    });
  }

  async updateStaff(id: string, staffData: {
    designation?: string;
    department?: string;
    salary?: number;
    joiningDate?: string;
    status?: string;
    isActive?: boolean;
    // Salesman flag (gap item 7).
    isSalesman?: boolean;
  }) {
    return this.request<{
      id: string;
      employeeId: string;
      designation: string;
      department?: string;
      salary?: number;
      joiningDate: string;
      status: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      membership: {
        id: string;
        role: { id: string; name: string } | null;
        user: {
          id: string;
          name: string;
          email: string;
          phone?: string;
          profileImage?: string;
        };
        branches: Array<{ id: string; name: string }>;
      };
    }>(`/staff/${id}`, {
      method: 'PUT',
      body: JSON.stringify(staffData)
    });
  }

  async deleteStaff(id: string) {
    return this.request<{ message: string }>(`/staff/${id}`, {
      method: 'DELETE'
    });
  }

  async getStaffStats(branchId?: string, companyId?: string) {
    const params = new URLSearchParams();
    if (branchId) params.append('branchId', branchId);
    if (companyId) params.append('companyId', companyId);

    return this.request<{
      totalStaff: number;
      activeStaff: number;
      inactiveStaff: number;
      terminatedStaff: number;
      onLeaveStaff: number;
    }>(`/staff/stats?${params.toString()}`);
  }

  // ─── Salesmen (gap item 7) ─────────────────────────────────────────
  // Staff designated as salesmen (StaffProfile.isSalesman). The POS
  // picker reads this roster — not the whole staff list — and the
  // performance views read the sales attributed to each salesman.
  async getSalesmen(params?: { branchId?: string; q?: string }) {
    const queryParams = new URLSearchParams();
    if (params?.branchId) queryParams.append('branchId', params.branchId);
    if (params?.q) queryParams.append('q', params.q);
    const query = queryParams.toString();
    return this.request<Array<{
      staffProfileId: string;
      employeeId: string;
      userId: string;
      name: string;
      email: string;
      phone: string;
      designation?: string | null;
      department?: string | null;
      isActive: boolean;
      isSalesman: boolean;
    }>>(`/salesmen${query ? `?${query}` : ''}`);
  }

  async getSalesmenPerformance(params?: { startDate?: string; endDate?: string; branchId?: string }) {
    const queryParams = new URLSearchParams();
    if (params?.startDate) queryParams.append('startDate', params.startDate);
    if (params?.endDate) queryParams.append('endDate', params.endDate);
    if (params?.branchId) queryParams.append('branchId', params.branchId);
    const query = queryParams.toString();
    return this.request<{
      range: { startDate: string; endDate: string };
      salesmen: Array<{
        staffProfileId: string;
        employeeId: string;
        userId: string;
        name: string;
        email: string;
        designation?: string | null;
        totalSales: number;
        transactions: number;
        averageSale: number;
        commissions: { periods: number; totalAmount: number; totalCommission: number; totalBonus: number };
      }>;
      totals: { totalSales: number; transactions: number; totalCommission: number };
    }>(`/salesmen/performance${query ? `?${query}` : ''}`);
  }

  async getSalesmanPerformance(id: string, params?: { startDate?: string; endDate?: string; branchId?: string }) {
    const queryParams = new URLSearchParams();
    if (params?.startDate) queryParams.append('startDate', params.startDate);
    if (params?.endDate) queryParams.append('endDate', params.endDate);
    if (params?.branchId) queryParams.append('branchId', params.branchId);
    const query = queryParams.toString();
    return this.request<{
      staffProfileId: string;
      employeeId: string;
      userId: string;
      name: string;
      email: string;
      designation?: string | null;
      range: { startDate: string; endDate: string };
      totalSales: number;
      totalPaid: number;
      transactions: number;
      averageSale: number;
      recentSales: Array<{
        id: string;
        invoiceNumber?: string | null;
        totalAmount: number;
        paidAmount: number;
        paymentStatus: string;
        createdAt: string;
        customer?: { id: string; name: string } | null;
        branch?: { id: string; name: string } | null;
      }>;
    }>(`/salesmen/${id}/performance${query ? `?${query}` : ''}`);
  }

  // Attendance Management
  async checkIn(attendanceData: {
    staffProfileId: string;
    branchId: string;
    notes?: string;
  }) {
    return this.request<{
      id: string;
      staffProfileId: string;
      branchId: string;
      checkIn: string;
      checkOut?: string;
      totalHours?: number;
      status: string;
      notes?: string;
      staffProfile: {
        id: string;
        employeeId: string;
        designation: string;
        membership: {
          user: {
            id: string;
            name: string;
          };
        };
      };
      branch: {
        id: string;
        name: string;
      };
      createdAt: string;
    }>('/attendance/check-in', {
      method: 'POST',
      body: JSON.stringify(attendanceData)
    });
  }

  async checkOut(attendanceData: {
    attendanceId: string;
    notes?: string;
  }) {
    return this.request<{
      id: string;
      staffProfileId: string;
      branchId: string;
      checkIn: string;
      checkOut: string;
      totalHours: number;
      status: string;
      notes?: string;
      staffProfile: {
        id: string;
        employeeId: string;
        designation: string;
        membership: {
          user: {
            id: string;
            name: string;
          };
        };
      };
      branch: {
        id: string;
        name: string;
      };
      createdAt: string;
    }>('/attendance/check-out', {
      method: 'POST',
      body: JSON.stringify(attendanceData)
    });
  }

  async getAttendance(params?: {
    page?: number;
    limit?: number;
    staffProfileId?: string;
    branchId?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    return this.request<{
      attendance: Array<{
        id: string;
        staffProfileId: string;
        branchId: string;
        checkIn: string;
        checkOut?: string;
        totalHours?: number;
        status: string;
        notes?: string;
        staffProfile: {
          id: string;
          employeeId: string;
          designation: string;
          membership: {
            user: {
              id: string;
              name: string;
            };
          };
        };
        branch: {
          id: string;
          name: string;
        };
        createdAt: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/attendance?${queryParams.toString()}`);
  }

  async getTodayAttendance(staffProfileId: string) {
    return this.request<{
      id: string;
      staffProfileId: string;
      branchId: string;
      checkIn: string;
      checkOut?: string;
      totalHours?: number;
      status: string;
      notes?: string;
      staffProfile: {
        id: string;
        employeeId: string;
        designation: string;
        membership: {
          user: {
            id: string;
            name: string;
          };
        };
      };
      branch: {
        id: string;
        name: string;
      };
      createdAt: string;
    }>(`/attendance/today/${staffProfileId}`);
  }

  async getAttendanceStats(params?: {
    branchId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    return this.request<{
      totalRecords: number;
      presentCount: number;
      absentCount: number;
      lateCount: number;
      halfDayCount: number;
      leaveCount: number;
    }>(`/attendance/stats?${queryParams.toString()}`);
  }

  // Shift Management
  async startShift(shiftData: {
    staffProfileId: string;
    branchId: string;
    shiftDate: string;
    startTime: string;
    openingBalance?: number;
    notes?: string;
  }) {
    return this.request<{
      id: string;
      staffProfileId: string;
      branchId: string;
      shiftDate: string;
      startTime: string;
      endTime?: string;
      openingBalance: number;
      cashIn: number;
      cashOut: number;
      expectedBalance?: number;
      actualBalance?: number;
      difference?: number;
      status: string;
      notes?: string;
      staffProfile: {
        id: string;
        employeeId: string;
        designation: string;
        membership: {
          user: {
            id: string;
            name: string;
          };
        };
      };
      branch: {
        id: string;
        name: string;
      };
      createdAt: string;
    }>('/shifts/start', {
      method: 'POST',
      body: JSON.stringify(shiftData)
    });
  }

  async endShift(shiftData: {
    shiftId: string;
    endTime: string;
    actualBalance: number;
    notes?: string;
  }) {
    return this.request<{
      id: string;
      staffProfileId: string;
      branchId: string;
      shiftDate: string;
      startTime: string;
      endTime: string;
      openingBalance: number;
      cashIn: number;
      cashOut: number;
      expectedBalance: number;
      actualBalance: number;
      difference: number;
      status: string;
      notes?: string;
      staffProfile: {
        id: string;
        employeeId: string;
        designation: string;
        membership: {
          user: {
            id: string;
            name: string;
          };
        };
      };
      branch: {
        id: string;
        name: string;
      };
      createdAt: string;
    }>('/shifts/end', {
      method: 'POST',
      body: JSON.stringify(shiftData)
    });
  }

  async getShifts(params?: {
    page?: number;
    limit?: number;
    staffProfileId?: string;
    branchId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    return this.request<{
      shifts: Array<{
        id: string;
        staffProfileId: string;
        branchId: string;
        shiftDate: string;
        startTime: string;
        endTime?: string;
        openingBalance: number;
        cashIn: number;
        cashOut: number;
        expectedBalance?: number;
        actualBalance?: number;
        difference?: number;
        status: string;
        notes?: string;
        staffProfile: {
          id: string;
          employeeId: string;
          designation: string;
          membership: {
            user: {
              id: string;
              name: string;
            };
          };
        };
        branch: {
          id: string;
          name: string;
        };
        createdAt: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/shifts?${queryParams.toString()}`);
  }

  async getActiveShift(staffProfileId: string) {
    return this.request<{
      id: string;
      staffProfileId: string;
      branchId: string;
      shiftDate: string;
      startTime: string;
      endTime?: string;
      openingBalance: number;
      cashIn: number;
      cashOut: number;
      expectedBalance?: number;
      actualBalance?: number;
      difference?: number;
      status: string;
      notes?: string;
      staffProfile: {
        id: string;
        employeeId: string;
        designation: string;
        membership: {
          user: {
            id: string;
            name: string;
          };
        };
      };
      branch: {
        id: string;
        name: string;
      };
      createdAt: string;
    }>(`/shifts/active/${staffProfileId}`);
  }

  async updateCashierShift(shiftId: string, shiftData: {
    cashIn?: number;
    cashOut?: number;
    notes?: string;
  }) {
    return this.request<{
      id: string;
      staffProfileId: string;
      branchId: string;
      shiftDate: string;
      startTime: string;
      endTime?: string;
      openingBalance: number;
      cashIn: number;
      cashOut: number;
      expectedBalance?: number;
      actualBalance?: number;
      difference?: number;
      status: string;
      notes?: string;
      staffProfile: {
        id: string;
        employeeId: string;
        designation: string;
        membership: {
          user: {
            id: string;
            name: string;
          };
        };
      };
      branch: {
        id: string;
        name: string;
      };
      createdAt: string;
    }>(`/shifts/${shiftId}`, {
      method: 'PUT',
      body: JSON.stringify(shiftData)
    });
  }

  async getShiftStats(params?: {
    branchId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    return this.request<{
      totalShifts: number;
      activeShifts: number;
      completedShifts: number;
      cancelledShifts: number;
      totalCashIn: number;
      totalCashOut: number;
      totalDifference: number;
    }>(`/shifts/stats?${queryParams.toString()}`);
  }

  // Commission Management
  async calculateCommission(commissionData: {
    staffProfileId: string;
    branchId: string;
    period: string;
    periodType?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
    baseRate?: number;
    bonusRate?: number;
    notes?: string;
  }) {
    return this.request<{
      id: string;
      staffProfileId: string;
      branchId: string;
      period: string;
      periodType: string;
      totalSales: number;
      totalTransactions: number;
      averageSale: number;
      baseRate: number;
      bonusRate: number;
      totalCommission: number;
      bonusAmount: number;
      totalAmount: number;
      status: string;
      paidAt?: string;
      notes?: string;
      staffProfile: {
        id: string;
        employeeId: string;
        designation: string;
        membership: {
          user: {
            id: string;
            name: string;
          };
        };
      };
      branch: {
        id: string;
        name: string;
      };
      createdAt: string;
    }>('/commissions/calculate', {
      method: 'POST',
      body: JSON.stringify(commissionData)
    });
  }

  async getCommissions(params?: {
    page?: number;
    limit?: number;
    staffProfileId?: string;
    branchId?: string;
    status?: string;
    periodType?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    return this.request<{
      commissions: Array<{
        id: string;
        staffProfileId: string;
        branchId: string;
        period: string;
        periodType: string;
        totalSales: number;
        totalTransactions: number;
        averageSale: number;
        baseRate: number;
        bonusRate: number;
        totalCommission: number;
        bonusAmount: number;
        totalAmount: number;
        status: string;
        paidAt?: string;
        notes?: string;
        staffProfile: {
          id: string;
          employeeId: string;
          designation: string;
          membership: {
            user: {
              id: string;
              name: string;
            };
          };
        };
        branch: {
          id: string;
          name: string;
        };
        createdAt: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/commissions?${queryParams.toString()}`);
  }

  async getCommission(commissionId: string) {
    return this.request<{
      id: string;
      staffProfileId: string;
      branchId: string;
      period: string;
      periodType: string;
      totalSales: number;
      totalTransactions: number;
      averageSale: number;
      baseRate: number;
      bonusRate: number;
      totalCommission: number;
      bonusAmount: number;
      totalAmount: number;
      status: string;
      paidAt?: string;
      notes?: string;
      staffProfile: {
        id: string;
        employeeId: string;
        designation: string;
        membership: {
          user: {
            id: string;
            name: string;
          };
        };
      };
      branch: {
        id: string;
        name: string;
      };
      createdAt: string;
    }>(`/commissions/${commissionId}`);
  }

  async updateCommission(commissionId: string, commissionData: {
    status?: 'PENDING' | 'APPROVED' | 'PAID' | 'CANCELLED';
    notes?: string;
  }) {
    return this.request<{
      id: string;
      staffProfileId: string;
      branchId: string;
      period: string;
      periodType: string;
      totalSales: number;
      totalTransactions: number;
      averageSale: number;
      baseRate: number;
      bonusRate: number;
      totalCommission: number;
      bonusAmount: number;
      totalAmount: number;
      status: string;
      paidAt?: string;
      notes?: string;
      staffProfile: {
        id: string;
        employeeId: string;
        designation: string;
        membership: {
          user: {
            id: string;
            name: string;
          };
        };
      };
      branch: {
        id: string;
        name: string;
      };
      createdAt: string;
    }>(`/commissions/${commissionId}`, {
      method: 'PUT',
      body: JSON.stringify(commissionData)
    });
  }

  async getCommissionStats(params?: {
    branchId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    return this.request<{
      totalCommissions: number;
      pendingCommissions: number;
      approvedCommissions: number;
      paidCommissions: number;
      cancelledCommissions: number;
      totalAmount: number;
      totalPaidAmount: number;
    }>(`/commissions/stats?${queryParams.toString()}`);
  }

  async getStaffPerformance(staffProfileId: string, params?: {
    startDate?: string;
    endDate?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    // Shape mirrors backend getStaffPerformance: commission aggregates for
    // the staff member, their top products by sales value, and the most
    // recent commission records. There is no `sales` block in the response.
    return this.request<{
      commissions: {
        totalCommissions: number;
        totalAmount: number;
        totalCommission: number;
        totalBonus: number;
      };
      topProducts: Array<{
        productName: string;
        quantity: number;
        totalAmount: number;
      }>;
      recentCommissions: Array<{
        id: string;
        period: string;
        periodType: string;
        totalSales: number;
        totalAmount: number;
        status: string;
        createdAt: string;
        branch: {
          id: string;
          name: string;
        };
      }>;
    }>(`/commissions/performance/${staffProfileId}?${queryParams.toString()}`);
  }

  // Branch Management

  async getBranch(id: string) {
    return this.request<{
      id: string;
      name: string;
      address: string;
      phone: string;
      email: string;
      managerId?: string;
      isActive: boolean;
      createdAt: string;
      _count: {
        users: number;
        products: number;
        customers: number;
      };
    }>(`/branches/${id}`);
  }

  async createBranch(branchData: {
    name: string;
    address: string;
    phone: string;
    email: string;
    companyId: string;
    managerId?: string;
  }) {
    return this.request<{
      id: string;
      name: string;
      address: string;
      phone: string;
      email: string;
      companyId: string;
      managerId?: string;
      isActive: boolean;
      createdAt: string;
    }>('/branches', {
      method: 'POST',
      body: JSON.stringify(branchData),
    });
  }

  async updateBranch(id: string, branchData: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    managerId?: string;
    isActive?: boolean;
  }) {
    return this.request<{
      id: string;
      name: string;
      address: string;
      phone: string;
      email: string;
      managerId?: string;
      isActive: boolean;
      createdAt: string;
    }>(`/branches/${id}`, {
      method: 'PUT',
      body: JSON.stringify(branchData),
    });
  }

  async deleteBranch(id: string) {
    return this.request<{
      success: boolean;
      message: string;
    }>(`/branches/${id}`, {
      method: 'DELETE',
    });
  }

  // Subscription Management
  async getSubscription() {
    return this.request<{
      remainingDays: number;
      businessId: string;
      planId: string;
      planName: string;
      status: string;
      trialEndsAt: string | null;
      currentPeriodEnd: string | null;
      isSubscribed: boolean;
    }>('/subscription');
  }

  async updateSubscription(subscriptionData: {
    plan: string;
    status?: string;
  }) {
    return this.request<{
      businessId: string;
      planId: string;
      status: string;
    }>('/subscription', {
      method: 'PUT',
      body: JSON.stringify(subscriptionData),
    });
  }

  // ── Subscription Add-ons ──────────────────────────────────────────
  async getAddonCatalogue() {
    return this.request<Array<{
      type: string;
      name: string;
      description: string;
      priceMonthly: number;
      stackable: boolean;
      unitLabel?: string;
      // Online store (Wave C5 — gap item 5): true while the price is
      // undecided — the pack is listed but cannot be purchased.
      // Gift cards / eWallet + kiosk (Wave C9 — gap item 9): true
      // while the price is undecided — the pack is listed but cannot
      // be purchased. (ONLINE_STORE_PACK, item 5, same treatment.)
      pricingPending?: boolean;
    }>>('/subscription/addons/catalogue');
  }

  async getBusinessAddons(businessId: string) {
    return this.request<{
      businessId: string;
      planId: string;
      planName: string;
      isTrial: boolean;
      monthlyAddonSpend: number;
      addons: Array<{
        id: string;
        type: string;
        name: string;
        quantity: number;
        status: string;
        priceMonthly: number | null;
        pricingPending?: boolean;
        startedAt: string | null;
        periodEnd: string | null;
        cancelledAt: string | null;
      }>;
      limits: {
        maxBranches: number;
        maxStaffSeats: number;
        staffAllowed: boolean;
        financeAllowed: boolean;
        advancedReportsAllowed: boolean;
        multiBranchReportsAllowed: boolean;
        whatsappPack: boolean;
        // Online store (Wave C5 — gap item 5)
        onlineStoreAllowed: boolean;
        // Prescription upload is its own pack (split 2026-10-25)
        prescriptionUploadAllowed: boolean;
        giftCardKioskAllowed: boolean;
        voiceTokenQuota: number;
      };
    }>(`/subscription/addons?businessId=${encodeURIComponent(businessId)}`);
  }

  async purchaseAddon(data: { businessId: string; type: string; quantity?: number; months?: number }) {
    return this.request<{
      addon: { type: string; quantity: number; status: string; periodEnd: string | null };
      upfrontAmount: number;
      chargedMonths: number;
      limits: Record<string, unknown>;
    }>('/subscription/addons', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async cancelAddon(data: { businessId: string; type: string }) {
    return this.request<{
      addon: { type: string; status: string; periodEnd: string | null };
    }>('/subscription/addons/cancel', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ── Gift cards / eWallet + kiosk (Wave C9 — gap item 9) ──────────
  // All staff endpoints are add-on-gated server-side
  // (GIFT_CARD_KIOSK_PACK); the kiosk endpoints are public by design
  // (branch-scoped in the path, no auth).

  async purchaseGiftCard(data: {
    branchId: string;
    value: number;
    recipientName?: string;
    recipientPhone?: string;
    purchasedBy?: string;
    paymentMethod?: string;
    expiresAt?: string;
  }) {
    return this.request<{
      id: string;
      code: string;
      balance: number;
      initialValue: number;
      status: string;
      recipientName: string | null;
      recipientPhone: string | null;
      expiresAt: string | null;
      createdAt: string;
    }>('/gift-cards', { method: 'POST', body: JSON.stringify(data) });
  }

  async listGiftCards(params: { branchId?: string; status?: string; search?: string; page?: number; limit?: number } = {}) {
    const q = new URLSearchParams();
    if (params.branchId) q.set('branchId', params.branchId);
    if (params.status) q.set('status', params.status);
    if (params.search) q.set('search', params.search);
    if (params.page) q.set('page', String(params.page));
    if (params.limit) q.set('limit', String(params.limit));
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return this.request<{
      giftCards: Array<{
        id: string;
        code: string;
        balance: number;
        initialValue: number;
        status: string;
        recipientName: string | null;
        recipientPhone: string | null;
        expiresAt: string | null;
        createdAt: string;
      }>;
      pagination: { page: number; limit: number; total: number };
    }>(`/gift-cards${suffix}`);
  }

  async lookupGiftCardByCode(code: string) {
    return this.request<{
      id: string;
      code: string;
      balance: number;
      initialValue: number;
      status: string;
      recipientName: string | null;
      recipientPhone: string | null;
      expiresAt: string | null;
      transactions?: Array<{ id: string; type: string; amount: number; balanceAfter: number; saleId: string | null; createdAt: string }>;
    }>(`/gift-cards/code/${encodeURIComponent(code)}`);
  }

  async getGiftCard(id: string) {
    return this.request<{
      id: string;
      code: string;
      balance: number;
      initialValue: number;
      status: string;
      recipientName: string | null;
      recipientPhone: string | null;
      expiresAt: string | null;
      transactions?: Array<{ id: string; type: string; amount: number; balanceAfter: number; saleId: string | null; createdAt: string }>;
    }>(`/gift-cards/${encodeURIComponent(id)}`);
  }

  async voidGiftCard(id: string) {
    return this.request<{ id: string; status: string; balance: number }>(`/gift-cards/${encodeURIComponent(id)}/void`, {
      method: 'POST',
    });
  }

  async listWallets(params: { search?: string; page?: number; limit?: number } = {}) {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.page) q.set('page', String(params.page));
    if (params.limit) q.set('limit', String(params.limit));
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return this.request<{
      wallets: Array<{
        id: string;
        customerId: string;
        balance: number;
        customer: { id: string; name: string; phone: string };
      }>;
      pagination: { page: number; limit: number; total: number };
    }>(`/wallets${suffix}`);
  }

  async getWallet(customerId: string) {
    return this.request<{
      customer: { id: string; name: string; phone: string };
      wallet: { id: string; balance: number } | null;
      balance: number;
      exists: boolean;
    }>(`/wallets/customers/${encodeURIComponent(customerId)}`);
  }

  async topUpWallet(customerId: string, data: { amount: number; method?: string; note?: string }) {
    return this.request<{ walletId: string; customerId: string; balanceAfter: number }>(
      `/wallets/customers/${encodeURIComponent(customerId)}/topup`,
      { method: 'POST', body: JSON.stringify(data) }
    );
  }

  async getWalletTransactions(customerId: string, params: { page?: number; limit?: number } = {}) {
    const q = new URLSearchParams();
    if (params.page) q.set('page', String(params.page));
    if (params.limit) q.set('limit', String(params.limit));
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return this.request<{
      transactions: Array<{
        id: string;
        type: string;
        amount: number;
        balanceAfter: number;
        saleId: string | null;
        method: string | null;
        note: string | null;
        createdAt: string;
      }>;
      pagination: { page: number; limit: number; total: number };
    }>(`/wallets/customers/${encodeURIComponent(customerId)}/transactions${suffix}`);
  }

  async getKioskInfo(branchId: string) {
    return this.request<{
      branchId: string;
      branchName: string;
      companyName: string;
      address: string | null;
      phone: string | null;
    }>(`/kiosk/${encodeURIComponent(branchId)}`);
  }

  async getKioskCatalog(branchId: string, params: { search?: string; categoryId?: string; inStock?: boolean } = {}) {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.categoryId) q.set('categoryId', params.categoryId);
    if (params.inStock !== undefined) q.set('inStock', String(params.inStock));
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return this.request<Array<{
      id: string;
      name: string;
      categoryId: string | null;
      price: number;
      stock: number;
      inStock: boolean;
    }>>(`/kiosk/${encodeURIComponent(branchId)}/products${suffix}`);
  }

  async checkoutKioskOrder(branchId: string, data: { items: Array<{ productId: string; quantity: number }>; customerName?: string; customerPhone?: string }) {
    return this.request<{
      id: string;
      invoiceNumber?: string;
      totalAmount: number;
      receiptNumber?: string;
    }>(`/kiosk/${encodeURIComponent(branchId)}/checkout`, { method: 'POST', body: JSON.stringify(data) });
  }

  async getPaymentMethods() {
    return this.request<Array<{
      id: string;
      type: 'card' | 'bank' | 'mobile';
      last4: string;
      brand: string;
      expiryMonth: number;
      expiryYear: number;
      isDefault: boolean;
      holderName: string;
    }>>('/subscription/payment-methods');
  }

  async addPaymentMethod(paymentMethodData: {
    type: 'card' | 'bank' | 'mobile';
    last4: string;
    brand: string;
    expiryMonth: number;
    expiryYear: number;
    holderName: string;
    isDefault?: boolean;
  }) {
    return this.request<{
      id: string;
      type: string;
      last4: string;
      brand: string;
      expiryMonth: number;
      expiryYear: number;
      isDefault: boolean;
      holderName: string;
      createdAt: string;
    }>('/subscription/payment-methods', {
      method: 'POST',
      body: JSON.stringify(paymentMethodData),
    });
  }

  async updatePaymentMethod(methodId: string, paymentMethodData: {
    last4?: string;
    brand?: string;
    expiryMonth?: number;
    expiryYear?: number;
    holderName?: string;
    isDefault?: boolean;
  }) {
    return this.request<{
      id: string;
      type: string;
      last4: string;
      brand: string;
      expiryMonth: number;
      expiryYear: number;
      isDefault: boolean;
      createdAt: string;
    }>(`/subscription/payment-methods/${methodId}`, {
      method: 'PUT',
      body: JSON.stringify(paymentMethodData),
    });
  }

  async setDefaultPaymentMethod(methodId: string) {
    return this.request<{ message: string }>(`/subscription/payment-methods/${methodId}/default`, {
      method: 'PUT',
    });
  }

  async deletePaymentMethod(methodId: string) {
    return this.request<{ message: string }>(`/subscription/payment-methods/${methodId}`, {
      method: 'DELETE',
    });
  }

  // Billing profiles — backed by the real /billing-profiles CRUD
  // (backend controllers/billing-profile.controller.ts). These are the
  // name/address/tax details printed on invoices; they are NOT a payment
  // instrument and are never charged.

  async getBillingProfiles(businessId?: string) {
    const query = businessId ? `?businessId=${encodeURIComponent(businessId)}` : '';
    return this.request<Array<BillingProfileRecord>>(`/billing-profiles${query}`);
  }

  async createBillingProfile(profileData: {
    name: string;
    email: string;
    phone?: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    postalCode: string;
    country?: string;
    taxId?: string;
    companyName?: string;
    businessId?: string;
    paymentMethodId?: string;
    isDefault?: boolean;
  }) {
    return this.request<BillingProfileRecord>('/billing-profiles', {
      method: 'POST',
      body: JSON.stringify(profileData),
    });
  }

  async updateBillingProfile(profileId: string, profileData: {
    name?: string;
    email?: string;
    phone?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    taxId?: string;
    companyName?: string;
    paymentMethodId?: string;
    isDefault?: boolean;
  }) {
    return this.request<BillingProfileRecord>(`/billing-profiles/${profileId}`, {
      method: 'PUT',
      body: JSON.stringify(profileData),
    });
  }

  async deleteBillingProfile(profileId: string) {
    return this.request<{ message: string }>(`/billing-profiles/${profileId}`, {
      method: 'DELETE',
    });
  }

  async setDefaultBillingProfile(profileId: string) {
    return this.request<BillingProfileRecord>(`/billing-profiles/${profileId}/default`, {
      method: 'PUT',
    });
  }

  async getBillingHistory() {
    return this.request<Array<{
      id: string;
      amount: number;
      status: 'success' | 'failed' | 'pending';
      method: string;
      date: string;
      invoiceNumber: string;
      description: string;
    }>>('/subscription/billing-history');
  }

  /**
   * Download a real invoice document for a billing-history record.
   * The endpoint returns an HTML file (not JSON), so this uses a raw fetch
   * with the same auth headers as submitPaymentProof, saves the blob via an
   * anchor download, and throws an Error carrying the server's message when
   * the invoice does not exist or is not accessible.
   */
  async downloadInvoiceFile(invoiceId: string): Promise<void> {
    const headers = new Headers();
    const token = this._accessToken
      || (() => {
        try { return localStorage.getItem('localAccessToken') || localStorage.getItem('token'); } catch { return null; }
      })();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    try {
      const ctx = this.contextGetter ? this.contextGetter() : null;
      if (ctx?.companyId) headers.set('X-Business-ID', String(ctx.companyId));
    } catch { /* ignore */ }

    const response = await fetch(`${this.baseURL}/subscription/invoices/${invoiceId}/download`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      let message = `Failed to download invoice (${response.status})`;
      try {
        const data = await response.json();
        if (data?.message) message = data.message;
      } catch { /* non-JSON error body */ }
      throw new Error(message);
    }

    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/);
    const filename = match?.[1] || `invoice-${invoiceId}.html`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async getPricingPlans() {
    return this.request<Array<{
      id: string;
      segment: 'single' | 'multi';
      name: string;
      subtitle?: string;
      price: number;
      priceUnit: string;
      badge?: string;
      ctaLabel: string;
      features: string[];
      dashboardAccessRoles?: Array<'OWNER' | 'MANAGER' | 'CASHIER'>;
      businessTypes?: Array<'PHARMACY' | 'STORE' | 'RETAIL_STORE' | 'HOTEL' | 'CLINIC'>;
      limits?: {
        maxBranches?: number | null;
        maxCountersPerBranch?: number | null;
        maxConcurrentUsers?: number | null;
        maxConcurrentSessions?: number | null;
      };
      pricingModel?: {
        includedBranchesPerBusiness?: number | null;
        includedCountersPerBranch?: number | null;
        extraBranchPrice?: number | null;
        extraCounterPrice?: number | null;
      };
    }>>('/subscription/pricing-plans');
  }

  async updatePricingPlans(plans: Array<{
    id: string;
    segment: 'single' | 'multi';
    name: string;
    subtitle?: string;
    price: number;
    priceUnit: string;
    badge?: string;
    ctaLabel: string;
    features: string[];
    dashboardAccessRoles?: Array<'OWNER' | 'MANAGER' | 'CASHIER'>;
    businessTypes?: Array<'PHARMACY' | 'STORE' | 'RETAIL_STORE' | 'HOTEL' | 'CLINIC'>;
    limits?: {
      maxBranches?: number | null;
      maxCountersPerBranch?: number | null;
      maxConcurrentUsers?: number | null;
      maxConcurrentSessions?: number | null;
    };
    pricingModel?: {
      includedBranchesPerBusiness?: number | null;
      includedCountersPerBranch?: number | null;
      extraBranchPrice?: number | null;
      extraCounterPrice?: number | null;
    };
  }>) {
    return this.request<Array<{
      id: string;
      segment: 'single' | 'multi';
      name: string;
      subtitle?: string;
      price: number;
      priceUnit: string;
      badge?: string;
      ctaLabel: string;
      features: string[];
      dashboardAccessRoles?: Array<'OWNER' | 'MANAGER' | 'CASHIER'>;
      businessTypes?: Array<'PHARMACY' | 'STORE' | 'RETAIL_STORE' | 'HOTEL' | 'CLINIC'>;
      limits?: {
        maxBranches?: number | null;
        maxCountersPerBranch?: number | null;
        maxConcurrentUsers?: number | null;
        maxConcurrentSessions?: number | null;
      };
      pricingModel?: {
        includedBranchesPerBusiness?: number | null;
        includedCountersPerBranch?: number | null;
        extraBranchPrice?: number | null;
        extraCounterPrice?: number | null;
      };
    }>>('/subscription/pricing-plans', {
      method: 'PUT',
      body: JSON.stringify({ plans }),
    });
  }

  async getAnnualDiscount() {
    return this.request<{ percent: number }>('/subscription/annual-discount');
  }

  async updateAnnualDiscount(percent: number) {
    return this.request<{ percent: number }>('/subscription/annual-discount', {
      method: 'PUT',
      body: JSON.stringify({ percent }),
    });
  }

  async getBusinessEntitlements(companyId: string) {
    const response = await this.request<{
      companyId: string;
      businessType: 'PHARMACY' | 'STORE' | 'RETAIL_STORE' | 'HOTEL' | 'CLINIC';
      planId: string;
      isSubscribed: boolean;
      subscriptionStatus: string | null;
      trialEndsAt: string | null;
      currentPeriodEnd: string | null;
      addOns?: Record<string, number>;
      includedLimits?: {
        maxBranches: number | null;
        maxCountersPerBranch: number | null;
        maxConcurrentUsers: number | null;
      };
      effectiveLimits?: {
        maxBranches: number | null;
        maxCountersPerBranch: number | null;
        maxConcurrentUsers: number | null;
      };
      effectiveBusinessTypes?: Array<'PHARMACY' | 'STORE' | 'RETAIL_STORE' | 'HOTEL' | 'CLINIC'>;
      plan: {
        id: string;
        segment: 'single' | 'multi';
        name: string;
        dashboardAccessRoles?: Array<'OWNER' | 'MANAGER' | 'CASHIER'>;
        businessTypes: Array<'PHARMACY' | 'STORE' | 'RETAIL_STORE' | 'HOTEL' | 'CLINIC'>;
        limits: {
          maxBranches: number | null;
          maxCountersPerBranch: number | null;
          maxConcurrentUsers: number | null;
        };
      };
      limits: {
        maxBranches: number | null;
        maxCountersPerBranch: number | null;
        maxConcurrentUsers: number | null;
      };
      usage?: {
        activeBranches: number;
        activeUsers: number;
        totalUsers: number;
      };
      remaining?: {
        branches: number | null;
        users: number | null;
      };
    } | null>(`/subscription/entitlements/business/${companyId}`);
    
    return response;
  }

  async updateBusinessEntitlements(companyId: string, payload: { planId: string; addOns?: Record<string, number> }) {
    return this.request<{
      companyId: string;
      businessType: 'PHARMACY' | 'STORE' | 'RETAIL_STORE' | 'HOTEL' | 'CLINIC';
      planId: string;
      addOns?: Record<string, number>;
      includedLimits?: {
        maxBranches: number | null;
        maxCountersPerBranch: number | null;
        maxConcurrentUsers: number | null;
      };
      effectiveLimits?: {
        maxBranches: number | null;
        maxCountersPerBranch: number | null;
        maxConcurrentUsers: number | null;
      };
      plan: {
        id: string;
        segment: 'single' | 'multi';
        name: string;
        businessTypes: Array<'PHARMACY' | 'STORE' | 'RETAIL_STORE' | 'HOTEL' | 'CLINIC'>;
      };
      limits: {
        maxBranches: number | null;
        maxCountersPerBranch: number | null;
        maxConcurrentUsers: number | null;
      };
      usage?: {
        activeBranches: number;
        activeUsers: number;
      };
      remaining?: {
        branches: number | null;
        users: number | null;
      };
    }>(`/subscription/entitlements/business/${companyId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  // Logout
  async logout() {
    try {
      await fetch(`${this.baseURL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // ignore - cookie may already be gone
    }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }

  // Refunds
  async createRefund(refundData: {
    originalSaleId: string;
    refundReason: string;
    items: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
      reason: string;
      batchId?: string | null;
      saleItemId?: string | null;
    }>;
    refundedBy: string;
  }) {
    return this.request<{
      refund: {
        id: string;
        originalSaleId: string;
        refundReason: string;
        refundAmount: string | number;
        refundedBy: string;
        status: string;
        processedAt?: string;
        createdAt: string;
        updatedAt: string;
      };
      items: Array<{
        id: string;
        refundId: string;
        productId: string;
        quantity: number;
        unitPrice: number;
        reason: string;
      }>;
    }>('/refunds', {
      method: 'POST',
      body: JSON.stringify(refundData),
    });
  }

  async getRefunds(params?: {
    page?: number;
    limit?: number;
    search?: string;
    startDate?: string;
    endDate?: string;
    branchId?: string;
    companyId?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.search) queryParams.append('search', params.search);
    if (params?.startDate) queryParams.append('startDate', params.startDate);
    if (params?.endDate) queryParams.append('endDate', params.endDate);
    if (params?.branchId) queryParams.append('branchId', params.branchId);
    if (params?.companyId) queryParams.append('companyId', params.companyId);

    return this.request<{
      refunds: Array<{
        id: string;
        originalSaleId: string;
        refundReason: string;
        refundAmount: string | number;
        refundedBy: string;
        status: string;
        processedAt?: string;
        createdAt: string;
        updatedAt: string;
        originalSale: {
          id: string;
          receiptNumber?: string;
          totalAmount: number;
          customer?: {
            id: string;
            name: string;
            phone: string;
            email?: string;
            address?: string;
          };
          user: {
            id: string;
            name: string;
            username: string;
          };
          receipts?: Array<{
            id: string;
            receiptNumber: string;
            createdAt: string;
          }>;
        };
        items: Array<{
          id: string;
          productId: string;
          quantity: number;
          unitPrice: number;
          reason: string;
          product: {
            id: string;
            name: string;
            description?: string;
          };
        }>;
        refundedByUser: {
          id: string;
          name: string;
          username: string;
        };
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/refunds?${queryParams.toString()}`);
  }

  async getRefundById(id: string) {
    return this.request<{
      id: string;
      originalSaleId: string;
      refundReason: string;
      refundAmount: string | number;
      refundedBy: string;
      status: string;
      processedAt?: string;
      createdAt: string;
      updatedAt: string;
      originalSale: {
        id: string;
        receiptNumber?: string;
        totalAmount: number;
        customer?: {
          id: string;
          name: string;
          phone: string;
          email?: string;
          address?: string;
        };
        user: {
          id: string;
          name: string;
          username: string;
        };
        items: Array<{
          id: string;
          productId: string;
          quantity: number;
          unitPrice: number;
          product: {
            id: string;
            name: string;
            description?: string;
          };
        }>;
      };
      items: Array<{
        id: string;
        productId: string;
        quantity: number;
        unitPrice: number;
        reason: string;
        product: {
          id: string;
          name: string;
          description?: string;
        };
      }>;
      refundedByUser: {
        id: string;
        name: string;
        username: string;
      };
    }>(`/refunds/${id}`);
  }

  // Batch Management Methods
  async getBatches(params: {
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
    isReported?: boolean;
    productId?: string;
    branchId?: string;
    companyId?: string;
    // Product variants (Wave C6): filter by owning variant; the
    // literal 'null' selects the base pool.
    variantId?: string;
  } = {}) {
    const queryParams = new URLSearchParams();
    if (params.page) queryParams.append('page', params.page.toString());
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.search) queryParams.append('search', params.search);
    if (params.isActive !== undefined) queryParams.append('isActive', params.isActive.toString());
    if (params.isReported !== undefined) queryParams.append('isReported', params.isReported.toString());
    if (params.productId) queryParams.append('productId', params.productId);
    if (params.branchId) queryParams.append('branchId', params.branchId);
    if (params.companyId) queryParams.append('companyId', params.companyId);
    if (params.variantId) queryParams.append('variantId', params.variantId);

    const queryString = queryParams.toString();
    const endpoint = queryString ? `/batches?${queryString}` : '/batches';

    return this.request<{
      batches: Array<{
        id: string;
        batchNo: string;
        productId: string;
        supplierId?: string;
        supplierName?: string;
        totalBoxes: number;
        unitsPerBox: number;
        totalStock: number;
        costPrice: number;
        sellingPrice: number;
        // New pricing and stock fields
        costPricePerUnit?: number;
        costPricePerBox?: number;
        sellingPricePerUnit?: number;
        sellingPricePerBox?: number;
        stockQuantity?: number;
        minStockLevel?: number;
        stockPurchasePrice: number;
        paidAmount: number;
        supplierOutstanding: number;
        supplierInvoiceNo?: string;
        purchasingMethod?: string;
        expireDate?: string;
        productionDate?: string;
        shelfId?: string;
        shelfName?: string;
        isActive: boolean;
        isReported: boolean;
        createdAt: string;
        updatedAt: string;
        product: {
          id: string;
          name: string;
          sku: string;
          barcode?: string;
        };
        supplier?: {
          id: string;
          name: string;
        };
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(endpoint);
  }

  async getBatchById(id: string) {
    return this.request<{
      id: string;
      batchNo: string;
      productId: string;
      supplierId?: string;
      supplierName?: string;
      totalBoxes: number;
      unitsPerBox: number;
      totalStock: number;
      costPrice: number;
      sellingPrice: number;
      stockPurchasePrice: number;
      paidAmount: number;
      supplierOutstanding: number;
      supplierInvoiceNo?: string;
      purchasingMethod?: string;
      expireDate?: string;
      productionDate?: string;
      shelfId?: string;
      shelfName?: string;
      isActive: boolean;
      isReported: boolean;
      createdAt: string;
      updatedAt: string;
      product: {
        id: string;
        name: string;
        sku: string;
        barcode?: string;
      };
      supplier?: {
        id: string;
        name: string;
        email: string;
        phone: string;
      };
    }>(`/batches/${id}`);
  }

  async createBatch(batchData: {
    batchNo: string;
    productId: string;
    // Product variants (Wave C6): the variant this batch's stock
    // belongs to; omit/null = the base product pool.
    variantId?: string | null;
    supplierId?: string;
    supplierName?: string;
    totalBoxes?: number;
    unitsPerBox?: number;
    totalStock?: number;
    costPrice?: number;
    sellingPrice?: number;
    stockPurchasePrice?: number;
    paidAmount?: number;
    supplierOutstanding?: number;
    supplierInvoiceNo?: string;
    purchasingMethod?: string;
    expireDate?: string;
    productionDate?: string;
    shelfId?: string;
    shelfName?: string;
    // New pricing and stock fields
    costPricePerUnit?: number;
    costPricePerBox?: number;
    sellingPricePerUnit?: number;
    sellingPricePerBox?: number;
    stockQuantity?: number;
    minStockLevel?: number;
    maxStockLevel?: number;
  }) {
    return this.request<{
      id: string;
      batchNo: string;
      productId: string;
      supplierId?: string;
      supplierName?: string;
      totalBoxes: number;
      unitsPerBox: number;
      totalStock: number;
      costPrice: number;
      sellingPrice: number;
      stockPurchasePrice: number;
      paidAmount: number;
      supplierOutstanding: number;
      supplierInvoiceNo?: string;
      purchasingMethod?: string;
      expireDate?: string;
      productionDate?: string;
      shelfId?: string;
      shelfName?: string;
      isActive: boolean;
      isReported: boolean;
      createdAt: string;
      updatedAt: string;
      product: {
        id: string;
        name: string;
        sku: string;
        barcode?: string;
      };
      supplier?: {
        id: string;
        name: string;
      };
    }>('/batches', {
      method: 'POST',
      body: JSON.stringify(batchData),
    });
  }

  async updateBatch(id: string, batchData: {
    batchNo?: string;
    productId?: string;
    // Product variants (Wave C6): reassign the batch's variant
    // (null returns it to the base pool).
    variantId?: string | null;
    supplierId?: string;
    supplierName?: string;
    totalBoxes?: number;
    unitsPerBox?: number;
    totalStock?: number;
    costPrice?: number;
    sellingPrice?: number;
    stockPurchasePrice?: number;
    paidAmount?: number;
    supplierOutstanding?: number;
    supplierInvoiceNo?: string;
    purchasingMethod?: string;
    expireDate?: string;
    productionDate?: string;
    shelfId?: string;
    shelfName?: string;
    isActive?: boolean;
    isReported?: boolean;
    // New pricing and stock fields
    stockQuantity?: number;
    costPricePerUnit?: number;
    costPricePerBox?: number;
    sellingPricePerUnit?: number;
    sellingPricePerBox?: number;
    minStockLevel?: number;
  }) {
    return this.request<{
      id: string;
      batchNo: string;
      productId: string;
      supplierId?: string;
      supplierName?: string;
      totalBoxes: number;
      unitsPerBox: number;
      totalStock: number;
      costPrice: number;
      sellingPrice: number;
      stockPurchasePrice: number;
      paidAmount: number;
      supplierOutstanding: number;
      supplierInvoiceNo?: string;
      purchasingMethod?: string;
      expireDate?: string;
      productionDate?: string;
      shelfId?: string;
      shelfName?: string;
      isActive: boolean;
      isReported: boolean;
      createdAt: string;
      updatedAt: string;
      product: {
        id: string;
        name: string;
        sku: string;
        barcode?: string;
      };
      supplier?: {
        id: string;
        name: string;
      };
    }>(`/batches/${id}`, {
      method: 'PUT',
      body: JSON.stringify(batchData),
    });
  }

  async deleteBatch(id: string) {
    return this.request<{
      success: boolean;
      message: string;
    }>(`/batches/${id}`, {
      method: 'DELETE',
    });
  }

  async restockBatch(id: string, restockData: {
    quantity: number;
    notes?: string;
  }) {
    return this.request<{
      success: boolean;
      message: string;
      data: {
        id: string;
        batchNo: string;
        stockQuantity: number;
        updatedAt: string;
      };
    }>(`/batches/${id}/restock`, {
      method: 'POST',
      body: JSON.stringify(restockData),
    });
  }

  async getNearExpiryBatches(days: number = 30) {
    return this.request<Array<{
      id: string;
      batchNo: string;
      productId: string;
      totalStock: number;
      expireDate: string;
      product: {
        id: string;
        name: string;
        sku: string;
      };
    }>>(`/batches/near-expiry?days=${days}`);
  }

  async getLowStockBatches(params: {
    page?: number;
    limit?: number;
    search?: string;
    branchId?: string;
    companyId?: string;
  } = {}) {
    const queryParams = new URLSearchParams();
    if (params.page) queryParams.append('page', params.page.toString());
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.search) queryParams.append('search', params.search);
    if (params.branchId) queryParams.append('branchId', params.branchId);
    if (params.companyId) queryParams.append('companyId', params.companyId);

    const queryString = queryParams.toString();
    const endpoint = queryString ? `/batches/low-stock?${queryString}` : '/batches/low-stock';

    return this.request<{
      batches: Array<{
        id: string;
        batchNo: string;
        productId: string;
        productName: string;
        productSku: string;
        category: string;
        supplier: string;
        branch: {
          id: string;
          name: string;
        };
        currentStock: number;
        totalProductStock: number;
        minStock: number;
        maxStock: number;
        unitPrice: number;
        expireDate?: string;
        productionDate?: string;
        orderQuantity: number;
        isLowStock: boolean;
        isCritical: boolean;
        isNearExpiry: boolean;
        isExpired: boolean;
        reason: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(endpoint);
  }

  // Purchase Management Methods
  async getPurchases(params: {
    page?: number;
    limit?: number;
    status?: string;
    supplierId?: string;
  } = {}) {
    const queryParams = new URLSearchParams();
    if (params.page) queryParams.append('page', params.page.toString());
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.status) queryParams.append('status', params.status);
    if (params.supplierId) queryParams.append('supplierId', params.supplierId);

    return this.request<{
      data: Array<{
        id: string;
        supplierId: string;
        invoiceNo?: string;
        purchaseDate: string;
        totalAmount: number;
        paidAmount: number;
        outstanding: number;
        status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'PARTIAL';
        notes?: string;
        createdAt: string;
        updatedAt: string;
        supplier: {
          id: string;
          name: string;
          contactPerson: string;
          phone: string;
        };
        purchaseItems: Array<{
          id: string;
          productId: string;
          batchId?: string;
          quantity: number;
          unitPrice: number;
          totalPrice: number;
          product: {
            id: string;
            name: string;
            sku: string;
            barcode?: string;
          };
          batch?: {
            id: string;
            batchNo: string;
            quantity: number;
            expireDate?: string;
          };
        }>;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/purchases?${queryParams.toString()}`);
  }

  async getPurchaseById(id: string) {
    return this.request<{
      id: string;
      supplierId: string;
      invoiceNo?: string;
      purchaseDate: string;
      totalAmount: number;
      paidAmount: number;
      outstanding: number;
      status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'PARTIAL';
      notes?: string;
      createdAt: string;
      updatedAt: string;
      supplier: {
        id: string;
        name: string;
        contactPerson: string;
        phone: string;
        email: string;
        address: string;
      };
      purchaseItems: Array<{
        id: string;
        productId: string;
        batchId?: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        product: {
          id: string;
          name: string;
          sku: string;
          barcode?: string;
          unitType: string;
        };
        batch?: {
          id: string;
          batchNo: string;
          quantity: number;
          expireDate?: string;
          productionDate?: string;
        };
      }>;
    }>(`/purchases/${id}`);
  }

  async createPurchase(purchaseData: {
    supplierId: string;
    invoiceNo?: string;
    purchaseDate?: string;
    totalAmount?: number;
    paidAmount?: number;
    notes?: string;
    items: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
      batchNo?: string;
      expireDate?: string;
      productionDate?: string;
    }>;
  }) {
    return this.request<{
      id: string;
      supplierId: string;
      invoiceNo?: string;
      purchaseDate: string;
      totalAmount: number;
      paidAmount: number;
      outstanding: number;
      status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'PARTIAL';
      notes?: string;
      createdAt: string;
      updatedAt: string;
      supplier: {
        id: string;
        name: string;
        contactPerson: string;
        phone: string;
      };
      purchaseItems: Array<{
        id: string;
        productId: string;
        batchId?: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        product: {
          id: string;
          name: string;
          sku: string;
          barcode?: string;
        };
        batch?: {
          id: string;
          batchNo: string;
          quantity: number;
          expireDate?: string;
        };
      }>;
    }>('/purchases', {
      method: 'POST',
      body: JSON.stringify(purchaseData),
    });
  }

  // Auto-reorder suggestions (Wave C3): products at/below their reorder
  // level, grouped by the supplier of their most recent batch.
  async getReorderSuggestions() {
    return this.request<{
      groups: Array<{
        supplier: {
          id: string;
          name: string;
          contactPerson?: string;
          phone?: string;
        } | null;
        lines: Array<{
          productId: string;
          productName: string;
          sku: string;
          branchId: string;
          currentStock: number;
          reorderLevel: number;
          reorderQuantity: number | null;
          suggestedQty: number;
          lastCost: number | null;
          unitsPerPack: number;
          unitsPerStrip: number | null;
        }>;
        totalEstimatedCost: number;
      }>;
      totals: { products: number; units: number; estimatedCost: number };
      participatingProducts: number;
    }>('/purchases/reorder-suggestions');
  }

  // Creates a REAL purchase order from suggestion lines (quantities in
  // base units). Zapeera purchases have no draft state — the created
  // purchase is PENDING (unpaid) and lands stock, like any purchase.
  async createPurchaseFromSuggestions(payload: {
    supplierId: string;
    notes?: string;
    lines: Array<{ productId: string; quantity: number; unitPrice?: number }>;
  }) {
    return this.request<{
      id: string;
      totalAmount: number;
      status: string;
    }>('/purchases/draft-from-suggestions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // ─── Persisted purchase suggestions (Gap Item 4) ──────────────────────
  // Generate writes proposal rows only — nothing is ordered until the
  // owner explicitly approves a suggestion, which creates the purchase.
  async generatePurchaseSuggestions(payload?: { expiryWindowDays?: number }) {
    return this.request<{
      created: Array<{ id: string; supplierId: string | null; lines: number }>;
      totals: { suggestions: number; lines: number };
    }>('/purchases/suggestions/generate', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  }

  async getPurchaseSuggestions(params?: { status?: string; supplierId?: string; page?: number; limit?: number }) {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.supplierId) q.set('supplierId', params.supplierId);
    if (params?.page) q.set('page', String(params.page));
    if (params?.limit) q.set('limit', String(params.limit));
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return this.request<{
      suggestions: Array<{
        id: string;
        supplierId: string | null;
        status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
        reason: string | null;
        createdAt: string;
        purchaseId: string | null;
        supplier: { id: string; name: string; contactPerson?: string; phone?: string } | null;
        lines: Array<{
          id: string;
          productId: string;
          currentStock: number;
          sellableStock: number;
          expiringStock: number;
          reorderLevel: number | null;
          minStock: number;
          suggestedQty: number;
          unitCost: number | null;
          reason: string;
          note: string | null;
          product: { id: string; name: string; sku: string; unitsPerPack: number; unitsPerStrip: number | null };
        }>;
      }>;
      total: number;
      page: number;
      limit: number;
    }>(`/purchases/suggestions${suffix}`);
  }

  async approvePurchaseSuggestion(id: string) {
    return this.request<{
      purchase: { id: string; totalAmount: number; status: string };
      suggestion: { id: string; status: string; purchaseId: string | null };
    }>(`/purchases/suggestions/${id}/approve`, { method: 'POST' });
  }

  async rejectPurchaseSuggestion(id: string, reason?: string) {
    return this.request<{ id: string; status: string }>(
      `/purchases/suggestions/${id}/reject`,
      { method: 'POST', body: JSON.stringify({ reason: reason || '' }) }
    );
  }

  // ─── Aging reports (Gap Item 4) ────────────────────────────────────────
  async getSupplierAgingReport() {
    return this.request<{
      asOf: string;
      rows: Array<{
        supplier: { id: string; name: string; contactPerson?: string; phone?: string } | null;
        buckets: { days0to30: number; days31to60: number; days61to90: number; over90: number };
        total: number;
        openInvoices: number;
        oldestDueDate: string | null;
        oldestDueAgeDays: number | null;
      }>;
      totals: { days0to30: number; days31to60: number; days61to90: number; over90: number };
      totalOutstanding: number;
      suppliersWithDues: number;
    }>('/reports/advanced/aging/supplier');
  }

  async getCustomerAgingReport() {
    return this.request<{
      asOf: string;
      rows: Array<{
        customerId: string;
        customerName: string;
        phone: string | null;
        total: number;
        buckets: { days0to30: number; days31to60: number; days61to90: number; over90: number };
        oldestDueDate: string | null;
        oldestDueAgeDays: number | null;
        lastPaymentDate: string | null;
        riskBand: string;
      }>;
      totals: { days0to30: number; days31to60: number; days61to90: number; over90: number };
      total: number;
      customerAdvances: number;
      customersWithDues: number;
    }>('/reports/advanced/aging/customer');
  }

  async getStockAgingReport() {
    return this.request<{
      asOf: string;
      rows: Array<{
        productId: string;
        productName: string;
        sku: string;
        totalQty: number;
        totalValue: number;
        buckets: { days0to30: number; days31to60: number; days61to90: number; days91to180: number; over180: number };
        expiredQty: number;
        expiredValue: number;
        expiringQty: number;
        expiringValue: number;
        oldestBatchAgeDays: number;
        lastSaleDate: string | null;
        daysSinceLastSale: number | null;
        nonMoving90d: boolean;
      }>;
      totals: {
        totalQty: number;
        totalValue: number;
        expiredValue: number;
        expiringValue: number;
        nonMovingProducts: number;
        buckets: { days0to30: number; days31to60: number; days61to90: number; days91to180: number; over180: number };
      };
    }>('/reports/advanced/aging/stock');
  }

  async getMovementReport(days?: number) {
    const suffix = days ? `?days=${days}` : '';
    return this.request<{
      from: string;
      to: string;
      days: number;
      rows: Array<{
        productId: string;
        productName: string;
        sku: string;
        unitsSold: number;
        currentStock: number;
        minStock: number;
        dailyRate: number;
        daysOfCover: number | null;
        movementClass: string;
      }>;
      counts: { FAST: number; MEDIUM: number; SLOW: number; DEAD: number };
      products: number;
    }>(`/reports/advanced/aging/movement${suffix}`);
  }

  async getProfitabilityReport(days?: number) {
    const suffix = days ? `?days=${days}` : '';
    return this.request<{
      from: string;
      to: string;
      days: number;
      rows: Array<{
        productId: string;
        productName: string;
        sku: string | null;
        revenue: number;
        cost: number;
        grossProfit: number;
        marginPct: number | null;
        unitsSold: number;
        unknownCostUnits: number;
      }>;
      totals: { revenue: number; cost: number; grossProfit: number; unitsSold: number; unknownCostUnits: number };
    }>(`/reports/advanced/aging/profitability${suffix}`);
  }

  async updatePurchase(id: string, purchaseData: {
    supplierId?: string;
    invoiceNo?: string;
    purchaseDate?: string;
    totalAmount?: number;
    paidAmount?: number;
    status?: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'PARTIAL';
    notes?: string;
    // Roadmap A10: same line payload as createPurchase. When present, the
    // backend REPLACES the purchase's lines and reconciles the stock the
    // old lines put into batches (409 STOCK_CONFLICT if units were sold).
    items?: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
      batchNo?: string;
      expireDate?: string;
      productionDate?: string;
    }>;
  }) {
    return this.request<{
      id: string;
      supplierId: string;
      invoiceNo?: string;
      purchaseDate: string;
      totalAmount: number;
      paidAmount: number;
      outstanding: number;
      status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'PARTIAL';
      notes?: string;
      createdAt: string;
      updatedAt: string;
      supplier: {
        id: string;
        name: string;
        contactPerson: string;
        phone: string;
      };
      purchaseItems: Array<{
        id: string;
        productId: string;
        batchId?: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        product: {
          id: string;
          name: string;
          sku: string;
          barcode?: string;
        };
        batch?: {
          id: string;
          batchNo: string;
          quantity: number;
          expireDate?: string;
        };
      }>;
    }>(`/purchases/${id}`, {
      method: 'PUT',
      body: JSON.stringify(purchaseData),
    });
  }

  async deletePurchase(id: string) {
    return this.request<{
      success: boolean;
      message: string;
    }>(`/purchases/${id}`, {
      method: 'DELETE',
    });
  }

  // Inter-branch Stock Transfers (Roadmap A9)
  // Lifecycle: create = PENDING (stock validated, not moved) →
  // complete = stock moves atomically → cancel = PENDING only.

  async getTransfers(params: {
    page?: number;
    limit?: number;
    status?: string;
    fromBranchId?: string;
    toBranchId?: string;
  } = {}) {
    const queryParams = new URLSearchParams();
    if (params.page) queryParams.append('page', params.page.toString());
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.status) queryParams.append('status', params.status);
    if (params.fromBranchId) queryParams.append('fromBranchId', params.fromBranchId);
    if (params.toBranchId) queryParams.append('toBranchId', params.toBranchId);

    return this.request<{
      data: Array<StockTransferRecord>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/transfers?${queryParams.toString()}`);
  }

  async getTransferById(id: string) {
    return this.request<StockTransferRecord>(`/transfers/${id}`);
  }

  async createTransfer(transferData: {
    fromBranchId: string;
    toBranchId: string;
    notes?: string;
    items: Array<{
      productId: string;
      sourceBatchId: string;
      quantity: number;
    }>;
  }) {
    return this.request<StockTransferRecord>('/transfers', {
      method: 'POST',
      body: JSON.stringify(transferData),
    });
  }

  async completeTransfer(id: string) {
    return this.request<StockTransferRecord>(`/transfers/${id}/complete`, {
      method: 'POST',
    });
  }

  async cancelTransfer(id: string) {
    return this.request<StockTransferRecord>(`/transfers/${id}/cancel`, {
      method: 'POST',
    });
  }

  // Inventory Management Methods
  async getInventorySummary(params: {
    page?: number;
    limit?: number;
    search?: string;
    categoryId?: string;
    companyId?: string;
    lowStock?: boolean;
  } = {}) {
    const queryParams = new URLSearchParams();
    if (params.page) queryParams.append('page', params.page.toString());
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.search) queryParams.append('search', params.search);
    if (params.categoryId) queryParams.append('categoryId', params.categoryId);
    if (params.companyId) queryParams.append('companyId', params.companyId);
    if (params.lowStock) queryParams.append('lowStock', params.lowStock.toString());

    return this.request<{
      data: Array<{
        id: string;
        name: string;
        sku: string;
        barcode?: string;
        stock: number;
        minStock: number;
        costPrice: number;
        sellingPrice: number;
        unitType: string;
        category: {
          id: string;
          name: string;
          type: 'MEDICAL' | 'NON_MEDICAL' | 'GENERAL';
        };
        supplier: {
          id: string;
          name: string;
        };
        batches: Array<{
          id: string;
          batchNo: string;
          quantity: number;
          expireDate?: string;
          purchasePrice: number;
          sellingPrice: number;
        }>;
        totalBatchQuantity: number;
        nearExpiryBatches: number;
        expiredBatches: number;
        isLowStock: boolean;
        stockStatus: 'LOW' | 'MEDIUM' | 'GOOD';
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/inventory/summary?${queryParams.toString()}`);
  }

  async getInventoryByBatches(params: {
    page?: number;
    limit?: number;
    search?: string;
    productId?: string;
    nearExpiry?: boolean;
    expired?: boolean;
    branchId?: string;
    companyId?: string;
    isReported?: boolean;
  } = {}) {
    const queryParams = new URLSearchParams();
    if (params.page) queryParams.append('page', params.page.toString());
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.search) queryParams.append('search', params.search);
    if (params.productId) queryParams.append('productId', params.productId);
    if (params.nearExpiry) queryParams.append('nearExpiry', params.nearExpiry.toString());
    if (params.expired) queryParams.append('expired', params.expired.toString());
    if (params.branchId) queryParams.append('branchId', params.branchId);
    if (params.companyId) queryParams.append('companyId', params.companyId);
    if (params.isReported !== undefined) queryParams.append('isReported', params.isReported.toString());

    const queryString = queryParams.toString();
    const endpoint = queryString ? `/inventory/batches?${queryString}` : '/inventory/batches';

    return this.request<{
      data: Array<{
        id: string;
        batchNo: string;
        productId: string;
        quantity: number;
        purchasePrice: number;
        sellingPrice: number;
        expireDate?: string;
        productionDate?: string;
        product: {
          id: string;
          name: string;
          sku: string;
          barcode?: string;
          unitType: string;
          minStock: number;
        };
        supplier: {
          id: string;
          name: string;
        };
        expiryStatus: 'GOOD' | 'WARNING' | 'CRITICAL' | 'EXPIRED';
        daysUntilExpiry?: number;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(endpoint);
  }

  async getInventoryReports(companyId?: string) {
    const params = new URLSearchParams();
    if (companyId && companyId !== '') params.append('companyId', companyId);
    const queryString = params.toString();
    const endpoint = queryString ? `/inventory/reports?${queryString}` : '/inventory/reports';
    
    return this.request<{
      totalProducts: number;
      lowStockProducts: number;
      nearExpiryBatches: number;
      expiredBatches: number;
      totalStockValue: number;
      categoryStats: Array<{
        categoryId: string;
        categoryName: string;
        categoryType: 'MEDICAL' | 'NON_MEDICAL' | 'GENERAL';
        productCount: number;
        totalStock: number;
      }>;
    }>(endpoint);
  }

  // Business Type Management
  async getBusinessTypes() {
    return this.request<any[]>('/business-types');
  }

  async getModules() {
    return this.request<any[]>('/business-types/modules');
  }

  async createBusinessType(data: { name: string; description?: string }) {
    return this.request<any>('/business-types', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateBusinessType(id: string, data: { name: string; description?: string }) {
    return this.request<any>(`/business-types/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async updateBusinessTypeModules(id: string, moduleIds: string[]) {
    return this.request<any>(`/business-types/${id}/modules`, {
      method: 'PUT',
      body: JSON.stringify({ moduleIds }),
    });
  }

  async deleteBusinessType(id: string) {
    return this.request<any>(`/business-types/${id}`, {
      method: 'DELETE',
    });
  }

  async submitPaymentProof(formData: FormData) {
    // NOTE: unlike most endpoints, this path can't use `this.request()` directly
    // because it needs to retain low-level `{ success, message, code }` fields
    // (the upload UI maps specific codes like PENDING_EXISTS). It MUST still send
    // the Bearer token + CSRF header or the backend CSRF middleware rejects the
    // POST with 403 CSRF_TOKEN_REQUIRED (it bypasses CSRF only for Bearer auth).
    const headers = new Headers();
    const token = this._accessToken
      || (() => {
        try { return localStorage.getItem('localAccessToken') || localStorage.getItem('token'); } catch { return null; }
      })();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const csrfToken = this.getCSRFToken();
    if (csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }
    const response = await fetch(`${this.baseURL}/payments/manual/submit`, {
      method: 'POST',
      body: formData,
      headers,
      credentials: 'include',
    });
    return response.json();
  }

  async getMyPaymentProofs(businessId: string) {
    return this.request<any[]>(`/payments/manual/my?businessId=${businessId}`);
  }

  async updateBusinessTypeModule(businessTypeId: string, moduleId: string, enabled: boolean) {
    return this.request<any>(`/business-types/${businessTypeId}/modules/${moduleId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  }

  async updateBusinessTypeSubModule(businessTypeId: string, moduleId: string, subModuleKey: string, disabled: boolean) {
    return this.request<any>(`/business-types/${businessTypeId}/modules/${moduleId}/submodules/${subModuleKey}`, {
      method: 'PATCH',
      body: JSON.stringify({ disabled }),
    });
  }

  async getSubscriptionPlans() {
    return this.request<any[]>('/subscription/pricing-plans');
  }

  async updatePlanModule(planId: string, moduleId: string, enabled: boolean) {
    return this.request<any>(`/subscription-plans/${planId}/modules/${moduleId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  }

  async updatePlanSubModule(planId: string, moduleId: string, subModuleKey: string, disabled: boolean) {
    return this.request<any>(`/subscription-plans/${planId}/modules/${moduleId}/submodules/${subModuleKey}`, {
      method: 'PATCH',
      body: JSON.stringify({ disabled }),
    });
  }

  async getAllRoles() {
    return this.request<Record<string, any>>('/roles');
  }

  async getRolePermissions(role: string) {
    return this.request<{
      role: string;
      permissions: Array<{
        resource: string;
        actions: string[];
        conditions?: Record<string, any>;
      }>;
      accessibleResources: string[];
    }>(`/roles/roles/${encodeURIComponent(role)}/permissions`);
  }

  async updateUserRole(userId: string, role: string, businessId: string) {
    return this.request<any>(`/roles/users/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role, businessId }),
    });
  }

  async updateRoleModule(roleId: string, moduleId: string, enabled: boolean) {
    return this.request<any>(`/roles/${roleId}/modules/${moduleId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  }

  async updateRoleSubModule(roleId: string, moduleId: string, subModuleKey: string, disabled: boolean) {
    return this.request<any>(`/roles/${roleId}/modules/${moduleId}/submodules/${subModuleKey}`, {
      method: 'PATCH',
      body: JSON.stringify({ disabled }),
    });
  }

  async getAllModules() {
    return this.request<any[]>('/module-access/all');
  }

  async updateModuleStatus(moduleId: string, enabled: boolean) {
    return this.request<any>(`/modules/${moduleId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  }

  // ==================== BARCODE METHODS ====================

  async lookupBarcode(barcode: string) {
    return this.request<any>('/barcodes/lookup', {
      method: 'POST',
      body: JSON.stringify({ barcode }),
    });
  }

  async generateBarcode(options: { prefix?: string; length?: number; type?: string }) {
    return this.request<any>('/barcodes/generate', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async validateBarcode(barcode: string, type?: string, excludeProductId?: string) {
    return this.request<any>('/barcodes/validate', {
      method: 'POST',
      body: JSON.stringify({ barcode, type, excludeProductId }),
    });
  }

  async getBarcodeStats() {
    return this.request<any>('/barcodes/stats');
  }

  async getProductBarcodes(productId: string) {
    return this.request<any>(`/barcodes/product/${productId}`);
  }

  async updateProductBarcodes(productId: string, data: {
    barcode?: string;
    additionalBarcodes?: string[];
    barcodeType?: string;
  }) {
    return this.request<any>(`/barcodes/product/${productId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

}

export const apiService = new ApiService(API_BASE_URL);
export default apiService;