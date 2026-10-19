import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Phone,
  MessageCircle,
  Mail,
  BookOpen,
  HelpCircle,
  ShieldCheck,
  FileText,
  ChevronRight,
  Sparkles,
  Plus,
  Send,
  Loader2,
  Ticket,
} from "lucide-react";
import { config } from "@/lib/config";
import { whatsappUrl, callUrl, emailUrl, SUPPORT_PHONE_DISPLAY } from "@/lib/support-links";
import { cn } from "@/lib/utils";
import { apiService, type SupportTicketItem } from "@/services/api";
import { useToast } from "@/hooks/use-toast";

const TICKET_STATUS_STYLES: Record<SupportTicketItem["status"], string> = {
  OPEN: "bg-blue-100 text-blue-700",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  RESOLVED: "bg-emerald-100 text-emerald-700",
  CLOSED: "bg-gray-100 text-gray-500",
};

const TICKET_PRIORITY_STYLES: Record<SupportTicketItem["priority"], string> = {
  LOW: "bg-gray-100 text-gray-600",
  MEDIUM: "bg-blue-100 text-blue-600",
  HIGH: "bg-amber-100 text-amber-600",
  URGENT: "bg-red-100 text-red-600",
};

const FAQS = [
  { q: "How do I create a new business?", a: "From your dashboard, click \"Create New Business\" and fill in the business details. You'll be able to open its workspace right away." },
  { q: "How do I join a business I was invited to?", a: "Open the Invitations page from the sidebar and click Accept on the invitation. The business will appear under My Businesses." },
  { q: "How does the desktop app sync my data?", a: "The desktop app works offline and syncs automatically whenever you're online. Check Desktop Status on the Profile & Security page to see the last sync time." },
  { q: "What payment methods are accepted for plans?", a: "Contact our billing team on WhatsApp or email and they'll walk you through available payment methods." },
  { q: "How do I reset my password?", a: "Use the \"Forgot Password\" option on the login screen — we'll send a reset link to your email." },
];

const SupportPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [open, setOpen] = useState<string | null>(FAQS[0].q);

  // ─── Support tickets (real API — /api/support/tickets) ───────────────────
  const [tickets, setTickets] = useState<SupportTicketItem[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ subject: "", description: "", priority: "MEDIUM" });
  const [selected, setSelected] = useState<SupportTicketItem | null>(null);
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);

  const loadTickets = useCallback(async () => {
    setTicketsLoading(true);
    try {
      const res = await apiService.getSupportTickets({ limit: 50 });
      setTickets(res.data?.tickets || []);
    } catch (error: any) {
      toast({ title: "Failed to load your tickets", description: error?.message, variant: "destructive" });
    } finally {
      setTicketsLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  const handleCreate = async () => {
    if (!form.subject.trim() || !form.description.trim()) {
      toast({ title: "Subject and description are required" });
      return;
    }
    setCreating(true);
    try {
      const res = await apiService.createSupportTicket({
        subject: form.subject.trim(),
        description: form.description.trim(),
        priority: form.priority,
      });
      if (res.data) setTickets((prev) => [res.data!, ...prev]);
      setForm({ subject: "", description: "", priority: "MEDIUM" });
      setShowCreate(false);
      toast({ title: "Ticket created", description: "Our support team will reply here." });
    } catch (error: any) {
      toast({ title: "Failed to create ticket", description: error?.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const openTicket = async (ticket: SupportTicketItem) => {
    setSelected(ticket);
    setReply("");
    try {
      const res = await apiService.getSupportTicket(ticket.id);
      if (res.data) setSelected(res.data);
    } catch (error: any) {
      toast({ title: "Failed to load ticket", description: error?.message, variant: "destructive" });
    }
  };

  const handleReply = async () => {
    if (!selected || !reply.trim()) return;
    setReplying(true);
    try {
      const res = await apiService.replyToSupportTicket(selected.id, reply.trim());
      if (res.data) {
        setSelected((prev) => prev ? {
          ...prev,
          status: prev.status === "RESOLVED" ? "OPEN" : prev.status,
          messages: [...(prev.messages || []), res.data!],
        } : prev);
      }
      setReply("");
      loadTickets();
    } catch (error: any) {
      toast({ title: "Failed to send reply", description: error?.message, variant: "destructive" });
    } finally {
      setReplying(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-7 sm:px-8 lg:px-11 lg:py-9">
      <div className="mb-7">
        <div className="mb-1.5 inline-flex items-center gap-2 rounded-full border border-[#1a52c5]/10 bg-gradient-to-br from-[#1a52c5]/[0.06] to-[#28c2ce]/[0.06] px-3 py-1 text-xs font-semibold text-[#1a52c5]">
          <HelpCircle className="h-3.5 w-3.5" />
          Support
        </div>
        <h1 className="text-[28px] font-extrabold tracking-[-0.7px] text-[#0a1128]">Support Center</h1>
        <p className="mt-1 text-sm text-[#8c95b0]">Get help with your account, businesses and the Zapeera apps.</p>
      </div>

      {/* Contact cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <a
          href={callUrl()}
          className="group rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)]"
        >
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white">
            <Phone className="h-5 w-5" />
          </div>
          <h3 className="mt-3 text-[15px] font-bold text-[#0a1128]">Call Us</h3>
          <p className="mt-0.5 text-[13px] text-[#8c95b0]">{SUPPORT_PHONE_DISPLAY}</p>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#1a52c5] group-hover:underline">
            Start a call <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </a>
        <a
          href={whatsappUrl("Hello! I need support with Zapeera.")}
          target="_blank"
          rel="noopener noreferrer"
          className="group rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)]"
        >
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-green-500 text-white">
            <MessageCircle className="h-5 w-5" />
          </div>
          <h3 className="mt-3 text-[15px] font-bold text-[#0a1128]">WhatsApp</h3>
          <p className="mt-0.5 text-[13px] text-[#8c95b0]">Chat with our support team</p>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-green-600 group-hover:underline">
            Open chat <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </a>
        <a
          href={emailUrl("Zapeera Support", "Hello, I need help with Zapeera.")}
          className="group rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)]"
        >
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#1a52c5]/10 text-[#1a52c5]">
            <Mail className="h-5 w-5" />
          </div>
          <h3 className="mt-3 text-[15px] font-bold text-[#0a1128]">Email</h3>
          <p className="mt-0.5 truncate text-[13px] text-[#8c95b0]">{config.support.email}</p>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#1a52c5] group-hover:underline">
            Send email <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </a>
        <div className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-gradient-to-br from-[#1a52c5]/[0.06] to-[#28c2ce]/[0.06] p-5">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white">
            <Sparkles className="h-5 w-5" />
          </div>
          <h3 className="mt-3 text-[15px] font-bold text-[#0a1128]">Business Help</h3>
          <p className="mt-0.5 text-[13px] text-[#8c95b0]">Feature guides inside your workspace</p>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#1a52c5]">
            <BookOpen className="h-3.5 w-3.5" /> In-app docs
          </span>
        </div>
      </div>

      {/* Support tickets */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[18px] font-extrabold tracking-tight text-[#0a1128]">My Support Tickets</h2>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#1a52c5] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-95"
          >
            <Plus className="h-4 w-4" /> New Ticket
          </button>
        </div>

        {showCreate && (
          <div className="mb-4 rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_180px]">
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-[#0a1128]">Subject</label>
                <input
                  type="text"
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder="Brief summary of your issue"
                  className="w-full rounded-[10px] border border-[rgba(15,23,60,0.1)] px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#1a52c5]/40"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-[#0a1128]">Priority</label>
                <select
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  className="w-full rounded-[10px] border border-[rgba(15,23,60,0.1)] bg-white px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#1a52c5]/40"
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </div>
            </div>
            <div className="mt-4">
              <label className="mb-1.5 block text-[13px] font-semibold text-[#0a1128]">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Describe the issue in detail — what happened, and what you expected instead."
                rows={4}
                className="w-full rounded-[10px] border border-[rgba(15,23,60,0.1)] px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#1a52c5]/40"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-[10px] border border-[rgba(15,23,60,0.1)] bg-white px-4 py-2.5 text-sm font-semibold text-[#0a1128] hover:bg-[#f0f2f7]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="inline-flex items-center gap-2 rounded-[10px] bg-[#1a52c5] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
              >
                {creating && <Loader2 className="h-4 w-4 animate-spin" />} Create Ticket
              </button>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]">
          {ticketsLoading ? (
            <div className="flex items-center justify-center gap-2 px-6 py-10 text-sm text-[#8c95b0]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading tickets…
            </div>
          ) : tickets.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <Ticket className="mx-auto mb-3 h-10 w-10 text-[#c3c9dc]" />
              <p className="text-sm font-semibold text-[#0a1128]">No tickets yet</p>
              <p className="mt-1 text-[13px] text-[#8c95b0]">Create a ticket and our team will get back to you here.</p>
            </div>
          ) : (
            tickets.map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                onClick={() => openTicket(ticket)}
                className="flex w-full items-center gap-3 border-b border-[rgba(15,23,60,0.06)] px-6 py-4 text-left transition-colors last:border-0 hover:bg-[#f7f9fd]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-[#0a1128]">{ticket.subject}</p>
                  <p className="mt-0.5 text-[12px] text-[#8c95b0]">
                    {ticket.businessName ? `${ticket.businessName} · ` : ""}Updated {new Date(ticket.updatedAt).toLocaleString()}
                    {ticket._count ? ` · ${ticket._count.messages} message${ticket._count.messages === 1 ? "" : "s"}` : ""}
                  </p>
                </div>
                <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", TICKET_PRIORITY_STYLES[ticket.priority])}>{ticket.priority}</span>
                <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", TICKET_STATUS_STYLES[ticket.status])}>{ticket.status.replace("_", " ")}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[#8c95b0]" />
              </button>
            ))
          )}
        </div>

        {selected && (
          <div className="mt-4 rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[16px] font-bold text-[#0a1128]">{selected.subject}</h3>
                <p className="mt-0.5 text-[12px] text-[#8c95b0]">
                  {selected.businessName ? `${selected.businessName} · ` : ""}Opened {new Date(selected.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", TICKET_STATUS_STYLES[selected.status])}>{selected.status.replace("_", " ")}</span>
                <button type="button" onClick={() => setSelected(null)} className="text-[13px] font-semibold text-[#1a52c5] hover:underline">Close</button>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {(selected.messages || []).map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                    message.authorType === "ADMIN"
                      ? "bg-[#f0f4ff] text-[#26355e]"
                      : "ml-auto bg-[#1a52c5] text-white"
                  )}
                >
                  <p className={cn("mb-1 text-[11px] font-semibold", message.authorType === "ADMIN" ? "text-[#1a52c5]" : "text-white/70")}>
                    {message.authorType === "ADMIN" ? "Zapeera Support" : "You"} · {new Date(message.createdAt).toLocaleString()}
                  </p>
                  <p className="whitespace-pre-wrap">{message.body}</p>
                </div>
              ))}
              {(selected.messages || []).length === 0 && (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#4a5578]">{selected.description}</p>
              )}
            </div>

            {selected.status === "CLOSED" ? (
              <p className="mt-4 rounded-[10px] bg-[#f0f2f7] px-4 py-3 text-[13px] text-[#4a5578]">
                This ticket is closed. If you still need help, please create a new ticket.
              </p>
            ) : (
              <div className="mt-4 flex items-end gap-2">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={selected.status === "RESOLVED" ? "Replying will reopen this ticket…" : "Write a reply…"}
                  rows={2}
                  className="flex-1 rounded-[10px] border border-[rgba(15,23,60,0.1)] px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#1a52c5]/40"
                />
                <button
                  type="button"
                  onClick={handleReply}
                  disabled={replying || !reply.trim()}
                  className="inline-flex items-center gap-2 rounded-[10px] bg-[#1a52c5] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
                >
                  {replying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Reply
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* FAQ */}
        <section className="lg:col-span-2">
          <h2 className="mb-3 text-[18px] font-extrabold tracking-tight text-[#0a1128]">Frequently Asked Questions</h2>
          <div className="overflow-hidden rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]">
            {FAQS.map((faq) => {
              const isOpen = open === faq.q;
              return (
                <div key={faq.q} className="border-b border-[rgba(15,23,60,0.06)] last:border-0">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : faq.q)}
                    className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
                  >
                    <span className="text-[15px] font-semibold text-[#0a1128]">{faq.q}</span>
                    <ChevronRight className={cn("h-4 w-4 shrink-0 text-[#8c95b0] transition-transform", isOpen && "rotate-90")} />
                  </button>
                  {isOpen && <p className="px-6 pb-4 text-[13px] leading-relaxed text-[#4a5578]">{faq.a}</p>}
                </div>
              );
            })}
          </div>
        </section>

        {/* Resources */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)]">
            <div className="flex items-center gap-2.5 text-[16px] font-bold text-[#0a1128]">
              <ShieldCheck className="h-5 w-5 text-[#1a52c5]" />
              Account & Security
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-[#8c95b0]">
              Manage your password, profile and security settings from the Profile & Security page.
            </p>
            <a
              href="#/settings"
              onClick={(e) => {
                e.preventDefault();
                navigate("/settings");
              }}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-[rgba(15,23,60,0.1)] bg-white px-4 py-2.5 text-sm font-semibold text-[#0a1128] transition-colors hover:bg-[#f0f2f7]"
            >
              <FileText className="h-4 w-4 text-[#1a52c5]" />
              Open Profile & Security
            </a>
          </section>

          <section className="rounded-2xl border border-[rgba(15,23,60,0.06)] bg-gradient-to-br from-[#1a52c5]/[0.04] to-[#28c2ce]/[0.04] p-6">
            <h3 className="text-[15px] font-bold text-[#0a1128]">Still stuck?</h3>
            <p className="mt-1 text-[13px] text-[#8c95b0]">
              Reach out on WhatsApp — our support team typically responds within a few hours.
            </p>
            <a
              href={whatsappUrl("Hello! I need help with Zapeera.")}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[10px] bg-green-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(34,197,94,0.3)] hover:opacity-95"
            >
              <MessageCircle className="h-4 w-4" />
              Chat on WhatsApp
            </a>
          </section>
        </div>
      </div>
    </main>
  );
};

export default SupportPage;
