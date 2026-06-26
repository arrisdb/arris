MODEL (
  name analytics_shop.country_codes,
  kind SEED (
    path '$root/seeds/country_codes.csv'
  ),
  columns (
    country_code TEXT,
    country_name TEXT,
    region TEXT
  ),
  grain country_code
);
