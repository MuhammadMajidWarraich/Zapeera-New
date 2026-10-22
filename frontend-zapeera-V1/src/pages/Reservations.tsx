import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  CalendarCheck,
  LogIn,
  Ban,
  UserX,
  Search,
} from "lucide-react";
import {
  apiService,
  type AvailabilityRoom,
  type ReservationRecord,
} from "@/services/api";
import { toast } from "@/hooks/use-toast";
import FolioDialog from "@/components/hotel/FolioDialog";

// Reservations (Wave C5 — Hotel pack). Booking picks dates first:
// the room list is the server's availability answer for that range,
// so a room that would conflict is shown blocked with its conflicting
// booking instead of failing after the fact. Check-in opens the
// stay's folio (first night posted at the type's current rate) and
// hands the desk straight into the folio.

const STATUS_STYLES: Record<string, string> = {
  BOOKED: "bg-blue-100 text-blue-800",
  CHECKED_IN: "bg-purple-100 text-purple-800",
  COMPLETED: "bg-green-100 text-green-800",
  CANCELLED: "bg-gray-200 text-gray-700",
  NO_SHOW: "bg-red-100 text-red-800",
};

const SOURCES = ["WALK_IN", "PHONE", "WHATSAPP", "ONLINE", "OTHER"];

const money = (n: number | null | undefined) =>
  `Rs ${Number(n || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

const todayInputValue = () => {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const plusDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const dayLabel = (iso?: string | null) => (iso ? String(iso).slice(0, 10) : "—");

const ReservationsPage: React.FC = () => {
  const [records, setRecords] = useState<ReservationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    guestName: "",
    guestPhone: "",
    guestCnic: "",
    checkInDate: todayInputValue(),
    checkOutDate: plusDays(todayInputValue(), 1),
    roomId: "",
    adults: "2",
    children: "0",
    source: "WALK_IN",
    notes: "",
  });
  const [availability, setAvailability] = useState<AvailabilityRoom[] | null>(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [saving, setSaving] = useState(false);

  const [folioId, setFolioId] = useState<string | null>(null);
  const [folioOpen, setFolioOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiService.getReservations({
        limit: 200,
        status: statusFilter === "all" ? undefined : statusFilter,
        date: dateFilter || undefined,
        search: search || undefined,
      });
      if (response.success && response.data) setRecords(response.data);
    } catch {
      toast({ title: "Could not load reservations", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, dateFilter, search]);

  useEffect(() => {
    load();
  }, [load]);

  const checkAvailability = useCallback(async () => {
    if (!form.checkInDate || !form.checkOutDate) return;
    setCheckingAvailability(true);
    try {
      const response = await apiService.getAvailability({
        from: form.checkInDate,
        to: form.checkOutDate,
      });
      if (response.success && response.data) {
        setAvailability(response.data);
        const picked = response.data.find((r) => r.id === form.roomId);
        if (picked && !picked.bookable) setForm((f) => ({ ...f, roomId: "" }));
      }
    } catch {
      setAvailability(null);
    } finally {
      setCheckingAvailability(false);
    }
  }, [form.checkInDate, form.checkOutDate, form.roomId]);

  useEffect(() => {
    if (createOpen) checkAvailability();
  }, [createOpen, form.checkInDate, form.checkOutDate]);

  const create = async () => {
    setSaving(true);
    try {
      const response = await apiService.createReservation({
        guestName: form.guestName.trim(),
        guestPhone: form.guestPhone.trim() || null,
        guestCnic: form.guestCnic.trim() || null,
        roomId: form.roomId,
        checkInDate: form.checkInDate,
        checkOutDate: form.checkOutDate,
        adults: form.adults ? Number(form.adults) : null,
        children: form.children ? Number(form.children) : null,
        source: form.source || null,
        notes: form.notes.trim() || null,
      });
      if (response.success) {
        toast({ title: "Reservation created" });
        setCreateOpen(false);
        setForm({
          guestName: "",
          guestPhone: "",
          guestCnic: "",
          checkInDate: todayInputValue(),
          checkOutDate: plusDays(todayInputValue(), 1),
          roomId: "",
          adults: "2",
          children: "0",
          source: "WALK_IN",
          notes: "",
        });
        load();
      } else {
        toast({ title: (response as any)?.message || "Could not create the reservation", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: err?.message || "Could not create the reservation", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const checkIn = async (record: ReservationRecord) => {
    setBusyId(record.id);
    try {
      const response = await apiService.checkInReservation(record.id);
      if (response.success && response.data) {
        toast({ title: `Checked in — folio opened for room ${record.room?.number || ""}` });
        load();
        setFolioId(response.data.folio.id);
        setFolioOpen(true);
      } else {
        toast({ title: (response as any)?.message || "Check-in failed", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: err?.message || "Check-in failed", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const setStatus = async (record: ReservationRecord, status: "CANCELLED" | "NO_SHOW") => {
    setBusyId(record.id);
    try {
      const response = await apiService.updateReservationStatus(record.id, status);
      if (response.success) {
        toast({ title: `Reservation marked ${status}` });
        load();
      } else {
        toast({ title: (response as any)?.message || "Status change refused", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: err?.message || "Status change refused", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const pickedRoom = availability?.find((r) => r.id === form.roomId);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarCheck className="h-6 w-6" /> Reservations
          </h1>
          <p className="text-sm text-muted-foreground">
            A walk-in is just a reservation for today — create it, then check the guest in.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> New reservation
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.keys(STATUS_STYLES).map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          className="w-44"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          title="Arrivals on"
        />
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
          <Input
            className="pl-8 w-56"
            placeholder="Guest, phone or CNIC"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : records.length === 0 ? (
        <div className="rounded-lg border p-10 text-center text-muted-foreground">
          No reservations match. Create the first one.
        </div>
      ) : (
        <div className="rounded-lg border divide-y">
          {records.map((record) => (
            <div key={record.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{record.guestName}</span>
                  <Badge className={STATUS_STYLES[record.status]}>{record.status}</Badge>
                  {record.source && <Badge variant="outline">{record.source}</Badge>}
                </div>
                <div className="text-sm text-muted-foreground">
                  Room {record.room?.number || "—"} ({record.room?.roomType?.name || "Room"}) ·{" "}
                  {dayLabel(record.checkInDate)} → {dayLabel(record.checkOutDate)}
                  {record.guestPhone ? ` · ${record.guestPhone}` : ""}
                  {record.guestCnic ? ` · CNIC ${record.guestCnic}` : ""}
                </div>
                {record.notes && <div className="text-sm">{record.notes}</div>}
              </div>
              <div className="flex gap-1">
                {record.status === "BOOKED" && (
                  <>
                    <Button size="sm" disabled={busyId === record.id} onClick={() => checkIn(record)}>
                      <LogIn className="h-3 w-3 mr-1" /> Check in
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === record.id}
                      onClick={() => setStatus(record, "NO_SHOW")}
                    >
                      <UserX className="h-3 w-3 mr-1" /> No-show
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === record.id}
                      onClick={() => setStatus(record, "CANCELLED")}
                    >
                      <Ban className="h-3 w-3 mr-1" /> Cancel
                    </Button>
                  </>
                )}
                {record.status === "CHECKED_IN" && record.folioId && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setFolioId(record.folioId!);
                      setFolioOpen(true);
                    }}
                  >
                    Open folio
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New reservation</DialogTitle>
            <DialogDescription>
              Pick the dates first — the room list below is live availability for that range.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Check-in</Label>
                <Input
                  type="date"
                  value={form.checkInDate}
                  onChange={(e) => setForm({ ...form, checkInDate: e.target.value })}
                />
              </div>
              <div>
                <Label>Check-out</Label>
                <Input
                  type="date"
                  value={form.checkOutDate}
                  onChange={(e) => setForm({ ...form, checkOutDate: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label>Room {checkingAvailability && <Loader2 className="inline h-3 w-3 animate-spin" />}</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {(availability || []).map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    disabled={!room.bookable}
                    onClick={() => setForm({ ...form, roomId: room.id })}
                    className={`text-left rounded-lg border p-3 text-sm ${
                      form.roomId === room.id ? "border-primary ring-1 ring-primary" : ""
                    } ${room.bookable ? "" : "opacity-50 cursor-not-allowed"}`}
                  >
                    <div className="flex justify-between">
                      <span className="font-semibold">{room.number}</span>
                      <Badge className={room.bookable ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                        {room.bookable ? "Available" : "Blocked"}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground">
                      {room.roomType?.name} · {money(room.roomType?.ratePerNight)}/night · {room.status}
                    </div>
                    {!room.bookable && room.conflicts.length > 0 && (
                      <div className="text-red-700">
                        Booked: {room.conflicts.map((c) => `${c.guestName} (${dayLabel(c.checkInDate)} → ${dayLabel(c.checkOutDate)})`).join("; ")}
                      </div>
                    )}
                    {!room.bookable && room.conflicts.length === 0 && (
                      <div className="text-red-700">Under maintenance for a stay including today.</div>
                    )}
                  </button>
                ))}
                {availability !== null && availability.length === 0 && (
                  <p className="text-sm text-muted-foreground col-span-2">
                    No active rooms. Add rooms first.
                  </p>
                )}
              </div>
              {pickedRoom && (
                <p className="text-xs text-muted-foreground mt-1">
                  Estimated room total: {money(pickedRoom.roomType?.ratePerNight)} × nights — the
                  folio bills per posted night at the rate snapshotted at check-in.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Guest name</Label>
                <Input
                  value={form.guestName}
                  onChange={(e) => setForm({ ...form, guestName: e.target.value })}
                  placeholder="Full name"
                />
              </div>
              <div>
                <Label>Phone</Label>
                <Input
                  value={form.guestPhone}
                  onChange={(e) => setForm({ ...form, guestPhone: e.target.value })}
                  placeholder="03xx-xxxxxxx"
                />
              </div>
              <div>
                <Label>CNIC / passport</Label>
                <Input
                  value={form.guestCnic}
                  onChange={(e) => setForm({ ...form, guestCnic: e.target.value })}
                  placeholder="35202-xxxxxxx-x"
                />
              </div>
              <div>
                <Label>Source</Label>
                <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Adults</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.adults}
                  onChange={(e) => setForm({ ...form, adults: e.target.value })}
                />
              </div>
              <div>
                <Label>Children</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.children}
                  onChange={(e) => setForm({ ...form, children: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Early arrival, extra bed…"
              />
            </div>
            <Button
              className="w-full"
              onClick={create}
              disabled={saving || !form.guestName.trim() || !form.roomId}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Create reservation
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <FolioDialog folioId={folioId} open={folioOpen} onOpenChange={setFolioOpen} onChanged={load} />
    </div>
  );
};

export default ReservationsPage;
