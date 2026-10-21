# Production guide: images, CI/CD, deployment

Status (keep this section honest when things change):

| Area | State |
|---|---|
| Product photos | 59 of 70 products have licensed photos; 11 use generated illustrations (reasons in `docs/product-images.md`). |
| CI (tests, audit, image validation, e2e) | Running on every push and PR. |
| CD to Render | Built and gated. **Awaiting configuration:** the `RENDER_DEPLOY_HOOK_STORE` / `RENDER_DEPLOY_HOOK_ML` secrets are not set, so deploy runs are skipped with a warning. |
| Live storefront (`anvaya-1.onrender.com`) | **Suspended in the Render dashboard**; it must be resumed before any deploy can succeed. Not verified live. |
| Staging / preview environments | Not available: Render preview environments need a paid workspace. PRs are validated in CI only. |

## Architecture

| Part | Where | Deployed by |
|---|---|---|
| React client + Express API (one service; Express serves `web/dist`) | Render web service (`anvaya-1`) | CD job, every release |
| ML / BI service (FastAPI) | Render web service (`anvaya-ml`) | CD job, only when `ml/` changed |
| PostgreSQL | Neon | migrations run by the API on start |
| Product photos | `web/public/assets/products/` (in the repo, shipped with the client build) | with the client |

## Environment variables

**Storefront (`server/src/config/env.ts`)**: `DATABASE_URL`, `JWT_SECRET` (≥ 32 chars), `ML_SERVICE_URL`, `ML_SERVICE_TOKEN`, `NODE_ENV=production`, `PAYMENT_PROVIDER` (`none`/`razorpay`; `mock` is refused in production), `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SELLER_STATE`, `BRAND_NAME`, `CORS_ORIGIN`, `COOKIE_SECURE`, `EVENT_RETENTION_DAYS`, `LOW_STOCK_THRESHOLD`, `FREE_SHIPPING_THRESHOLD_PAISE`, `SHIPPING_FEE_PAISE`. Render sets `PORT` and `RENDER_GIT_COMMIT`.

**ML service (`ml/app/config.py`)**: `DATABASE_URL`, `ML_SERVICE_TOKEN` (same value as the storefront), optional `ML_*` tuning variables (see `ml/.env.example`).

**GitHub** (Settings → Environments → `production`; restrict the environment to the `main` branch):

| Name | Kind | Used by |
|---|---|---|
| `RENDER_DEPLOY_HOOK_STORE` | secret | `ci.yml` deploy: storefront deploy hook (Render → service → Settings → Deploy Hook) |
| `RENDER_DEPLOY_HOOK_ML` | secret | `ci.yml` deploy: ML deploy hook |
| `DATABASE_URL` | secret | `image-sync.yml`, `maintenance.yml` |
| `ML_SERVICE_URL`, `ML_SERVICE_TOKEN` | secrets | `maintenance.yml` (retrain) |
| `STORE_URL`, `ML_URL` | variables | deploy, smoke tests, keep-warm (defaults: `https://anvaya-1.onrender.com`, `https://anvaya-ml.onrender.com`) |
| `MAINTENANCE_ENABLED`, `KEEP_WARM` | variables | turn scheduled workflows on/off |

Secrets are only read in jobs that run on `main` and are never echoed (deploy hook URLs are passed straight to `curl`).

