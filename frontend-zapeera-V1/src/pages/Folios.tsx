import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, BookOpen, Search } from "lucide-react";
import { apiService, type FolioRecord } from "@/services/api";
import { toast } from "@/hooks/use-toast";
import FolioDialog from "@/components/hotel/FolioDialog";

// Folios (Wave C5 — Hotel pack): the register of stay bills. A
// folio opens at check-in and closes at check-out; its balance is
// the server's Σ charges − Σ payments over its rows. The detail
// (charges, payments, night posting, check-out) lives in the shared
// FolioDialog — this page is the find-and-open register.

const money = (n: number | null | undefined) =>
  `Rs ${Number(n || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

const dayLabel = (iso?: string | null) => (iso ? String(iso).slice(0, 10) : "—");

const FoliosPage: React.FC = () => {
  const [records, setRecords] = useState<FolioRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("OPEN");
  const [search, setSearch] = useState("");

  const [folioId, setFolioId] = useState<string | null>(null);
  const [folioOpen, setFolioOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiService.getFolios({
        limit: 200,
        status: statusFilter === "all" ? undefined : statusFilter,
        search: search || undefined,
      });
      if (response.success && response.data) setRecords(response.data);
    } catch {
      toast({ title: "Could not load folios", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-6 w-6" /> Folios
          </h1>
          <p className="text-sm text-muted-foreground">
            Every stay's bill — charges, advances and the checkout invoice.
          </p>
        </div>
        <Button variant="outline" onClick={load}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All folios</SelectItem>
            <SelectItem value="OPEN">Open</SelectItem>
            <SelectItem value="CLOSED">Closed</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
          <Input
            className="pl-8 w-56"
            placeholder="Guest name"
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
          No folios match. Folios open when a reservation is checked in.
        </div>
      ) : (
        <div className="rounded-lg border divide-y">
          {records.map((folio) => (
            <button
              key={folio.id}
              type="button"
              className="w-full text-left flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-muted/50"
              onClick={() => {
                setFolioId(folio.id);
                setFolioOpen(true);
              }}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{folio.guestName}</span>
                  <Badge
                    className={
                      folio.status === "OPEN"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-green-100 text-green-800"
                    }
                  >
                    {folio.status}
                  </Badge>
                  {folio.writeOffAmount ? (
                    <Badge variant="outline">write-off {money(folio.writeOffAmount)}</Badge>
                  ) : null}
                </div>
                <div className="text-sm text-muted-foreground">
                  Room {folio.room?.number || "—"} ({folio.room?.roomType?.name || "Room"}) · opened{" "}
                  {dayLabel(folio.openedAt)}
                  {folio.closedAt ? ` · closed ${dayLabel(folio.closedAt)}` : ""} ·{" "}
                  {folio.summary?.roomNightCount || 0} night(s)
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm text-muted-foreground">Balance</div>
                <div
                  className={`font-semibold ${
                    (folio.summary?.balance || 0) > 0 ? "text-red-600" : "text-green-600"
                  }`}
                >
                  {money(folio.summary?.balance)}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <FolioDialog folioId={folioId} open={folioOpen} onOpenChange={setFolioOpen} onChanged={load} />
    </div>
  );
};

export default FoliosPage;
