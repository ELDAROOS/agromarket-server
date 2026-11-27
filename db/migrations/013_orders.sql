BEGIN;

ALTER TABLE products ADD COLUMN IF NOT EXISTS stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0);
ALTER TABLE products ADD COLUMN IF NOT EXISTS farmer_id integer REFERENCES users(id);

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conrelid = 'users'::regclass AND conname = 'users_market_role_check'
    ) THEN
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
        ALTER TABLE users ADD CONSTRAINT users_market_role_check CHECK (role IN ('user', 'admin', 'farmer'));
    END IF;
END;
$migration$;

-- Existing orders stores wholesale requests. Keep its data and API intact.
CREATE TABLE IF NOT EXISTS checkout_orders (
    id serial PRIMARY KEY,
    buyer_id integer NOT NULL REFERENCES users(id),
    status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'confirmed', 'shipped', 'cancelled')),
    total bigint NOT NULL CHECK (total > 0),
    address text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
    order_id integer NOT NULL REFERENCES checkout_orders(id) ON DELETE CASCADE,
    product_id integer NOT NULL REFERENCES products(id),
    quantity integer NOT NULL CHECK (quantity > 0),
    price integer NOT NULL CHECK (price >= 0),
    PRIMARY KEY (order_id, product_id)
);

CREATE INDEX IF NOT EXISTS checkout_orders_buyer_id_idx ON checkout_orders (buyer_id);
CREATE INDEX IF NOT EXISTS order_items_product_id_idx ON order_items (product_id);
CREATE INDEX IF NOT EXISTS products_farmer_id_idx ON products (farmer_id);

COMMIT;
