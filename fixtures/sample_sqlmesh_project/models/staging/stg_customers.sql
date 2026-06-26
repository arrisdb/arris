MODEL (
  name analytics_shop.stg_customers,
  kind VIEW,
  grain customer_id,
  description 'Cleaned customer records with a derived full name.',
  column_descriptions (
    customer_id = 'Surrogate key for the customer',
    full_name = 'First and last name concatenated'
  ),
  audits (
    not_null(columns := (customer_id, email)),
    unique_values(columns := (customer_id))
  )
);

SELECT
  customer_id,
  first_name,
  last_name,
  first_name || ' ' || last_name AS full_name,
  email,
  country_code,
  signup_date,
  safasf
FROM analytics_shop.raw_customers;
