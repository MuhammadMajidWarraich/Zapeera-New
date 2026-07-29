import { useState } from 'react';
import { HeadphonesIcon, Search, Filter, Clock, CheckCircle, AlertCircle, XCircle } from 'lucide-react';

const STATUS_COLORS = {
  OPEN: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  RESOLVED: 'bg-emerald-100 text-emerald-700',
  CLOSED: 'bg-gray-100 text-gray-500',
};
const PRIORITY_COLORS = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-blue-100 text-blue-600',
  HIGH: 'bg-amber-100 text-amber-600',
  URGENT: 'bg-red-100 text-red-600',
};

export function SupportTicketsPage() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-gray-900">Support Tickets</h1><p className="text-sm text-gray-500 mt-1">Manage customer support requests</p></div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
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

      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <HeadphonesIcon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-600 mb-1">No support tickets yet</h3>
        <p className="text-sm text-gray-400">Support ticket system will be available soon</p>
      </div>
    </div>
  );
}
