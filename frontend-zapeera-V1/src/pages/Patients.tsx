import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
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
  Eye,
  Ban,
  Loader2,
  RefreshCw,
  Users,
} from "lucide-react";
import {
  apiService,
  type PatientRecord,
  type PatientPayload,
} from "@/services/api";
import { useAuth, getMembershipRole } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

// Patients register (Wave C4 — Clinic pack). Patient-Lite: the
// clinic's own register of the people it treats — deliberately
// separate from the sales Customer register (no khata, no loyalty).
// Records are never deleted: deactivation (owner/manager) hides a
// patient from active lists while the visit history stays readable.

interface PatientFormState {
  name: string;
  phone: string;
  age: string;
  gender: string;
  cnic: string;
  address: string;
  notes: string;
}

const emptyForm: PatientFormState = {
  name: "",
  phone: "",
  age: "",
  gender: "",
  cnic: "",
  address: "",
  notes: "",
};

const statusBadge = (appt: { status: string }) => {
  const styles: Record<string, string> = {
    BOOKED: "bg-blue-100 text-blue-800",
    CHECKED_IN: "bg-amber-100 text-amber-800",
    IN_VISIT: "bg-purple-100 text-purple-800",
    COMPLETED: "bg-green-100 text-green-800",
    CANCELLED: "bg-gray-200 text-gray-700",
    NO_SHOW: "bg-red-100 text-red-800",
  };
  return (
    <Badge className={styles[appt.status] || "bg-gray-100 text-gray-700"}>
      {appt.status.replace("_", " ")}
    </Badge>
  );
};

