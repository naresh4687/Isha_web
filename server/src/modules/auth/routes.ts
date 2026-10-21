import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { one, query } from '../../db/pool.js';
import { asyncHandler, cleanText, HttpError, parse } from '../../lib/http.js';
import { clearAuthCookie, requireAuth, setAuthCookie } from '../../middleware/auth.js';
import { mergeGuestCart } from '../cart/service.js';
import { env } from '../../config/env.js';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many attempts. Please wait a few minutes.' } },
});

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must include a letter')
  .regex(/[0-9]/, 'Password must include a number');

const registerSchema = z.object({
  name: z.string().min(1).max(80).transform(cleanText),
  email: z.string().email().max(254).transform((s) => s.toLowerCase()),
  password,
  marketingConsent: z.boolean().optional().default(false),
  categoryPrefs: z.array(z.string().max(60)).max(9).optional().default([]),
});

const loginSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().min(1).max(128),
});

// Demo accounts store a non-bcrypt placeholder and can never sign in.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', 12);

const publicUser = 'id, email, name, role, category_prefs AS "categoryPrefs", marketing_consent AS "marketingConsent"';

authRouter.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = parse(registerSchema, req.body);
    const exists = await one('SELECT 1 FROM users WHERE email = $1', [body.email]);
    if (exists) throw new HttpError(409, 'An account with this email already exists.', 'email_taken');
    const validCats = (await query('SELECT slug FROM categories')).map((r) => r.slug);
    const prefs = body.categoryPrefs.filter((c) => validCats.includes(c));
    const source = typeof req.cookies?.src === 'string' ? req.cookies.src.slice(0, 40) : null;
    const user = await one(
      `INSERT INTO users(email, password_hash, name, marketing_consent, category_prefs, acquisition_source)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${publicUser}, token_version`,
      [body.email, await bcrypt.hash(body.password, 12), body.name, body.marketingConsent, prefs, source],
    );
    setAuthCookie(res, user);
    await mergeGuestCart(req.visitorId, user.id);
    const { token_version: _tv, ...safe } = user;
    res.status(201).json({ user: safe });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = parse(loginSchema, req.body);
    const row = await one('SELECT id, role, password_hash, token_version FROM users WHERE email = $1', [body.email]);
    // Compare against a dummy hash when the user is missing to keep timing similar.
    const hash = row?.password_hash?.startsWith('$2') ? row.password_hash : DUMMY_HASH;
    const ok = await bcrypt.compare(body.password, hash);
    if (!row || !ok || !row.password_hash.startsWith('$2')) {
      throw new HttpError(401, 'Incorrect email or password.', 'invalid_credentials');
    }
    setAuthCookie(res, row);
    await mergeGuestCart(req.visitorId, row.id);
    const user = await one(`SELECT ${publicUser} FROM users WHERE id = $1`, [row.id]);
    res.json({ user });
  }),
);

authRouter.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.user) return res.json({ user: null });
    res.json({ user: await one(`SELECT ${publicUser} FROM users WHERE id = $1`, [req.user.id]) });
  }),
);

const prefsSchema = z.object({
  name: z.string().min(1).max(80).transform(cleanText).optional(),
  categoryPrefs: z.array(z.string().max(60)).max(9).optional(),
  marketingConsent: z.boolean().optional(),
});

authRouter.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parse(prefsSchema, req.body);
    let prefs: string[] | null = null;
    if (body.categoryPrefs) {
      const valid = (await query('SELECT slug FROM categories')).map((r) => r.slug);
      prefs = body.categoryPrefs.filter((c) => valid.includes(c));
    }
    const user = await one(
      `UPDATE users SET name = coalesce($2, name), category_prefs = coalesce($3, category_prefs),
         marketing_consent = coalesce($4, marketing_consent)
       WHERE id = $1 RETURNING ${publicUser}`,
      [req.user!.id, body.name ?? null, prefs, body.marketingConsent ?? null],
    );
    res.json({ user });
  }),
);

/** Revokes every session for this account, including the current one. */
authRouter.post(
  '/logout-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.user!.id]);
    clearAuthCookie(res);
    res.json({ ok: true });
  }),
);

const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password });

/** Changes the password, signs out all other sessions, and re-issues this session's cookie. */
authRouter.post(
  '/password',
  authLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parse(changePasswordSchema, req.body);
    const row = await one('SELECT password_hash FROM users WHERE id = $1', [req.user!.id]);
    if (!row?.password_hash.startsWith('$2') || !(await bcrypt.compare(body.currentPassword, row.password_hash))) {
      throw new HttpError(400, 'Current password is incorrect.', 'validation_error', { fieldErrors: { currentPassword: ['Current password is incorrect.'] } });
    }
    if (body.currentPassword === body.newPassword) {
      throw new HttpError(400, 'Choose a password you have not used here.', 'validation_error', { fieldErrors: { newPassword: ['New password must differ from the current one.'] } });
    }
    const updated = await one(
      'UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1 RETURNING id, role, token_version',
      [req.user!.id, await bcrypt.hash(body.newPassword, 12)],
    );
    setAuthCookie(res, updated);
    res.json({ ok: true });
  }),
);
