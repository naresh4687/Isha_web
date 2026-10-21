# Recommendation engine & BI: methods and results

Code lives in `ml/app/`. `models.py` holds the components, `hybrid.py` the ranking, `evaluation.py` the offline evaluation, `bi/` the segmentation and forecasting, and `api.py` the service.

## Data

| Signal | Source | Notes |
|---|---|---|
| Product content | `products`, `categories`, default variant price | Title, description, tags, category, subcategory, attribute values, price |
| Views, wishlist, cart | `events` (consented visitors only) | User key = account id, else `v:<visitor id>` |
| Purchases | `orders` + `order_items` with `paid_at`, excluding cancelled | Never taken from client events |
| Ratings | `reviews` | Shift the signal by `(rating − 3) × rating_scale` |

## Components

1. **Content**: TF-IDF over title ×2, tags ×2, subcategory, category, description and attribute values. Unigrams and bigrams, sublinear TF, English stop words.
   - The text vector is concatenated with one-hot category (weight 0.6), subcategory (0.4) and log-price quantile bands (0.3, with neighbouring bands at half weight), then L2-normalised. Similarity is cosine.
   - Rationale: text carries most of the meaning, the category features anchor results within a collection, and price bands keep suggestions in a comparable range.
2. **Item-item CF**: a user × item matrix of `log1p(Σ interaction weight)`.
   - Similarity is column-normalised cosine, shrunk by `n / (n + 10)`, where n is the number of users who engaged with both items. Only the top 30 neighbours per item are kept.
   - A user's score is their decayed history vector times the similarity matrix.
3. **Popularity / trending**: interaction weight × exponential decay (half-life 7 days) over the last 30 days.
4. **Co-purchase**: pairs appearing together in ≥3 non-cancelled orders, with support, confidence and lift.
   - "Frequently bought together" returns only pairs with lift > 1, and is **empty** when no pair qualifies. It is never fabricated.

## Hybrid ranking

1. Each component is min-max normalised over the eligible candidate set for that request.
2. Score = Σ wᶜ · normᶜ over cf, content, category affinity (history share plus declared preferences), trending and recency (exp(−age/30d)).
3. Weights are configurable (`ML_HYBRID_WEIGHTS`). Production uses the weights chosen on validation, and only if they beat the defaults there.

**Eligibility** (enforced in the ML service and again in the backend):
- active product;
- stock > 0, refreshed from the database every 60 s;
- not something the shopper already interacted with (for "recommended for you");
- not the anchor product (for similar items and frequently bought together).

**Reasons** are the two largest weighted components, mapped to customer-facing text such as "Shoppers who liked your picks also liked this".

### Cold start
- **New shopper** (no history): popularity 0.55, recency 0.15, plus category preferences 0.3 if declared.
  - Preferences come from the account, or from the home-page picker stored on the device.
  - Current-session views count as history: consented server events, plus a recently-viewed list kept in localStorage and sent as `recent=`.
- **New product**: "similar products" uses content only until at least 5 distinct users have engaged with it.

## Evaluation protocol (`python -m app.train`)

1. **Split**: temporal. The cutoff is the 80th-percentile interaction timestamp; models only see earlier data.
2. **Test cases**: users with history before the cutoff and an add-to-cart or purchase afterwards on an item they had not touched before. Seen items are excluded from ranking.
3. **Tuning**: interaction-weight schemes and a 162-point grid of hybrid weights are compared on a validation split carved from the training period. The test period is never used for choices.
4. **Metrics**: Precision@K, Recall@K, NDCG@K (binary relevance), hit rate, catalog coverage, intra-list diversity (1 − mean pairwise content cosine) and category diversity.
5. **Significance**: paired bootstrap over test users (2,000 resamples) gives a 95% CI for the NDCG@10 difference. "Better" means the CI excludes 0.
6. **Reproducibility**: deterministic, with no random sampling except the seeded bootstrap. Covered by `ml/tests/test_evaluation.py::test_evaluation_is_reproducible…`.

### Latest results (`ml/artifacts/report-v20261021-062534.json`)

