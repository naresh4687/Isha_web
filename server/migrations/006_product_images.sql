-- Product photography. Ordered list; the first entry is the canonical image used on every surface
-- (cards, search, recommendations, cart, orders, admin). Each entry:
--   { "src": "/assets/products/...-800.webp", "alt": "...", "width": 800, "height": 800,
--     "credit": { "author", "license", "licenseUrl", "sourceUrl" } | null }
-- An empty list means "no photo yet": the API falls back to the generated illustration.
ALTER TABLE products ADD COLUMN images jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(images) = 'array');
