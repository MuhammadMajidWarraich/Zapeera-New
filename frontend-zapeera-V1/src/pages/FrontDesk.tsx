import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  RefreshCw,
  ConciergeBell,
  LogIn,
  LogOut,
  MoonStar,
  BedDouble,
} from "lucide-react";
import {
  apiService,
  type FolioRecord,
  type NightAuditRecord,
  type ReservationRecord,
} from "@/services/api";
import { toast } from "@/hooks/use-toast";
import FolioDialog from "@/components/hotel/FolioDialog";

// Front Desk (Wave C5 — Hotel pack): the day board. Arrivals are
// today's BOOKED reservations, in-house is the OPEN folio register,
// departures are checked-in stays whose check-out day is today. The
// strip on top is the night-audit-lite summary; its button posts
// tonight's room night on every open folio (the night audit step).
// Folio work itself (charges, payments, check-out) happens in the
// shared FolioDialog.

const money = (n: number | null | undefined) =>
  `Rs ${Number(n || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

const todayInputValue = () => {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const dayLabel = (iso?: string | null) => (iso ? String(iso).slice(0, 10) : "—");

const FrontDeskPage: React.FC = () => {
  const today = todayInputValue();
  const [audit, setAudit] = useState<NightAuditRecord | null>(null);
  const [arrivals, setArrivals] = useState<ReservationRecord[]>([]);
  const [departures, setDepartures] = useState<ReservationRecord[]>([]);
  const [inHouse, setInHouse] = useState<FolioRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [folioId, setFolioId] = useState<string | null>(null);
  const [folioOpen, setFolioOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [auditRes, arrivalsRes, checkedInRes, foliosRes] = await Promise.all([
        apiService.getNightAudit(today),
        apiService.getReservations({ date: today, status: "BOOKED", limit: 200 }),
        apiService.getReservations({ status: "CHECKED_IN", limit: 200 }),
        apiService.getFolios({ status: "OPEN", limit: 200 }),
      ]);
      if (auditRes.success && auditRes.data) setAudit(auditRes.data);
      if (arrivalsRes.success && arrivalsRes.data) setArrivals(arrivalsRes.data);
      if (checkedInRes.success && checkedInRes.data) {
        setDepartures(
          checkedInRes.data.filter((r) => dayLabel(r.checkOutDate) === today)
        );
      }
      if (foliosRes.success && foliosRes.data) setInHouse(foliosRes.data);
    } catch {
      toast({ title: "Could not load the front desk board", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    load();
  }, [load]);

  const checkIn = async (record: ReservationRecord) => {
    setBusyId(record.id);
    try {
      const response = await apiService.checkInReservation(record.id);
      if (response.success && response.data) {
        toast({ title: `Checked in — room ${record.room?.number || ""}` });
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

  const postAllNights = async () => {
    setPosting(true);
    try {
      const response = await apiService.postNightChargesBulk();
      if (response.success && response.data) {
        toast({
          title: `Night audit: posted ${response.data.postedCount} room night(s) — ${money(response.data.postedTotal)}`,
          description: response.data.skippedCount
            ? `${response.data.skippedCount} folio(s) already had tonight posted.`
            : undefined,
        });
        load();
      } else {
        toast({ title: (response as any)?.message || "Night posting failed", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: err?.message || "Night posting failed", variant: "destructive" });
    } finally {
      setPosting(false);
    }
  };

  const openFolio = (id: string) => {
    setFolioId(id);
    setFolioOpen(true);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ConciergeBell className="h-6 w-6" /> Front Desk — {today}
          </h1>
          <p className="text-sm text-muted-foreground">
            Arrivals, in-house guests and departures for today.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button onClick={postAllNights} disabled={posting}>
            {posting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <MoonStar className="h-4 w-4 mr-1" />
            )}
            Post tonight's room charges
          </Button>
        </div>
      </div>

      {audit && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          {[
            { label: "Occupied rooms", value: String(audit.occupiedRooms) },
            { label: "Arrivals", value: String(audit.arrivals) },
            { label: "Departures", value: String(audit.departures) },
            { label: "Open folios", value: String(audit.openFolios) },
            { label: "Revenue posted", value: money(audit.folioRevenuePosted) },
            { label: "Payments received", value: money(audit.paymentsReceived) },
            { label: "Leaving tomorrow", value: String(audit.expectedDepartures) },
          ].map((card) => (
            <div key={card.label} className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{card.label}</div>
              <div className="text-lg font-semibold">{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="grid md:grid-cols-3 gap-4 items-start">
          <section className="rounded-lg border">
            <header className="flex items-center gap-2 border-b p-3 font-medium">
              <LogIn className="h-4 w-4" /> Arrivals ({arrivals.length})
            </header>
            <div className="divide-y">
              {arrivals.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">No arrivals booked for today.</p>
              )}
              {arrivals.map((record) => (
                <div key={record.id} className="p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{record.guestName}</span>
                    <Badge variant="outline">Room {record.room?.number || "—"}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {record.room?.roomType?.name || "Room"} · out {dayLabel(record.checkOutDate)}
                    {record.guestPhone ? ` · ${record.guestPhone}` : ""}
                  </div>
                  <Button
                    size="sm"
                    className="mt-1"
                    disabled={busyId === record.id}
                    onClick={() => checkIn(record)}
                  >
                    <LogIn className="h-3 w-3 mr-1" /> Check in
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border">
            <header className="flex items-center gap-2 border-b p-3 font-medium">
              <BedDouble className="h-4 w-4" /> In-house ({inHouse.length})
            </header>
            <div className="divide-y">
              {inHouse.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">No guests in-house.</p>
              )}
              {inHouse.map((folio) => (
                <div key={folio.id} className="p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{folio.guestName}</span>
                    <Badge variant="outline">Room {folio.room?.number || "—"}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {folio.summary?.roomNightCount || 0} night(s) posted · balance{" "}
                    <span className={(folio.summary?.balance || 0) > 0 ? "text-red-600" : "text-green-600"}>
                      {money(folio.summary?.balance)}
                    </span>
                  </div>
                  <Button size="sm" variant="outline" className="mt-1" onClick={() => openFolio(folio.id)}>
                    Open folio
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border">
            <header className="flex items-center gap-2 border-b p-3 font-medium">
              <LogOut className="h-4 w-4" /> Departures ({departures.length})
            </header>
            <div className="divide-y">
              {departures.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">No departures due today.</p>
              )}
              {departures.map((record) => (
                <div key={record.id} className="p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{record.guestName}</span>
                    <Badge variant="outline">Room {record.room?.number || "—"}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    In {dayLabel(record.checkInDate)} · due out today
                  </div>
                  {record.folioId && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1"
                      onClick={() => openFolio(record.folioId!)}
                    >
                      <LogOut className="h-3 w-3 mr-1" /> Open folio & check out
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      <FolioDialog folioId={folioId} open={folioOpen} onOpenChange={setFolioOpen} onChanged={load} />
    </div>
  );
};

export default FrontDeskPage;
