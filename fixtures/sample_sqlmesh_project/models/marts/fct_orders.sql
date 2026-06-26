MODEL (
  name analytics_shop.fct_orders,
  kind INCREMENTAL_BY_TIME_RANGE (
    time_column order_date
  ),
  start '2025-01-01',
  cron '@daily',
  grain order_id,
  tags (mart, finance),
  description 'Order fact joining orders, customers, countries and order-item revenue.',
  audits (
    not_null(columns := (order_id, customer_id, order_date)),
    number_of_rows(threshold := 1)
  )
);

SELECT
  o.order_id,
  o.order_date,
  o.status,
  c.customer_id,
  c.full_name AS customer_name,
  cc.country_name,
  cc.region,
  COUNT(oi.order_item_id) AS item_count,
  COALESCE(SUM(oi.quantity), 0) AS total_units,
  COALESCE(SUM(oi.line_revenue), 0) AS order_revenue
FROM analytics_shop.stg_orders AS o
INNER JOIN analytics_shop.stg_customers AS c
  ON o.customer_id = c.customer_id
LEFT JOIN analytics_shop.country_codes AS cc
  ON c.country_code = cc.country_code
LEFT JOIN analytics_shop.stg_order_items AS oi
  ON o.order_id = oi.order_id
WHERE o.order_date BETWEEN @start_date AND @end_date
GROUP BY
  o.order_id,
  o.order_date,
  o.status,
  c.customer_id,
  c.full_name,
  cc.country_name,
  cc.region;
