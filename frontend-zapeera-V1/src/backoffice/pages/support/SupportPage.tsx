import { useState, useEffect } from 'react';
import { HeadphonesIcon, Clock, CheckCircle, AlertTriangle, MessageSquare, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function SupportPage() {
  const navigate = useNavigate();
  const [loading] = useState(false);

  const stats = [
    { label: 'Open Tickets', value: 0, icon: HeadphonesIcon, color: 'bg-blue-50 text-blue-600' },
    { label: 'In Progress', value: 0, icon: Clock, color: 'bg-amber-50 text-amber-600' },
    { label: 'Resolved Today', value: 0, icon: CheckCircle, color: 'bg-emerald-50 text-emerald-600' },
    { label: 'Urgent', value: 0, icon: AlertTriangle, color: 'bg-red-50 text-red-600' },
  ];

  const quickActions = [
    { label: 'View Support Tickets', path: '/backoffice/support/tickets', icon: HeadphonesIcon, description: 'Manage customer support requests' },
    { label: 'Announcements', path: '/backoffice/announcements', icon: MessageSquare, description: 'Create and manage platform announcements' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Support Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Manage customer support and communications</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-3"><div className={`p-2 rounded-lg ${k.color}`}><k.icon className="w-4 h-4" /></div><div><p className="text-2xl font-bold text-gray-900">{k.value}</p><p className="text-xs text-gray-500">{k.label}</p></div></div>
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

      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <HeadphonesIcon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-600 mb-1">Support ticket system coming soon</h3>
        <p className="text-sm text-gray-400">Integration with customer support channels is under development</p>
      </div>
    </div>
  );
}
