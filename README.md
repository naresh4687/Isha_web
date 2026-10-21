# Anvaya: e-commerce with analytics and ML recommendations

Anvaya is a storefront for considered, natural lifestyle goods. It has nine categories: Rudraksha, Consecrated Products, Yoga Store, Natural Food, Health and Immunity, Clothing, Body Care, Home Decor and Books. Alongside the store it has:
- an access-controlled business analytics dashboard;
- a Python recommendation service (content + collaborative + hybrid) with an honest offline evaluation;
- BI modules: RFM, validated k-means, forecasting, demand and affinity.

> **Independent demonstration store.**
> - The brand ("Anvaya", configurable) is original.
> - All product names, copy and images are original placeholders. Images are generated SVG illustrations.
> - The shopping layout follows common patterns. No assets, copy or code from any other retailer are used, and the reference site blocked automated access.
> - The included sales/behaviour dataset is **synthetic**. It is flagged `is_demo` and labelled everywhere it appears.

## Architecture

```
 Browser (React 18 + TS + Vite + Tailwind; Recharts for admin charts)
     │  same-origin /api, /media   (Vite proxy in dev; Express serves web/dist in prod)
     ▼
 Express API (Node 18, TypeScript via tsx, zod-validated)            ──────►  PostgreSQL 16
   auth · catalog/search · cart · wishlist · checkout · payments        (plain SQL migrations;
   orders · reviews · events · support · admin · analytics               orders, events, sessions…)
     │  X-Service-Token, 1.5 s timeout, SQL fallback if down                    ▲
     ▼                                                                          │ read-only
 FastAPI ML service (pandas, scikit-learn) ───────────────────────────────────┘
   recommendations (content / item-item CF / hybrid / co-purchase) · BI · evaluation
   artifacts: ml/artifacts/model-<version>.joblib + report-<version>.json; row in model_versions
```

```
server/   src/{config,db,middleware,lib,modules/<domain>}  migrations/  seed/  tests/
ml/       app/{config,data,models,hybrid,evaluation,train,api}.py  app/bi/  tests/
web/      src/{api,components,pages,admin,hooks,lib}  e2e/
docs/     PLAN.md  METRICS.md  ML.md  API.md
```

## Quick start (development)

Prerequisites: Node 18.18+, Python 3.11+, Docker.

```bash
docker compose up -d db                                # Postgres on :5433 (also creates anvaya_test)

cd server && cp .env.example .env                      # fill in JWT_SECRET; set PAYMENT_PROVIDER=mock for local testing
npm install
npm run seed                                           # migrations + catalogue + settings + discount codes + dev admin
npm run seed:demo                                      # OPTIONAL synthetic history (~1.5k orders, 81k events), is_demo=true
npm run dev                                            # API on :4000

cd ../ml && cp .env.example .env                       # same DATABASE_URL (postgresql://…) and ML_SERVICE_TOKEN
make venv && make train && make serve                  # trains, evaluates, serves on 127.0.0.1:8001

cd ../web && npm install && npm run dev                # http://localhost:5173
```

The dev admin is `admin@anvaya.local` / `ChangeMe-Admin-123` unless `ADMIN_EMAIL` or `ADMIN_PASSWORD` is set. The seed refuses to create an admin in production without `ADMIN_PASSWORD`.

The sample discount codes are `WELCOME10` (10%), `FESTIVE15` (15% over ₹999) and `FLAT200` (₹200 off over ₹1,499).

### Database & migrations
- Migrations are ordered SQL files in `server/migrations/`, tracked in `schema_migrations`. They are applied by `npm run migrate`, by the seed scripts, and on API startup.
- Add a migration by creating `00N_description.sql`. Migrations run inside a transaction and are never edited after being applied.
- Regenerate demo data with `npm run seed:demo -- --reset [--days=180 --customers=1500 --anonymous=6000 --seed=7]`.
  - `--reset` deletes only `is_demo` rows.
