MODEL (
  name analytics_shop.raw_customers,
  kind SEED (
    path '$root/seeds/raw_customers.csv'
  ),
  columns (
    customer_id INTEGER,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    country_code TEXT,
    signup_date DATE,
    updated_at TIMESTAMP
  ),
  grain customer_id
);
