MODEL (
  name analytics_shop.raw_orders,
  kind SEED (
    path '$root/seeds/raw_orders.csv'
  ),
  columns (
    order_id INTEGER,
    customer_id INTEGER,
    order_date DATE,
    status TEXT,
    amount DECIMAL(10, 2)
  ),
  grain order_id
);
