MODEL (
  name analytics_shop.stg_order_items,
  kind VIEW,
  grain order_item_id,
  audits (
    not_null(columns := (order_item_id, order_id, product_id))
  )
);

SELECT
  order_item_id,
  order_id,
  product_id,
  quantity,
  unit_price,
  unit_price * quantity AS line_revenue
FROM analytics_shop.raw_order_items;
