-- Sample data for the local ClickHouse dev container (database `demo`).
-- Runs once on first container start via /docker-entrypoint-initdb.d.

-- =================================================================
-- Canonical sample dataset (shared across every docker-compose engine)
-- Same tables, same primary keys, same rows everywhere so cross-source
-- federated joins line up. ClickHouse has no FKs; MergeTree tables are
-- ordered by their primary key.
-- =================================================================

CREATE TABLE IF NOT EXISTS demo.customers
(
    customer_id   UInt32,
    first_name    String,
    last_name     String,
    email         String,
    country_code  FixedString(2),
    signup_date   Date,
    updated_at    DateTime
)
ENGINE = MergeTree
ORDER BY customer_id;

CREATE TABLE IF NOT EXISTS demo.products
(
    product_id    UInt32,
    product_name  String,
    category      LowCardinality(String),
    price         Decimal(10, 2)
)
ENGINE = MergeTree
ORDER BY product_id;

CREATE TABLE IF NOT EXISTS demo.orders
(
    order_id      UInt32,
    customer_id   UInt32,
    order_date    Date,
    status        LowCardinality(String),
    amount        Decimal(10, 2)
)
ENGINE = MergeTree
ORDER BY order_id;

CREATE TABLE IF NOT EXISTS demo.order_items
(
    order_item_id UInt32,
    order_id      UInt32,
    product_id    UInt32,
    quantity      UInt32,
    unit_price    Decimal(10, 2)
)
ENGINE = MergeTree
ORDER BY order_item_id;

INSERT INTO demo.customers (customer_id, first_name, last_name, email, country_code, signup_date, updated_at) VALUES
    (1,  'Ada',       'Lovelace',     'ada@example.com',       'GB', '2025-01-01', '2025-01-01 09:00:00'),
    (2,  'Grace',     'Hopper',       'grace@example.com',     'US', '2025-01-02', '2025-01-02 09:00:00'),
    (3,  'Katherine', 'Johnson',      'katherine@example.com', 'US', '2025-01-03', '2025-01-03 09:00:00'),
    (4,  'Radia',     'Perlman',      'radia@example.com',     'CA', '2025-01-04', '2025-01-04 09:00:00'),
    (5,  'Margaret',  'Hamilton',     'margaret@example.com',  'US', '2025-01-05', '2025-01-05 09:00:00'),
    (6,  'Barbara',   'Liskov',       'barbara@example.com',   'US', '2025-01-06', '2025-01-06 09:00:00'),
    (7,  'Joan',      'Clarke',       'joan@example.com',      'GB', '2025-01-07', '2025-01-07 09:00:00'),
    (8,  'Karen',     'Sparck-Jones', 'karen@example.com',     'GB', '2025-01-08', '2025-01-08 09:00:00'),
    (9,  'Shafi',     'Goldwasser',   'shafi@example.com',     'US', '2025-01-09', '2025-01-09 09:00:00'),
    (10, 'Frances',   'Allen',        'frances@example.com',   'CA', '2025-01-10', '2025-01-10 09:00:00'),
    (11, 'Lynn',      'Conway',       'lynn@example.com',      'AU', '2025-01-11', '2025-01-11 09:00:00'),
    (12, 'Sophie',    'Wilson',       'sophie@example.com',    'DE', '2025-01-12', '2025-01-12 09:00:00');

INSERT INTO demo.products (product_id, product_name, category, price) VALUES
    (1, 'Mechanical Keyboard',          'Peripherals', 129.00),
    (2, 'Wireless Mouse',               'Peripherals', 49.00),
    (3, 'USB-C Hub',                    'Accessories', 35.00),
    (4, '27in Monitor',                 'Displays',    299.00),
    (5, 'Laptop Stand',                 'Accessories', 42.00),
    (6, 'Webcam 1080p',                 'Peripherals', 69.00),
    (7, 'Noise-Cancelling Headphones',  'Audio',       199.00),
    (8, 'Desk Mat',                     'Accessories', 19.00);

