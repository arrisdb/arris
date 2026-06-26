SELECT *
FROM {{ ref('stg_orders') }}
WHERE amount < 0
