/**
 * Prefix app paths with /business/:slug when a business is selected so URLs show tenant context.
 * Public storefront will use /store/:slug (separate namespace).
 */
export function withBusinessSlug(slug: string | null | undefined, path: string): string {
  const s = String(slug || '').trim();
  if (!s) {
    return path.startsWith('/') ? path : `/${path}`;
  }
  const enc = encodeURIComponent(s);
  if (path === '/') return `/business/${enc}/dashboard`;
  
  // CRITICAL FIX: Normalize legacy paths to new route paths for business context
  let normalized = path.startsWith('/') ? path : `/${path}`;
  if (normalized === '/point-of-sale') normalized = '/pos';
  
  return `/business/${enc}${normalized}`;
}
