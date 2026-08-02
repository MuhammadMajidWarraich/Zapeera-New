import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  UserPlus,
  Check,
  X,
  Building2,
  Clock,
  ShieldCheck,
  Mail,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Invitation = {
  invitationId: string;
  token: string;
  businessName: string;
  roleName: string | null;
  status: string;
  expiresAt: string;
};

function formatExpiry(iso?: string): string {
  if (!iso) return "Soon";
  try {
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return "Expired";
    const days = Math.ceil(diff / 86400000);
    return days <= 1 ? "Today" : `${days} days`;
  } catch {
    return "Soon";
  }
}

const InvitationsPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingToken, setActingToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiService.getMyInvitations();
      if (res.success && res.data) {
        setInvitations(Array.isArray(res.data.invitations) ? res.data.invitations : []);
      } else {
        setInvitations([]);
      }
    } catch (error) {
      console.error("Failed to load invitations:", error);
      setInvitations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAccept = async (inv: Invitation) => {
    setActingToken(inv.token);
    try {
      const res = await apiService.acceptInvitation(inv.token);
      if (res.success) {
        toast({ title: "Invitation accepted", description: `You've joined ${inv.businessName}.` });
        setInvitations((prev) => prev.filter((i) => i.token !== inv.token));
      } else {
        toast({ title: "Could not accept", description: res.message || "Failed to accept invitation.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Could not accept", description: e.message || "Failed to accept invitation.", variant: "destructive" });
    } finally {
      setActingToken(null);
    }
  };

  const handleDecline = async (inv: Invitation) => {
    setActingToken(inv.token);
    try {
      const res = await apiService.rejectInvitation(inv.token);
      if (res.success) {
        toast({ title: "Invitation declined", description: `You declined ${inv.businessName}.` });
        setInvitations((prev) => prev.filter((i) => i.token !== inv.token));
      } else {
        toast({ title: "Could not decline", description: res.message || "Failed to decline invitation.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Could not decline", description: e.message || "Failed to decline invitation.", variant: "destructive" });
    } finally {
      setActingToken(null);
    }
  };

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-7 sm:px-8 lg:px-11 lg:py-9">
      <div className="mb-7">
        <div className="mb-1.5 inline-flex items-center gap-2 rounded-full border border-[#1a52c5]/10 bg-gradient-to-br from-[#1a52c5]/[0.06] to-[#28c2ce]/[0.06] px-3 py-1 text-xs font-semibold text-[#1a52c5]">
          <UserPlus className="h-3.5 w-3.5" />
          Invitations
        </div>
        <h1 className="text-[28px] font-extrabold tracking-[-0.7px] text-[#0a1128]">Pending Invitations</h1>
        <p className="mt-1 text-sm text-[#8c95b0]">Businesses that invited you to join. Accept to start working with them.</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[110px] animate-pulse rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white" />
          ))}
        </div>
      ) : invitations.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[rgba(15,23,60,0.12)] bg-white/60 p-12 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#1a52c5]/10 to-[#28c2ce]/10 text-[#1a52c5]">
            <Mail className="h-7 w-7" />
          </div>
          <h3 className="text-lg font-bold text-[#0a1128]">No pending invitations</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-[#8c95b0]">
            When a business invites you to join, it will appear here. You can also browse your businesses below.
          </p>
          <Button
            onClick={() => navigate("/zapeera/my-businesses")}
            className="mt-5 h-11 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-6 font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)]"
          >
            My Businesses
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {invitations.map((inv) => {
            const busy = actingToken === inv.token;
            return (
              <div
                key={inv.invitationId}
                className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white">
                    <Building2 className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[16px] font-bold tracking-tight text-[#0a1128]">{inv.businessName || "Business"}</h3>
                      {inv.roleName && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#1a52c5]/10 bg-[#1a52c5]/[0.06] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#1a52c5]">
                          <ShieldCheck className="h-3 w-3" />
                          {inv.roleName}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#8c95b0]">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        Expires {formatExpiry(inv.expiresAt)}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => handleDecline(inv)}
                      className="h-10 rounded-[10px] border-[rgba(15,23,60,0.1)] font-semibold text-[#4a5578] hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                    >
                      <X className="mr-1.5 h-4 w-4" />
                      Decline
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => handleAccept(inv)}
                      className="h-10 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-5 font-semibold text-white shadow-[0_4px_16px_rgba(26,82,197,0.25)] hover:opacity-95"
                    >
                      <Check className="mr-1.5 h-4 w-4" strokeWidth={2.5} />
                      {busy ? "Working…" : "Accept"}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => navigate("/zapeera/my-businesses")}
        className="mt-6 inline-flex items-center gap-1 text-sm font-semibold text-[#1a52c5] transition-colors hover:text-[#28c2ce]"
      >
        View My Businesses <ChevronRight className="h-4 w-4" />
      </button>
    </main>
  );
};

export default InvitationsPage;
