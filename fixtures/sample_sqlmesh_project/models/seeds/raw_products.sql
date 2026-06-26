MODEL (
  name analytics_shop.raw_products,
  kind SEED (
    path '$root/seeds/raw_products.csv'
  ),
  columns (
    product_id INTEGER,
    product_name TEXT,
    category TEXT,
    price DECIMAL(10, 2)
  ),
  grain product_id
);
