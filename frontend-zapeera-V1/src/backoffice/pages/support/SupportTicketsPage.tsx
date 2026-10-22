import { useState, useEffect, useCallback } from 'react';
import { HeadphonesIcon, Search, Clock, Send, Loader2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { backofficeApi } from '../../services/api';
import type { SupportTicket } from '../../types';

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  RESOLVED: 'bg-emerald-100 text-emerald-700',
  CLOSED: 'bg-gray-100 text-gray-500',
};
const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-blue-100 text-blue-600',
  HIGH: 'bg-amber-100 text-amber-600',
  URGENT: 'bg-red-100 text-red-600',
};
const STATUSES: Array<SupportTicket['status']> = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const PRIORITIES: Array<SupportTicket['priority']> = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export function SupportTicketsPage() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const [updating, setUpdating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());
      const res = await backofficeApi.getTickets(params.toString());
      setTickets(res.data?.tickets || []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  const openTicket = async (ticket: SupportTicket) => {
    setReply('');
    setSelected(ticket);
    try {
      const res = await backofficeApi.getTicket(ticket.id);
      setSelected(res.data);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load ticket');
    }
  };

  const handleReply = async () => {
    if (!selected || !reply.trim()) return;
    setReplying(true);
    try {
      const res = await backofficeApi.replyToTicket(selected.id, reply.trim());
      setSelected(prev => prev ? {
        ...prev,
        status: prev.status === 'OPEN' ? 'IN_PROGRESS' : prev.status,
        messages: [...(prev.messages || []), res.data],
      } : prev);
      setReply('');
      toast.success('Reply sent');
      load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to send reply');
    } finally {
      setReplying(false);
    }
  };

  const handleUpdate = async (patch: Partial<{ status: SupportTicket['status']; priority: SupportTicket['priority'] }>) => {
    if (!selected) return;
    setUpdating(true);
    try {
      const res = await backofficeApi.updateTicket(selected.id, patch);
      setSelected(prev => prev ? { ...prev, ...res.data, messages: prev.messages } : prev);
      setTickets(prev => prev.map(t => t.id === selected.id ? { ...t, ...res.data } : t));
      toast.success('Ticket updated');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update ticket');
    } finally {
      setUpdating(false);
    }
  };

  if (selected) {
    return (
      <div className="space-y-6">
        <button onClick={() => { setSelected(null); load(); }} className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-800">
          <ArrowLeft className="w-4 h-4" /> Back to tickets
        </button>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-gray-900">{selected.subject}</h1>
              <p className="text-sm text-gray-500 mt-1">
                {selected.user ? `${selected.user.name} (${selected.user.email})` : 'Unknown user'}
                {selected.businessName ? ` · ${selected.businessName}` : ' · Account-level ticket'}
                {` · Opened ${new Date(selected.createdAt).toLocaleString()}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={selected.priority}
                disabled={updating}
                onChange={e => handleUpdate({ priority: e.target.value as SupportTicket['priority'] })}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
              >
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <select
                value={selected.status}
                disabled={updating}
                onChange={e => handleUpdate({ status: e.target.value as SupportTicket['status'] })}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
              >
                {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {(selected.messages || []).map(message => (
              <div
                key={message.id}
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  message.authorType === 'ADMIN' ? 'ml-auto bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'
                }`}
              >
                <p className={`mb-1 text-[11px] font-semibold ${message.authorType === 'ADMIN' ? 'text-white/70' : 'text-gray-500'}`}>
                  {message.authorType === 'ADMIN' ? 'Support team' : (selected.user?.name || 'Customer')} · {new Date(message.createdAt).toLocaleString()}
                </p>
                <p className="whitespace-pre-wrap">{message.body}</p>
              </div>
            ))}
            {(selected.messages || []).length === 0 && (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{selected.description}</p>
            )}
          </div>

          <div className="mt-6 flex items-end gap-2">
            <textarea
              value={reply}
              onChange={e => setReply(e.target.value)}
              placeholder="Write a reply to the customer…"
              rows={3}
              className="flex-1 px-3.5 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/50"
            />
            <button
              onClick={handleReply}
              disabled={replying || !reply.trim()}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
            >
              {replying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Reply
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-gray-900">Support Tickets</h1><p className="text-sm text-gray-500 mt-1">Manage customer support requests</p></div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-none sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tickets..." className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-full outline-none focus:ring-2 focus:ring-blue-500/50" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
          <option value="all">All Status</option>
          <option value="OPEN">Open</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="RESOLVED">Resolved</option>
          <option value="CLOSED">Closed</option>
        </select>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-sm text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-gray-300" /> Loading tickets…
        </div>
      ) : tickets.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <HeadphonesIcon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-1">No support tickets</h3>
          <p className="text-sm text-gray-400">Tickets created by customers will appear here</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {tickets.map(ticket => (
            <button key={ticket.id} onClick={() => openTicket(ticket)} className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 transition-colors">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">{ticket.subject}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-400">
                  <Clock className="w-3.5 h-3.5" />
                  {new Date(ticket.updatedAt).toLocaleString()}
                  {ticket.user ? ` · ${ticket.user.name}` : ''}
                  {ticket.businessName ? ` · ${ticket.businessName}` : ''}
                  {ticket._count ? ` · ${ticket._count.messages} message${ticket._count.messages === 1 ? '' : 's'}` : ''}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${PRIORITY_COLORS[ticket.priority]}`}>{ticket.priority}</span>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_COLORS[ticket.status]}`}>{ticket.status.replace('_', ' ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
