import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiService } from "@/services/api";
import { useAdmin } from "@/contexts/useAdmin";
import { useAuth } from "@/contexts/AuthContext";
import { AutoModuleGuard } from "./ModuleGuard";

export default function BusinessSlugGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const { businessSlug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    selectedBusinessId,
    setSelectedBusinessId,
    allBusinesses,
    getMembershipRole,
  } = useAdmin();

  const [isResolving, setIsResolving] = useState(false);
  const [expectedBusinessId, setExpectedBusinessId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [hasAttemptedLookup, setHasAttemptedLookup] = useState(false);
  
  // Use refs to prevent state updates during active transitions
  const isProcessingRef = useRef(false);
  const lastSlugRef = useRef<string | null>(null);

  const normalizedSlug = useMemo(
    () => String(businessSlug || "").trim().toLowerCase(),
    [businessSlug]
  );

  const accessibleBusinessIds = useMemo(() => {
    const ids = new Set<string>();
    if (user?.companyId) {
      ids.add(String(user.companyId));
    }
    if (Array.isArray(user?.memberships)) {
      user.memberships.forEach((membership: any) => {
        if (membership?.businessId) {
          ids.add(String(membership.businessId));
        }
      });
    }
    return ids;
  }, [user]);

  const isBusinessAccessible = useCallback(
    (businessId: string | null, business?: any) => {
      if (!businessId) return false;
      if (accessibleBusinessIds.has(businessId)) return true;
      if (business?.createdBy && user?.id && String(business.createdBy) === String(user.id)) {
        return true;
      }
      return false;
    },
    [accessibleBusinessIds, user?.id]
  );

  useEffect(() => {
    // Prevent duplicate processing for same slug
    if (normalizedSlug === lastSlugRef.current && hasAttemptedLookup) {
      return;
    }
    
    // Prevent concurrent processing
    if (isProcessingRef.current) {
      return;
    }

    let cancelled = false;
    isProcessingRef.current = true;
    lastSlugRef.current = normalizedSlug;

    if (!normalizedSlug) {
      setExpectedBusinessId(null);
      setIsResolving(false);
      setHasAttemptedLookup(true);
      isProcessingRef.current = false;
      return;
    }

    setIsResolving(true);
    setError(null);

    const run = async () => {
      try {
        console.log(`[BusinessSlugGate] Looking up business: ${normalizedSlug}`);
        
        // Try local cache first
        const localMatch = allBusinesses.find(
          (business: any) =>
            String(business?.slug || "").toLowerCase() === normalizedSlug
        );

        const hasLocalAccess = localMatch && isBusinessAccessible(String(localMatch.id), localMatch);
        let businessId: string | null = hasLocalAccess && localMatch?.id
          ? String(localMatch.id)
          : null;

        if (localMatch && !hasLocalAccess) {
          if (allBusinesses.length > 0) {
            console.warn(`[BusinessSlugGate] Slug resolves to a business the user cannot access:`, localMatch);
            setError(`You do not have access to this business.`);
            setAccessDenied(true);
          } else {
            console.log(`[BusinessSlugGate] Allowing provisional slug access while companies are loading:`, localMatch);
            businessId = String(localMatch.id);
          }
        }

        console.log(`[BusinessSlugGate] Local cache result:`, { 
          found: !!localMatch, 
          businessId,
          allBusinessesCount: allBusinesses.length 
        });

        // Fallback API lookup
        if (!businessId) {
          console.log(`[BusinessSlugGate] Trying API lookup...`);
          try {
            const response = await apiService.getBusinessBySlug(normalizedSlug);
            console.log(`[BusinessSlugGate] API response:`, response);
            
            if (response.success && response.data?.id) {
              const candidateId = String(response.data.id);
              const accessible = isBusinessAccessible(candidateId, response.data);
              if (accessible || allBusinesses.length === 0) {
                businessId = candidateId;
              } else {
                console.warn(`[BusinessSlugGate] Business slug is not accessible for current user:`, response.data);
                setError(`You do not have access to this business.`);
                setAccessDenied(true);
              }
            } else {
              console.warn(`[BusinessSlugGate] API returned no business:`, response);
            }
          } catch (apiError: any) {
            console.error(`[BusinessSlugGate] API lookup failed:`, apiError);
            setError(`API Error: ${apiError.message || 'Unknown error'}`);
          }
        }

        if (cancelled) return;

        // Invalid slug / business not found
        if (!businessId) {
          if (!accessDenied) {
            console.error(`[BusinessSlugGate] Business not found for slug: ${normalizedSlug}`);
          }
          setExpectedBusinessId(null);
          return;
        }

        console.log(`[BusinessSlugGate] Found business ID: ${businessId}`);
        setExpectedBusinessId(businessId);

        // Sync selected business context (only if different)
        if (String(selectedBusinessId || "") !== businessId) {
          console.log(`[BusinessSlugGate] Syncing selected business: ${businessId}`);
          setSelectedBusinessId(businessId);
        }
      } catch (error: any) {
        console.error("[BusinessSlugGate] Failed to resolve business slug:", error);
        setError(`Error: ${error.message || 'Unknown error'}`);

        if (!cancelled) {
          setExpectedBusinessId(null);
        }
      } finally {
        if (!cancelled) {
          setIsResolving(false);
          setHasAttemptedLookup(true);
          isProcessingRef.current = false;
        }
      }
    };

    // Add small delay to prevent flickering from rapid updates
    const timeoutId = setTimeout(() => {
      void run();
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      cancelled = true;
    };
  }, [
    normalizedSlug,
    allBusinesses.length, // Only trigger on length change, not reference
    // Remove selectedBusinessId and setSelectedBusinessId to prevent loops
  ]);

  // Membership role within selected business
  const membershipRole = expectedBusinessId
    ? getMembershipRole()
    : null;

  // Fallback to user global role
  const effectiveRole =
    membershipRole || String(user?.role || "").toUpperCase();

  const role = String(effectiveRole).toUpperCase();

  // Restrict managers to their assigned business
  const managerBlocked =
    expectedBusinessId != null &&
    role === "MANAGER" &&
    user?.businessId &&
    String(user.businessId) !== String(expectedBusinessId);

  // Ensure context is synced before rendering
  const synced =
    !normalizedSlug ||
    (expectedBusinessId != null &&
      String(selectedBusinessId || "") === String(expectedBusinessId));

  // No slug → bypass gate
  if (!normalizedSlug) {
    return <>{children}</>;
  }

  // Access denied
  if (managerBlocked || accessDenied) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="max-w-md">
          <h3 className="text-lg font-semibold text-destructive mb-2">Access Denied</h3>
          <p className="text-muted-foreground mb-4">
            You do not have access to this business.
            Open your assigned business from My Businesses.
          </p>
          {error && (
            <p className="text-sm text-destructive mb-4">{error}</p>
          )}
          <button
            onClick={() => navigate('/zapeera/my-businesses')}
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
          >
            Go to My Businesses
          </button>
        </div>
      </div>
    );
  }

  // Loading state (show for max 3 seconds, then show error)
  if (isResolving) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading business…</p>
        </div>
      </div>
    );
  }

  // Business not found - show detailed error
  if (!expectedBusinessId) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="max-w-md">
          <h3 className="text-lg font-semibold text-destructive mb-2">Business Not Found</h3>
          <p className="text-muted-foreground mb-4">
            Could not find business with slug: <code className="bg-muted px-1 rounded">{normalizedSlug}</code>
          </p>
          {error && (
            <p className="text-sm text-destructive mb-4">{error}</p>
          )}
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Available businesses: {allBusinesses.length}</p>
            {allBusinesses.length > 0 && (
              <div className="text-left bg-muted p-2 rounded">
                <p className="font-medium mb-1">Try one of these:</p>
                <ul className="list-disc list-inside">
                  {allBusinesses.slice(0, 5).map((b: any) => (
                    <li key={b.id}>
                      <a 
                        href={`/business/${b.slug}/dashboard`}
                        className="text-primary hover:underline"
                      >
                        {b.name} ({b.slug})
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <button
            onClick={() => navigate('/zapeera/my-businesses')}
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
          >
            Go to My Businesses
          </button>
        </div>
      </div>
    );
  }

  // Wait for context sync
  if (!synced) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Syncing business context…</p>
        </div>
      </div>
    );
  }

  return <AutoModuleGuard>{children}</AutoModuleGuard>;
}
