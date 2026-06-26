-- =================================================================
-- Canonical sample dataset (shared across every docker-compose engine)
-- Same tables, same primary keys, same rows everywhere so cross-source
-- federated joins line up (e.g. postgres.orders ⋈ mysql.customers).
-- =================================================================

CREATE TABLE customers (
    customer_id   INT PRIMARY KEY,
    first_name    VARCHAR(50) NOT NULL,
    last_name     VARCHAR(50) NOT NULL,
    email         VARCHAR(255) NOT NULL,
    country_code  CHAR(2) NOT NULL,
    signup_date   DATE NOT NULL,
    updated_at    DATETIME NOT NULL
);

CREATE TABLE products (
    product_id    INT PRIMARY KEY,
    product_name  VARCHAR(100) NOT NULL,
    category      VARCHAR(50) NOT NULL,
    price         DECIMAL(10,2) NOT NULL
);

CREATE TABLE orders (
    order_id      INT PRIMARY KEY,
    customer_id   INT NOT NULL,
    order_date    DATE NOT NULL,
    status        VARCHAR(20) NOT NULL,
    amount        DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);

CREATE TABLE order_items (
    order_item_id INT PRIMARY KEY,
    order_id      INT NOT NULL,
    product_id    INT NOT NULL,
    quantity      INT NOT NULL,
    unit_price    DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(order_id),
    FOREIGN KEY (product_id) REFERENCES products(product_id)
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
-- Schema-object fixtures for schema browser testing
-- =================================================================

CREATE TABLE sales_audit (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    message    VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE VIEW us_customers AS
SELECT customer_id, first_name, last_name, email
FROM customers
WHERE country_code = 'US';

DELIMITER //

CREATE FUNCTION customer_display_name(p_first_name VARCHAR(50), p_last_name VARCHAR(50))
RETURNS VARCHAR(128)
DETERMINISTIC
NO SQL
BEGIN
    RETURN CONCAT('Customer: ', p_first_name, ' ', p_last_name);
END//

CREATE PROCEDURE record_sales_audit(IN audit_message VARCHAR(255))
BEGIN
    INSERT INTO sales_audit (message) VALUES (audit_message);
END//

CREATE TRIGGER customers_before_insert
BEFORE INSERT ON customers
FOR EACH ROW
BEGIN
    SET NEW.country_code = UPPER(NEW.country_code);
END//

CREATE EVENT daily_sales_audit
ON SCHEDULE EVERY 1 DAY
STARTS CURRENT_TIMESTAMP + INTERVAL 1 DAY
DO
BEGIN
    INSERT INTO sales_audit (message) VALUES ('daily sales audit');
END//

DELIMITER ;

-- =================================================================
-- Large sales dataset (1M rows) for chart / board testing
-- =================================================================

CREATE TABLE sales_transactions (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    sale_date       DATE NOT NULL,
    region          VARCHAR(20) NOT NULL,
    category        VARCHAR(30) NOT NULL,
    product         VARCHAR(50) NOT NULL,
    channel         VARCHAR(20) NOT NULL,
    customer_segment VARCHAR(20) NOT NULL,
    quantity        INT NOT NULL,
    unit_price      DECIMAL(10,2) NOT NULL,
    amount          DECIMAL(12,2) NOT NULL,
    cost            DECIMAL(12,2) NOT NULL,
    profit          DECIMAL(12,2) NOT NULL,
    INDEX idx_sales_date (sale_date),
    INDEX idx_sales_region (region),
    INDEX idx_sales_category (category)
);

SET cte_max_recursion_depth = 1001;

INSERT INTO sales_transactions
    (sale_date, region, category, product, channel, customer_segment, quantity, unit_price, amount, cost, profit)
WITH RECURSIVE s1 AS (SELECT 1 AS n UNION ALL SELECT n+1 FROM s1 WHERE n < 1000),
               s2 AS (SELECT 1 AS n UNION ALL SELECT n+1 FROM s2 WHERE n < 1000)
SELECT
    DATE_ADD('2023-01-01', INTERVAL FLOOR(RAND()*912) DAY) AS sale_date,
    ELT(1+FLOOR(RAND()*5), 'North','South','East','West','Central') AS region,
    ELT(1+FLOOR(RAND()*8), 'Electronics','Clothing','Food','Furniture','Sports','Books','Beauty','Toys') AS category,
    ELT(1+FLOOR(RAND()*40),
        'Laptop','Phone','Tablet','Headphones','Speaker',
        'T-Shirt','Jeans','Jacket','Sneakers','Hat',
        'Coffee','Pasta','Snacks','Juice','Bread',
        'Desk','Chair','Lamp','Shelf','Rug',
        'Basketball','Yoga Mat','Dumbbells','Bike','Helmet',
        'Novel','Textbook','Comic','Magazine','Planner',
        'Moisturizer','Shampoo','Perfume','Lipstick','Sunscreen',
        'Lego Set','Board Game','Puzzle','Doll','RC Car'
    ) AS product,
    ELT(1+FLOOR(RAND()*4), 'Online','In-Store','Wholesale','Marketplace') AS channel,
    ELT(1+FLOOR(RAND()*4), 'Consumer','Business','Enterprise','Government') AS customer_segment,
    @q := 1+FLOOR(RAND()*9) AS quantity,
    @p := ROUND(5+RAND()*495, 2) AS unit_price,
    ROUND(@q * @p, 2) AS amount,
    ROUND(@q * @p * (0.4 + RAND()*0.3), 2) AS cost,
    ROUND(@q * @p * (1 - 0.4 - RAND()*0.3), 2) AS profit
FROM s1 CROSS JOIN s2;

-- =================================================================
-- Large user accounts table (10M rows) for federation perf testing
-- =================================================================

CREATE TABLE user_accounts_1m (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(60) NOT NULL,
    email         VARCHAR(120) NOT NULL,
    country       VARCHAR(30) NOT NULL,
    signup_date   DATE NOT NULL,
    plan_type     VARCHAR(20) NOT NULL,
    monthly_spend DECIMAL(10,2) NOT NULL,
    is_verified   BOOLEAN NOT NULL,
    INDEX idx_ua_country (country),
    INDEX idx_ua_plan (plan_type),
    INDEX idx_ua_signup (signup_date)
);

SET cte_max_recursion_depth = 1001;

INSERT INTO user_accounts_1m
    (username, email, country, signup_date, plan_type, monthly_spend, is_verified)
WITH RECURSIVE s1 AS (SELECT 1 AS n UNION ALL SELECT n+1 FROM s1 WHERE n < 1000),
               s2 AS (SELECT 1 AS n UNION ALL SELECT n+1 FROM s2 WHERE n < 1000)
SELECT
    CONCAT('user', (s1.n - 1) * 1000 + s2.n),
    CONCAT('user', (s1.n - 1) * 1000 + s2.n, '@example.com'),
    ELT(1+FLOOR(RAND()*10), 'US','UK','Canada','Germany','France','Japan','Australia','Brazil','India','Mexico'),
    DATE_ADD('2020-01-01', INTERVAL FLOOR(RAND()*1826) DAY),
    ELT(1+FLOOR(RAND()*4), 'free','starter','pro','enterprise'),
    ROUND(RAND()*500, 2),
    FLOOR(RAND()*2)
FROM s1 CROSS JOIN s2;
