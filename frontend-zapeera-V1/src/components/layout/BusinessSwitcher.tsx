import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Building2, Wifi, WifiOff } from 'lucide-react';
import { useAdmin } from '@/contexts/useAdmin';
import { useRuntime } from '@/lib/runtime';
import { cn } from '@/lib/utils';

interface Business {
  id: string;
  name: string;
  slug?: string;
  businessType?: string;
  isOwned?: boolean;
}

interface BusinessSwitcherProps {
  businessSlug?: string;
}

export function BusinessSwitcher({ businessSlug }: BusinessSwitcherProps) {
  const navigate = useNavigate();
  const { allCompanies: allBusinesses, selectedCompanyId: selectedBusinessId, setSelectedCompanyId: setSelectedBusinessId } = useAdmin();
  const runtime = useRuntime();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentBusiness = allBusinesses.find(
    (b: Business) => b.id === selectedBusinessId || b.slug === businessSlug
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleBusinessSwitch = (business: Business) => {
    setSelectedBusinessId(business.id);
    setIsOpen(false);
    navigate(`/business/${business.slug}/dashboard`);
  };

  if (!currentBusiness || allBusinesses.length <= 1) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent transition-colors"
      >
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-popover border rounded-lg shadow-lg z-50 py-1">
          <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Switch Business
          </div>
          {allBusinesses.map((business: Business) => {
            const desktopState = runtime.desktopBusinessStates.find(s => s.businessId === business.id);
            const isAvailable = !runtime.isDesktop || desktopState?.availableOffline;

            return (
              <button
                key={business.id}
                onClick={() => handleBusinessSwitch(business)}
                className={cn(
                  'w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2',
                  business.id === currentBusiness.id ? 'bg-accent' : '',
                )}
              >
                <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{business.name}</div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                    <span>{business.businessType} • {business.isOwned ? 'Owner' : 'Member'}</span>
                    {runtime.isDesktop && (
                      <>
                        <span>·</span>
                        {isAvailable ? (
                          <span className="flex items-center gap-0.5 text-green-600 dark:text-green-400">
                            <Wifi className="h-3 w-3" />
                            Offline
                          </span>
                        ) : (
                          <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                            <WifiOff className="h-3 w-3" />
                            Cloud
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {business.id === currentBusiness.id && (
                  <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
