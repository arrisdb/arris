MODEL (
  name analytics_shop.dim_customers,
  kind FULL,
  cron '@daily',
  grain customer_id,
  tags (mart),
  description 'Customer dimension with lifetime order metrics.',
  audits (
    not_null(columns := (customer_id, email))
  )
);

SELECT
  c.customer_id,
  c.first_name,
  c.last_name,
  c.email,
  cc.country_name,
  cc.region,
  c.signup_date,
  COUNT(o.order_id) AS order_count,
  COALESCE(SUM(o.amount), 0) AS lifetime_value,
  MAX(o.order_date) AS most_recent_order_date
FROM analytics_shop.stg_customers AS c
LEFT JOIN analytics_shop.stg_orders AS o
  ON c.customer_id = o.customer_id
LEFT JOIN analytics_shop.country_codes AS cc
  ON c.country_code = cc.country_code
GROUP BY
  c.customer_id,
  c.first_name,
  c.last_name,
  c.email,
  cc.country_name,
  cc.region,
  c.signup_date;
