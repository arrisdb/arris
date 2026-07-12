IF DB_ID(N'appdb') IS NULL
    CREATE DATABASE appdb;
GO

USE appdb;
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- =================================================================
-- Canonical sample dataset (shared across every docker-compose engine)
-- Same tables, same primary keys, same rows everywhere so cross-source
-- federated joins line up.
-- =================================================================

IF OBJECT_ID(N'dbo.customers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.customers (
        customer_id  INT PRIMARY KEY,
        first_name   NVARCHAR(50) NOT NULL,
        last_name    NVARCHAR(50) NOT NULL,
        email        NVARCHAR(255) NOT NULL,
        country_code CHAR(2) NOT NULL,
        signup_date  DATE NOT NULL,
        updated_at   DATETIME2 NOT NULL
    );
END;
GO

IF OBJECT_ID(N'dbo.products', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.products (
        product_id   INT PRIMARY KEY,
        product_name NVARCHAR(100) NOT NULL,
        category     NVARCHAR(50) NOT NULL,
        price        DECIMAL(10,2) NOT NULL
    );
END;
GO

IF OBJECT_ID(N'dbo.orders', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.orders (
        order_id    INT PRIMARY KEY,
        customer_id INT NOT NULL REFERENCES dbo.customers(customer_id),
        order_date  DATE NOT NULL,
        status      NVARCHAR(20) NOT NULL,
        amount      DECIMAL(10,2) NOT NULL
    );
END;
GO

IF OBJECT_ID(N'dbo.order_items', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.order_items (
        order_item_id INT PRIMARY KEY,
        order_id      INT NOT NULL REFERENCES dbo.orders(order_id),
        product_id    INT NOT NULL REFERENCES dbo.products(product_id),
        quantity      INT NOT NULL,
        unit_price    DECIMAL(10,2) NOT NULL
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.customers)
BEGIN
    INSERT INTO dbo.customers (customer_id, first_name, last_name, email, country_code, signup_date, updated_at) VALUES
        (1,  N'Ada',       N'Lovelace',     N'ada@example.com',       'GB', '2025-01-01', '2025-01-01 09:00:00'),
        (2,  N'Grace',     N'Hopper',       N'grace@example.com',     'US', '2025-01-02', '2025-01-02 09:00:00'),
        (3,  N'Katherine', N'Johnson',      N'katherine@example.com', 'US', '2025-01-03', '2025-01-03 09:00:00'),
        (4,  N'Radia',     N'Perlman',      N'radia@example.com',     'CA', '2025-01-04', '2025-01-04 09:00:00'),
        (5,  N'Margaret',  N'Hamilton',     N'margaret@example.com',  'US', '2025-01-05', '2025-01-05 09:00:00'),
        (6,  N'Barbara',   N'Liskov',       N'barbara@example.com',   'US', '2025-01-06', '2025-01-06 09:00:00'),
        (7,  N'Joan',      N'Clarke',       N'joan@example.com',      'GB', '2025-01-07', '2025-01-07 09:00:00'),
        (8,  N'Karen',     N'Sparck-Jones', N'karen@example.com',     'GB', '2025-01-08', '2025-01-08 09:00:00'),
        (9,  N'Shafi',     N'Goldwasser',   N'shafi@example.com',     'US', '2025-01-09', '2025-01-09 09:00:00'),
        (10, N'Frances',   N'Allen',        N'frances@example.com',   'CA', '2025-01-10', '2025-01-10 09:00:00'),
        (11, N'Lynn',      N'Conway',       N'lynn@example.com',      'AU', '2025-01-11', '2025-01-11 09:00:00'),
        (12, N'Sophie',    N'Wilson',       N'sophie@example.com',    'DE', '2025-01-12', '2025-01-12 09:00:00');
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.products)
BEGIN
    INSERT INTO dbo.products (product_id, product_name, category, price) VALUES
        (1, N'Mechanical Keyboard',         N'Peripherals', 129.00),
        (2, N'Wireless Mouse',              N'Peripherals', 49.00),
        (3, N'USB-C Hub',                   N'Accessories', 35.00),
        (4, N'27in Monitor',                N'Displays',    299.00),
        (5, N'Laptop Stand',                N'Accessories', 42.00),
        (6, N'Webcam 1080p',                N'Peripherals', 69.00),
        (7, N'Noise-Cancelling Headphones', N'Audio',       199.00),
        (8, N'Desk Mat',                    N'Accessories', 19.00);
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.orders)
BEGIN
    INSERT INTO dbo.orders (order_id, customer_id, order_date, status, amount) VALUES
        (100, 1,  '2025-01-03', N'completed', 129.00),
        (101, 1,  '2025-01-15', N'shipped',   49.00),
        (102, 2,  '2025-01-04', N'completed', 299.00),
        (103, 3,  '2025-01-05', N'pending',   35.00),
        (104, 4,  '2025-01-06', N'returned',  42.00),
        (105, 5,  '2025-01-07', N'completed', 69.00),
        (106, 6,  '2025-01-08', N'completed', 199.00),
        (107, 7,  '2025-01-09', N'shipped',   19.00),
        (108, 2,  '2025-01-12', N'completed', 129.00),
        (109, 8,  '2025-01-14', N'cancelled', 49.00),
        (110, 9,  '2025-01-16', N'completed', 299.00),
        (111, 10, '2025-01-18', N'shipped',   35.00),
        (112, 11, '2025-01-20', N'completed', 42.00),
        (113, 12, '2025-01-22', N'pending',   69.00),
        (114, 1,  '2025-01-25', N'completed', 199.00),
        (115, 3,  '2025-01-27', N'completed', 19.00),
        (116, 5,  '2025-02-01', N'shipped',   129.00),
        (117, 6,  '2025-02-03', N'completed', 49.00),
        (118, 7,  '2025-02-05', N'returned',  299.00),
        (119, 9,  '2025-02-07', N'completed', 35.00),
        (120, 2,  '2025-02-09', N'completed', 42.00),
        (121, 4,  '2025-02-11', N'shipped',   69.00),
        (122, 8,  '2025-02-13', N'completed', 199.00),
        (123, 10, '2025-02-15', N'pending',   19.00),
        (124, 11, '2025-02-17', N'completed', 129.00),
        (125, 12, '2025-02-19', N'shipped',   49.00),
        (126, 1,  '2025-02-21', N'completed', 299.00),
        (127, 5,  '2025-02-23', N'cancelled', 35.00),
        (128, 6,  '2025-02-25', N'completed', 42.00),
        (129, 3,  '2025-02-27', N'completed', 69.00);
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.order_items)
BEGIN
    INSERT INTO dbo.order_items (order_item_id, order_id, product_id, quantity, unit_price) VALUES
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
END;
GO

