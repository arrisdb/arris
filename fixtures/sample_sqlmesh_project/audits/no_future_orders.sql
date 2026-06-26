AUDIT (
  name no_future_orders
);

SELECT
  order_id,
  order_date
FROM @this_model
WHERE order_date > CURRENT_DATE;
