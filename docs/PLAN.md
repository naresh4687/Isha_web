# Implementation Plan (Phase 1 findings)

## Baseline inspection (2026-10-21)

| Item | Finding |
|---|---|
| Existing code | **None.** `/home/naresh/projects/ishadesign` was empty (no files, no git repo). Nothing to preserve; no baseline tests exist. |
| Runtimes | Node 18.19.1, npm 9.2, Python 3.12.3 (venv available), Docker 29.8 (working). |
| Databases | No local Postgres/Mongo install. Postgres 16 runs via Docker. |
| Network | npm registry and PyPI reachable. |
| Reference site | `ishalife.sadhguru.org/in/` returns HTTP 403 to automated fetches. Layout follows the shopping patterns listed in the brief; no assets, copy or code are taken from it. |
| Credentials | None present: no payment keys, no email provider, no analytics provider. |

## Stack decisions (new project, so the brief's defaults apply, with justified deviations)

- **Frontend:** React 18 + TypeScript + Vite 5 + Tailwind 3. Vite 5 rather than 7 because Node 18 is installed. Data fetching uses TanStack Query and charts use Recharts.
  - No heavy component library. Small in-house primitives keep the editorial look and avoid an admin-template feel.
- **Backend:** Node + Express 4 + TypeScript (run with `tsx`). zod validates every request body and query.
- **Database:** PostgreSQL 16, accessed with `pg` through plain SQL migrations.
  - Analytics is SQL-heavy (window functions, date bucketing), and plain SQL keeps the metric definitions auditable.
  - Prisma was avoided because it needs a runtime engine download.
- **ML/BI service:** Python FastAPI + pandas + scikit-learn + numpy/scipy.
  - It reads Postgres read-only and is called only by the backend, using a shared service token.
- **Payments:** Razorpay test mode (an INR storefront), using server-created orders, HMAC signature verification and a webhook.
  - A `mock` provider exists for local development only. The server refuses to start with it when `NODE_ENV=production`.
- **Images:** product art is generated as SVG at request time (an original placeholder system). No third-party photography is used.
- **Brand:** "Anvaya" (original), configurable through `BRAND_NAME` and the `settings` table.

## Modules

```
server/  src/{config,db,middleware,modules/<domain>/{routes,service}.ts,lib}
         migrations/*.sql, seed/, tests/
ml/      app/{data,content,collaborative,popularity,hybrid,evaluation,bi/*,api}.py, train.py, tests/
web/     src/{api,components,pages,admin,hooks,lib}
docs/    PLAN, METRICS, ML, API
```

## Phase order

1. Infrastructure, schema, seed catalog (9 categories), and demo data generator (all demo rows flagged `is_demo`).
2. Commerce API: auth and roles, catalog/search/filter, cart, wishlist, checkout, payments, orders, reviews, and admin.
3. Storefront UI.
4. Analytics API and dashboard (definitions in `docs/METRICS.md`).
5. ML service: content, CF, hybrid, cold start, evaluation against baselines (`docs/ML.md`).
6. BI: RFM, k-means (gated on silhouette), forecasting with backtest, demand, affinity, and abandonment.
7. Tests across all three packages, plus README and API docs.
