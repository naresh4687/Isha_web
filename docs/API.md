# API reference

The base path is `/api`.

**Request rules**
- Responses are JSON.
- Every non-GET request must send `X-Requested-With: fetch` (CSRF guard). The Razorpay webhook is the only exception.
- Auth is an httpOnly `auth` cookie holding a 7-day JWT. The role is re-read from the database on every request.

**Errors** have the shape `{ "error": { "code", "message", "details?" } }`.
- Validation errors return 400 with `details.fieldErrors`.
- 401 means unauthenticated and 403 means forbidden.
- 409 means a business conflict, e.g. `insufficient_stock` or `duplicate_review`.
- 503 means payments or the ML service is unavailable.

All money is integer **paise**.

## Auth
| Method | Path | Body / notes |
|---|---|---|
| POST | `/auth/register` | `{name, email, password, marketingConsent?, categoryPrefs?}`. Password needs ≥8 characters with a letter and a digit. Merges the guest cart. Rate limited (20 per 15 min). |
| POST | `/auth/login` | `{email, password}`. Merges the guest cart. Rate limited. |
| POST | `/auth/logout` | Signs out this browser |
| POST | `/auth/logout-all` | Auth. Revokes every session for the account (increments `token_version`). |
| POST | `/auth/password` | Auth. `{currentPassword, newPassword}`. Keeps this session and revokes all others. Rate limited. |
| GET | `/auth/me` | `{user \| null}` |
| PATCH | `/auth/me` | `{name?, categoryPrefs?, marketingConsent?}` |

## Catalog
| Method | Path | Notes |
|---|---|---|
| GET | `/categories` | Taxonomy with subcategories and counts |
| GET | `/products` | `q, category, subcategory, tag, minPrice, maxPrice` (rupees), `inStock, minRating, sort` (`relevance\|newest\|price_asc\|price_desc\|rating\|bestselling`), `page, pageSize` (≤48), `ids` (comma-separated UUIDs). Search is full-text with typo tolerance (trigram word similarity). |
| GET | `/products/:slugOrId` | Detail: variants with availability, gallery, attributes, rating distribution |
| GET | `/products/:id/reviews` | `page, pageSize, sort=recent\|highest\|lowest`. Author is shown as first name plus last initial. |
| POST | `/products/:id/reviews` | Auth. `{rating 1–5, title 3–120, body 10–2000}`, plain text only. One review per user. `verifiedPurchase` is set automatically. |
| GET | `/settings/public` | Brand name and announcement |
| GET | `/media/products/:slug/:0-3.svg` | Generated product art (not under `/api`) |

## Cart & wishlist
| Method | Path | Notes |
|---|---|---|
| GET | `/cart?discountCode=` | Lines, totals, discount validation message, `hasUnavailable` |
| POST | `/cart/items` | `{variantId, quantity 1–20}`. Adds to the existing line. 409 if over stock. |
| PATCH | `/cart/items/:variantId` | `{quantity 0–20}` (0 removes the line) |
| DELETE | `/cart/items/:variantId` | |
| GET / POST / DELETE | `/wishlist`, `/wishlist/:productId` | Auth |

Guest carts are keyed by the `vid` cookie and merged into the account on sign-in.

## Checkout, payments, orders
| Method | Path | Notes |
|---|---|---|
| GET | `/checkout/config` | Payment availability and test-mode flags, Indian states and UTs, shipping rules |
| POST | `/checkout` | Auth. `{address{fullName, phone, line1, line2?, city, state, postalCode}, discountCode?, saveAddress?}`. See below. |
| POST | `/payments/razorpay/verify` | Auth. `{orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature}`, verified with HMAC-SHA256 |
| POST | `/payments/razorpay/webhook` | Server-to-server. Raw body verified with `X-Razorpay-Signature`. Handles `payment.captured`, `order.paid` and `payment.failed`. |
| POST | `/payments/failure` | Auth. Client-reported dismissal or failure. Can only move a pending order to failed. |
| POST | `/payments/mock/complete` | Dev only (`PAYMENT_PROVIDER=mock`, not production). `{orderId, outcome: success\|failure}`. Only acts on pending orders. |
| GET | `/orders`, `/orders/:id` | Auth. A customer sees only their own orders. Detail includes per-line refunds, `returns`, `returnWindowOpen` and `tax` (GST breakdown, or null if rates are not configured). |
| POST | `/orders/:id/cancel` | Auth. Allowed before shipment. A paid order is refunded in full and restocked. |
| POST | `/orders/:id/returns` | Auth. `{items[{orderItemId, quantity}], reason 10–500}`. Delivered orders within 7 days; food and botanicals are non-returnable; quantities are checked against bought − refunded − pending. |
| GET | `/addresses` | Auth. Saved addresses. |