const PatientsPage: React.FC = () => {
  const { user } = useAuth();
  const role = getMembershipRole(user as any);
  const canManage = role === "OWNER" || role === "MANAGER";

  const [records, setRecords] = useState<PatientRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PatientRecord | null>(null);
  const [form, setForm] = useState<PatientFormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const [detail, setDetail] = useState<PatientRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [deactivating, setDeactivating] = useState<PatientRecord | null>(null);
  const [deactivateSubmitting, setDeactivateSubmitting] = useState(false);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiService.getPatients({
        page,
        limit: 20,
        search: searchQuery.trim() || undefined,
        isActive: statusFilter === "all" ? undefined : statusFilter === "active",
      });
      if (response.success && response.data) {
        setRecords(response.data);
        const pagination = (response as any).pagination;
        if (pagination) setTotalPages(Math.max(1, pagination.pages || 1));
      }
    } catch (error) {
      toast({ title: "Error", description: "Could not load patients.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, statusFilter]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (record: PatientRecord) => {
    setEditing(record);
    setForm({
      name: record.name || "",
      phone: record.phone || "",
      age: record.age != null ? String(record.age) : "",
      gender: record.gender || "",
      cnic: record.cnic || "",
      address: record.address || "",
      notes: record.notes || "",
    });
    setDialogOpen(true);
  };

  const openDetail = async (record: PatientRecord) => {
    setDetail(record);
    setDetailLoading(true);
    try {
      const response = await apiService.getPatient(record.id);
      if (response.success && response.data) setDetail(response.data);
    } catch {
      // The list payload is already a usable fallback.
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast({ title: "Name required", description: "Enter the patient's name.", variant: "destructive" });
      return;
    }
    const age = form.age.trim() === "" ? null : Number(form.age);
    if (age !== null && (!Number.isInteger(age) || age < 0 || age > 130)) {
      toast({ title: "Invalid age", description: "Age must be a whole number between 0 and 130.", variant: "destructive" });
      return;
    }
    const payload: PatientPayload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      age,
      gender: form.gender || null,
      cnic: form.cnic.trim() || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
    };
    setSubmitting(true);
    try {
      const response = editing
        ? await apiService.updatePatient(editing.id, payload)
        : await apiService.createPatient(payload);
      if (response.success) {
        toast({ title: editing ? "Patient updated" : "Patient registered" });
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
      const response = await apiService.deactivatePatient(deactivating.id);
      if (response.success) {
        toast({ title: "Patient deactivated" });
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

  const handleReactivate = async (record: PatientRecord) => {
    try {
      const response = await apiService.updatePatient(record.id, { isActive: true });
      if (response.success) {
        toast({ title: "Patient reactivated" });
        loadRecords();
      }
    } catch (error: any) {
      toast({ title: "Could not reactivate", description: error?.message || "Please try again.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[#0a1128]">
            <Users className="h-6 w-6" /> Patients
          </h1>
          <p className="text-sm text-gray-500">
            The clinic's patient register — separate from sales customers. Records are never deleted, only deactivated.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadRecords} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> New Patient
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            className="pl-9"
            placeholder="Search by name, phone or CNIC…"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as any); setPage(1); }}>
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
              <th className="px-4 py-3">Patient</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Age / Gender</th>
              <th className="px-4 py-3">CNIC</th>
              <th className="px-4 py-3">Visits</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                  No patients found. Register the first patient with “New Patient”.
                </td>
              </tr>
            ) : (
              records.map((record) => (
                <tr key={record.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-[#0a1128]">{record.name}</td>
                  <td className="px-4 py-3">{record.phone || "—"}</td>
                  <td className="px-4 py-3">
                    {[record.age != null ? `${record.age} yrs` : null, record.gender || null].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-4 py-3">{record.cnic || "—"}</td>
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
                      <Button variant="ghost" size="sm" onClick={() => openDetail(record)} title="View + visit history">
                        <Eye className="h-4 w-4" />
                      </Button>
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

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Patient" : "New Patient"}</DialogTitle>
            <DialogDescription>
              Patient-Lite record — only the name is required.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Full name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Muhammad Ali" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="03xx-xxxxxxx" />
            </div>
            <div>
              <Label>CNIC</Label>
              <Input value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} placeholder="35202-xxxxxxx-x" />
            </div>
            <div>
              <Label>Age (years)</Label>
              <Input type="number" min={0} max={130} value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} />
            </div>
            <div>
              <Label>Gender</Label>
              <Select value={form.gender || "unspecified"} onValueChange={(v) => setForm({ ...form, gender: v === "unspecified" ? "" : v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unspecified">Not specified</SelectItem>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Address</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="col-span-2">
              <Label>Notes (allergies, chronic conditions…)</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Register patient"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail + visit history */}
      <Dialog open={!!detail} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.name}</DialogTitle>
            <DialogDescription>
              {[detail?.phone, detail?.cnic, detail?.age != null ? `${detail.age} yrs` : null, detail?.gender]
                .filter(Boolean)
                .join(" · ") || "Patient record"}
            </DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <div className="py-8 text-center text-gray-500">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading history…
            </div>
          ) : (
            <div className="space-y-3">
              {detail?.address && <p className="text-sm text-gray-600">{detail.address}</p>}
              {detail?.notes && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{detail.notes}</p>
              )}
              <h3 className="pt-2 text-sm font-semibold text-[#0a1128]">Visit history</h3>
              {(detail?.appointments || []).length === 0 ? (
                <p className="text-sm text-gray-500">No visits yet.</p>
              ) : (
                <div className="max-h-[40vh] space-y-2 overflow-y-auto">
                  {(detail?.appointments || []).map((appt) => (
                    <div key={appt.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <div>
                        <span className="font-medium">
                          {appt.appointmentDate ? appt.appointmentDate.slice(0, 10) : ""} · Token {appt.tokenNumber}
                        </span>
                        <span className="text-gray-500">
                          {" "}— Dr {appt.doctor?.name || "—"}
                          {appt.reason ? ` · ${appt.reason}` : ""}
                        </span>
                      </div>
                      {statusBadge(appt)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Deactivate confirm */}
      <Dialog open={!!deactivating} onOpenChange={(open) => { if (!open) setDeactivating(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Deactivate patient?</DialogTitle>
            <DialogDescription>
              {deactivating?.name} will stop appearing in active lists and cannot be booked until reactivated.
              The record and its visit history are kept.
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

export default PatientsPage;
