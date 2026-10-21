import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { errorHandler } from './lib/http.js';
import { csrfGuard, loadUser, visitor } from './middleware/auth.js';
import { authRouter } from './modules/auth/routes.js';
import { catalogRouter } from './modules/catalog/routes.js';
import { mediaRouter } from './modules/media/routes.js';
import { cartRouter } from './modules/cart/routes.js';
import { ordersRouter, webhookRouter } from './modules/orders/routes.js';
import { reviewsRouter } from './modules/reviews/routes.js';
import { eventsRouter } from './modules/events/routes.js';
import { supportRouter } from './modules/support/routes.js';
import { adminRouter } from './modules/admin/routes.js';
import { analyticsRouter } from './modules/analytics/routes.js';
import { mlAdminRouter, recommendationsRouter } from './modules/recommendations/routes.js';
import { pool } from './db/pool.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
          frameSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
          connectSrc: ["'self'", 'https://lumberjack.razorpay.com'],
          imgSrc: ["'self'", 'data:'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(cookieParser());
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && origin === env.CORS_ORIGIN) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
      res.set('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
      res.set('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Webhook needs the raw body, so it is mounted before the JSON parser.
  app.use('/api', webhookRouter);
  app.use(express.json({ limit: '64kb' }));
  app.use(visitor);
  app.use(csrfGuard);
  app.use(asyncLoadUser);
  app.use('/api', rateLimit({ windowMs: 60_000, limit: env.NODE_ENV === 'test' ? 100_000 : 600, standardHeaders: 'draft-7', legacyHeaders: false }));

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, commit: process.env.RENDER_GIT_COMMIT ?? null }); // lets CD verify which build is live
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  app.use('/media', mediaRouter);
  app.use('/api/auth', authRouter);
  app.use('/api', catalogRouter);
  app.use('/api', cartRouter);
  app.use('/api', ordersRouter);
  app.use('/api', reviewsRouter);
  app.use('/api', eventsRouter);
  app.use('/api', supportRouter);
  app.use('/api/recommendations', recommendationsRouter);
  app.use('/api/admin/analytics', analyticsRouter);
  app.use('/api/admin/ml', mlAdminRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Unknown API route' } }));

  // In production the built storefront (web/dist) is served from the same origin as the API.
  const dist = process.env.WEB_DIST ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (env.NODE_ENV === 'production' && fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1y', immutable: true, setHeaders: (res, file) => /\.(html|json)$/.test(file) && res.set('Cache-Control', 'no-cache') })); // JSON (e.g. the image manifest) is not content-hashed
    app.get('*', (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(dist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}

function asyncLoadUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  loadUser(req, res, next).catch(next);
}