- Retention: `npm run purge-events` deletes events and analytics sessions older than `EVENT_RETENTION_DAYS` (default 395). Schedule it daily in production.

### Environment variables
- Server: see `server/.env.example`. The required ones are `DATABASE_URL`, `JWT_SECRET` (≥32 chars) and `NODE_ENV`.
  - `PAYMENT_PROVIDER` is `razorpay | mock | none`.
  - `mock` is **refused at startup in production**.
  - With `none`, or with missing Razorpay keys, checkout shows "payments not configured" and no order can be paid.
- ML service: see `ml/.env.example`. `ML_SERVICE_TOKEN` must match the server's.
- Web: no build-time secrets. The brand name and announcement come from the `settings` table (`/api/settings/public`).

### Payments (Razorpay test mode)
1. Set `PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID=rzp_test_…` and `RAZORPAY_KEY_SECRET` from the Razorpay dashboard, in test mode.
2. Add a webhook pointing to `https://<host>/api/payments/razorpay/webhook` with the events `payment.captured`, `payment.failed` and `order.paid`. Set `RAZORPAY_WEBHOOK_SECRET`.
3. Card and UPI details are entered only in Razorpay's window. The server stores provider order and payment ids and status, never card data.
   - Payment is confirmed by HMAC-verified signature (client handler) or by the signed webhook.

**Not verified against live Razorpay.** No credentials were available. Signature verification and the webhook path are covered by unit and integration tests using known HMACs. The order and refund REST calls (`POST /v1/orders`, `POST /v1/payments/:id/refund`) have **not** been exercised against Razorpay's sandbox.

## ML training & evaluation

```bash
cd ml
make train        # = .venv/bin/python -m app.train   (prints the metric table and bootstrap CIs)
curl -X POST -H "X-Service-Token: $ML_SERVICE_TOKEN" localhost:8001/v1/model/reload   # hot-reload a new artifact
```

- Training evaluates first, on a temporal split with validation-based tuning against popularity and content-only baselines. It then fits on all data and writes a versioned artifact and report.
- It records a `model_versions` row (`--no-db-record` to skip).
- See **`docs/ML.md`** for the method and the latest results.
  - Hybrid vs popularity: clear win.
  - Hybrid vs CF-only: marginal.
  - Differentiated interaction weights: no measurable effect.
  - All of this is on synthetic data.
- Retrain on a schedule (e.g. nightly) once real data accumulates.

## Tests

| Suite | Command | Result (2026-10-21) |
|---|---|---|
| Server: Vitest + Supertest against an isolated `anvaya_test` DB (schema rebuilt per run) | `cd server && npm test` | **90 passed** (10 files) |
| ML: pytest, in-memory fixtures | `cd ml && make test` | **30 passed** |
| Web unit: Vitest + Testing Library | `cd web && npm test` | **15 passed** |
| E2E + responsive + axe a11y: Playwright, isolated `anvaya_e2e` DB, API :4100, Vite :5174, ML deliberately offline | `cd web && npx playwright install chromium && npm run test:e2e` | **51 passed, 2 skipped** (device-specific) |
| Typecheck | `npm run typecheck` in server and web | clean |

What the suites cover:
- **Catalog**: listing, filters, search with typos, sorting, pagination, inactive and out-of-stock handling.
- **Cart**: guest persistence, quantity and stock caps, guest→account merge, discount validation.
- **Orders**: totals, shipping thresholds, discount usage counts, stock reservation and release, oversell prevention, payment success and failure, cancellation and refund.
- **Refunds & returns**: unit-by-unit partial refunds summing exactly to the order total (shipping with the last unit), per-product analytics attribution, return window, non-returnable categories, pending-quantity limits, approve/reject finality.
- **GST**: breakdown maths (discount share, CGST/SGST vs IGST), rate snapshot at checkout, admin-only configuration.
- **Sessions**: sign out everywhere and password change revoke other sessions.
- **Security**: authentication, CSRF header, admin 401/403, immediate role changes, admin product and inventory audit trail.
- **Payments**: Razorpay signature and webhook verification.
- **Analytics**: hand-computed fixtures including timezone edges, demo exclusion and refund allocation.
- **Events**: consent gating and invalid or missing payloads.
- **Recommendations**: eligibility filtering, anchor exclusion, consent-gated history, ML-down fallback, empty frequently-bought-together.
- **ML**: content and CF behaviour, cold start for users and products, frequently-bought-together support, metric maths, temporal-split leakage, evaluation reproducibility, BI guardrails.
- **E2E**: full purchase journey, failed payment, customer return approved by admin with partial refund shown, empty and error states, admin protection.
- **Responsive and a11y**: no horizontal overflow at desktop and Pixel 7 sizes; zero serious or critical axe violations on 7 pages in light and dark; keyboard skip link and menus.

