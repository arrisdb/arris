-- Sample data for Oracle — canonical dataset plus schema-object fixtures
-- covering every object type for metadata scan testing.

-- =================================================================
-- Canonical sample dataset (shared across every docker-compose engine)
-- Same tables, same primary keys, same rows everywhere so cross-source
-- federated joins line up.
-- =================================================================

CREATE TABLE customers (
    customer_id  NUMBER PRIMARY KEY,
    first_name   VARCHAR2(50) NOT NULL,
    last_name    VARCHAR2(50) NOT NULL,
    email        VARCHAR2(255) NOT NULL,
    country_code CHAR(2) NOT NULL,
    signup_date  DATE NOT NULL,
    updated_at   TIMESTAMP NOT NULL
);

CREATE TABLE products (
    product_id   NUMBER PRIMARY KEY,
    product_name VARCHAR2(100) NOT NULL,
    category     VARCHAR2(50) NOT NULL,
    price        NUMBER(10,2) NOT NULL
);

CREATE TABLE orders (
    order_id    NUMBER PRIMARY KEY,
    customer_id NUMBER NOT NULL REFERENCES customers(customer_id),
    order_date  DATE NOT NULL,
    status      VARCHAR2(20) NOT NULL,
    amount      NUMBER(10,2) NOT NULL
);

CREATE TABLE order_items (
    order_item_id NUMBER PRIMARY KEY,
    order_id      NUMBER NOT NULL REFERENCES orders(order_id),
    product_id    NUMBER NOT NULL REFERENCES products(product_id),
    quantity      NUMBER NOT NULL,
    unit_price    NUMBER(10,2) NOT NULL
);

INSERT INTO customers (customer_id, first_name, last_name, email, country_code, signup_date, updated_at) VALUES (1,  'Ada',       'Lovelace',     'ada@example.com',       'GB', DATE '2025-01-01', TIMESTAMP '2025-01-01 09:00:00');
INSERT INTO customers (customer_id, first_name, last_name, email, country_code, signup_date, updated_at) VALUES (2,  'Grace',     'Hopper',       'grace@example.com',     'US', DATE '2025-01-02', TIMESTAMP '2025-01-02 09:00:00');
INSERT INTO customers (customer_id, first_name, last_name, email, country_code, signup_date, updated_at) VALUES (3,  'Katherine', 'Johnson',      'katherine@example.com', 'US', DATE '2025-01-03', TIMESTAMP '2025-01-03 09:00:00');
INSERT INTO customers (customer_id, first_name, last_name, email, country_code, signup_date, updated_at) VALUES (4,  'Radia',     'Perlman',      'radia@example.com',     'CA', DATE '2025-01-04', TIMESTAMP '2025-01-04 09:00:00');
INSERT INTO customers (customer_id, first_name, last_name, email, country_code, signup_date, updated_at) VALUES (5,  'Margaret',  'Hamilton',     'margaret@example.com',  'US', DATE '2025-01-05', TIMESTAMP '2025-01-05 09:00:00');
INSERT INTO customers (customer_id, first_name, last_name, email, country_code, signup_date, updated_at) VALUES (6,  'Barbara',   'Liskov',       'barbara@example.com',   'US', DATE '2025-01-06', TIMESTAMP '2025-01-06 09:00:00');
INSERT INTO customers (customer_id, first_name, last_name, email, country_code, signup_date, updated_at) VALUES (7,  'Joan',      'Clarke',       'joan@example.com',      'GB', DATE '2025-01-07', TIMESTAMP '2025-01-07 09:00:00');
INSERT INTO customers (customer_id, first_name, last_name, email, country_code, signup_date, updated_at) VALUES (8,  'Karen',     'Sparck-Jones', 'karen@example.com',     'GB', DATE '2025-01-08', TIMESTAMP '2025-01-08 09:00:00');
INSERT INTO customers (customer_id, first_name, last_name, email, country_code, signup_date, updated_at) VALUES (9,  'Shafi',     'Goldwasser',   'shafi@example.com',     'US', DATE '2025-01-09', TIMESTAMP '2025-01-09 09:00:00');
INSERT INTO customers (customer_id, first_name, last_name, email, country_code, signup_date, updated_at) VALUES (10, 'Frances',   'Allen',        'frances@example.com',   'CA', DATE '2025-01-10', TIMESTAMP '2025-01-10 09:00:00');
INSERT INTO customers (customer_id, first_name, last_name, email, country_code, signup_date, updated_at) VALUES (11, 'Lynn',      'Conway',       'lynn@example.com',      'AU', DATE '2025-01-11', TIMESTAMP '2025-01-11 09:00:00');
INSERT INTO customers (customer_id, first_name, last_name, email, country_code, signup_date, updated_at) VALUES (12, 'Sophie',    'Wilson',       'sophie@example.com',    'DE', DATE '2025-01-12', TIMESTAMP '2025-01-12 09:00:00');

