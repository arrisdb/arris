MODEL (
  name analytics_shop.stg_orders,
  kind INCREMENTAL_BY_TIME_RANGE (
    time_column order_date
  ),
  start '2025-01-01',
  cron '@daily',
  grain (order_id, order_date),
  audits (
    not_null(columns := (order_id, customer_id, order_date)),
    accepted_values(column := status, is_in := ('completed', 'shipped', 'pending', 'returned', 'cancelled')),
    positive_order_amounts,
    no_future_orders
  )
);

SELECT
  order_id,
  customer_id,
  order_date,
  status,
  amount
FROM analytics_shop.raw_orders
WHERE order_date BETWEEN @start_date AND @end_date;
