MODEL (
  name analytics_shop.raw_order_items,
  kind SEED (
    path '$root/seeds/raw_order_items.csv'
  ),
  columns (
    order_item_id INTEGER,
    order_id INTEGER,
    product_id INTEGER,
    quantity INTEGER,
    unit_price DECIMAL(10, 2)
  ),
  grain order_item_id
);
