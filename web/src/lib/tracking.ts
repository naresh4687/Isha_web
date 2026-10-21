/**
 * Consent-aware behavioural tracking. Nothing is sent unless the visitor accepted analytics
 * cookies; the server independently refuses to store events without the consent cookie.
 */
type EventType =
  | 'page_view' | 'product_view' | 'search' | 'add_to_wishlist' | 'remove_from_wishlist'
  | 'add_to_cart' | 'remove_from_cart' | 'begin_checkout' | 'rec_impression' | 'rec_click';

export interface TrackEvent {
  type: EventType;
  productId?: string;
  quantity?: number;
  placement?: string;
  metadata?: { path?: string; q?: string; position?: number; resultCount?: number; modelVersion?: string };
}

const CONSENT = 'consent';

export function getConsent(): 'analytics' | 'essential' | null {
  const m = document.cookie.match(/(?:^|; )consent=([^;]+)/);
  return m ? (m[1] as 'analytics' | 'essential') : null;
}

export function setConsent(value: 'analytics' | 'essential') {
  document.cookie = `${CONSENT}=${value}; path=/; max-age=${180 * 86400}; samesite=lax`;
  if (value !== 'analytics') queue.length = 0;
}

function trafficContext() {
  const p = new URLSearchParams(location.search);
  const utm = p.get('utm_source')?.toLowerCase();
  const medium = p.get('utm_medium')?.toLowerCase();
  let source = 'direct';
  if (medium === 'cpc' || medium === 'paid') source = 'paid_search';
  else if (utm === 'email' || medium === 'email') source = 'email';
  else if (utm && /facebook|instagram|twitter|x|linkedin|pinterest|youtube/.test(utm)) source = 'social';
  else if (utm) source = 'other';
  else if (document.referrer && !document.referrer.startsWith(location.origin)) {
    source = /google\.|bing\.|duckduckgo\.|yahoo\./.test(document.referrer) ? 'organic_search' : /facebook|instagram|t\.co|linkedin|pinterest|youtube/.test(document.referrer) ? 'social' : 'referral';
  }
  const w = window.innerWidth;
  return {
    source,
    medium: medium?.slice(0, 40),
    campaign: p.get('utm_campaign')?.slice(0, 80),
    landingPath: location.pathname.slice(0, 200),
    device: w < 640 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop',
  };
}

const context = typeof window !== 'undefined' ? trafficContext() : {};
const queue: TrackEvent[] = [];
let timer: number | undefined;

function flush() {
  timer = undefined;
  if (!queue.length || getConsent() !== 'analytics') {
    queue.length = 0;
    return;
  }
  const events = queue.splice(0, 25);
  fetch('/api/events', {
    method: 'POST',
    keepalive: true,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: JSON.stringify({ context, events }),
  }).catch(() => undefined);
  if (queue.length) timer = window.setTimeout(flush, 500);
}

export function track(e: TrackEvent) {
  if (getConsent() !== 'analytics') return;
  queue.push(e);
  if (queue.length >= 25) flush();
  else if (!timer) timer = window.setTimeout(flush, 1500);
}

if (typeof window !== 'undefined') {
  addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
}

// --- Recently viewed (kept on this device only) ------------------------------------------------
const RV = 'recentlyViewed';

export function recentlyViewed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RV) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
}

export function pushRecentlyViewed(id: string) {
  try {
    localStorage.setItem(RV, JSON.stringify([id, ...recentlyViewed().filter((x) => x !== id)].slice(0, 12)));
  } catch {
    /* storage unavailable */
  }
}

export function guestCategoryPrefs(): string[] {
  try {
    return JSON.parse(localStorage.getItem('categoryPrefs') ?? '[]');
  } catch {
    return [];
  }
}

export function setGuestCategoryPrefs(prefs: string[]) {
  try {
    localStorage.setItem('categoryPrefs', JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}