INSERT INTO demo.orders (order_id, customer_id, order_date, status, amount) VALUES
    (100, 1,  '2025-01-03', 'completed', 129.00),
    (101, 1,  '2025-01-15', 'shipped',   49.00),
    (102, 2,  '2025-01-04', 'completed', 299.00),
    (103, 3,  '2025-01-05', 'pending',   35.00),
    (104, 4,  '2025-01-06', 'returned',  42.00),
    (105, 5,  '2025-01-07', 'completed', 69.00),
    (106, 6,  '2025-01-08', 'completed', 199.00),
    (107, 7,  '2025-01-09', 'shipped',   19.00),
    (108, 2,  '2025-01-12', 'completed', 129.00),
    (109, 8,  '2025-01-14', 'cancelled', 49.00),
    (110, 9,  '2025-01-16', 'completed', 299.00),
    (111, 10, '2025-01-18', 'shipped',   35.00),
    (112, 11, '2025-01-20', 'completed', 42.00),
    (113, 12, '2025-01-22', 'pending',   69.00),
    (114, 1,  '2025-01-25', 'completed', 199.00),
    (115, 3,  '2025-01-27', 'completed', 19.00),
    (116, 5,  '2025-02-01', 'shipped',   129.00),
    (117, 6,  '2025-02-03', 'completed', 49.00),
    (118, 7,  '2025-02-05', 'returned',  299.00),
    (119, 9,  '2025-02-07', 'completed', 35.00),
    (120, 2,  '2025-02-09', 'completed', 42.00),
    (121, 4,  '2025-02-11', 'shipped',   69.00),
    (122, 8,  '2025-02-13', 'completed', 199.00),
    (123, 10, '2025-02-15', 'pending',   19.00),
    (124, 11, '2025-02-17', 'completed', 129.00),
    (125, 12, '2025-02-19', 'shipped',   49.00),
    (126, 1,  '2025-02-21', 'completed', 299.00),
    (127, 5,  '2025-02-23', 'cancelled', 35.00),
    (128, 6,  '2025-02-25', 'completed', 42.00),
    (129, 3,  '2025-02-27', 'completed', 69.00);

INSERT INTO demo.order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES
    (1,  100, 1, 1, 129.00),
    (2,  101, 2, 1, 49.00),
    (3,  102, 4, 1, 299.00),
    (4,  103, 3, 1, 35.00),
    (5,  104, 5, 1, 42.00),
    (6,  105, 6, 1, 69.00),
    (7,  106, 7, 1, 199.00),
    (8,  107, 8, 1, 19.00),
    (9,  108, 1, 1, 129.00),
    (10, 109, 2, 1, 49.00),
    (11, 110, 4, 1, 299.00),
    (12, 111, 3, 1, 35.00),
    (13, 112, 5, 1, 42.00),
    (14, 113, 6, 1, 69.00),
    (15, 114, 7, 1, 199.00),
    (16, 115, 8, 1, 19.00),
    (17, 116, 1, 1, 129.00),
    (18, 117, 2, 1, 49.00),
    (19, 118, 4, 1, 299.00),
    (20, 119, 3, 1, 35.00),
    (21, 120, 5, 1, 42.00),
    (22, 121, 6, 1, 69.00),
    (23, 122, 7, 1, 199.00),
    (24, 123, 8, 1, 19.00),
    (25, 124, 1, 1, 129.00),
    (26, 125, 2, 1, 49.00),
    (27, 126, 4, 1, 299.00),
    (28, 127, 3, 1, 35.00),
    (29, 128, 5, 1, 42.00),
    (30, 129, 6, 1, 69.00),
    (31, 100, 8, 2, 19.00),
    (32, 102, 2, 1, 49.00),
    (33, 106, 3, 1, 35.00),
    (34, 110, 5, 2, 42.00),
    (35, 114, 8, 1, 19.00),
    (36, 122, 2, 1, 49.00),
    (37, 126, 1, 1, 129.00);

-- =================================================================
-- A plain view and a materialized view to populate the schema browser.
-- =================================================================

CREATE VIEW IF NOT EXISTS demo.completed_orders AS
    SELECT order_id, customer_id, amount FROM demo.orders WHERE status = 'completed';

CREATE MATERIALIZED VIEW IF NOT EXISTS demo.revenue_by_customer
ENGINE = SummingMergeTree
ORDER BY customer_id
AS SELECT customer_id, sum(amount) AS total
   FROM demo.orders
   WHERE status = 'completed'
   GROUP BY customer_id;
