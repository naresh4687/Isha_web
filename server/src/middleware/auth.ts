import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { one } from '../db/pool.js';
import { HttpError } from '../lib/http.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'customer' | 'admin';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      visitorId: string;
      analyticsConsent: boolean;
    }
  }
}

export const AUTH_COOKIE = 'auth';
export const VISITOR_COOKIE = 'vid';
export const SESSION_COOKIE = 'asid';
export const CONSENT_COOKIE = 'consent';

const cookieBase = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.COOKIE_SECURE || env.NODE_ENV === 'production',
  path: '/',
});

export function setAuthCookie(res: Response, user: { id: string; role: string; token_version?: number }) {
  const token = jwt.sign({ sub: user.id, role: user.role, tv: user.token_version ?? 0 }, env.JWT_SECRET, { expiresIn: '7d' });
  res.cookie(AUTH_COOKIE, token, { ...cookieBase(), maxAge: 7 * 86_400_000 });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(AUTH_COOKIE, cookieBase());
}

export function setSessionCookie(res: Response, id: string) {
  res.cookie(SESSION_COOKIE, id, { ...cookieBase(), maxAge: 30 * 60_000 });
}

/** Anonymous visitor id (cart ownership for guests) plus the user's consent choice. */
export function visitor(req: Request, res: Response, next: NextFunction) {
  let vid = req.cookies?.[VISITOR_COOKIE];
  if (typeof vid !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(vid)) {
    vid = crypto.randomUUID();
    res.cookie(VISITOR_COOKIE, vid, { ...cookieBase(), maxAge: 365 * 86_400_000 });
  }
  req.visitorId = vid;
  req.analyticsConsent = req.cookies?.[CONSENT_COOKIE] === 'analytics';
  next();
}

export async function loadUser(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[AUTH_COOKIE];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { sub: string; tv?: number };
    // Role is always re-read from the database so demotions take effect immediately;
    // a token_version mismatch means the session was revoked.
    const user = await one<AuthUser & { token_version: number }>('SELECT id, email, name, role, token_version FROM users WHERE id = $1', [payload.sub]);
    if (user && user.token_version === (payload.tv ?? 0)) {
      const { token_version: _tv, ...u } = user;
      req.user = u;
    } else clearAuthCookie(res);
  } catch {
    clearAuthCookie(res);
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue.', 'unauthenticated'));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue.', 'unauthenticated'));
  if (req.user.role !== 'admin') return next(new HttpError(403, 'Administrator access required.', 'forbidden'));
  next();
}

/**
 * CSRF mitigation for cookie-authenticated JSON APIs: state-changing requests must carry a custom
 * header, which browsers will not attach cross-origin without a CORS preflight we do not allow.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/api/payments/razorpay/webhook')) return next();
  if (req.get('x-requested-with') !== 'fetch') {
    return next(new HttpError(403, 'Missing request header', 'csrf'));
  }
  next();
}
