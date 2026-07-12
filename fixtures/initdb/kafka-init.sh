#!/bin/bash
set -e

BROKER="kafka:19092"
SCHEMA_REGISTRY="http://schema-registry:8081"

# Row count for the large streaming-test topic (events_large).
LARGE_EVENTS_COUNT=10000000

# =================================================================
# Canonical sample dataset — one topic per table, JSON records.
# Same keys / rows as every other engine so cross-source joins line up.
# =================================================================

echo "=== Creating canonical topics ==="
kafka-topics --bootstrap-server $BROKER --create --if-not-exists --topic customers   --partitions 3 --replication-factor 1
kafka-topics --bootstrap-server $BROKER --create --if-not-exists --topic products    --partitions 3 --replication-factor 1
kafka-topics --bootstrap-server $BROKER --create --if-not-exists --topic orders      --partitions 6 --replication-factor 1
kafka-topics --bootstrap-server $BROKER --create --if-not-exists --topic order_items --partitions 6 --replication-factor 1

echo "=== Creating demo topics ==="
kafka-topics --bootstrap-server $BROKER --create --if-not-exists --topic events        --partitions 12 --replication-factor 1
kafka-topics --bootstrap-server $BROKER --create --if-not-exists --topic notifications --partitions 1  --replication-factor 1
kafka-topics --bootstrap-server $BROKER --create --if-not-exists --topic audit-log     --partitions 4  --replication-factor 1

echo "=== Registering Avro schemas for canonical topics ==="
curl -s -X POST "$SCHEMA_REGISTRY/subjects/customers-value/versions" \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  -d '{
    "schema": "{\"type\":\"record\",\"name\":\"Customer\",\"fields\":[{\"name\":\"customer_id\",\"type\":\"int\"},{\"name\":\"first_name\",\"type\":\"string\"},{\"name\":\"last_name\",\"type\":\"string\"},{\"name\":\"email\",\"type\":\"string\"},{\"name\":\"country_code\",\"type\":\"string\"},{\"name\":\"signup_date\",\"type\":\"string\"},{\"name\":\"updated_at\",\"type\":\"string\"}]}"
  }'
echo ""

curl -s -X POST "$SCHEMA_REGISTRY/subjects/products-value/versions" \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  -d '{
    "schema": "{\"type\":\"record\",\"name\":\"Product\",\"fields\":[{\"name\":\"product_id\",\"type\":\"int\"},{\"name\":\"product_name\",\"type\":\"string\"},{\"name\":\"category\",\"type\":\"string\"},{\"name\":\"price\",\"type\":\"double\"}]}"
  }'
echo ""

curl -s -X POST "$SCHEMA_REGISTRY/subjects/orders-value/versions" \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  -d '{
    "schema": "{\"type\":\"record\",\"name\":\"Order\",\"fields\":[{\"name\":\"order_id\",\"type\":\"int\"},{\"name\":\"customer_id\",\"type\":\"int\"},{\"name\":\"order_date\",\"type\":\"string\"},{\"name\":\"status\",\"type\":\"string\"},{\"name\":\"amount\",\"type\":\"double\"}]}"
  }'
echo ""

curl -s -X POST "$SCHEMA_REGISTRY/subjects/order_items-value/versions" \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  -d '{
    "schema": "{\"type\":\"record\",\"name\":\"OrderItem\",\"fields\":[{\"name\":\"order_item_id\",\"type\":\"int\"},{\"name\":\"order_id\",\"type\":\"int\"},{\"name\":\"product_id\",\"type\":\"int\"},{\"name\":\"quantity\",\"type\":\"int\"},{\"name\":\"unit_price\",\"type\":\"double\"}]}"
  }'
echo ""

