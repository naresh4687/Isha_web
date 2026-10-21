-- Core schema. All money is stored as integer paise (INR * 100).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- array_to_string is STABLE; this wrapper is safe for text[] and lets us use it in a generated column.
CREATE FUNCTION immutable_tags_text(text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT array_to_string($1, ' ') $$;

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  is_public boolean NOT NULL DEFAULT false
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  category_prefs text[] NOT NULL DEFAULT '{}',
  acquisition_source text,
  marketing_consent boolean NOT NULL DEFAULT false,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id serial PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  subcategories text[] NOT NULL DEFAULT '{}',
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL,
  category_id int NOT NULL REFERENCES categories(id),
  subcategory text,
  tags text[] NOT NULL DEFAULT '{}',
  attributes jsonb NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  is_demo boolean NOT NULL DEFAULT false,
  rating_avg numeric(3,2) NOT NULL DEFAULT 0,
  rating_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(immutable_tags_text(tags), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) STORED
);
CREATE INDEX products_category_idx ON products(category_id);
CREATE INDEX products_search_idx ON products USING gin(search_vector);
CREATE INDEX products_title_trgm_idx ON products USING gin(title gin_trgm_ops);

-- Inventory lives on variants; every product has at least one (the default) variant.
CREATE TABLE product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT 'Standard',
  price_paise int NOT NULL CHECK (price_paise > 0),
  compare_at_paise int CHECK (compare_at_paise IS NULL OR compare_at_paise > 0),
  stock int NOT NULL DEFAULT 0 CHECK (stock >= 0),
  is_default boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0
);
CREATE INDEX product_variants_product_idx ON product_variants(product_id);

CREATE TABLE inventory_adjustments (
  id bigserial PRIMARY KEY,
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  delta int NOT NULL,
  reason text NOT NULL CHECK (reason IN ('admin', 'order_reserved', 'order_released', 'restock', 'seed')),
  order_id uuid,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  visitor_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR visitor_id IS NOT NULL)
);

CREATE TABLE cart_items (
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity int NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cart_id, variant_id)
);

CREATE TABLE wishlist_items (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text NOT NULL,
  line1 text NOT NULL,
  line2 text,
  city text NOT NULL,
  state text NOT NULL,
  postal_code text NOT NULL,
  country text NOT NULL DEFAULT 'IN',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE discount_codes (
  code citext PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('percent', 'fixed')),
  value int NOT NULL CHECK (value > 0),
  min_subtotal_paise int NOT NULL DEFAULT 0,
  max_uses int,
  used_count int NOT NULL DEFAULT 0,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  CHECK (kind <> 'percent' OR value <= 90)
);

-- Analytics sessions: a 30-minute inactivity window, recorded only with analytics consent.
CREATE TABLE analytics_sessions (
  id text PRIMARY KEY,
  visitor_id text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'direct',
  medium text,
  campaign text,
  landing_path text,
  device text CHECK (device IN ('mobile', 'tablet', 'desktop')),
  is_demo boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_sessions_started_idx ON analytics_sessions(started_at);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number bigserial UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN
    ('pending_payment', 'payment_failed', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded')),
  subtotal_paise int NOT NULL CHECK (subtotal_paise >= 0),
  discount_paise int NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  shipping_paise int NOT NULL DEFAULT 0 CHECK (shipping_paise >= 0),
  total_paise int NOT NULL CHECK (total_paise >= 0),
  refunded_paise int NOT NULL DEFAULT 0 CHECK (refunded_paise >= 0),
  discount_code citext,
  shipping_address jsonb NOT NULL,
  analytics_session_id text,
  acquisition_source text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  CHECK (total_paise = subtotal_paise - discount_paise + shipping_paise),
  CHECK (refunded_paise <= total_paise)
);
CREATE INDEX orders_user_idx ON orders(user_id);
CREATE INDEX orders_paid_at_idx ON orders(paid_at);
CREATE INDEX orders_status_idx ON orders(status);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  variant_id uuid NOT NULL REFERENCES product_variants(id),
  title text NOT NULL,
  variant_name text NOT NULL,
  unit_price_paise int NOT NULL CHECK (unit_price_paise > 0),
  quantity int NOT NULL CHECK (quantity > 0),
  line_total_paise int NOT NULL,
  CHECK (line_total_paise = unit_price_paise * quantity)
);
CREATE INDEX order_items_order_idx ON order_items(order_id);
CREATE INDEX order_items_product_idx ON order_items(product_id);

-- No card data is ever stored; only provider references and status.
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('razorpay', 'mock')),
  provider_order_id text,
  provider_payment_id text,
  status text NOT NULL CHECK (status IN ('created', 'captured', 'failed', 'refunded')),
  amount_paise int NOT NULL,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_provider_order_idx ON payments(provider, provider_order_id);

CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title text NOT NULL,
  body text NOT NULL,
  verified_purchase boolean NOT NULL DEFAULT false,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, user_id)
);

-- Behavioural events (consented only). Purchases are read from orders, not from here.
CREATE TABLE events (
  id bigserial PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN (
    'page_view', 'product_view', 'search', 'add_to_wishlist', 'remove_from_wishlist',
    'add_to_cart', 'remove_from_cart', 'begin_checkout', 'rec_impression', 'rec_click')),
  visitor_id text NOT NULL,
  session_id text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  quantity int,
  placement text,
  metadata jsonb NOT NULL DEFAULT '{}',
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_created_idx ON events(created_at);
CREATE INDEX events_session_idx ON events(session_id);
CREATE INDEX events_user_idx ON events(user_id, created_at);
CREATE INDEX events_product_idx ON events(product_id, event_type);

CREATE TABLE model_versions (
  id serial PRIMARY KEY,
  kind text NOT NULL,
  params jsonb NOT NULL,
  metrics jsonb NOT NULL,
  dataset jsonb NOT NULL,
  artifact_path text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  email citext NOT NULL,
  name text NOT NULL,
  subject text NOT NULL,
  message text NOT NULL,
  order_number bigint,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cart_recovery_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'contacted', 'recovered', 'dismissed')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id)
);
