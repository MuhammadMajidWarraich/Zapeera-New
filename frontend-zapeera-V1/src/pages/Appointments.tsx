import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Plus,
  Loader2,
  RefreshCw,
  CalendarDays,
  X,
  CheckCheck,
  Play,
  Receipt,
  UserX,
  Ban,
} from "lucide-react";
import {
  apiService,
  type AppointmentRecord,
  type AppointmentStatus,
  type DoctorRecord,
  type PatientRecord,
} from "@/services/api";
import { toast } from "@/hooks/use-toast";

// Appointments + OPD queue (Wave C4 — Clinic pack). Booking assigns
// the patient's token in the doctor's queue for the day (server-side
// sequence — a cancelled token is never reused, like a paper token
// book). Flow: BOOKED → CHECKED_IN → IN_VISIT → COMPLETED, where
// completing a visit BILLS it: the consultation fee (a non-stock
// service line) plus any extra items go through the normal sale
// engine, and the fee/share split is snapshotted on the appointment.

const STATUS_STYLES: Record<string, string> = {
  BOOKED: "bg-blue-100 text-blue-800",
  CHECKED_IN: "bg-amber-100 text-amber-800",
  IN_VISIT: "bg-purple-100 text-purple-800",
  COMPLETED: "bg-green-100 text-green-800",
  CANCELLED: "bg-gray-200 text-gray-700",
  NO_SHOW: "bg-red-100 text-red-800",
};

const PAYMENT_METHODS = ["CASH", "CARD", "JAZZCASH", "EASYPAISA", "BANK_TRANSFER"];

