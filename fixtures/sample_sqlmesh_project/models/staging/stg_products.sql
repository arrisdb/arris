MODEL (
  name analytics_shop.stg_products,
  kind VIEW,
  grain product_id,
  audits (
    not_null(columns := (product_id, product_name)),
    accepted_values(column := category, is_in := ('Peripherals', 'Accessories', 'Displays', 'Audio'))
  )
);

SELECT
  product_id,
  product_name,
  category,
  price
FROM analytics_shop.raw_products;