`POST /checkout` validates the 6-digit PIN code and the Indian mobile number. It then:
- reserves stock with a conditional decrement;
- creates a `pending_payment` order;
- creates a provider order and returns `{orderId, orderNumber, totals, payment{provider, testMode, providerOrderId, keyId?, amountPaise}}`.

It returns 503 if payments are not configured. Pending reservations expire after 30 minutes, and starting a new checkout releases the previous one.

## Events
`POST /events` takes `{context{source, medium?, campaign?, landingPath?, device?}, events[1..25]{type, productId?, quantity?, placement?, metadata{path?, q?, position?, resultCount?, modelVersion?}}}`.
- Strict schema: unknown fields, unknown product ids and invalid types return 400.
- Without the `consent=analytics` cookie it returns `202 {accepted: 0, reason: "no_consent"}` and stores nothing.
- `purchase` cannot be sent by clients.
- Rate limited to 120 per minute per visitor.

## Recommendations
All return `{placement, source: model|fallback|client_history, strategy, modelVersion, items[{product, position, score, reasons[]}]}`. Only eligible products are returned (active and in stock).

| Method | Path | Notes |
|---|---|---|
| GET | `/recommendations/personalized` | `k, recent` (recently viewed ids), `categories`. Uses account and consented session history. Cold-start strategy when there is no history. |
| GET | `/recommendations/products/:id/similar` | Content + CF; content only for new products |
| GET | `/recommendations/products/:id/frequently-bought-together` | Empty unless co-purchase support ≥3 orders |
| GET | `/recommendations/trending` | `k, category` |
| GET | `/recommendations/continue-exploring` | Unseen items from recently browsed categories |
| GET | `/recommendations/recently-viewed` | `ids` (client-side history), hydrated in order |

If the ML service is unreachable, `similar` falls back to the same category and `trending`/`personalized` fall back to SQL popularity (`source: "fallback"`). Frequently-bought-together returns nothing.

## Admin (role `admin`; 401 or 403 otherwise)
| Method | Path |
|---|---|
| GET | `/admin/analytics/overview?from&to&granularity=day\|week\|month&category&productId&includeDemo` |
| GET | `/admin/analytics/products`, `/admin/analytics/inventory` |
| GET | `/admin/analytics/export/:report.csv` (summary, trend, categories, products, inventory, discounts, sources) |
| GET | `/admin/ml/model` (evaluation report), `/admin/ml/online-metrics?days` |
| GET | `/admin/ml/bi/{rfm,segments,forecast,demand,affinity}` |
| GET / POST / PUT | `/admin/products`, `/admin/products/:id` (stock changes are rejected here; use the adjust endpoint) |
| POST | `/admin/inventory/adjust` `{variantId, delta, reason: admin\|restock}` (audited in `inventory_adjustments`) |
| GET | `/admin/orders?status&q&page` |
| POST | `/admin/orders/:id/status` `{action: ship\|deliver\|cancel\|refund, restock?}` (`refund` = everything not yet refunded) |
| POST | `/admin/orders/:id/refunds` `{items[{orderItemId, quantity}], reason, restock?}` (partial refund; amount computed server-side; shipping refunded with the last unit) |
| GET | `/admin/returns?status=requested\|refunded\|rejected` |
| POST | `/admin/returns/:id/approve` `{restock?}`, `/admin/returns/:id/reject` `{note}` (decisions are final) |
| GET / PUT | `/admin/tax-rates` `{rates[{slug, gstRateBps \| null}]}` (GST per category, snapshotted onto orders at checkout) |
| GET / PUT | `/admin/discounts` |
| GET / POST | `/admin/support`, `/admin/support/:id/close` |
| POST / GET / PATCH | `/admin/cart-recovery/refresh`, `/admin/cart-recovery`, `/admin/cart-recovery/:id` |

## Internal ML service (port 8001; `X-Service-Token` required except `/health`)
- `GET /health`
- `GET /v1/recommend/{personalized, continue, similar/:id, fbt/:id, trending}`
- `GET /v1/model`, `POST /v1/model/reload`
- `GET /v1/bi/{rfm, segments, forecast, demand, affinity}`

Bind it to localhost or a private network only.