## Deployment

**Free hosting (Render + Neon + GitHub Actions):** follow [`docs/DEPLOY.md`](docs/DEPLOY.md). `render.yaml` defines both services as a Render Blueprint.

Any other host:
1. Provision PostgreSQL 16 and set the server env (`NODE_ENV=production`, a strong `JWT_SECRET`, `PAYMENT_PROVIDER=razorpay` with keys or `none`, and `ADMIN_PASSWORD` for seeding).
2. Run `cd web && npm ci --include=dev && npm run build`, then `cd server && npm ci --omit=dev && npm run seed && npm start`. Express serves `web/dist` and `/api` from one origin, and migrations run on start.
3. Run the ML service with `uvicorn app.api:app --host 0.0.0.0 --port $PORT`. It trains in the background on first start, and its endpoints need `X-Service-Token`.
4. Serve everything over HTTPS (cookies are `Secure` in production). The app sets `trust proxy 1`.
5. Schedule `npm run purge-events` daily and `POST /v1/model/retrain` nightly (see `.github/workflows/maintenance.yml`).

## Security notes & limitations

**Implemented**:
- bcrypt (cost 12) passwords and httpOnly SameSite=Lax JWT cookies, with the role re-read from the database on every request;
- CSRF custom-header guard, helmet CSP and same-origin CORS;
- zod validation on every input, plain-text-only reviews, CSV formula-injection guards;
- rate limits on auth, events, support and the API overall;
- conditional stock decrements in transactions;
- no PII in public recommendation responses, consent-gated tracking, a data-retention script and an audited inventory log.

**Known gaps (not done)**:
- No email delivery. Cart recovery is a manual queue, and there is no password reset (forgotten password) or email verification. Signed-in password change exists.
- Logout clears only this browser's cookie; "Sign out of all devices" and password changes revoke all sessions via `token_version`. No 2FA for admins.
- Rate limits are in-memory, so they are per process. Use a shared store if scaling horizontally.
- Refunds and returns: partial refunds, customer return requests and admin approval are implemented. There's no return-shipping/pickup tracking, and approval doesn't wait for the item to arrive back.
- GST: a per-category rate (set by the merchant, unset by default) gives an order-level breakdown of GST included in prices. It is **not** a GST tax invoice: no GSTIN, HSN codes or invoice numbering, and shipping is excluded.
- Refund-provider calls happen inside the database transaction that locks the order. A slow Razorpay response holds that lock for up to 10 s.
- Variant images are not supported; product imagery is generated art.
- Remaining frontend advisory: react-router 6.x has a moderate advisory (GHSA-wrjc-x8rr-h8h6) that is only fixed in v7, a breaking upgrade.
  - The affected redirect path (`?next=`) is independently hardened and tested.
  - The SSR advisory does not apply (no SSR).
  - React Router v7 requires Node ≥ 20; this environment runs Node 18.19, so the upgrade was not attempted.
  - Dev-only advisories exist in the vitest/esbuild toolchain; their fixes require Node 20.
- Recommendation quality is unproven on real traffic. Online CTR and conversion tracking is wired up but has only test traffic.
- The reference website could not be inspected (HTTP 403 to automated access), so the information architecture follows the brief's description.
