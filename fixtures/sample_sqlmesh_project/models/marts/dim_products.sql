MODEL (
  name analytics_shop.dim_products,
  kind INCREMENTAL_BY_UNIQUE_KEY (
    unique_key product_id
  ),
  grain product_id,
  tags (mart),
  description 'Product dimension enriched with order-item sales aggregates.',
  audits (
    unique_values(columns := (product_id)),
    not_null(columns := (product_id, product_name))
  )
);

SELECT
  p.product_id,
  p.product_name,
  p.category,
  p.price,
  COUNT(oi.order_item_id) AS times_ordered,
  COALESCE(SUM(oi.quantity), 0) AS units_sold,
  COALESCE(SUM(oi.line_revenue), 0) AS total_revenue
FROM analytics_shop.stg_products AS p
LEFT JOIN analytics_shop.stg_order_items AS oi
  ON p.product_id = oi.product_id
GROUP BY
  p.product_id,
  p.product_name,
  p.category,
  p.price;
