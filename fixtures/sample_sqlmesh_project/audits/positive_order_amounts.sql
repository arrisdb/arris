AUDIT (
  name positive_order_amounts
);

SELECT
  order_id,
  amount
FROM @this_model
WHERE amount < 0;