**The data is 100% synthetic** (`npm run seed:demo`, seed 7). The generator plants per-user category preferences, Zipf-like product appeal and fixed complement bundles. These results show the models recover that planted structure. They are **not** evidence of real-world performance.

- Dataset: 64,151 interactions from 7,504 user keys (most are anonymous visitors) over 70 products, 2026-04-24 → 2026-10-21. Cutoff 2026-09-23.
- Train/test: 51,321 / 12,830 interactions; **117 warm test users** and 1,004 cold-start test users.

| Model | P@10 | R@10 | NDCG@10 | Hit rate | Coverage | ILD | P@5 | NDCG@5 |
|---|---|---|---|---|---|---|---|---|
| popularity | 0.094 | 0.447 | 0.276 | 0.684 | 0.300 | 0.938 | 0.113 | 0.206 |
| content only | 0.101 | 0.434 | 0.262 | 0.632 | 1.000 | 0.866 | 0.118 | 0.188 |
| cf only | 0.128 | 0.567 | 0.388 | 0.769 | 0.843 | 0.916 | 0.176 | 0.317 |
| hybrid (default weights) | 0.126 | 0.559 | 0.388 | 0.744 | 1.000 | 0.893 | 0.174 | 0.322 |
| hybrid (tuned weights) | 0.133 | 0.596 | 0.409 | 0.778 | 0.843 | 0.921 | 0.185 | 0.339 |

Paired bootstrap, ΔNDCG@10 with 95% CI:
- Tuned hybrid vs popularity: +0.133 [+0.081, +0.185]. **Better.**
- CF only vs popularity: +0.113 [+0.052, +0.170]. **Better.**
- Tuned hybrid vs CF only: +0.020 [+0.001, +0.041]. **Better, but marginal.**
  - The lower bound barely clears zero, and it is one of five comparisons made without multiple-comparison correction. Treat it as weak evidence.
- Default hybrid vs CF only: −0.000 [−0.023, +0.025]. No significant difference.
  - Default weights do buy full catalogue coverage (1.00 vs 0.84).

**Interaction weights**: the schemes were compared on validation NDCG@10 (hybrid). The selection mechanically picks the highest score, but the evidence is weak:
- uniform 0.354, default (1/3/4/8) 0.355, purchase-heavy (1/2/3/15) 0.356 are within 0.002 of each other, so differentiated weights have **no measurable effect** on this data.
- intent-only (ignoring views) scored 0.305, so dropping views clearly hurts.
- The scheme selected for production was purchase-heavy.

**Cold start**: for the 1,004 cold-start users, the cold-start strategy (popularity + recency) produced the same NDCG@10 as pure popularity (0.229). The recency term did not change the top 10 here.

### Online metrics
After deployment, CTR and purchase conversion per placement are computed from `rec_impression` and `rec_click` events (see `docs/METRICS.md`). No real traffic has been recorded yet.

## BI modules

| Module | Method | Guardrails |
|---|---|---|
| RFM (`bi/segments.py`) | R = days since last paid order (quintile); F = order count bands 1/2/3/4–5/6+; M = net sales (quintile); rule-based segment names and suggested actions | Requires ≥20 customers. Returns aggregates only, no customer PII. |
| K-means | log1p and standardised RFM, k = 2..6, choose by silhouette | Reported as valid only if silhouette ≥ 0.25, stability (mean ARI over 5 seeds) ≥ 0.8 and n ≥ 50. Otherwise the UI says to use RFM. |
| Forecast (`bi/forecast.py`) | Seasonal naive, 28-day moving average, ridge (trend + day of week); selected by rolling-origin backtest (4 × 7-day folds, WAPE) | Empirical 80% interval from backtest errors. Needs ≥56 days of history. Limitations listed in the output. |
| Demand | 28-day mean and SD of daily units; reorder point = μL + 1.28σ√L (L = 14 days); suggested quantity covers 30 days | Assumes stationary demand. Stock-outs understate demand. |
| Affinity | Co-purchase rules: support, confidence, lift (≥3 orders, lift > 1) | Labelled "co-occurrence, not causation". |

No recommendation or insight makes health or medical claims. The Health and Immunity category carries a non-medical disclaimer.