echo "=== Producing canonical customers (12 records) ==="
kafka-console-producer --bootstrap-server $BROKER --topic customers <<'NDJSON'
{"customer_id":1,"first_name":"Ada","last_name":"Lovelace","email":"ada@example.com","country_code":"GB","signup_date":"2025-01-01","updated_at":"2025-01-01T09:00:00Z"}
{"customer_id":2,"first_name":"Grace","last_name":"Hopper","email":"grace@example.com","country_code":"US","signup_date":"2025-01-02","updated_at":"2025-01-02T09:00:00Z"}
{"customer_id":3,"first_name":"Katherine","last_name":"Johnson","email":"katherine@example.com","country_code":"US","signup_date":"2025-01-03","updated_at":"2025-01-03T09:00:00Z"}
{"customer_id":4,"first_name":"Radia","last_name":"Perlman","email":"radia@example.com","country_code":"CA","signup_date":"2025-01-04","updated_at":"2025-01-04T09:00:00Z"}
{"customer_id":5,"first_name":"Margaret","last_name":"Hamilton","email":"margaret@example.com","country_code":"US","signup_date":"2025-01-05","updated_at":"2025-01-05T09:00:00Z"}
{"customer_id":6,"first_name":"Barbara","last_name":"Liskov","email":"barbara@example.com","country_code":"US","signup_date":"2025-01-06","updated_at":"2025-01-06T09:00:00Z"}
{"customer_id":7,"first_name":"Joan","last_name":"Clarke","email":"joan@example.com","country_code":"GB","signup_date":"2025-01-07","updated_at":"2025-01-07T09:00:00Z"}
{"customer_id":8,"first_name":"Karen","last_name":"Sparck-Jones","email":"karen@example.com","country_code":"GB","signup_date":"2025-01-08","updated_at":"2025-01-08T09:00:00Z"}
{"customer_id":9,"first_name":"Shafi","last_name":"Goldwasser","email":"shafi@example.com","country_code":"US","signup_date":"2025-01-09","updated_at":"2025-01-09T09:00:00Z"}
{"customer_id":10,"first_name":"Frances","last_name":"Allen","email":"frances@example.com","country_code":"CA","signup_date":"2025-01-10","updated_at":"2025-01-10T09:00:00Z"}
{"customer_id":11,"first_name":"Lynn","last_name":"Conway","email":"lynn@example.com","country_code":"AU","signup_date":"2025-01-11","updated_at":"2025-01-11T09:00:00Z"}
{"customer_id":12,"first_name":"Sophie","last_name":"Wilson","email":"sophie@example.com","country_code":"DE","signup_date":"2025-01-12","updated_at":"2025-01-12T09:00:00Z"}
NDJSON

echo "=== Producing canonical products (8 records) ==="
kafka-console-producer --bootstrap-server $BROKER --topic products <<'NDJSON'
{"product_id":1,"product_name":"Mechanical Keyboard","category":"Peripherals","price":129.00}
{"product_id":2,"product_name":"Wireless Mouse","category":"Peripherals","price":49.00}
{"product_id":3,"product_name":"USB-C Hub","category":"Accessories","price":35.00}
{"product_id":4,"product_name":"27in Monitor","category":"Displays","price":299.00}
{"product_id":5,"product_name":"Laptop Stand","category":"Accessories","price":42.00}
{"product_id":6,"product_name":"Webcam 1080p","category":"Peripherals","price":69.00}
{"product_id":7,"product_name":"Noise-Cancelling Headphones","category":"Audio","price":199.00}
{"product_id":8,"product_name":"Desk Mat","category":"Accessories","price":19.00}
NDJSON

