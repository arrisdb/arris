-- =================================================================
-- Canonical sample dataset (shared across every docker-compose engine)
-- Same tables, same primary keys, same rows everywhere so cross-source
-- federated joins line up (e.g. postgres.orders ⋈ mysql.customers).
-- =================================================================

CREATE TABLE customers (
    customer_id   INTEGER PRIMARY KEY,
    first_name    VARCHAR(50) NOT NULL,
    last_name     VARCHAR(50) NOT NULL,
    email         VARCHAR(255) NOT NULL,
    country_code  CHAR(2) NOT NULL,
    signup_date   DATE NOT NULL,
    updated_at    TIMESTAMP NOT NULL
);

CREATE TABLE products (
    product_id    INTEGER PRIMARY KEY,
    product_name  VARCHAR(100) NOT NULL,
    category      VARCHAR(50) NOT NULL,
    price         DECIMAL(10,2) NOT NULL
);

CREATE TABLE orders (
    order_id      INTEGER PRIMARY KEY,
    customer_id   INTEGER NOT NULL REFERENCES customers(customer_id),
    order_date    DATE NOT NULL,
    status        VARCHAR(20) NOT NULL,
    amount        DECIMAL(10,2) NOT NULL
);

CREATE TABLE order_items (
    order_item_id INTEGER PRIMARY KEY,
    order_id      INTEGER NOT NULL REFERENCES orders(order_id),
    product_id    INTEGER NOT NULL REFERENCES products(product_id),
    quantity      INTEGER NOT NULL,
    unit_price    DECIMAL(10,2) NOT NULL
);

INSERT INTO customers (customer_id, first_name, last_name, email, country_code, signup_date, updated_at) VALUES
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

INSERT INTO products (product_id, product_name, category, price) VALUES
    (1, 'Mechanical Keyboard',          'Peripherals', 129.00),
    (2, 'Wireless Mouse',               'Peripherals', 49.00),
    (3, 'USB-C Hub',                    'Accessories', 35.00),
    (4, '27in Monitor',                 'Displays',    299.00),
    (5, 'Laptop Stand',                 'Accessories', 42.00),
    (6, 'Webcam 1080p',                 'Peripherals', 69.00),
    (7, 'Noise-Cancelling Headphones',  'Audio',       199.00),
    (8, 'Desk Mat',                     'Accessories', 19.00);

INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES
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

INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES
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
-- Large sales dataset (1M rows) for chart / board testing
-- =================================================================

CREATE TABLE sales_transactions (
    id              SERIAL PRIMARY KEY,
    sale_date       DATE NOT NULL,
    region          VARCHAR(20) NOT NULL,
    category        VARCHAR(30) NOT NULL,
    product         VARCHAR(50) NOT NULL,
    channel         VARCHAR(20) NOT NULL,
    customer_segment VARCHAR(20) NOT NULL,
    quantity        INTEGER NOT NULL,
    unit_price      NUMERIC(10,2) NOT NULL,
    amount          NUMERIC(12,2) NOT NULL,
    cost            NUMERIC(12,2) NOT NULL,
    profit          NUMERIC(12,2) NOT NULL
);

INSERT INTO sales_transactions
    (sale_date, region, category, product, channel, customer_segment, quantity, unit_price, amount, cost, profit)
SELECT
    '2023-01-01'::date + (floor(random() * 912))::int AS sale_date,
    (ARRAY['North','South','East','West','Central'])[1 + (i % 5)] AS region,
    (ARRAY['Electronics','Clothing','Food','Furniture','Sports','Books','Beauty','Toys'])[1 + (i % 8)] AS category,
    (ARRAY[
        'Laptop','Phone','Tablet','Headphones','Speaker',
        'T-Shirt','Jeans','Jacket','Sneakers','Hat',
        'Coffee','Pasta','Snacks','Juice','Bread',
        'Desk','Chair','Lamp','Shelf','Rug',
        'Basketball','Yoga Mat','Dumbbells','Bike','Helmet',
        'Novel','Textbook','Comic','Magazine','Planner',
        'Moisturizer','Shampoo','Perfume','Lipstick','Sunscreen',
        'Lego Set','Board Game','Puzzle','Doll','RC Car'
    ])[1 + (i % 40)] AS product,
    (ARRAY['Online','In-Store','Wholesale','Marketplace'])[1 + ((i / 5) % 4)] AS channel,
    (ARRAY['Consumer','Business','Enterprise','Government'])[1 + ((i / 20) % 4)] AS customer_segment,
    q AS quantity,
    p AS unit_price,
    ROUND((q * p)::numeric, 2) AS amount,
    ROUND((q * p * (0.4 + random() * 0.3))::numeric, 2) AS cost,
    ROUND((q * p * (0.3 + random() * 0.3))::numeric, 2) AS profit
FROM generate_series(1, 1000000) AS s(i),
LATERAL (SELECT 1 + (floor(random() * 10))::int AS q) AS qty,
LATERAL (SELECT ROUND((5 + random() * 495)::numeric, 2) AS p) AS price;

CREATE INDEX idx_sales_date ON sales_transactions(sale_date);
CREATE INDEX idx_sales_region ON sales_transactions(region);
CREATE INDEX idx_sales_category ON sales_transactions(category);

-- =================================================================
-- Page events table (1M rows) for federation perf testing
-- user_id 1..1M maps to mysql.testdb.user_accounts_1m.id
-- =================================================================

CREATE TABLE page_events_1m (
    id            BIGSERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL,
    event_type    VARCHAR(30) NOT NULL,
    page_url      VARCHAR(100) NOT NULL,
    session_id    BIGINT NOT NULL,
    created_at    TIMESTAMP NOT NULL,
    duration_ms   INTEGER NOT NULL,
    payload_size  INTEGER NOT NULL
);

INSERT INTO page_events_1m
    (user_id, event_type, page_url, session_id, created_at, duration_ms, payload_size)
SELECT
    1 + (i % 1000000),
    (ARRAY['page_view','click','scroll','form_submit','search','logout'])[1 + (i % 6)],
    (ARRAY['/home','/products','/cart','/checkout','/profile',
           '/settings','/search','/about','/blog','/help'])[1 + (i % 10)],
    (i / 20) + 1,
    '2023-01-01'::timestamp + ((i % 63072000) || ' seconds')::interval,
    50 + (floor(random() * 30000))::int,
    100 + (floor(random() * 50000))::int
FROM generate_series(1, 1000000) AS s(i);

CREATE INDEX idx_pe1m_user_id ON page_events_1m(user_id);
CREATE INDEX idx_pe1m_event_type ON page_events_1m(event_type);
CREATE INDEX idx_pe1m_created_at ON page_events_1m(created_at);
