-- Esquema PostgreSQL inicial. Diseño propio (ver docs/EVIDENCIA.md).
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  address     text,
  comuna      text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE user_role AS ENUM ('admin', 'manager', 'cashier');

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid REFERENCES branches(id),
  rut           text NOT NULL UNIQUE,
  name          text NOT NULL,
  email         text UNIQUE,
  role          user_role NOT NULL,
  password_hash text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         text NOT NULL UNIQUE,
  barcode     text UNIQUE,
  name        text NOT NULL,
  description text,
  price_clp   integer NOT NULL CHECK (price_clp >= 0),  -- CLP sin decimales, IVA incluido
  published   boolean NOT NULL DEFAULT false,            -- visible en catálogo online
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE sales_channel AS ENUM ('physical', 'online');

-- Inventario por sucursal y canal. "reserved" cubre carritos online en checkout.
CREATE TABLE inventory_levels (
  branch_id  uuid NOT NULL REFERENCES branches(id),
  product_id uuid NOT NULL REFERENCES products(id),
  channel    sales_channel NOT NULL,
  quantity   integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reserved   integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, product_id, channel),
  CHECK (reserved <= quantity)
);

CREATE TABLE stock_movements (
  id          bigserial PRIMARY KEY,
  branch_id   uuid NOT NULL REFERENCES branches(id),
  product_id  uuid NOT NULL REFERENCES products(id),
  channel     sales_channel NOT NULL,
  delta       integer NOT NULL,
  reason      text NOT NULL,           -- sale, return, adjustment, transfer
  ref_sale_id uuid,
  user_id     uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE sale_status AS ENUM ('open', 'paid', 'cancelled', 'refunded');

CREATE TABLE sales (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id  uuid NOT NULL REFERENCES branches(id),
  cashier_id uuid REFERENCES users(id),
  channel    sales_channel NOT NULL,
  status     sale_status NOT NULL DEFAULT 'open',
  total_clp  integer NOT NULL DEFAULT 0 CHECK (total_clp >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at    timestamptz
);

CREATE TABLE sale_items (
  id         bigserial PRIMARY KEY,
  sale_id    uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  quantity   integer NOT NULL CHECK (quantity > 0),
  unit_price_clp integer NOT NULL CHECK (unit_price_clp >= 0)
);

CREATE TYPE payment_provider AS ENUM ('cash', 'transbank', 'mercadopago', 'getnet');
CREATE TYPE payment_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

CREATE TABLE payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id      uuid NOT NULL REFERENCES sales(id),
  provider     payment_provider NOT NULL,
  status       payment_status NOT NULL DEFAULT 'pending',
  amount_clp   integer NOT NULL CHECK (amount_clp > 0),
  external_ref text,                   -- código de autorización del terminal/pasarela
  idempotency_key text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Documentos tributarios (boleta 39, factura 33, etc.)
CREATE TABLE tax_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id     uuid NOT NULL REFERENCES sales(id),
  dte_type    smallint NOT NULL,       -- 39 boleta, 33 factura
  folio       integer NOT NULL,
  xml         text,
  sii_status  text NOT NULL DEFAULT 'draft',
  sii_track_id text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dte_type, folio)
);

CREATE VIEW daily_reports AS
SELECT s.branch_id,
       s.channel,
       date_trunc('day', s.paid_at)::date AS day,
       count(*)                           AS sales_count,
       sum(s.total_clp)                   AS total_clp
FROM sales s
WHERE s.status = 'paid'
GROUP BY s.branch_id, s.channel, date_trunc('day', s.paid_at)::date;
