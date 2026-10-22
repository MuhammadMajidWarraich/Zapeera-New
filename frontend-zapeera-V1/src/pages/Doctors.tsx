import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
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
  Search,
  Plus,
  Pencil,
  Ban,
  Loader2,
  RefreshCw,
  HeartPulse,
  HandCoins,
} from "lucide-react";
import {
  apiService,
  type DoctorRecord,
  type DoctorPayload,
  type DoctorSettlementReport,
  type DoctorSettlementRecord,
} from "@/services/api";
import { useAuth, getMembershipRole } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

// Doctors + share settlement (Wave C4 — Clinic pack). A doctor's fee
// and sharePercent are defaults for FUTURE visits: completing a visit
// snapshots the fee charged and the doctor's share onto the
// appointment, and the settlement report below reads those snapshots
// — editing a doctor never rewrites what was already earned.
// Outstanding for a period = share earned in it − payouts made in it.

interface DoctorFormState {
  name: string;
  specialization: string;
  phone: string;
  consultationFee: string;
  sharePercent: string;
}

const emptyForm: DoctorFormState = {
  name: "",
  specialization: "",
  phone: "",
  consultationFee: "",
  sharePercent: "",
};

const money = (n: number | null | undefined) =>
  `Rs ${Number(n || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

const todayInputValue = () => new Date().toISOString().slice(0, 10);
const monthStartInputValue = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

const DoctorsPage: React.FC = () => {
  const { user } = useAuth();
  const role = getMembershipRole(user as any);
  const canManage = role === "OWNER" || role === "MANAGER";

  const [records, setRecords] = useState<DoctorRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DoctorRecord | null>(null);
  const [form, setForm] = useState<DoctorFormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const [deactivating, setDeactivating] = useState<DoctorRecord | null>(null);
  const [deactivateSubmitting, setDeactivateSubmitting] = useState(false);

  // Settlement
  const [reportFrom, setReportFrom] = useState(monthStartInputValue());
  const [reportTo, setReportTo] = useState(todayInputValue());
  const [report, setReport] = useState<DoctorSettlementReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [settlements, setSettlements] = useState<DoctorSettlementRecord[]>([]);

  const [payoutDoctor, setPayoutDoctor] = useState<DoctorRecord | null>(null);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutNote, setPayoutNote] = useState("");
  const [payoutSubmitting, setPayoutSubmitting] = useState(false);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiService.getDoctors({
        page: 1,
        limit: 100,
        search: searchQuery.trim() || undefined,
        isActive: statusFilter === "all" ? undefined : statusFilter === "active",
      });
      if (response.success && response.data) setRecords(response.data);
    } catch (error) {
      toast({ title: "Error", description: "Could not load doctors.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter]);

  const loadSettlement = useCallback(async () => {
    setReportLoading(true);
    try {
      const [reportRes, settlementsRes] = await Promise.all([
        apiService.getDoctorSettlementReport({ from: reportFrom || undefined, to: reportTo || undefined }),
        apiService.getDoctorSettlements({ page: 1, limit: 20 }),
      ]);
      if (reportRes.success && reportRes.data) setReport(reportRes.data);
      if (settlementsRes.success && settlementsRes.data) setSettlements(settlementsRes.data);
    } catch (error) {
      toast({ title: "Error", description: "Could not load the settlement report.", variant: "destructive" });
    } finally {
      setReportLoading(false);
    }
  }, [reportFrom, reportTo]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    loadSettlement();
  }, [loadSettlement]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (record: DoctorRecord) => {
    setEditing(record);
    setForm({
      name: record.name || "",
      specialization: record.specialization || "",
      phone: record.phone || "",
      consultationFee: record.consultationFee != null ? String(record.consultationFee) : "",
      sharePercent: record.sharePercent != null ? String(record.sharePercent) : "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast({ title: "Name required", description: "Enter the doctor's name.", variant: "destructive" });
      return;
    }
    const fee = form.consultationFee.trim() === "" ? 0 : Number(form.consultationFee);
    const share = form.sharePercent.trim() === "" ? 0 : Number(form.sharePercent);
    if (Number.isNaN(fee) || fee < 0) {
      toast({ title: "Invalid fee", description: "Consultation fee must be 0 or more.", variant: "destructive" });
      return;
    }
    if (Number.isNaN(share) || share < 0 || share > 100) {
      toast({ title: "Invalid share", description: "Doctor share must be between 0 and 100%.", variant: "destructive" });
      return;
    }
    const payload: DoctorPayload = {
      name: form.name.trim(),
      specialization: form.specialization.trim() || null,
      phone: form.phone.trim() || null,
      consultationFee: fee,
      sharePercent: share,
    };
    setSubmitting(true);
    try {
      const response = editing
        ? await apiService.updateDoctor(editing.id, payload)
        : await apiService.createDoctor(payload);
      if (response.success) {
        toast({ title: editing ? "Doctor updated" : "Doctor added" });
        setDialogOpen(false);
        loadRecords();
      } else {
        toast({ title: "Could not save", description: (response as any).message || "Please try again.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Could not save", description: error?.message || "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivating) return;
    setDeactivateSubmitting(true);
    try {
      const response = await apiService.deactivateDoctor(deactivating.id);
      if (response.success) {
        toast({ title: "Doctor deactivated" });
        setDeactivating(null);
        loadRecords();
      } else {
        toast({ title: "Could not deactivate", description: (response as any).message || "Please try again.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Could not deactivate", description: error?.message || "Please try again.", variant: "destructive" });
    } finally {
      setDeactivateSubmitting(false);
    }
  };

  const handleReactivate = async (record: DoctorRecord) => {
    try {
      const response = await apiService.updateDoctor(record.id, { isActive: true });
      if (response.success) {
        toast({ title: "Doctor reactivated" });
        loadRecords();
      }
    } catch (error: any) {
      toast({ title: "Could not reactivate", description: error?.message || "Please try again.", variant: "destructive" });
    }
  };

  const openPayout = (doctorId: string, outstanding: number) => {
    const doctor = records.find((d) => d.id === doctorId) || null;
    setPayoutDoctor(doctor);
    setPayoutAmount(outstanding > 0 ? String(outstanding) : "");
    setPayoutNote("");
  };

  const handlePayout = async () => {
    if (!payoutDoctor) return;
    const amount = Number(payoutAmount);
    if (Number.isNaN(amount) || amount <= 0) {
      toast({ title: "Invalid amount", description: "Enter a payout amount above 0.", variant: "destructive" });
      return;
    }
    setPayoutSubmitting(true);
    try {
      const response = await apiService.createDoctorSettlement({
        doctorId: payoutDoctor.id,
        from: reportFrom,
        to: reportTo,
        amount,
        note: payoutNote.trim() || null,
      });
      if (response.success) {
        toast({ title: "Settlement recorded", description: `${money(amount)} paid to Dr ${payoutDoctor.name}.` });
        setPayoutDoctor(null);
        loadSettlement();
      } else {
        toast({ title: "Could not record", description: (response as any).message || "Please try again.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Could not record", description: error?.message || "Please try again.", variant: "destructive" });
    } finally {
      setPayoutSubmitting(false);
    }
  };

  const reportRowByDoctor = new Map((report?.doctors || []).map((row) => [row.doctorId, row]));

  return (
    <div className="space-y-8 px-4 pb-14 pt-6 sm:px-6 lg:px-11 lg:pt-9">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <HeartPulse className="h-6 w-6" /> Doctors
          </span>
        }
        description="Consultation fees and each doctor's share of them. Fee/share changes apply to future visits only."
        actions={
          <>
            <Button variant="outline" onClick={loadRecords} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> New Doctor
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            className="pl-9"
            placeholder="Search by name or specialization…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Doctor</th>
              <th className="px-4 py-3">Specialization</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Fee</th>
              <th className="px-4 py-3">Doctor share</th>
              <th className="px-4 py-3">Visits</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-500">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-4">
                  <EmptyState
                    icon={HeartPulse}
                    title="No doctors found"
                    description="Add the first doctor with “New Doctor”."
                  />
                </td>
              </tr>
            ) : (
              records.map((record) => (
                <tr key={record.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-[#0a1128]">Dr {record.name}</td>
                  <td className="px-4 py-3">{record.specialization || "—"}</td>
                  <td className="px-4 py-3">{record.phone || "—"}</td>
                  <td className="px-4 py-3">{money(record.consultationFee)}</td>
                  <td className="px-4 py-3">{record.sharePercent}%</td>
                  <td className="px-4 py-3">{record._count?.appointments ?? 0}</td>
                  <td className="px-4 py-3">
                    {record.isActive ? (
                      <Badge className="bg-green-100 text-green-800">Active</Badge>
                    ) : (
                      <Badge className="bg-gray-200 text-gray-700">Inactive</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(record)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {canManage && record.isActive && (
                        <Button variant="ghost" size="sm" onClick={() => setDeactivating(record)} title="Deactivate">
                          <Ban className="h-4 w-4 text-red-500" />
                        </Button>
                      )}
                      {canManage && !record.isActive && (
                        <Button variant="ghost" size="sm" onClick={() => handleReactivate(record)} title="Reactivate">
                          <RefreshCw className="h-4 w-4 text-green-600" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ─── Settlement ─────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-[#0a1128]">
              <HandCoins className="h-5 w-5" /> Doctor-share settlement
            </h2>
            <p className="text-sm text-gray-500">
              Earned = the doctor's share snapshotted on completed visits in the period. Outstanding = earned − payouts made in the period.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <Label>From</Label>
              <Input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} />
            </div>
            <div>
              <Label>To</Label>
              <Input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} />
            </div>
            <Button variant="outline" onClick={loadSettlement} disabled={reportLoading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${reportLoading ? "animate-spin" : ""}`} /> Reload
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Doctor</th>
                <th className="px-4 py-3">Visits</th>
                <th className="px-4 py-3">Fee revenue</th>
                <th className="px-4 py-3">Doctor share</th>
                <th className="px-4 py-3">Clinic share</th>
                <th className="px-4 py-3">Paid out</th>
                <th className="px-4 py-3">Outstanding</th>
                {canManage && <th className="px-4 py-3 text-right">Payout</th>}
              </tr>
            </thead>
            <tbody>
              {reportLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-500">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
                  </td>
                </tr>
              ) : !report || report.doctors.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-500">
                    No doctors to settle yet.
                  </td>
                </tr>
              ) : (
                <>
                  {report.doctors.map((row) => (
                    <tr key={row.doctorId} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-[#0a1128]">
                        Dr {row.doctor.name}
                        {!row.doctor.isActive && <span className="ml-2 text-xs text-gray-400">(inactive)</span>}
                      </td>
                      <td className="px-4 py-3">{row.visits}</td>
                      <td className="px-4 py-3">{money(row.consultationRevenue)}</td>
                      <td className="px-4 py-3">{money(row.doctorShare)}</td>
                      <td className="px-4 py-3">{money(row.clinicShare)}</td>
                      <td className="px-4 py-3">{money(row.settled)}</td>
                      <td className="px-4 py-3 font-semibold">{money(row.outstanding)}</td>
                      {canManage && (
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openPayout(row.doctorId, row.outstanding)}
                            disabled={!reportRowByDoctor.has(row.doctorId)}
                          >
                            Record payout
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                  <tr className="border-t bg-gray-50 font-semibold">
                    <td className="px-4 py-3">Totals</td>
                    <td className="px-4 py-3">{report.totals.visits}</td>
                    <td className="px-4 py-3">{money(report.totals.consultationRevenue)}</td>
                    <td className="px-4 py-3">{money(report.totals.doctorShare)}</td>
                    <td className="px-4 py-3">{money(report.totals.clinicShare)}</td>
                    <td className="px-4 py-3">{money(report.totals.settled)}</td>
                    <td className="px-4 py-3">{money(report.totals.outstanding)}</td>
                    {canManage && <td />}
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>

        {settlements.length > 0 && (
          <div className="rounded-lg border bg-white">
            <h3 className="border-b px-4 py-3 text-sm font-semibold text-[#0a1128]">Recent payouts</h3>
            <div className="divide-y">
              {settlements.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span>
                    <span className="font-medium">Dr {s.doctor?.name || "—"}</span>
                    <span className="text-gray-500">
                      {" "}· for {s.periodFrom.slice(0, 10)} → {s.periodTo.slice(0, 10)}
                      {s.note ? ` · ${s.note}` : ""}
                    </span>
                  </span>
                  <span className="font-semibold">{money(s.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Doctor" : "New Doctor"}</DialogTitle>
            <DialogDescription>
              The fee is billed per visit as a service line (no stock). Share is the doctor's cut of the fee.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Full name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ahmed Raza" />
            </div>
            <div>
              <Label>Specialization</Label>
              <Input value={form.specialization} onChange={(e) => setForm({ ...form, specialization: e.target.value })} placeholder="e.g. General Physician" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="03xx-xxxxxxx" />
            </div>
            <div>
              <Label>Consultation fee (Rs)</Label>
              <Input type="number" min={0} value={form.consultationFee} onChange={(e) => setForm({ ...form, consultationFee: e.target.value })} />
            </div>
            <div>
              <Label>Doctor share (%)</Label>
              <Input type="number" min={0} max={100} value={form.sharePercent} onChange={(e) => setForm({ ...form, sharePercent: e.target.value })} />
              <p className="pt-1 text-xs text-gray-500">The clinic keeps the rest. Applies to future visits only.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Add doctor"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Payout dialog */}
      <Dialog open={!!payoutDoctor} onOpenChange={(open) => { if (!open) setPayoutDoctor(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record payout — Dr {payoutDoctor?.name}</DialogTitle>
            <DialogDescription>
              Records share money paid to the doctor for {reportFrom} → {reportTo}. It reduces the doctor's outstanding for the period it is paid in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Amount (Rs)</Label>
              <Input type="number" min={0} value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)} />
            </div>
            <div>
              <Label>Note (optional)</Label>
              <Textarea value={payoutNote} onChange={(e) => setPayoutNote(e.target.value)} rows={2} placeholder="e.g. Cash paid at desk" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setPayoutDoctor(null)} disabled={payoutSubmitting}>
              Cancel
            </Button>
            <Button onClick={handlePayout} disabled={payoutSubmitting}>
              {payoutSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record payout
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Deactivate confirm */}
      <Dialog open={!!deactivating} onOpenChange={(open) => { if (!open) setDeactivating(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Deactivate doctor?</DialogTitle>
            <DialogDescription>
              Dr {deactivating?.name} will no longer take new bookings. Existing appointments can still be
              completed and billed, and settlement history is kept.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeactivating(null)} disabled={deactivateSubmitting}>
              Keep active
            </Button>
            <Button variant="destructive" onClick={handleDeactivate} disabled={deactivateSubmitting}>
              {deactivateSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Deactivate
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DoctorsPage;