echo "=== Producing canonical orders (30 records) ==="
kafka-console-producer --bootstrap-server $BROKER --topic orders <<'NDJSON'
{"order_id":100,"customer_id":1,"order_date":"2025-01-03","status":"completed","amount":129.00}
{"order_id":101,"customer_id":1,"order_date":"2025-01-15","status":"shipped","amount":49.00}
{"order_id":102,"customer_id":2,"order_date":"2025-01-04","status":"completed","amount":299.00}
{"order_id":103,"customer_id":3,"order_date":"2025-01-05","status":"pending","amount":35.00}
{"order_id":104,"customer_id":4,"order_date":"2025-01-06","status":"returned","amount":42.00}
{"order_id":105,"customer_id":5,"order_date":"2025-01-07","status":"completed","amount":69.00}
{"order_id":106,"customer_id":6,"order_date":"2025-01-08","status":"completed","amount":199.00}
{"order_id":107,"customer_id":7,"order_date":"2025-01-09","status":"shipped","amount":19.00}
{"order_id":108,"customer_id":2,"order_date":"2025-01-12","status":"completed","amount":129.00}
{"order_id":109,"customer_id":8,"order_date":"2025-01-14","status":"cancelled","amount":49.00}
{"order_id":110,"customer_id":9,"order_date":"2025-01-16","status":"completed","amount":299.00}
{"order_id":111,"customer_id":10,"order_date":"2025-01-18","status":"shipped","amount":35.00}
{"order_id":112,"customer_id":11,"order_date":"2025-01-20","status":"completed","amount":42.00}
{"order_id":113,"customer_id":12,"order_date":"2025-01-22","status":"pending","amount":69.00}
{"order_id":114,"customer_id":1,"order_date":"2025-01-25","status":"completed","amount":199.00}
{"order_id":115,"customer_id":3,"order_date":"2025-01-27","status":"completed","amount":19.00}
{"order_id":116,"customer_id":5,"order_date":"2025-02-01","status":"shipped","amount":129.00}
{"order_id":117,"customer_id":6,"order_date":"2025-02-03","status":"completed","amount":49.00}
{"order_id":118,"customer_id":7,"order_date":"2025-02-05","status":"returned","amount":299.00}
{"order_id":119,"customer_id":9,"order_date":"2025-02-07","status":"completed","amount":35.00}
{"order_id":120,"customer_id":2,"order_date":"2025-02-09","status":"completed","amount":42.00}
{"order_id":121,"customer_id":4,"order_date":"2025-02-11","status":"shipped","amount":69.00}
{"order_id":122,"customer_id":8,"order_date":"2025-02-13","status":"completed","amount":199.00}
{"order_id":123,"customer_id":10,"order_date":"2025-02-15","status":"pending","amount":19.00}
{"order_id":124,"customer_id":11,"order_date":"2025-02-17","status":"completed","amount":129.00}
{"order_id":125,"customer_id":12,"order_date":"2025-02-19","status":"shipped","amount":49.00}
{"order_id":126,"customer_id":1,"order_date":"2025-02-21","status":"completed","amount":299.00}
{"order_id":127,"customer_id":5,"order_date":"2025-02-23","status":"cancelled","amount":35.00}
{"order_id":128,"customer_id":6,"order_date":"2025-02-25","status":"completed","amount":42.00}
{"order_id":129,"customer_id":3,"order_date":"2025-02-27","status":"completed","amount":69.00}
NDJSON

