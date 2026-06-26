{{ config(materialized='incremental', unique_key='order_date', schema='marts') }}

SELECT
    order_date,
    COUNT(*) AS order_count,
    SUM(amount) AS total_amount
FROM {{ ref('stg_orders') }}
GROUP BY order_date

{% if is_incremental() %}
-- On incremental runs only recompute days newer than what is already stored.
HAVING order_date > (SELECT COALESCE(MAX(order_date), '1900-01-01') FROM {{ this }})
{% endif %}
