-- Line-level refunds (partial refunds/returns) and customer return requests.
ALTER TABLE order_items
  ADD COLUMN refunded_quantity int NOT NULL DEFAULT 0,
  ADD COLUMN refunded_paise int NOT NULL DEFAULT 0,
  ADD CONSTRAINT order_items_refunded_quantity CHECK (refunded_quantity BETWEEN 0 AND quantity),
  ADD CONSTRAINT order_items_refunded_paise CHECK (refunded_paise BETWEEN 0 AND line_total_paise);

-- Backfill: every refund before this migration was a full refund, so each line's refund is its
-- merchandise value after its pro-rata share of the order discount.
UPDATE order_items oi
SET refunded_quantity = oi.quantity,
    refunded_paise = round((oi.line_total_paise
      - CASE WHEN o.subtotal_paise > 0 THEN o.discount_paise::numeric * oi.line_total_paise / o.subtotal_paise ELSE 0 END)
      * o.refunded_paise::numeric / o.total_paise)
FROM orders o
WHERE o.id = oi.order_id AND o.refunded_paise > 0 AND o.total_paise > 0;

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount_paise int NOT NULL CHECK (amount_paise > 0),
  shipping_paise int NOT NULL DEFAULT 0 CHECK (shipping_paise >= 0),
  items jsonb NOT NULL,
  reason text NOT NULL,
  restocked boolean NOT NULL DEFAULT false,
  provider_refund_id text,
  return_request_id uuid,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refunds_order_idx ON refunds(order_id);

CREATE TABLE return_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  items jsonb NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'refunded', 'rejected')),
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX return_requests_status_idx ON return_requests(status, created_at);
