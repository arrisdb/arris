#!/bin/sh
# Seeds DynamoDB Local with the canonical sample dataset shared across every
# docker-compose engine (same tables, same primary keys, same rows) so
# cross-source federated joins line up with postgres / mysql / etc.
# DynamoDB is schemaless, so each table declares only its partition key; the
# remaining attributes are written per item. Run as a one-shot sidecar
# (amazon/aws-cli) against the `dynamodb` service. Any non-empty credentials are
# accepted by the emulator.
set -e

EP="--endpoint-url http://dynamodb:8000"

until aws dynamodb list-tables $EP >/dev/null 2>&1; do
  echo "waiting for dynamodb-local..."
  sleep 1
done

create_table() {
  table="$1"
  key="$2"
  if ! aws dynamodb describe-table $EP --table-name "$table" >/dev/null 2>&1; then
    aws dynamodb create-table $EP \
      --table-name "$table" \
      --attribute-definitions "AttributeName=$key,AttributeType=N" \
      --key-schema "AttributeName=$key,KeyType=HASH" \
      --billing-mode PAY_PER_REQUEST >/dev/null
  fi
}

put() {
  aws dynamodb put-item $EP --table-name "$1" --item "$2" >/dev/null
}

create_table customers customer_id
create_table products product_id
create_table orders order_id
create_table order_items order_item_id

# customers: id first last email country signup updated(ISO, no space)
while read id first last email cc signup updated; do
  put customers "{\"customer_id\":{\"N\":\"$id\"},\"first_name\":{\"S\":\"$first\"},\"last_name\":{\"S\":\"$last\"},\"email\":{\"S\":\"$email\"},\"country_code\":{\"S\":\"$cc\"},\"signup_date\":{\"S\":\"$signup\"},\"updated_at\":{\"S\":\"$updated\"}}"
done <<'ROWS'
1 Ada Lovelace ada@example.com GB 2025-01-01 2025-01-01T09:00:00
2 Grace Hopper grace@example.com US 2025-01-02 2025-01-02T09:00:00
3 Katherine Johnson katherine@example.com US 2025-01-03 2025-01-03T09:00:00
4 Radia Perlman radia@example.com CA 2025-01-04 2025-01-04T09:00:00
5 Margaret Hamilton margaret@example.com US 2025-01-05 2025-01-05T09:00:00
6 Barbara Liskov barbara@example.com US 2025-01-06 2025-01-06T09:00:00
7 Joan Clarke joan@example.com GB 2025-01-07 2025-01-07T09:00:00
8 Karen Sparck-Jones karen@example.com GB 2025-01-08 2025-01-08T09:00:00
9 Shafi Goldwasser shafi@example.com US 2025-01-09 2025-01-09T09:00:00
10 Frances Allen frances@example.com CA 2025-01-10 2025-01-10T09:00:00
11 Lynn Conway lynn@example.com AU 2025-01-11 2025-01-11T09:00:00
12 Sophie Wilson sophie@example.com DE 2025-01-12 2025-01-12T09:00:00
ROWS

# products: id price category name(rest of line, may contain spaces)
while read id price category name; do
  put products "{\"product_id\":{\"N\":\"$id\"},\"product_name\":{\"S\":\"$name\"},\"category\":{\"S\":\"$category\"},\"price\":{\"N\":\"$price\"}}"
done <<'ROWS'
1 129.00 Peripherals Mechanical Keyboard
2 49.00 Peripherals Wireless Mouse
3 35.00 Accessories USB-C Hub
4 299.00 Displays 27in Monitor
5 42.00 Accessories Laptop Stand
6 69.00 Peripherals Webcam 1080p
7 199.00 Audio Noise-Cancelling Headphones
8 19.00 Accessories Desk Mat
ROWS

# orders: order_id customer_id order_date status amount
while read oid cid date status amount; do
  put orders "{\"order_id\":{\"N\":\"$oid\"},\"customer_id\":{\"N\":\"$cid\"},\"order_date\":{\"S\":\"$date\"},\"status\":{\"S\":\"$status\"},\"amount\":{\"N\":\"$amount\"}}"
done <<'ROWS'
100 1 2025-01-03 completed 129.00
101 1 2025-01-15 shipped 49.00
102 2 2025-01-04 completed 299.00
103 3 2025-01-05 pending 35.00
104 4 2025-01-06 returned 42.00
105 5 2025-01-07 completed 69.00
106 6 2025-01-08 completed 199.00
107 7 2025-01-09 shipped 19.00
108 2 2025-01-12 completed 129.00
109 8 2025-01-14 cancelled 49.00
110 9 2025-01-16 completed 299.00
111 10 2025-01-18 shipped 35.00
112 11 2025-01-20 completed 42.00
113 12 2025-01-22 pending 69.00
114 1 2025-01-25 completed 199.00
115 3 2025-01-27 completed 19.00
116 5 2025-02-01 shipped 129.00
117 6 2025-02-03 completed 49.00
118 7 2025-02-05 returned 299.00
119 9 2025-02-07 completed 35.00
120 2 2025-02-09 completed 42.00
121 4 2025-02-11 shipped 69.00
122 8 2025-02-13 completed 199.00
123 10 2025-02-15 pending 19.00
124 11 2025-02-17 completed 129.00
125 12 2025-02-19 shipped 49.00
126 1 2025-02-21 completed 299.00
127 5 2025-02-23 cancelled 35.00
128 6 2025-02-25 completed 42.00
129 3 2025-02-27 completed 69.00
ROWS

# order_items: order_item_id order_id product_id quantity unit_price
while read iid oid pid qty price; do
  put order_items "{\"order_item_id\":{\"N\":\"$iid\"},\"order_id\":{\"N\":\"$oid\"},\"product_id\":{\"N\":\"$pid\"},\"quantity\":{\"N\":\"$qty\"},\"unit_price\":{\"N\":\"$price\"}}"
done <<'ROWS'
1 100 1 1 129.00
2 101 2 1 49.00
3 102 4 1 299.00
4 103 3 1 35.00
5 104 5 1 42.00
6 105 6 1 69.00
7 106 7 1 199.00
8 107 8 1 19.00
9 108 1 1 129.00
10 109 2 1 49.00
11 110 4 1 299.00
12 111 3 1 35.00
13 112 5 1 42.00
14 113 6 1 69.00
15 114 7 1 199.00
16 115 8 1 19.00
17 116 1 1 129.00
18 117 2 1 49.00
19 118 4 1 299.00
20 119 3 1 35.00
21 120 5 1 42.00
22 121 6 1 69.00
23 122 7 1 199.00
24 123 8 1 19.00
25 124 1 1 129.00
26 125 2 1 49.00
27 126 4 1 299.00
28 127 3 1 35.00
29 128 5 1 42.00
30 129 6 1 69.00
31 100 8 2 19.00
32 102 2 1 49.00
33 106 3 1 35.00
34 110 5 2 42.00
35 114 8 1 19.00
36 122 2 1 49.00
37 126 1 1 129.00
ROWS

echo "DynamoDB Local seeded: customers, products, orders, order_items."
