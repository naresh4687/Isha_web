# Metric definitions

Every number on the admin analytics dashboard is computed in `server/src/modules/analytics/service.ts`, directly from the `orders`, `order_items`, `analytics_sessions` and `events` tables. The fixture in `server/tests/analytics.test.ts` checks the definitions against hand-computed values.

## Conventions (apply to every metric)

| Topic | Rule |
|---|---|
| Time zone | `Asia/Kolkata`. A range `from..to` includes both calendar days. |
| Order date | `orders.paid_at`. Orders that never completed payment (`pending_payment`, `payment_failed` without `paid_at`) are excluded everywhere. |
| Money | Integer paise. Prices include GST; tax is not reported separately. |
| Shipping | Excluded from GMV, net sales and AOV. |
| Refund timing | A refund is attributed to the original order's `paid_at` date, not the refund date. Past periods can therefore change as refunds arrive. |
| Refund amount | Refunds are recorded per order line (`order_items.refunded_paise`), so partial refunds and returns hit only the refunded product and category. Refunded shipping is not merchandise and is excluded. |
| Category/product filters | Discounts are allocated to order lines pro rata by line value, and refunds are already per line. Filtered values therefore add up exactly to the unfiltered totals, with no double counting. |
| Demo data | Rows with `is_demo = true` are included unless `includeDemo=false`. The dashboard shows a banner whenever demo rows are present. |
| Previous period | The window of equal length immediately before `from`. It is used for deltas and retention. |

## Sales

| Metric | Numerator | Denominator | Notes |
|---|---|---|---|
| **GMV** | Σ `line_total_paise` (unit price × qty) of lines in paid orders | — | Before discounts and refunds. Includes orders later cancelled or refunded. |
| **Discounts** | Σ allocated `discount_paise` | — | |
| **Refunds** | Σ `order_items.refunded_paise` | — | Merchandise only. A line's refund for k of n units = round(line net × k / n), so the parts sum exactly to the line net. |
| **Net sales** | GMV − discounts − refunds | — | |
| **Orders** | Distinct paid orders (containing ≥1 matching line when filtered) | — | |
| **Completed orders** | Orders currently `delivered` | — | |
| **Cancelled / refunded orders** | Orders currently `cancelled` or `refunded` (fully refunded) | — | Partially refunded orders keep their fulfilment status. |
| **AOV** | GMV − discounts | Orders | Value at checkout, before later refunds. |
| **Discounted order share** | Orders with a discount code | Orders | |

## Funnel (store-wide; category and product filters do not apply)

Sessions exist only for visitors who accepted analytics cookies. A session ends after 30 minutes of inactivity.

| Metric | Numerator | Denominator |
|---|---|---|
| **Conversion rate** | Sessions started in range with ≥1 paid order whose `analytics_session_id` is that session | Sessions started in range |
| **Cart abandonment rate** | Sessions with an `add_to_cart` event and no paid order in that session | Sessions with an `add_to_cart` event |
| **Source conversion** | Same as conversion, grouped by `analytics_sessions.source` | — |

Limitation: a purchase completed in a later session counts as abandonment in the earlier session.

## Customers (store-wide)

| Metric | Definition |
|---|---|
| **Purchasers** | Distinct users with a paid order in range |
| **New customers** | Purchasers whose first-ever paid order is in range |
| **Returning customers** | Purchasers − new customers |
| **Repeat purchase rate** | Purchasers with ≥2 paid orders up to the end of the range, divided by purchasers |
| **Retention rate** | Users who purchased in the previous period *and* in this range, divided by previous-period purchasers |

## Products & inventory

| Metric | Definition |
|---|---|
| **Views / add-to-carts** | Count of `product_view` / `add_to_cart` events in range (consented visitors only) |
| **View → order rate** | Paid orders containing the product, divided by `product_view` events, both in range |
| **Top sellers** | Products with units > 0, sorted by net sales |
| **Underperformers (low conversion)** | Active products with views ≥ max(10, median views of viewed products) whose view→order rate is in the bottom quartile of that group |
| **No sales** | Active products with 0 units in range |
| **Low stock** | Variant stock between 1 and `LOW_STOCK_THRESHOLD` (default 5) |
| **Days of cover** | Stock ÷ (units sold in the last 28 days, excluding cancelled and refunded orders, ÷ 28). Not defined when nothing sold. |

## Discounts

Per-code orders, GMV, discount and AOV. The dashboard also compares AOV for orders with and without a code. This is **associational only**: minimum-spend codes select for larger baskets, so the comparison does not show that discounts grow baskets.

## Recommendation online metrics (`/api/admin/ml/online-metrics`)

| Metric | Numerator | Denominator |
|---|---|---|
| **CTR** | `rec_click` events | `rec_impression` events (one per product shown when a rail first becomes ≥30% visible) |
| **Purchase conversion** | Clicks followed within 24h by a paid order in the same session that contains the clicked product | Clicks |

## Exports

`GET /api/admin/analytics/export/{summary|trend|categories|products|inventory|discounts|sources}.csv` uses the same filters. The first line of each CSV states the range and units, and whether demo rows are included. Cells starting with `= + - @` are prefixed with `'` to prevent spreadsheet formula injection.
