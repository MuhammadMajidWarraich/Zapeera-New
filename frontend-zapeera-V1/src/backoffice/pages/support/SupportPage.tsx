import { useState, useEffect } from 'react';
import { HeadphonesIcon, Clock, CheckCircle, AlertTriangle, MessageSquare, ArrowRight, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { backofficeApi } from '../../services/api';
import type { SupportTicket } from '../../types';

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  RESOLVED: 'bg-emerald-100 text-emerald-700',
  CLOSED: 'bg-gray-100 text-gray-500',
};

export function SupportPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await backofficeApi.getTickets('limit=100');
        setTickets(res.data?.tickets || []);
      } catch (e: any) {
        toast.error(e?.message || 'Failed to load support overview');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const today = new Date().toDateString();
  const stats = [
    { label: 'Open Tickets', value: tickets.filter(t => t.status === 'OPEN').length, icon: HeadphonesIcon, color: 'bg-blue-50 text-blue-600' },
    { label: 'In Progress', value: tickets.filter(t => t.status === 'IN_PROGRESS').length, icon: Clock, color: 'bg-amber-50 text-amber-600' },
    { label: 'Resolved Today', value: tickets.filter(t => t.status === 'RESOLVED' && new Date(t.updatedAt).toDateString() === today).length, icon: CheckCircle, color: 'bg-emerald-50 text-emerald-600' },
    { label: 'Urgent', value: tickets.filter(t => t.priority === 'URGENT' && t.status !== 'RESOLVED' && t.status !== 'CLOSED').length, icon: AlertTriangle, color: 'bg-red-50 text-red-600' },
  ];

  const quickActions = [
    { label: 'View Support Tickets', path: '/backoffice/support/tickets', icon: HeadphonesIcon, description: 'Manage customer support requests' },
    { label: 'Announcements', path: '/backoffice/announcements', icon: MessageSquare, description: 'Create and manage platform announcements' },
  ];

  const recent = tickets.slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Support Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Manage customer support and communications</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-3"><div className={`p-2 rounded-lg ${k.color}`}><k.icon className="w-4 h-4" /></div><div><p className="text-2xl font-bold text-gray-900">{loading ? '–' : k.value}</p><p className="text-xs text-gray-500">{k.label}</p></div></div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {quickActions.map(action => (
          <button key={action.path} onClick={() => navigate(action.path)} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow text-left">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-50 rounded-xl"><action.icon className="w-6 h-6 text-blue-600" /></div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">{action.label}</h3>
                <p className="text-sm text-gray-500">{action.description}</p>
              </div>
              <ArrowRight className="w-5 h-5 text-gray-300" />
            </div>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Recent Tickets</h3>
          <button onClick={() => navigate('/backoffice/support/tickets')} className="text-sm font-medium text-blue-600 hover:underline">View all</button>
        </div>
        {loading ? (
          <div className="p-10 text-center text-sm text-gray-400"><Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-gray-300" /> Loading…</div>
        ) : recent.length === 0 ? (
          <div className="p-10 text-center">
            <HeadphonesIcon className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No support tickets yet — tickets created by customers will appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {recent.map(ticket => (
              <button key={ticket.id} onClick={() => navigate('/backoffice/support/tickets')} className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-gray-50 transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">{ticket.subject}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {ticket.user ? `${ticket.user.name} · ` : ''}{new Date(ticket.updatedAt).toLocaleString()}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_COLORS[ticket.status]}`}>{ticket.status.replace('_', ' ')}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