const money = (n: number | null | undefined) =>
  `Rs ${Number(n || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

const todayInputValue = () => {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

interface ProductPick {
  productId: string;
  productName: string;
  price?: number;
}

/** Compact product search-select (same pattern as the Prescriptions page). */
const ProductSearchSelect: React.FC<{
  value: ProductPick;
  onChange: (pick: ProductPick) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Array<{ id: string; name: string; price?: number }>>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (term: string) => {
    setSearching(true);
    try {
      const response = await apiService.getProducts({ page: 1, limit: 10, search: term } as any);
      const products = (response as any)?.data?.products;
      setResults(
        Array.isArray(products)
          ? products
              .filter((p: any) => !p.isService)
              .map((p: any) => ({
                id: p.id,
                name: p.name,
                price: p.batches?.[0]?.sellingPrice ?? p.sellingPrice ?? undefined,
              }))
          : []
      );
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query.trim()), 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, open, runSearch]);

  if (value.productId) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-md border bg-white px-2.5">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#0a1128]">{value.productName}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => { onChange({ productId: "", productName: "" }); setQuery(""); setOpen(true); }}
          className="text-xs font-bold text-[#1a52c5] hover:underline"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        value={query}
        disabled={disabled}
        placeholder="Search products…"
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-white shadow-lg">
          {searching ? (
            <div className="px-3 py-2 text-sm text-gray-500">
              <Loader2 className="mr-2 inline h-3 w-3 animate-spin" /> Searching…
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">No products found.</div>
          ) : (
            results.map((p) => (
              <button
                key={p.id}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                onClick={() => {
                  onChange({ productId: p.id, productName: p.name, price: p.price });
                  setOpen(false);
                }}
              >
                {p.name}
                {p.price != null && <span className="text-gray-400"> · {money(p.price)}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

interface ExtraItemRow extends ProductPick {
  quantity: string;
  unitPrice: string;
}

interface RxItemRow extends ProductPick {
  quantity: string;
  dosage: string;
  durationDays: string;
}

const AppointmentsPage: React.FC = () => {
  const [date, setDate] = useState(todayInputValue());
  const [doctorFilter, setDoctorFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [queue, setQueue] = useState<AppointmentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [doctors, setDoctors] = useState<DoctorRecord[]>([]);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  // Booking dialog
  const [bookingOpen, setBookingOpen] = useState(false);
  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<PatientRecord[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientRecord | null>(null);
  const [quickName, setQuickName] = useState("");
  const [quickPhone, setQuickPhone] = useState("");
  const [quickCreating, setQuickCreating] = useState(false);
  const [bookingDoctorId, setBookingDoctorId] = useState("");
  const [bookingDate, setBookingDate] = useState(todayInputValue());
  const [bookingReason, setBookingReason] = useState("");
  const [bookingNotes, setBookingNotes] = useState("");
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const patientDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Terminal-transition confirm
  const [confirmAction, setConfirmAction] = useState<{ appt: AppointmentRecord; status: AppointmentStatus } | null>(null);

  // Complete-visit dialog
  const [completing, setCompleting] = useState<AppointmentRecord | null>(null);
  const [fee, setFee] = useState("");
  const [extraItems, setExtraItems] = useState<ExtraItemRow[]>([]);
  const [rxItems, setRxItems] = useState<RxItemRow[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [paidAmount, setPaidAmount] = useState("");
  const [completeSubmitting, setCompleteSubmitting] = useState(false);

  const loadDoctors = useCallback(async () => {
    try {
      const response = await apiService.getDoctors({ page: 1, limit: 100, isActive: true });
      if (response.success && response.data) setDoctors(response.data);
    } catch {
      // The queue still loads without the filter list.
    }
  }, []);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiService.getAppointments({
        date,
        doctorId: doctorFilter === "all" ? undefined : doctorFilter,
        status: statusFilter === "all" ? undefined : statusFilter,
        limit: 200,
      });
      if (response.success && response.data) setQueue(response.data);
    } catch (error) {
      toast({ title: "Error", description: "Could not load the appointment queue.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [date, doctorFilter, statusFilter]);

  useEffect(() => {
    loadDoctors();
  }, [loadDoctors]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const runStatus = async (appt: AppointmentRecord, status: AppointmentStatus) => {
    setActionBusyId(appt.id);
    try {
      const response = await apiService.updateAppointmentStatus(appt.id, status);
      if (response.success) {
        toast({ title: `Token ${appt.tokenNumber} — ${status.replace("_", " ")}` });
        loadQueue();
      } else {
        toast({ title: "Could not update", description: (response as any).message || "Please try again.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Could not update", description: error?.message || "Please try again.", variant: "destructive" });
    } finally {
      setActionBusyId(null);
    }
  };

  // Patient search for the booking dialog
  useEffect(() => {
    if (!bookingOpen || selectedPatient) return;
    if (patientDebounce.current) clearTimeout(patientDebounce.current);
    patientDebounce.current = setTimeout(async () => {
      try {
        const response = await apiService.getPatients({
          page: 1,
          limit: 10,
          search: patientQuery.trim() || undefined,
          isActive: true,
        });
        if (response.success && response.data) setPatientResults(response.data);
      } catch {
        setPatientResults([]);
      }
    }, 250);
    return () => { if (patientDebounce.current) clearTimeout(patientDebounce.current); };
  }, [patientQuery, bookingOpen, selectedPatient]);

  const openBooking = () => {
    setSelectedPatient(null);
    setPatientQuery("");
    setQuickName("");
    setQuickPhone("");
    setBookingDoctorId(doctorFilter !== "all" ? doctorFilter : "");
    setBookingDate(date);
    setBookingReason("");
    setBookingNotes("");
    setBookingOpen(true);
  };

  const quickCreatePatient = async () => {
    if (!quickName.trim()) {
      toast({ title: "Name required", description: "Enter the new patient's name.", variant: "destructive" });
      return;
    }
    setQuickCreating(true);
    try {
      const response = await apiService.createPatient({
        name: quickName.trim(),
        phone: quickPhone.trim() || null,
      });
      if (response.success && response.data) {
        setSelectedPatient(response.data);
        toast({ title: "Patient registered" });
      } else {
        toast({ title: "Could not register", description: (response as any).message || "Please try again.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Could not register", description: error?.message || "Please try again.", variant: "destructive" });
    } finally {
      setQuickCreating(false);
    }
  };

  const handleBook = async () => {
    if (!selectedPatient) {
      toast({ title: "Select a patient", description: "Pick an existing patient or quick-register a new one.", variant: "destructive" });
      return;
    }
    if (!bookingDoctorId) {
      toast({ title: "Select a doctor", description: "Choose which doctor the patient will see.", variant: "destructive" });
      return;
    }
    setBookingSubmitting(true);
    try {
      const response = await apiService.createAppointment({
        patientId: selectedPatient.id,
        doctorId: bookingDoctorId,
        appointmentDate: bookingDate,
        reason: bookingReason.trim() || null,
        notes: bookingNotes.trim() || null,
      });
      if (response.success && response.data) {
        toast({
          title: `Booked — Token ${response.data.tokenNumber}`,
          description: `${selectedPatient.name} with Dr ${response.data.doctor?.name || ""} on ${bookingDate}.`,
        });
        setBookingOpen(false);
        if (bookingDate === date) loadQueue();
      } else {
        toast({ title: "Could not book", description: (response as any).message || "Please try again.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Could not book", description: error?.message || "Please try again.", variant: "destructive" });
    } finally {
      setBookingSubmitting(false);
    }
  };

  const openComplete = (appt: AppointmentRecord) => {
    const doctor = doctors.find((d) => d.id === appt.doctorId);
    setCompleting(appt);
    setFee(doctor ? String(doctor.consultationFee ?? 0) : "");
    setExtraItems([]);
    setRxItems([]);
    setPaymentMethod("CASH");
    setPaidAmount("");
  };

  const billTotal =
    (Number(fee) || 0) +
    extraItems.reduce((sum, row) => sum + (Number(row.quantity) || 0) * (Number(row.unitPrice) || 0), 0);

  const handleComplete = async () => {
    if (!completing) return;
    const feeValue = Number(fee);
    if (fee.trim() === "" || Number.isNaN(feeValue) || feeValue < 0) {
      toast({ title: "Invalid fee", description: "Enter the consultation fee actually charged (0 for a free visit).", variant: "destructive" });
      return;
    }
    const items = extraItems
      .filter((row) => row.productId)
      .map((row) => ({
        productId: row.productId,
        quantity: Number(row.quantity) || 1,
        unitPrice: Number(row.unitPrice) || 0,
      }));
    if (extraItems.some((row) => row.productId && (Number(row.quantity) <= 0 || Number(row.unitPrice) < 0))) {
      toast({ title: "Check extra items", description: "Quantities must be above 0 and prices 0 or more.", variant: "destructive" });
      return;
    }
    const prescriptionItems = rxItems
      .filter((row) => row.productId)
      .map((row) => ({
        productId: row.productId,
        quantity: Number(row.quantity) || 1,
        dosage: row.dosage.trim() || null,
        durationDays: row.durationDays.trim() === "" ? null : Number(row.durationDays),
      }));
    setCompleteSubmitting(true);
    try {
      const response = await apiService.completeVisit(completing.id, {
        feeCharged: feeValue,
        items,
        prescriptionItems: prescriptionItems.length > 0 ? prescriptionItems : undefined,
        paymentMethod,
        paidAmount: paidAmount.trim() === "" ? undefined : Number(paidAmount),
      });
      if (response.success && response.data) {
        const sale = response.data.sale;
        toast({
          title: "Visit completed",
          description: sale
            ? `Invoice ${sale.invoiceNumber || ""} — ${money(sale.totalAmount)}${response.data.prescription ? " · prescription recorded" : ""}`
            : "Free visit — no invoice was needed.",
        });
        setCompleting(null);
        loadQueue();
      } else {
        toast({ title: "Could not complete the visit", description: (response as any).message || "Please try again.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Could not complete the visit", description: error?.message || "Please try again.", variant: "destructive" });
    } finally {
      setCompleteSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 px-4 pb-14 pt-6 sm:px-6 lg:px-11 lg:pt-9">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <CalendarDays className="h-6 w-6" /> Appointments — OPD Queue
          </span>
        }
        description="Tokens are assigned per doctor per day when a visit is booked. Completing a visit bills it."
        actions={
          <>
            <Button variant="outline" onClick={loadQueue} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button onClick={openBooking}>
              <Plus className="mr-2 h-4 w-4" /> Book Appointment
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div>
          <Label>Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-[170px]" />
        </div>
        <div>
          <Label>Doctor</Label>
          <Select value={doctorFilter} onValueChange={setDoctorFilter}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="All doctors" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All doctors</SelectItem>
              {doctors.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  Dr {d.name}{d.specialization ? ` — ${d.specialization}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="BOOKED">Booked</SelectItem>
              <SelectItem value="CHECKED_IN">Checked in</SelectItem>
              <SelectItem value="IN_VISIT">In visit</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
              <SelectItem value="NO_SHOW">No show</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-500">
          <Loader2 className="mr-2 inline h-5 w-5 animate-spin" /> Loading the queue…
        </div>
      ) : queue.length === 0 ? (
        <div className="rounded-lg border bg-white py-16 text-center text-gray-500">
          No appointments for this day. Book the first one with “Book Appointment”.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {queue.map((appt) => (
            <div key={appt.id} className="flex gap-4 rounded-lg border bg-white p-4">
              <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-lg bg-[#0a1128] text-white">
                <span className="text-[10px] uppercase tracking-wide opacity-70">Token</span>
                <span className="text-2xl font-bold leading-none">{appt.tokenNumber}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[#0a1128]">{appt.patient?.name || "Patient"}</p>
                    <p className="truncate text-sm text-gray-500">
                      Dr {appt.doctor?.name || "—"}
                      {appt.patient?.phone ? ` · ${appt.patient.phone}` : ""}
                    </p>
                  </div>
                  <Badge className={STATUS_STYLES[appt.status] || "bg-gray-100 text-gray-700"}>
                    {appt.status.replace("_", " ")}
                  </Badge>
                </div>
                {appt.reason && <p className="pt-1 text-sm text-gray-600">{appt.reason}</p>}
                {appt.status === "COMPLETED" && (
                  <p className="pt-1 text-sm text-gray-600">
                    Fee {money(appt.feeCharged)}
                    {appt.sale ? ` · Invoice ${appt.sale.invoiceNumber || ""}` : " · free visit"}
                    {appt.prescriptionId ? " · Rx recorded" : ""}
                  </p>
                )}
                <div className="flex flex-wrap gap-1 pt-3">
                  {appt.status === "BOOKED" && (
                    <>
                      <Button size="sm" onClick={() => runStatus(appt, "CHECKED_IN")} disabled={actionBusyId === appt.id}>
                        <CheckCheck className="mr-1 h-3.5 w-3.5" /> Check in
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmAction({ appt, status: "NO_SHOW" })} disabled={actionBusyId === appt.id}>
                        <UserX className="mr-1 h-3.5 w-3.5" /> No show
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmAction({ appt, status: "CANCELLED" })} disabled={actionBusyId === appt.id}>
                        <Ban className="mr-1 h-3.5 w-3.5" /> Cancel
                      </Button>
                    </>
                  )}
                  {appt.status === "CHECKED_IN" && (
                    <>
                      <Button size="sm" onClick={() => runStatus(appt, "IN_VISIT")} disabled={actionBusyId === appt.id}>
                        <Play className="mr-1 h-3.5 w-3.5" /> Start visit
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => openComplete(appt)} disabled={actionBusyId === appt.id}>
                        <Receipt className="mr-1 h-3.5 w-3.5" /> Complete visit
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmAction({ appt, status: "CANCELLED" })} disabled={actionBusyId === appt.id}>
                        <Ban className="mr-1 h-3.5 w-3.5" /> Cancel
                      </Button>
                    </>
                  )}
                  {appt.status === "IN_VISIT" && (
                    <Button size="sm" onClick={() => openComplete(appt)} disabled={actionBusyId === appt.id}>
                      <Receipt className="mr-1 h-3.5 w-3.5" /> Complete visit & bill
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Booking dialog */}
      <Dialog open={bookingOpen} onOpenChange={setBookingOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Book Appointment</DialogTitle>
            <DialogDescription>
              The token number is assigned by the server — it is the patient's place in that doctor's queue for the day.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Patient *</Label>
              {selectedPatient ? (
                <div className="flex h-10 items-center gap-2 rounded-md border bg-white px-3">
                  <span className="flex-1 truncate text-sm font-medium">
                    {selectedPatient.name}
                    {selectedPatient.phone ? <span className="text-gray-400"> · {selectedPatient.phone}</span> : null}
                  </span>
                  <button type="button" className="text-xs font-bold text-[#1a52c5] hover:underline" onClick={() => setSelectedPatient(null)}>
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <Input
                    placeholder="Search patients by name or phone…"
                    value={patientQuery}
                    onChange={(e) => setPatientQuery(e.target.value)}
                  />
                  {patientResults.length > 0 && (
                    <div className="mt-1 max-h-40 overflow-y-auto rounded-md border">
                      {patientResults.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                          onClick={() => setSelectedPatient(p)}
                        >
                          {p.name}
                          {p.phone ? <span className="text-gray-400"> · {p.phone}</span> : null}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 rounded-md bg-gray-50 p-3">
                    <p className="pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">New patient — quick register</p>
                    <div className="flex gap-2">
                      <Input placeholder="Name" value={quickName} onChange={(e) => setQuickName(e.target.value)} />
                      <Input placeholder="Phone" value={quickPhone} onChange={(e) => setQuickPhone(e.target.value)} />
                      <Button variant="secondary" onClick={quickCreatePatient} disabled={quickCreating}>
                        {quickCreating && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                        Add
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Doctor *</Label>
                <Select value={bookingDoctorId || "none"} onValueChange={(v) => setBookingDoctorId(v === "none" ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select doctor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Select doctor</SelectItem>
                    {doctors.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        Dr {d.name}{d.specialization ? ` — ${d.specialization}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Date *</Label>
                <Input type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Reason for visit</Label>
              <Input value={bookingReason} onChange={(e) => setBookingReason(e.target.value)} placeholder="e.g. Fever since yesterday" />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={bookingNotes} onChange={(e) => setBookingNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setBookingOpen(false)} disabled={bookingSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleBook} disabled={bookingSubmitting}>
              {bookingSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Book & assign token
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel / no-show confirm */}
      <Dialog open={!!confirmAction} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmAction?.status === "CANCELLED" ? "Cancel this appointment?" : "Mark as no-show?"}
            </DialogTitle>
            <DialogDescription>
              Token {confirmAction?.appt.tokenNumber} — {confirmAction?.appt.patient?.name}. The token is not
              reused; the day's queue keeps its numbering.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              Keep
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmAction) runStatus(confirmAction.appt, confirmAction.status);
                setConfirmAction(null);
              }}
            >
              {confirmAction?.status === "CANCELLED" ? "Cancel appointment" : "Mark no-show"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Complete-visit billing dialog */}
      <Dialog open={!!completing} onOpenChange={(open) => { if (!open) setCompleting(null); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Complete visit — Token {completing?.tokenNumber}
            </DialogTitle>
            <DialogDescription>
              {completing?.patient?.name} with Dr {completing?.doctor?.name}. The fee is billed as a service
              line (no stock); extra items are normal stock lines on the same invoice.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Consultation fee charged (Rs)</Label>
                <Input type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} />
                <p className="pt-1 text-xs text-gray-500">Prefilled from the doctor's standard fee — change it if this visit was charged differently. 0 = free visit.</p>
              </div>
              <div>
                <Label>Payment method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>{m.replace("_", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between pb-2">
                <Label>Extra items (medicines, tests, procedures)</Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setExtraItems((rows) => [...rows, { productId: "", productName: "", quantity: "1", unitPrice: "" }])}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add item
                </Button>
              </div>
              {extraItems.length === 0 ? (
                <p className="text-sm text-gray-500">None — the bill is the consultation fee only.</p>
              ) : (
                <div className="space-y-2">
                  {extraItems.map((row, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_80px_110px_32px] items-start gap-2">
                      <ProductSearchSelect
                        value={row}
                        onChange={(pick) =>
                          setExtraItems((rows) =>
                            rows.map((r, i) =>
                              i === idx
                                ? { ...r, ...pick, unitPrice: r.unitPrice || (pick.price != null ? String(pick.price) : "") }
                                : r
                            )
                          )
                        }
                      />
                      <Input
                        type="number"
                        min={1}
                        value={row.quantity}
                        onChange={(e) => setExtraItems((rows) => rows.map((r, i) => (i === idx ? { ...r, quantity: e.target.value } : r)))}
                        placeholder="Qty"
                      />
                      <Input
                        type="number"
                        min={0}
                        value={row.unitPrice}
                        onChange={(e) => setExtraItems((rows) => rows.map((r, i) => (i === idx ? { ...r, unitPrice: e.target.value } : r)))}
                        placeholder="Price"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExtraItems((rows) => rows.filter((_, i) => i !== idx))}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between pb-2">
                <Label>Prescription written (optional)</Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRxItems((rows) => [...rows, { productId: "", productName: "", quantity: "1", dosage: "", durationDays: "" }])}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add medicine
                </Button>
              </div>
              {rxItems.length === 0 ? (
                <p className="text-sm text-gray-500">
                  None — no prescription record is written. Added medicines go into the clinic's prescription register and attach to the invoice.
                </p>
              ) : (
                <div className="space-y-2">
                  {rxItems.map((row, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_70px_110px_90px_32px] items-start gap-2">
                      <ProductSearchSelect
                        value={row}
                        onChange={(pick) => setRxItems((rows) => rows.map((r, i) => (i === idx ? { ...r, ...pick } : r)))}
                      />
                      <Input
                        type="number"
                        min={1}
                        value={row.quantity}
                        onChange={(e) => setRxItems((rows) => rows.map((r, i) => (i === idx ? { ...r, quantity: e.target.value } : r)))}
                        placeholder="Qty"
                      />
                      <Input
                        value={row.dosage}
                        onChange={(e) => setRxItems((rows) => rows.map((r, i) => (i === idx ? { ...r, dosage: e.target.value } : r)))}
                        placeholder="Dosage 1+0+1"
                      />
                      <Input
                        type="number"
                        min={1}
                        value={row.durationDays}
                        onChange={(e) => setRxItems((rows) => rows.map((r, i) => (i === idx ? { ...r, durationDays: e.target.value } : r)))}
                        placeholder="Days"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRxItems((rows) => rows.filter((_, i) => i !== idx))}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 items-end gap-4">
              <div>
                <Label>Amount paid (Rs) — blank = full bill</Label>
                <Input type="number" min={0} value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} placeholder={String(billTotal || "")} />
              </div>
              <div className="pb-1 text-right">
                <span className="text-sm text-gray-500">Bill total: </span>
                <span className="text-lg font-bold text-[#0a1128]">{money(billTotal)}</span>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCompleting(null)} disabled={completeSubmitting}>
              Not yet
            </Button>
            <Button onClick={handleComplete} disabled={completeSubmitting}>
              {completeSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Complete & bill
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AppointmentsPage;
