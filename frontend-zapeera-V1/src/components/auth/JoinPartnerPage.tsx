import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { PARTNER_SLUG_STORAGE_KEY } from '../../contexts/BrandingContext';

// ─── Partner join link (White-label Feature 3) ────────────────────────
// /join/<slug> is the link a white-label partner shares. It persists
// the slug (so attribution survives the email-verification round trip
// and lands on the business created afterwards) and hands over to the
// NORMAL register — which renders partner-branded because the
// BrandingProvider resolves ?partner=<slug>. Domain-ready by design:
// a partner custom domain (phase 2) resolves to this same route.
const JoinPartnerPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const clean = (slug || '').trim().toLowerCase();

  useEffect(() => {
    if (clean) {
      try {
        localStorage.setItem(PARTNER_SLUG_STORAGE_KEY, clean);
      } catch {
        /* storage unavailable */
      }
    }
  }, [clean]);

  if (!clean) return <Navigate to="/signup" replace />;
  return <Navigate to={`/signup?partner=${encodeURIComponent(clean)}`} replace />;
};

export default JoinPartnerPage;