INSERT INTO products (product_id, product_name, category, price) VALUES (1, 'Mechanical Keyboard',         'Peripherals', 129.00);
INSERT INTO products (product_id, product_name, category, price) VALUES (2, 'Wireless Mouse',              'Peripherals', 49.00);
INSERT INTO products (product_id, product_name, category, price) VALUES (3, 'USB-C Hub',                   'Accessories', 35.00);
INSERT INTO products (product_id, product_name, category, price) VALUES (4, '27in Monitor',               'Displays',    299.00);
INSERT INTO products (product_id, product_name, category, price) VALUES (5, 'Laptop Stand',               'Accessories', 42.00);
INSERT INTO products (product_id, product_name, category, price) VALUES (6, 'Webcam 1080p',               'Peripherals', 69.00);
INSERT INTO products (product_id, product_name, category, price) VALUES (7, 'Noise-Cancelling Headphones', 'Audio',      199.00);
INSERT INTO products (product_id, product_name, category, price) VALUES (8, 'Desk Mat',                   'Accessories', 19.00);

INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (100, 1,  DATE '2025-01-03', 'completed', 129.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (101, 1,  DATE '2025-01-15', 'shipped',   49.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (102, 2,  DATE '2025-01-04', 'completed', 299.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (103, 3,  DATE '2025-01-05', 'pending',   35.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (104, 4,  DATE '2025-01-06', 'returned',  42.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (105, 5,  DATE '2025-01-07', 'completed', 69.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (106, 6,  DATE '2025-01-08', 'completed', 199.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (107, 7,  DATE '2025-01-09', 'shipped',   19.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (108, 2,  DATE '2025-01-12', 'completed', 129.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (109, 8,  DATE '2025-01-14', 'cancelled', 49.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (110, 9,  DATE '2025-01-16', 'completed', 299.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (111, 10, DATE '2025-01-18', 'shipped',   35.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (112, 11, DATE '2025-01-20', 'completed', 42.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (113, 12, DATE '2025-01-22', 'pending',   69.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (114, 1,  DATE '2025-01-25', 'completed', 199.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (115, 3,  DATE '2025-01-27', 'completed', 19.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (116, 5,  DATE '2025-02-01', 'shipped',   129.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (117, 6,  DATE '2025-02-03', 'completed', 49.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (118, 7,  DATE '2025-02-05', 'returned',  299.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (119, 9,  DATE '2025-02-07', 'completed', 35.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (120, 2,  DATE '2025-02-09', 'completed', 42.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (121, 4,  DATE '2025-02-11', 'shipped',   69.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (122, 8,  DATE '2025-02-13', 'completed', 199.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (123, 10, DATE '2025-02-15', 'pending',   19.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (124, 11, DATE '2025-02-17', 'completed', 129.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (125, 12, DATE '2025-02-19', 'shipped',   49.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (126, 1,  DATE '2025-02-21', 'completed', 299.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (127, 5,  DATE '2025-02-23', 'cancelled', 35.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (128, 6,  DATE '2025-02-25', 'completed', 42.00);
INSERT INTO orders (order_id, customer_id, order_date, status, amount) VALUES (129, 3,  DATE '2025-02-27', 'completed', 69.00);

INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (1,  100, 1, 1, 129.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (2,  101, 2, 1, 49.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (3,  102, 4, 1, 299.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (4,  103, 3, 1, 35.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (5,  104, 5, 1, 42.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (6,  105, 6, 1, 69.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (7,  106, 7, 1, 199.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (8,  107, 8, 1, 19.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (9,  108, 1, 1, 129.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (10, 109, 2, 1, 49.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (11, 110, 4, 1, 299.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (12, 111, 3, 1, 35.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (13, 112, 5, 1, 42.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (14, 113, 6, 1, 69.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (15, 114, 7, 1, 199.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (16, 115, 8, 1, 19.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (17, 116, 1, 1, 129.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (18, 117, 2, 1, 49.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (19, 118, 4, 1, 299.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (20, 119, 3, 1, 35.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (21, 120, 5, 1, 42.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (22, 121, 6, 1, 69.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (23, 122, 7, 1, 199.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (24, 123, 8, 1, 19.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (25, 124, 1, 1, 129.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (26, 125, 2, 1, 49.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (27, 126, 4, 1, 299.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (28, 127, 3, 1, 35.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (29, 128, 5, 1, 42.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (30, 129, 6, 1, 69.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (31, 100, 8, 2, 19.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (32, 102, 2, 1, 49.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (33, 106, 3, 1, 35.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (34, 110, 5, 2, 42.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (35, 114, 8, 1, 19.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (36, 122, 2, 1, 49.00);
INSERT INTO order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES (37, 126, 1, 1, 129.00);

-- =================================================================
-- HR fixtures + schema objects (covering every object kind) for metadata scan
-- =================================================================

CREATE TABLE departments (
    id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR2(100) NOT NULL UNIQUE,
    budget NUMBER(15,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE employees (
    id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR2(100) NOT NULL,
    email VARCHAR2(100) UNIQUE,
    department_id NUMBER,
    salary NUMBER(10,2),
    hire_date DATE DEFAULT SYSDATE,
    is_active NUMBER(1) DEFAULT 1
);

-- Views
CREATE VIEW v_active_employees AS
    SELECT id, name, email, department_id, salary
    FROM employees WHERE is_active = 1;

CREATE VIEW v_department_summary AS
    SELECT d.name AS department, COUNT(e.id) AS headcount, SUM(e.salary) AS total_salary
    FROM departments d
    LEFT JOIN employees e ON e.department_id = d.id
    GROUP BY d.name;

-- Materialized views
CREATE MATERIALIZED VIEW mv_product_catalog AS
    SELECT product_id, product_name, category, price
    FROM products;

CREATE MATERIALIZED VIEW mv_customer_order_totals AS
    SELECT customer_id, COUNT(*) AS order_count, SUM(amount) AS revenue
    FROM orders
    GROUP BY customer_id;

-- Sequences
CREATE SEQUENCE seq_invoice_number START WITH 1000 INCREMENT BY 1;
CREATE SEQUENCE seq_tracking_code START WITH 5000 INCREMENT BY 10;

-- Types
CREATE TYPE t_address AS OBJECT (
    street VARCHAR2(200),
    city VARCHAR2(100),
    zip VARCHAR2(20)
);
/

CREATE TYPE t_name_list AS TABLE OF VARCHAR2(100);
/

-- Procedures
CREATE OR REPLACE PROCEDURE proc_update_salary(
    p_employee_id IN NUMBER,
    p_new_salary IN NUMBER
) AS
BEGIN
    UPDATE employees SET salary = p_new_salary WHERE id = p_employee_id;
    COMMIT;
END;
/

CREATE OR REPLACE PROCEDURE proc_deactivate_employee(
    p_employee_id IN NUMBER
) AS
BEGIN
    UPDATE employees SET is_active = 0 WHERE id = p_employee_id;
    COMMIT;
END;
/

-- Functions
CREATE OR REPLACE FUNCTION fn_employee_count RETURN NUMBER AS
    v_count NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM employees WHERE is_active = 1;
    RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_total_revenue RETURN NUMBER AS
    v_total NUMBER;
BEGIN
    SELECT NVL(SUM(amount), 0) INTO v_total FROM orders;
    RETURN v_total;
END;
/

-- Triggers
CREATE OR REPLACE TRIGGER trg_employees_updated
    BEFORE UPDATE ON employees
    FOR EACH ROW
BEGIN
    NULL;
END;
/

CREATE OR REPLACE TRIGGER trg_orders_insert
    AFTER INSERT ON orders
    FOR EACH ROW
BEGIN
    NULL;
END;
/

-- Indexes
CREATE INDEX idx_employees_department ON employees(department_id);
CREATE INDEX idx_employees_email ON employees(email);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
CREATE INDEX idx_products_name ON products(product_name);

-- HR sample data
INSERT INTO departments (name, budget) VALUES ('Engineering', 500000.00);
INSERT INTO departments (name, budget) VALUES ('Sales', 300000.00);
INSERT INTO departments (name, budget) VALUES ('Marketing', 200000.00);

INSERT INTO employees (name, email, department_id, salary, is_active) VALUES ('Alice Johnson', 'alice@example.com', 1, 95000.00, 1);
INSERT INTO employees (name, email, department_id, salary, is_active) VALUES ('Bob Smith', 'bob@example.com', 1, 85000.00, 1);
INSERT INTO employees (name, email, department_id, salary, is_active) VALUES ('Carol White', 'carol@example.com', 2, 75000.00, 1);
INSERT INTO employees (name, email, department_id, salary, is_active) VALUES ('David Brown', 'david@example.com', 3, 70000.00, 0);

COMMIT;

EXIT;
