{{ config(materialized='table', schema='marts') }}

WITH customers AS (
    SELECT * FROM {{ ref('stg_customers') }}
),

orders AS (
    SELECT * FROM {{ ref('stg_orders') }}
),

customer_orders AS (
    SELECT
        customer_id,
        COUNT(*) AS order_count,
        SUM(amount) AS total_amount
    FROM orders
    GROUP BY customer_id
)

SELECT
    c.customer_id,
    c.first_name,
    c.last_name,
    c.email,
    COALESCE(co.order_count, 0) AS order_count,
    COALESCE(co.total_amount, 0) AS total_amount
FROM customers c
LEFT JOIN customer_orders co ON c.customer_id = co.customer_id