echo "=== Producing canonical order_items (37 records) ==="
kafka-console-producer --bootstrap-server $BROKER --topic order_items <<'NDJSON'
{"order_item_id":1,"order_id":100,"product_id":1,"quantity":1,"unit_price":129.00}
{"order_item_id":2,"order_id":101,"product_id":2,"quantity":1,"unit_price":49.00}
{"order_item_id":3,"order_id":102,"product_id":4,"quantity":1,"unit_price":299.00}
{"order_item_id":4,"order_id":103,"product_id":3,"quantity":1,"unit_price":35.00}
{"order_item_id":5,"order_id":104,"product_id":5,"quantity":1,"unit_price":42.00}
{"order_item_id":6,"order_id":105,"product_id":6,"quantity":1,"unit_price":69.00}
{"order_item_id":7,"order_id":106,"product_id":7,"quantity":1,"unit_price":199.00}
{"order_item_id":8,"order_id":107,"product_id":8,"quantity":1,"unit_price":19.00}
{"order_item_id":9,"order_id":108,"product_id":1,"quantity":1,"unit_price":129.00}
{"order_item_id":10,"order_id":109,"product_id":2,"quantity":1,"unit_price":49.00}
{"order_item_id":11,"order_id":110,"product_id":4,"quantity":1,"unit_price":299.00}
{"order_item_id":12,"order_id":111,"product_id":3,"quantity":1,"unit_price":35.00}
{"order_item_id":13,"order_id":112,"product_id":5,"quantity":1,"unit_price":42.00}
{"order_item_id":14,"order_id":113,"product_id":6,"quantity":1,"unit_price":69.00}
{"order_item_id":15,"order_id":114,"product_id":7,"quantity":1,"unit_price":199.00}
{"order_item_id":16,"order_id":115,"product_id":8,"quantity":1,"unit_price":19.00}
{"order_item_id":17,"order_id":116,"product_id":1,"quantity":1,"unit_price":129.00}
{"order_item_id":18,"order_id":117,"product_id":2,"quantity":1,"unit_price":49.00}
{"order_item_id":19,"order_id":118,"product_id":4,"quantity":1,"unit_price":299.00}
{"order_item_id":20,"order_id":119,"product_id":3,"quantity":1,"unit_price":35.00}
{"order_item_id":21,"order_id":120,"product_id":5,"quantity":1,"unit_price":42.00}
{"order_item_id":22,"order_id":121,"product_id":6,"quantity":1,"unit_price":69.00}
{"order_item_id":23,"order_id":122,"product_id":7,"quantity":1,"unit_price":199.00}
{"order_item_id":24,"order_id":123,"product_id":8,"quantity":1,"unit_price":19.00}
{"order_item_id":25,"order_id":124,"product_id":1,"quantity":1,"unit_price":129.00}
{"order_item_id":26,"order_id":125,"product_id":2,"quantity":1,"unit_price":49.00}
{"order_item_id":27,"order_id":126,"product_id":4,"quantity":1,"unit_price":299.00}
{"order_item_id":28,"order_id":127,"product_id":3,"quantity":1,"unit_price":35.00}
{"order_item_id":29,"order_id":128,"product_id":5,"quantity":1,"unit_price":42.00}
{"order_item_id":30,"order_id":129,"product_id":6,"quantity":1,"unit_price":69.00}
{"order_item_id":31,"order_id":100,"product_id":8,"quantity":2,"unit_price":19.00}
{"order_item_id":32,"order_id":102,"product_id":2,"quantity":1,"unit_price":49.00}
{"order_item_id":33,"order_id":106,"product_id":3,"quantity":1,"unit_price":35.00}
{"order_item_id":34,"order_id":110,"product_id":5,"quantity":2,"unit_price":42.00}
{"order_item_id":35,"order_id":114,"product_id":8,"quantity":1,"unit_price":19.00}
{"order_item_id":36,"order_id":122,"product_id":2,"quantity":1,"unit_price":49.00}
{"order_item_id":37,"order_id":126,"product_id":1,"quantity":1,"unit_price":129.00}
NDJSON

echo "=== Producing demo events (300 records) ==="
EVENT_TYPES=("page_view" "click" "scroll" "form_submit" "search" "add_to_cart" "purchase" "logout")
PAGES=("/home" "/products" "/product/123" "/cart" "/checkout" "/account" "/search" "/about")

for i in $(seq 1 300); do
  customer_id=$((1 + RANDOM % 12))
  event_type="${EVENT_TYPES[$((RANDOM % 8))]}"
  page="${PAGES[$((RANDOM % 8))]}"
  duration=$((50 + RANDOM % 10000))
  day=$((1 + RANDOM % 28))
  month=$((1 + RANDOM % 12))
  ts=$(printf "2025-%02d-%02dT%02d:%02d:%02dZ" $month $day $((RANDOM % 24)) $((RANDOM % 60)) $((RANDOM % 60)))
  echo "{\"event_id\":$i,\"customer_id\":$customer_id,\"event_type\":\"$event_type\",\"page\":\"$page\",\"duration_ms\":$duration,\"timestamp\":\"$ts\"}"
