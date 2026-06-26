{{ config(materialized='incremental', unique_key='order_id', schema='marts') }}

SELECT
    order_id,
    customer_id,
    order_date,
    status,
    amount
FROM {{ ref('stg_orders') }}

{% if is_incremental() %}
-- On incremental runs only load orders newer than what is already stored.
WHERE order_date > (SELECT COALESCE(MAX(order_date), '1900-01-01') FROM {{ this }})
{% endif %}
