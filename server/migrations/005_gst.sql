-- GST rate per category (basis points, e.g. 500 = 5%). NULL = not configured; set by the merchant
-- based on HSN classification. Order lines snapshot the rate at checkout.
ALTER TABLE categories ADD COLUMN gst_rate_bps int CHECK (gst_rate_bps BETWEEN 0 AND 4000);
ALTER TABLE order_items ADD COLUMN gst_rate_bps int CHECK (gst_rate_bps BETWEEN 0 AND 4000);
