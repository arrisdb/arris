{{ config(materialized='view') }}

SELECT
    order_id,
    customer_id,
    order_date,
    status,
    amount
FROM {{ source('public', 'orders') }}
