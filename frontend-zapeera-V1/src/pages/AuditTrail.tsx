import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { History, RefreshCw, Search } from "lucide-react";
import { apiService } from "@/services/api";
import { useAdmin } from "@/contexts/useAdmin";
import { toast } from "@/hooks/use-toast";

// Audit trail / activity log (v1.0.22): the append-only record of
// the key mutations — sales created/deleted, refunds, stock
// adjustments, write-offs, role changes, settings changes and
// quotation conversions. Entries are never edited or deleted.
// Filters: staff member, action, date range, branch (the global
// branch selector scopes the list; "All branches" shows everything).

interface AuditEntry {
  id: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  description?: string | null;
  userName?: string | null;
  createdAt: string;
  branch?: { id: string; name: string } | null;
  user?: { id: string; name: string } | null;
  metadata?: Record<string, unknown> | null;
}

const ACTIONS = [
  "SALE_CREATE",
  "SALE_DELETE",
  "SALE_UPDATE",
  "REFUND_CREATE",
  "STOCK_ADJUST",
  "WASTAGE_RECORD",
  "ROLE_CHANGE",
  "SETTINGS_CHANGE",
  "QUOTATION_CONVERT",
];

const ACTION_LABELS: Record<string, string> = {
  SALE_CREATE: "Sale created",
  SALE_DELETE: "Sale deleted",
  SALE_UPDATE: "Sale updated",
  REFUND_CREATE: "Refund created",
  STOCK_ADJUST: "Stock adjusted",
  WASTAGE_RECORD: "Write-off recorded",
  ROLE_CHANGE: "Role changed",
  SETTINGS_CHANGE: "Settings changed",
  QUOTATION_CONVERT: "Quotation converted",
};

const formatDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString() : "—");

const AuditTrail: React.FC = () => {
  const { selectedBranchId } = useAdmin();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [staffOptions, setStaffOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [userFilter, setUserFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await apiService.getAuditLogs({
        branchId: selectedBranchId || undefined,
        userId: userFilter || undefined,
        action: actionFilter || undefined,
        search: search.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        limit: 25,
      });
      if (response.success && response.data) {
        setEntries(response.data as AuditEntry[]);
        setTotalPages(response.pagination?.pages || 1);
      }
    } catch {
      toast({ title: "Error", description: "Failed to load the audit trail", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [selectedBranchId, userFilter, actionFilter, search, from, to, page]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  useEffect(() => {
    (async () => {
      try {
        const response = await apiService.getStaff({ limit: 100, isActive: true });
        if (response.success && response.data) {
          const list = ((response.data as any)?.staff || []) as any[];
          const seen = new Map<string, string>();
          for (const s of list) {
            const u = s?.membership?.user;
            if (u?.id && u?.name && !seen.has(u.id)) seen.set(u.id, u.name);
          }
          setStaffOptions([...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
        }
      } catch {
        // Staff filter stays empty; the search box still matches names.
      }
    })();
  }, []);

  const resetFilters = () => {
    setUserFilter("");
    setActionFilter("");
    setSearch("");
    setFrom("");
    setTo("");
    setPage(1);
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Audit Trail</h1>
            <p className="text-sm text-muted-foreground">Who did what, when. Entries are append-only and are never edited or deleted.</p>
          </div>
        </div>
        <Button variant="outline" size="icon" onClick={loadEntries} disabled={isLoading} title="Refresh">
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search description, name, id…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <Select value={userFilter || "all"} onValueChange={(v) => { setUserFilter(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger><SelectValue placeholder="All staff members" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All staff members</SelectItem>
                {staffOptions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={actionFilter || "all"} onValueChange={(v) => { setActionFilter(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger><SelectValue placeholder="All actions" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {ACTIONS.map((a) => (
                  <SelectItem key={a} value={a}>{ACTION_LABELS[a] || a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From date" />
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To date" />
            <Button variant="outline" onClick={resetFilters}>Clear filters</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Staff member</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>What happened</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No activity recorded yet for these filters.</TableCell></TableRow>
                )}
                {entries.map((e) => (
                  <React.Fragment key={e.id}>
                    <TableRow className="cursor-pointer" onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}>
                      <TableCell className="whitespace-nowrap">{formatDateTime(e.createdAt)}</TableCell>
                      <TableCell className="font-medium">{e.user?.name || e.userName || "—"}</TableCell>
                      <TableCell><Badge variant="outline">{ACTION_LABELS[e.action] || e.action}</Badge></TableCell>
                      <TableCell>{e.branch?.name || "—"}</TableCell>
                      <TableCell>{e.description || `${e.entityType || ""} ${e.entityId || ""}`.trim() || "—"}</TableCell>
                    </TableRow>
                    {expandedId === e.id && e.metadata && (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 text-xs">{JSON.stringify(e.metadata, null, 2)}</pre>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
              <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AuditTrail;
