import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Command, Building2, Users, CreditCard, FileText, ScrollText, HeadphonesIcon, DollarSign } from 'lucide-react';

interface SearchResult {
  label: string;
  description?: string;
  path: string;
  icon?: React.ReactNode;
  type: 'business' | 'user' | 'subscription' | 'plan' | 'module' | 'ticket' | 'payment' | 'audit';
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([
        { label: 'Dashboard', path: '/backoffice/dashboard', type: 'business' },
        { label: 'Businesses', path: '/backoffice/businesses', type: 'business' },
        { label: 'Users', path: '/backoffice/users', type: 'user' },
        { label: 'Plans', path: '/backoffice/plans', type: 'plan' },
        { label: 'Modules', path: '/backoffice/modules', type: 'module' },
        { label: 'Payment Proofs', path: '/backoffice/payment-proofs', type: 'payment' },
        { label: 'Audit Logs', path: '/backoffice/audit', type: 'audit' },
        { label: 'Support Tickets', path: '/backoffice/support/tickets', type: 'ticket' },
      ]);
      return;
    }

    const q = query.toLowerCase();
    const all: SearchResult[] = [
      { label: 'Dashboard', path: '/backoffice/dashboard', type: 'business', description: 'Platform overview and KPIs' },
      { label: 'Businesses', path: '/backoffice/businesses', type: 'business', description: 'Manage all businesses' },
      { label: 'Users', path: '/backoffice/users', type: 'user', description: 'Manage all users' },
      { label: 'Plans', path: '/backoffice/plans', type: 'plan', description: 'Subscription plans' },
      { label: 'Modules', path: '/backoffice/modules', type: 'module', description: 'Platform modules' },
      { label: 'Business Types', path: '/backoffice/business-types', type: 'business', description: 'Business type configurations' },
      { label: 'Payment Proofs', path: '/backoffice/payment-proofs', type: 'payment', description: 'Pending payment approvals' },
      { label: 'Audit Logs', path: '/backoffice/audit', type: 'audit', description: 'System audit trail' },
      { label: 'Finance Dashboard', path: '/backoffice/finance', type: 'subscription', description: 'Revenue and billing' },
      { label: 'Support Tickets', path: '/backoffice/support/tickets', type: 'ticket', description: 'Customer support' },
      { label: 'Announcements', path: '/backoffice/announcements', type: 'ticket', description: 'Platform announcements' },
      { label: 'Settings', path: '/backoffice/settings', type: 'module', description: 'Backoffice settings' },
      { label: 'Feature Flags', path: '/backoffice/feature-flags', type: 'module', description: 'Toggle platform features' },
      { label: 'System Health', path: '/backoffice/monitoring', type: 'module', description: 'Platform monitoring' },
      { label: 'Roles', path: '/backoffice/roles', type: 'module', description: 'Role management' },
      { label: 'My Profile', path: '/backoffice/profile', type: 'user', description: 'Account settings' },
    ];
    setResults(all.filter(r => r.label.toLowerCase().includes(q) || (r.description && r.description.toLowerCase().includes(q))));
    setSelectedIndex(0);
  }, [query]);

  const handleSelect = useCallback((result: SearchResult) => {
    setOpen(false);
    setQuery('');
    navigate(result.path);
  }, [navigate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      handleSelect(results[selectedIndex]);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={() => setOpen(false)} />
      <div className="fixed top-[15%] left-1/2 -translate-x-1/2 w-full max-w-lg z-50">
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
            <Search className="w-5 h-5 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search businesses, users, plans..."
              className="flex-1 outline-none text-sm bg-transparent"
            />
            <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-500 text-xs rounded-md">
              <Command className="w-3 h-3" />K
            </kbd>
          </div>
          <div className="max-h-80 overflow-y-auto p-2">
            {results.length === 0 ? (
              <p className="text-center text-sm text-gray-500 py-8">No results found</p>
            ) : (
              results.map((result, i) => (
                <button
                  key={`${result.path}-${result.label}`}
                  onClick={() => handleSelect(result)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                    i === selectedIndex ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span className={`p-1.5 rounded-lg ${i === selectedIndex ? 'bg-blue-100' : 'bg-gray-100'}`}>
                    {result.type === 'business' && <Building2 className="w-4 h-4" />}
                    {result.type === 'user' && <Users className="w-4 h-4" />}
                    {result.type === 'subscription' && <CreditCard className="w-4 h-4" />}
                    {result.type === 'plan' && <DollarSign className="w-4 h-4" />}
                    {result.type === 'payment' && <FileText className="w-4 h-4" />}
                    {result.type === 'audit' && <ScrollText className="w-4 h-4" />}
                    {result.type === 'ticket' && <HeadphonesIcon className="w-4 h-4" />}
                    {result.type === 'module' && <Building2 className="w-4 h-4" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{result.label}</p>
                    {result.description && <p className="text-xs text-gray-400 truncate">{result.description}</p>}
                  </div>
                  <span className="text-xs text-gray-400">{result.type}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