-- =================================================================
-- Schema-object fixtures (covering every object kind) for schema browser testing
-- =================================================================

IF SCHEMA_ID(N'sales') IS NULL
    EXEC(N'CREATE SCHEMA sales');
GO

IF OBJECT_ID(N'dbo.order_number_seq', N'SO') IS NULL
BEGIN
    CREATE SEQUENCE dbo.order_number_seq
        AS BIGINT
        START WITH 1000
        INCREMENT BY 1;
END;
GO

IF TYPE_ID(N'dbo.EmailAddress') IS NULL
    CREATE TYPE dbo.EmailAddress FROM NVARCHAR(255) NOT NULL;
GO

IF TYPE_ID(N'dbo.OrderLineType') IS NULL
    CREATE TYPE dbo.OrderLineType AS TABLE (
        product NVARCHAR(200) NOT NULL,
        quantity INT NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL
    );
GO

IF OBJECT_ID(N'dbo.data_type_samples', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.data_type_samples (
        id INT IDENTITY(1,1) PRIMARY KEY,
        sample_guid UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
        is_active BIT NOT NULL DEFAULT 1,
        tiny_count TINYINT NOT NULL,
        small_count SMALLINT NOT NULL,
        regular_count INT NOT NULL,
        big_count BIGINT NOT NULL,
        price DECIMAL(12,2) NOT NULL,
        tax_rate NUMERIC(5,4) NOT NULL,
        account_balance MONEY NOT NULL,
        ratio REAL NOT NULL,
        score FLOAT NOT NULL,
        fixed_code CHAR(4) NOT NULL,
        display_name NVARCHAR(100) NOT NULL,
        notes NVARCHAR(MAX) NULL,
        payload VARBINARY(64) NULL,
        profile XML NULL,
        created_on DATE NOT NULL,
        starts_at TIME(3) NOT NULL,
        recorded_at DATETIME NOT NULL,
        captured_at DATETIME2(3) NOT NULL,
        captured_offset DATETIMEOFFSET(3) NOT NULL
    );
END;
GO

IF OBJECT_ID(N'sales.invoices', N'U') IS NULL
BEGIN
    CREATE TABLE sales.invoices (
        invoice_id INT IDENTITY(1,1) PRIMARY KEY,
        invoice_number BIGINT NOT NULL DEFAULT NEXT VALUE FOR dbo.order_number_seq,
        customer_email dbo.EmailAddress NOT NULL,
        subtotal DECIMAL(12,2) NOT NULL,
        tax DECIMAL(12,2) NOT NULL,
        total AS (subtotal + tax) PERSISTED,
        paid BIT NOT NULL DEFAULT 0,
        issued_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;
GO

INSERT INTO dbo.data_type_samples (
    tiny_count,
    small_count,
    regular_count,
    big_count,
    price,
    tax_rate,
    account_balance,
    ratio,
    score,
    fixed_code,
    display_name,
    notes,
    payload,
    profile,
    created_on,
    starts_at,
    recorded_at,
    captured_at,
    captured_offset
)
SELECT
    7,
    1200,
    42000,
    9000000000,
    1234.56,
    0.0825,
    98765.43,
    0.75,
    98.125,
    'A001',
    N'Data type sample',
    N'Wide MSSQL sample row for schema and result testing',
    0xDEADBEEF,
    CAST(N'<profile tier="gold"><tags><tag>beta</tag><tag>sql-server</tag></tags></profile>' AS XML),
    '2026-05-06',
    '09:30:15.125',
    '2026-05-06T09:30:15',
    '2026-05-06T09:30:15.125',
    '2026-05-06T09:30:15.125-07:00'
WHERE NOT EXISTS (SELECT 1 FROM dbo.data_type_samples WHERE fixed_code = 'A001');
GO

IF NOT EXISTS (SELECT 1 FROM sales.invoices)
BEGIN
    INSERT INTO sales.invoices (customer_email, subtotal, tax, paid) VALUES
        (N'alice@example.com', 199.99, 16.50, 1),
        (N'bob@example.com', 49.95, 4.12, 0);
END;
GO

IF OBJECT_ID(N'dbo.customer_order_summary', N'V') IS NULL
    EXEC(N'CREATE VIEW dbo.customer_order_summary AS
        SELECT
            c.customer_id,
            c.first_name,
            c.last_name,
            COUNT(o.order_id) AS order_count,
            SUM(o.amount) AS total_spend
        FROM dbo.customers c
        LEFT JOIN dbo.orders o ON o.customer_id = c.customer_id
        GROUP BY c.customer_id, c.first_name, c.last_name;');
GO

IF OBJECT_ID(N'dbo.customer_order_total', N'FN') IS NULL
    EXEC(N'CREATE FUNCTION dbo.customer_order_total (@customer_id INT)
        RETURNS DECIMAL(12,2)
        AS
        BEGIN
            DECLARE @total DECIMAL(12,2);
            SELECT @total = COALESCE(SUM(amount), 0)
            FROM dbo.orders
            WHERE customer_id = @customer_id;
            RETURN @total;
        END;');
GO

IF OBJECT_ID(N'dbo.mark_invoice_paid', N'P') IS NULL
    EXEC(N'CREATE PROCEDURE dbo.mark_invoice_paid
        @invoice_id INT
        AS
        BEGIN
            SET NOCOUNT ON;
            UPDATE sales.invoices
            SET paid = 1
            WHERE invoice_id = @invoice_id;
        END;');
GO

IF OBJECT_ID(N'sales.trg_invoices_paid_guard', N'TR') IS NULL
    EXEC(N'CREATE TRIGGER sales.trg_invoices_paid_guard
        ON sales.invoices
        AFTER UPDATE
        AS
        BEGIN
            SET NOCOUNT ON;
            UPDATE i
            SET issued_at = SYSUTCDATETIME()
            FROM sales.invoices i
            JOIN inserted ins ON ins.invoice_id = i.invoice_id
            WHERE ins.paid = 1;
        END;');
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_orders_customer_id' AND object_id = OBJECT_ID(N'dbo.orders'))
    CREATE INDEX ix_orders_customer_id ON dbo.orders (customer_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_invoices_paid_issued_at' AND object_id = OBJECT_ID(N'sales.invoices'))
    CREATE INDEX ix_invoices_paid_issued_at ON sales.invoices (paid, issued_at);
GO

-- =================================================================
-- Large table (10M rows) for exercising streaming-chunk ingestion
-- against the local container. Seeded in 1M-row batches so the
-- transaction log stays bounded during load.
-- =================================================================

IF OBJECT_ID(N'dbo.events_10m', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.events_10m (
        id         BIGINT PRIMARY KEY,
        user_id    INT NOT NULL,
        event_type NVARCHAR(20) NOT NULL,
        device     NVARCHAR(20) NOT NULL,
        country    CHAR(2) NOT NULL,
        event_time DATETIME2(0) NOT NULL,
        amount     DECIMAL(10,2) NOT NULL
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.events_10m)
BEGIN
    SET NOCOUNT ON;
    DECLARE @batch INT = 1000000;
    DECLARE @start BIGINT = 1;
    DECLARE @total BIGINT = 10000000;
    WHILE @start <= @total
    BEGIN
        INSERT INTO dbo.events_10m (id, user_id, event_type, device, country, event_time, amount)
        SELECT
            rn,
            (rn % 100000) + 1,
            CHOOSE((rn % 5) + 1, N'view', N'click', N'purchase', N'signup', N'logout'),
            CHOOSE((rn % 3) + 1, N'ios', N'android', N'web'),
            CHOOSE((rn % 4) + 1, 'US', 'GB', 'CA', 'DE'),
            DATEADD(SECOND, rn % 31536000, '2025-01-01T00:00:00'),
            CAST((rn % 10000) AS DECIMAL(10,2)) / 100
        FROM (
            SELECT TOP (@batch)
                ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) + @start - 1 AS rn
            FROM sys.all_objects a CROSS JOIN sys.all_objects b
        ) AS t;
        SET @start = @start + @batch;
    END;
END;
GO
