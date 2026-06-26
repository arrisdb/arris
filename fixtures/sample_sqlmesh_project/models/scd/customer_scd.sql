MODEL (
  name analytics_shop.customer_scd,
  kind SCD_TYPE_2_BY_TIME (
    unique_key customer_id,
    updated_at_name updated_at
  ),
  grain customer_id,
  description 'Slowly changing dimension tracking customer email and country over time.'
);

SELECT
  customer_id,
  email,
  country_code,
  updated_at
FROM analytics_shop.raw_customers;