done | kafka-console-producer --bootstrap-server $BROKER --topic events

echo "=== Producing demo notifications (20 records) ==="
for i in $(seq 1 20); do
  customer_id=$((1 + RANDOM % 12))
  level=$([ $((RANDOM % 3)) -eq 0 ] && echo "warn" || echo "info")
  echo "{\"id\":$i,\"customer_id\":$customer_id,\"level\":\"$level\",\"message\":\"Notification $i\"}"
done | kafka-console-producer --bootstrap-server $BROKER --topic notifications

echo "=== Producing demo audit-log (100 records) ==="
ACTIONS=("login" "logout" "update_profile" "change_password" "delete_account" "export_data" "create_order" "cancel_order")
for i in $(seq 1 100); do
  customer_id=$((1 + RANDOM % 12))
  action="${ACTIONS[$((RANDOM % 8))]}"
  echo "{\"id\":$i,\"customer_id\":$customer_id,\"action\":\"$action\",\"ip\":\"10.0.$((RANDOM % 256)).$((RANDOM % 256))\"}"
done | kafka-console-producer --bootstrap-server $BROKER --topic audit-log

echo "=== Producing large events topic ($LARGE_EVENTS_COUNT records) ==="
kafka-topics --bootstrap-server $BROKER --create --if-not-exists --topic events_large --partitions 12 --replication-factor 1
# Skip re-producing on restart if the topic already holds the full dataset.
EXISTING=$(kafka-run-class kafka.tools.GetOffsetShell --broker-list $BROKER --topic events_large --time -1 2>/dev/null | awk -F: '{s+=$3} END{print s+0}')
if [ "$EXISTING" -ge "$LARGE_EVENTS_COUNT" ]; then
  echo "events_large already has $EXISTING records, skipping"
else
  awk -v n="$LARGE_EVENTS_COUNT" 'BEGIN{
    srand(42);
    split("page_view,click,scroll,form_submit,search,add_to_cart,purchase,logout",et,",");
    split("/home,/products,/product/123,/cart,/checkout,/account,/search,/about",pg,",");
    for(i=1;i<=n;i++){
      c=1+int(rand()*12); e=et[1+int(rand()*8)]; p=pg[1+int(rand()*8)];
      d=50+int(rand()*10000); mo=1+int(rand()*12); da=1+int(rand()*28);
      printf "{\"event_id\":%d,\"customer_id\":%d,\"event_type\":\"%s\",\"page\":\"%s\",\"duration_ms\":%d,\"timestamp\":\"2025-%02d-%02dT%02d:%02d:%02dZ\"}\n", i,c,e,p,d,mo,da,int(rand()*24),int(rand()*60),int(rand()*60);
    }
  }' | kafka-console-producer --bootstrap-server $BROKER --topic events_large \
      --producer-property compression.type=lz4 \
      --producer-property batch.size=1000000 \
      --producer-property linger.ms=100
fi

echo "=== Registering consumer groups ==="
timeout 10 kafka-console-consumer --bootstrap-server $BROKER --topic orders --group order-processing-svc --from-beginning --max-messages 5 > /dev/null 2>&1 || true
timeout 10 kafka-console-consumer --bootstrap-server $BROKER --topic events --group analytics-pipeline --from-beginning --max-messages 5 > /dev/null 2>&1 || true
timeout 10 kafka-console-consumer --bootstrap-server $BROKER --topic notifications --group notification-sender --from-beginning --max-messages 5 > /dev/null 2>&1 || true

echo "=== Kafka init complete: 8 topics, 3 consumer groups ==="