## GitHub Actions

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | push, PR, manual | `audit` (npm audit high+, pip-audit) · `server` (typecheck, 97 tests incl. image validation, image-sync dry run → `image-inventory` artifact) · `web` (unit tests, typecheck + build → `web-dist` artifact) · `ml` (ranking, cold start, evaluation, API) · `e2e` (Playwright: shopping, checkout, returns, images, accessibility, responsive → `playwright-report` artifact) · `deploy` (main only, after all of the above) |
| `image-sync.yml` | manual only | dry run or apply of the image manifest against production; report kept 90 days |
| `maintenance.yml` | daily / manual | event purge + ML retrain |
| `keep-warm.yml` | every 10 min, 07:30–00:30 IST | pings the storefront so visitors avoid cold starts (kept within Render's 750 free hours) |

PR runs are cancelled when superseded; runs on `main` are never cancelled, and deploys are serialised (`production-deploy` concurrency group). No linters/formatters are configured in this repo, so CI does not run any; type checks cover the TypeScript code.

## Deploying

A push to `main` that passes every CI job:

1. Resolves the target commit and records what is live (`/api/health` and ML `/health` return `commit`).
2. Triggers the Render deploy hook with `ref=<commit>` (exact commit, not "latest"). The ML service only if `ml/` or `render.yaml` changed since its live commit.
3. Waits (up to 25 min) until health reports the new commit, then smoke-tests: home page, a client route, catalogue API, a product photo, the image manifest, recommendations, ML health.
4. **If the smoke test fails, automatically redeploys the previously live commit** and marks the run failed.

Render's own auto-deploy is off (`autoDeployTrigger: "off"` in `render.yaml`), so nothing reaches production without passing CI. Deployment history: the Actions tab (`deploy` job summaries) and each Render service's Events tab.

**Manual deploy / rollback:** Actions → `ci` → Run workflow → enter a commit on `main` in `ref` (blank = latest). The tests run on the current `main`, then that commit is deployed and smoke-tested. Render's dashboard also has a one-click **Rollback** per deploy.

**Migrations** are forward-only, additive SQL files in `server/migrations/`, applied in a transaction when the API starts. Because they only add columns/tables, rolling the code back runs fine on the migrated schema. If a future migration must remove or rename something, ship it in two releases (stop using the column first, drop it later) so a rollback stays safe. Neon offers point-in-time restore (and branches) for data recovery.

**First-time setup:** resume the storefront service in Render if it is suspended; add the two deploy-hook secrets; run `ci` manually once. Then confirm the `deploy` job summary says the commit is live and the smoke tests passed.

## Product images

**Sources and licensing.** Only files whose source page is on an allow-listed host (`commons.wikimedia.org`, `www.flickr.com`, `wordpress.org`) and whose licence is Public domain, CC0, CC BY or CC BY-SA are accepted. Download hosts are allow-listed separately in the scripts. No other site is crawled; the reference store's photos are not used. CC BY / BY-SA require attribution: every photo's author, licence and source link appear under the product gallery and on `/image-credits`; crops of CC BY-SA images are shared under the same licence. Unsplash/Pexels can be added later through their official APIs with a key.

**Preparing images** (`tools/product-images/`, Python + Pillow, run with `python3 -I`):
1. `search.py` / `openverse_search.py` collect licence-compatible candidates (≥ 700 px) per product.
2. A person reviews contact sheets (`sheet.py`) and records approved choices in `picks.py`, with alt text in `alts.py`. **There is no automatic matching**: every product↔image mapping is a human-approved pick. Candidates that don't clearly show the product are not picked; the product stays on its illustration and the reason goes in `UNRESOLVED`.
3. `build.py <out_dir>` downloads the approved files (cached), crops/pads to square, writes `<n>-<hash>-400.webp` and `-800.webp` atomically, rejects duplicates, and writes `manifest.json` with source, author, licence, retrieval date, modifications and `fit`. Output is deterministic: unchanged picks produce byte-identical files.
4. Open a PR. CI validates the manifest and runs the image tests and e2e checks before anything can deploy.

**Applying to the database** (`server`, needs `DATABASE_URL`):

```
npm run images:sync                          # dry run: validate + show changes (default)
npm run images:sync -- --report=inventory.md # also write the inventory (ID, name, category, image, status, attribution)
npm run images:sync -- --apply               # validate, then update products in one statement
```

Validation checks the source host and licence, attribution, alt text, file names, that both WebP files exist with a valid signature and the right dimensions, sizes, and duplicates. **If anything fails, nothing is applied** (the API also re-validates before its startup sync). Only products with no photo or with manifest-managed photos are updated; images set any other way are kept. Reruns are no-ops.

**Rendering.** Every surface (cards, search, recommendations, cart, checkout, orders, wishlist, admin) gets the product's first image from one resolver (`server/src/modules/catalog/images.ts`). The client's `ProductImage` component adds a fixed square frame, a loading placeholder, lazy loading, `srcset`/`sizes`, `object-contain` for isolated product shots and `object-cover` otherwise, and a bounded fallback chain: photo → the product's category illustration → branded placeholder. There is no 3D viewer and no product has a 3D model; `model3d` is always `null`.

**Storage and backup.** The catalogue photos (~12 MB) live in git, so every deploy ships them and git history is the backup; they're served with year-long immutable caching (file names contain content hashes). Admin uploads are not supported. If they are added, store them in object storage (S3/R2/Supabase), not on Render's ephemeral disk.

## Local development and tests

```
docker compose up -d db                                  # Postgres on :5433
cd server && npm ci && npm run seed && npm run dev       # API on :4000 (applies migrations + image sync)
cd web && npm ci && npm run dev                          # client on :5173
cd ml && make venv && make serve                         # ML on :8001
cd server && npm run typecheck && npm test               # 97 tests
cd web && npm test && npm run build                      # 21 tests + build
cd ml && make test                                       # 30 tests
cd web && npx playwright test                            # 57 e2e tests + 2 device-specific skips (starts its own stack)
```

## Monitoring and troubleshooting

- **Health:** `/api/health` (DB + commit) and ML `/health` (model loaded + commit). Render restarts unhealthy instances.
- **Logs:** Render service → Logs; CI → Actions run (summary shows target, live commit, smoke results).
- **Deploy job says "suspended"** (HTTP 409): resume the service in Render and re-run.
- **Deploy skipped with a warning:** the deploy-hook secrets are missing.
- **Images show illustrations on a running site:** the server logs `product images: manifest has N problem(s); not applied` if validation failed; run `npm run images:sync` to see why.
- **Recommendations look generic:** the ML service is asleep or retraining after a cold start; the API falls back to popularity within 1.5 s.

## Known limitations

- Free Render instances sleep outside the keep-warm window (cold start ~50 s) and share 750 hours/month.
- Product photos are representative, not the exact items; 11 products still use illustrations.
- `react-router` 6 has a moderate advisory; the fix is the v7 major upgrade (not done). The audit job fails only on high/critical.
- No staging environment (paid Render feature).
