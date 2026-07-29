import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Mail, Phone, MapPin, Calendar, Users, CreditCard, Activity, Shield, ExternalLink, Eye } from 'lucide-react';
import { backofficeApi } from '../../../services/api';
import { BusinessDetails } from '../../../types';
import { useBackofficeAuth } from '../../../auth/BackofficeAuthContext';

export function BusinessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useBackofficeAuth();
  const [business, setBusiness] = useState<BusinessDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    backofficeApi.getBusiness(id).then(res => setBusiness(res.data)).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  const handleImpersonate = async () => {
    if (!business) return;
    try {
      const res = await backofficeApi.startImpersonation(business.id);
      const { token, session } = res.data;
      sessionStorage.setItem('impersonationSession', JSON.stringify({
        businessId: business.id,
        businessName: business.name,
        startedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        token,
      }));
      window.open(`/business/${business.slug || business.id}/dashboard?impersonation=${token}`, '_blank');
    } catch { /* ignore */ }
  };

  if (loading) return <div className="space-y-4"><div className="h-8 w-64 bg-gray-200 rounded-lg animate-pulse" /><div className="h-96 bg-gray-100 rounded-xl animate-pulse" /></div>;
  if (!business) return <div className="text-center py-20 text-gray-500">Business not found</div>;

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Building2 },
    { id: 'members', label: 'Members', icon: Users },
    { id: 'subscription', label: 'Subscription', icon: CreditCard },
    { id: 'activity', label: 'Activity', icon: Activity },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/backoffice/businesses')} className="p-2 hover:bg-gray-100 rounded-lg transition"><ArrowLeft className="w-5 h-5 text-gray-500" /></button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{business.name}</h1>
          <p className="text-sm text-gray-500">{business.businessType || 'No type'} &middot; {business.isActive ? 'Active' : 'Inactive'}</p>
        </div>
        {hasPermission('impersonation.start') && (
          <button onClick={handleImpersonate} className="ml-auto inline-flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl hover:bg-amber-100 transition text-sm font-medium">
            <Eye className="w-4 h-4" /> Open Workspace as Support
          </button>
        )}
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab.id ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-900">Business Information</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm"><Mail className="w-4 h-4 text-gray-400" /><span>{business.email || 'N/A'}</span></div>
                <div className="flex items-center gap-3 text-sm"><Phone className="w-4 h-4 text-gray-400" /><span>{business.phone || 'N/A'}</span></div>
                <div className="flex items-center gap-3 text-sm"><MapPin className="w-4 h-4 text-gray-400" /><span>{business.address || 'N/A'}</span></div>
                <div className="flex items-center gap-3 text-sm"><Building2 className="w-4 h-4 text-gray-400" /><span>{business.businessType || 'N/A'}</span></div>
                <div className="flex items-center gap-3 text-sm"><Calendar className="w-4 h-4 text-gray-400" /><span>Created {new Date(business.createdAt).toLocaleDateString()}</span></div>
              </div>
            </div>
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-900">Subscription</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm"><CreditCard className="w-4 h-4 text-gray-400" /><span>{business.subscription?.planName || 'No active plan'}</span></div>
                <div className="flex items-center gap-3 text-sm"><Shield className="w-4 h-4 text-gray-400" /><span>Status: {business.subscription?.status || 'N/A'}</span></div>
                {business.subscription?.amount && <div className="flex items-center gap-3 text-sm font-semibold text-emerald-600">PKR {business.subscription.amount.toLocaleString()}</div>}
              </div>
            </div>
          </div>
        )}
        {activeTab === 'members' && (
          <div>
            <p className="text-sm text-gray-400 text-center py-8">Members list will load from API</p>
          </div>
        )}
        {activeTab === 'subscription' && (
          <div>
            <p className="text-sm text-gray-400 text-center py-8">Subscription details will load from API</p>
          </div>
        )}
        {activeTab === 'activity' && (
          <div>
            <p className="text-sm text-gray-400 text-center py-8">Activity log will load from API</p>
          </div>
        )}
      </div>
    </div>
  );
}
