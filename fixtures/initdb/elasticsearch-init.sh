#!/bin/sh
set -e

ES_URL="http://elasticsearch:9200"

es_put() {
  path="$1"
  curl -sS -X PUT "$ES_URL$path" -H 'Content-Type: application/json' --data-binary @-
}

es_post() {
  path="$1"
  content_type="$2"
  curl -sS -X POST "$ES_URL$path" -H "Content-Type: $content_type" --data-binary @-
}

curl -sS -X DELETE "$ES_URL/customers" >/dev/null || true
curl -sS -X DELETE "$ES_URL/products" >/dev/null || true
curl -sS -X DELETE "$ES_URL/orders" >/dev/null || true
curl -sS -X DELETE "$ES_URL/order_items" >/dev/null || true
curl -sS -X DELETE "$ES_URL/logs" >/dev/null || true
curl -sS -X DELETE "$ES_URL/events_10m" >/dev/null || true
curl -sS -X DELETE "$ES_URL/_data_stream/metrics-prod" >/dev/null || true

# =================================================================
# Canonical sample dataset — one index per table, same docs everywhere.
# Document _id matches the table primary key so cross-source joins line up.
# =================================================================

es_put "/customers" <<'JSON'
{
  "mappings": {
    "properties": {
      "customer_id": { "type": "integer" },
      "first_name": { "type": "text", "fields": { "keyword": { "type": "keyword" } } },
      "last_name": { "type": "text", "fields": { "keyword": { "type": "keyword" } } },
      "email": { "type": "keyword" },
      "country_code": { "type": "keyword" },
      "signup_date": { "type": "date" },
      "updated_at": { "type": "date" }
    }
  }
}
JSON

es_post "/customers/_bulk" "application/x-ndjson" <<'NDJSON'
{"index":{"_id":"1"}}
{"customer_id":1,"first_name":"Ada","last_name":"Lovelace","email":"ada@example.com","country_code":"GB","signup_date":"2025-01-01","updated_at":"2025-01-01T09:00:00Z"}
{"index":{"_id":"2"}}
{"customer_id":2,"first_name":"Grace","last_name":"Hopper","email":"grace@example.com","country_code":"US","signup_date":"2025-01-02","updated_at":"2025-01-02T09:00:00Z"}
{"index":{"_id":"3"}}
{"customer_id":3,"first_name":"Katherine","last_name":"Johnson","email":"katherine@example.com","country_code":"US","signup_date":"2025-01-03","updated_at":"2025-01-03T09:00:00Z"}
{"index":{"_id":"4"}}
{"customer_id":4,"first_name":"Radia","last_name":"Perlman","email":"radia@example.com","country_code":"CA","signup_date":"2025-01-04","updated_at":"2025-01-04T09:00:00Z"}
{"index":{"_id":"5"}}
{"customer_id":5,"first_name":"Margaret","last_name":"Hamilton","email":"margaret@example.com","country_code":"US","signup_date":"2025-01-05","updated_at":"2025-01-05T09:00:00Z"}
{"index":{"_id":"6"}}
{"customer_id":6,"first_name":"Barbara","last_name":"Liskov","email":"barbara@example.com","country_code":"US","signup_date":"2025-01-06","updated_at":"2025-01-06T09:00:00Z"}
{"index":{"_id":"7"}}
{"customer_id":7,"first_name":"Joan","last_name":"Clarke","email":"joan@example.com","country_code":"GB","signup_date":"2025-01-07","updated_at":"2025-01-07T09:00:00Z"}
{"index":{"_id":"8"}}
{"customer_id":8,"first_name":"Karen","last_name":"Sparck-Jones","email":"karen@example.com","country_code":"GB","signup_date":"2025-01-08","updated_at":"2025-01-08T09:00:00Z"}
{"index":{"_id":"9"}}
{"customer_id":9,"first_name":"Shafi","last_name":"Goldwasser","email":"shafi@example.com","country_code":"US","signup_date":"2025-01-09","updated_at":"2025-01-09T09:00:00Z"}
{"index":{"_id":"10"}}
{"customer_id":10,"first_name":"Frances","last_name":"Allen","email":"frances@example.com","country_code":"CA","signup_date":"2025-01-10","updated_at":"2025-01-10T09:00:00Z"}
{"index":{"_id":"11"}}
{"customer_id":11,"first_name":"Lynn","last_name":"Conway","email":"lynn@example.com","country_code":"AU","signup_date":"2025-01-11","updated_at":"2025-01-11T09:00:00Z"}
{"index":{"_id":"12"}}
{"customer_id":12,"first_name":"Sophie","last_name":"Wilson","email":"sophie@example.com","country_code":"DE","signup_date":"2025-01-12","updated_at":"2025-01-12T09:00:00Z"}
NDJSON

es_put "/products" <<'JSON'
{
  "mappings": {
    "properties": {
      "product_id": { "type": "integer" },
      "product_name": { "type": "text", "fields": { "keyword": { "type": "keyword" } } },
      "category": { "type": "keyword" },
      "price": { "type": "scaled_float", "scaling_factor": 100 }
    }
  }
}
JSON

es_post "/products/_bulk" "application/x-ndjson" <<'NDJSON'
{"index":{"_id":"1"}}
{"product_id":1,"product_name":"Mechanical Keyboard","category":"Peripherals","price":129.00}
{"index":{"_id":"2"}}
{"product_id":2,"product_name":"Wireless Mouse","category":"Peripherals","price":49.00}
{"index":{"_id":"3"}}
{"product_id":3,"product_name":"USB-C Hub","category":"Accessories","price":35.00}
{"index":{"_id":"4"}}
{"product_id":4,"product_name":"27in Monitor","category":"Displays","price":299.00}
{"index":{"_id":"5"}}
{"product_id":5,"product_name":"Laptop Stand","category":"Accessories","price":42.00}
{"index":{"_id":"6"}}
{"product_id":6,"product_name":"Webcam 1080p","category":"Peripherals","price":69.00}
{"index":{"_id":"7"}}
{"product_id":7,"product_name":"Noise-Cancelling Headphones","category":"Audio","price":199.00}
{"index":{"_id":"8"}}
{"product_id":8,"product_name":"Desk Mat","category":"Accessories","price":19.00}
NDJSON

es_put "/orders" <<'JSON'
{
  "mappings": {
    "properties": {
      "order_id": { "type": "integer" },
      "customer_id": { "type": "integer" },
      "order_date": { "type": "date" },
      "status": { "type": "keyword" },
      "amount": { "type": "scaled_float", "scaling_factor": 100 }
    }
  }
}
JSON

es_post "/orders/_bulk" "application/x-ndjson" <<'NDJSON'
{"index":{"_id":"100"}}
{"order_id":100,"customer_id":1,"order_date":"2025-01-03","status":"completed","amount":129.00}
{"index":{"_id":"101"}}
{"order_id":101,"customer_id":1,"order_date":"2025-01-15","status":"shipped","amount":49.00}
{"index":{"_id":"102"}}
{"order_id":102,"customer_id":2,"order_date":"2025-01-04","status":"completed","amount":299.00}
{"index":{"_id":"103"}}
{"order_id":103,"customer_id":3,"order_date":"2025-01-05","status":"pending","amount":35.00}
{"index":{"_id":"104"}}
{"order_id":104,"customer_id":4,"order_date":"2025-01-06","status":"returned","amount":42.00}
{"index":{"_id":"105"}}
{"order_id":105,"customer_id":5,"order_date":"2025-01-07","status":"completed","amount":69.00}
{"index":{"_id":"106"}}
{"order_id":106,"customer_id":6,"order_date":"2025-01-08","status":"completed","amount":199.00}
{"index":{"_id":"107"}}
{"order_id":107,"customer_id":7,"order_date":"2025-01-09","status":"shipped","amount":19.00}
{"index":{"_id":"108"}}
{"order_id":108,"customer_id":2,"order_date":"2025-01-12","status":"completed","amount":129.00}
{"index":{"_id":"109"}}
{"order_id":109,"customer_id":8,"order_date":"2025-01-14","status":"cancelled","amount":49.00}
{"index":{"_id":"110"}}
{"order_id":110,"customer_id":9,"order_date":"2025-01-16","status":"completed","amount":299.00}
{"index":{"_id":"111"}}
{"order_id":111,"customer_id":10,"order_date":"2025-01-18","status":"shipped","amount":35.00}
{"index":{"_id":"112"}}
{"order_id":112,"customer_id":11,"order_date":"2025-01-20","status":"completed","amount":42.00}
{"index":{"_id":"113"}}
{"order_id":113,"customer_id":12,"order_date":"2025-01-22","status":"pending","amount":69.00}
{"index":{"_id":"114"}}
{"order_id":114,"customer_id":1,"order_date":"2025-01-25","status":"completed","amount":199.00}
{"index":{"_id":"115"}}
{"order_id":115,"customer_id":3,"order_date":"2025-01-27","status":"completed","amount":19.00}
{"index":{"_id":"116"}}
{"order_id":116,"customer_id":5,"order_date":"2025-02-01","status":"shipped","amount":129.00}
{"index":{"_id":"117"}}
{"order_id":117,"customer_id":6,"order_date":"2025-02-03","status":"completed","amount":49.00}
{"index":{"_id":"118"}}
{"order_id":118,"customer_id":7,"order_date":"2025-02-05","status":"returned","amount":299.00}
{"index":{"_id":"119"}}
{"order_id":119,"customer_id":9,"order_date":"2025-02-07","status":"completed","amount":35.00}
{"index":{"_id":"120"}}
{"order_id":120,"customer_id":2,"order_date":"2025-02-09","status":"completed","amount":42.00}
{"index":{"_id":"121"}}
{"order_id":121,"customer_id":4,"order_date":"2025-02-11","status":"shipped","amount":69.00}
{"index":{"_id":"122"}}
{"order_id":122,"customer_id":8,"order_date":"2025-02-13","status":"completed","amount":199.00}
{"index":{"_id":"123"}}
{"order_id":123,"customer_id":10,"order_date":"2025-02-15","status":"pending","amount":19.00}
{"index":{"_id":"124"}}
{"order_id":124,"customer_id":11,"order_date":"2025-02-17","status":"completed","amount":129.00}
{"index":{"_id":"125"}}
{"order_id":125,"customer_id":12,"order_date":"2025-02-19","status":"shipped","amount":49.00}
{"index":{"_id":"126"}}
{"order_id":126,"customer_id":1,"order_date":"2025-02-21","status":"completed","amount":299.00}
{"index":{"_id":"127"}}
{"order_id":127,"customer_id":5,"order_date":"2025-02-23","status":"cancelled","amount":35.00}
{"index":{"_id":"128"}}
{"order_id":128,"customer_id":6,"order_date":"2025-02-25","status":"completed","amount":42.00}
{"index":{"_id":"129"}}
{"order_id":129,"customer_id":3,"order_date":"2025-02-27","status":"completed","amount":69.00}
NDJSON

es_put "/order_items" <<'JSON'
{
  "mappings": {
    "properties": {
      "order_item_id": { "type": "integer" },
      "order_id": { "type": "integer" },
      "product_id": { "type": "integer" },
      "quantity": { "type": "integer" },
      "unit_price": { "type": "scaled_float", "scaling_factor": 100 }
    }
  }
}
JSON

es_post "/order_items/_bulk" "application/x-ndjson" <<'NDJSON'
{"index":{"_id":"1"}}
{"order_item_id":1,"order_id":100,"product_id":1,"quantity":1,"unit_price":129.00}
{"index":{"_id":"2"}}
{"order_item_id":2,"order_id":101,"product_id":2,"quantity":1,"unit_price":49.00}
{"index":{"_id":"3"}}
{"order_item_id":3,"order_id":102,"product_id":4,"quantity":1,"unit_price":299.00}
{"index":{"_id":"4"}}
{"order_item_id":4,"order_id":103,"product_id":3,"quantity":1,"unit_price":35.00}
{"index":{"_id":"5"}}
{"order_item_id":5,"order_id":104,"product_id":5,"quantity":1,"unit_price":42.00}
{"index":{"_id":"6"}}
{"order_item_id":6,"order_id":105,"product_id":6,"quantity":1,"unit_price":69.00}
{"index":{"_id":"7"}}
{"order_item_id":7,"order_id":106,"product_id":7,"quantity":1,"unit_price":199.00}
{"index":{"_id":"8"}}
{"order_item_id":8,"order_id":107,"product_id":8,"quantity":1,"unit_price":19.00}
{"index":{"_id":"9"}}
{"order_item_id":9,"order_id":108,"product_id":1,"quantity":1,"unit_price":129.00}
{"index":{"_id":"10"}}
{"order_item_id":10,"order_id":109,"product_id":2,"quantity":1,"unit_price":49.00}
{"index":{"_id":"11"}}
{"order_item_id":11,"order_id":110,"product_id":4,"quantity":1,"unit_price":299.00}
{"index":{"_id":"12"}}
{"order_item_id":12,"order_id":111,"product_id":3,"quantity":1,"unit_price":35.00}
{"index":{"_id":"13"}}
{"order_item_id":13,"order_id":112,"product_id":5,"quantity":1,"unit_price":42.00}
{"index":{"_id":"14"}}
{"order_item_id":14,"order_id":113,"product_id":6,"quantity":1,"unit_price":69.00}
{"index":{"_id":"15"}}
{"order_item_id":15,"order_id":114,"product_id":7,"quantity":1,"unit_price":199.00}
{"index":{"_id":"16"}}
{"order_item_id":16,"order_id":115,"product_id":8,"quantity":1,"unit_price":19.00}
{"index":{"_id":"17"}}
{"order_item_id":17,"order_id":116,"product_id":1,"quantity":1,"unit_price":129.00}
{"index":{"_id":"18"}}
{"order_item_id":18,"order_id":117,"product_id":2,"quantity":1,"unit_price":49.00}
{"index":{"_id":"19"}}
{"order_item_id":19,"order_id":118,"product_id":4,"quantity":1,"unit_price":299.00}
{"index":{"_id":"20"}}
{"order_item_id":20,"order_id":119,"product_id":3,"quantity":1,"unit_price":35.00}
{"index":{"_id":"21"}}
{"order_item_id":21,"order_id":120,"product_id":5,"quantity":1,"unit_price":42.00}
{"index":{"_id":"22"}}
{"order_item_id":22,"order_id":121,"product_id":6,"quantity":1,"unit_price":69.00}
{"index":{"_id":"23"}}
{"order_item_id":23,"order_id":122,"product_id":7,"quantity":1,"unit_price":199.00}
{"index":{"_id":"24"}}
{"order_item_id":24,"order_id":123,"product_id":8,"quantity":1,"unit_price":19.00}
{"index":{"_id":"25"}}
{"order_item_id":25,"order_id":124,"product_id":1,"quantity":1,"unit_price":129.00}
{"index":{"_id":"26"}}
{"order_item_id":26,"order_id":125,"product_id":2,"quantity":1,"unit_price":49.00}
{"index":{"_id":"27"}}
{"order_item_id":27,"order_id":126,"product_id":4,"quantity":1,"unit_price":299.00}
{"index":{"_id":"28"}}
{"order_item_id":28,"order_id":127,"product_id":3,"quantity":1,"unit_price":35.00}
{"index":{"_id":"29"}}
{"order_item_id":29,"order_id":128,"product_id":5,"quantity":1,"unit_price":42.00}
{"index":{"_id":"30"}}
{"order_item_id":30,"order_id":129,"product_id":6,"quantity":1,"unit_price":69.00}
{"index":{"_id":"31"}}
{"order_item_id":31,"order_id":100,"product_id":8,"quantity":2,"unit_price":19.00}
{"index":{"_id":"32"}}
{"order_item_id":32,"order_id":102,"product_id":2,"quantity":1,"unit_price":49.00}
{"index":{"_id":"33"}}
{"order_item_id":33,"order_id":106,"product_id":3,"quantity":1,"unit_price":35.00}
{"index":{"_id":"34"}}
{"order_item_id":34,"order_id":110,"product_id":5,"quantity":2,"unit_price":42.00}
{"index":{"_id":"35"}}
{"order_item_id":35,"order_id":114,"product_id":8,"quantity":1,"unit_price":19.00}
{"index":{"_id":"36"}}
{"order_item_id":36,"order_id":122,"product_id":2,"quantity":1,"unit_price":49.00}
{"index":{"_id":"37"}}
{"order_item_id":37,"order_id":126,"product_id":1,"quantity":1,"unit_price":129.00}
NDJSON

es_put "/customers/_alias/customers_read" <<'JSON'
{}
JSON

es_put "/customers/_alias/us_customers" <<'JSON'
{
  "filter": {
    "term": {
      "country_code": "US"
    }
  }
}
JSON

# =================================================================
# Feature-demo indices (ip, date_nanos, data streams, flattened) for the
# schema browser — not part of the canonical dataset.
# =================================================================

es_put "/_index_template/metrics-template" <<'JSON'
{
  "index_patterns": ["metrics-*"],
  "priority": 200,
  "data_stream": {},
  "template": {
    "mappings": {
      "properties": {
        "@timestamp": { "type": "date" },
        "service": { "type": "keyword" },
        "host": { "type": "keyword" },
        "cpu_pct": { "type": "float" },
        "mem_bytes": { "type": "long" },
        "labels": { "type": "flattened" }
      }
    }
  }
}
JSON

es_put "/logs" <<'JSON'
{
  "mappings": {
    "properties": {
      "timestamp": { "type": "date_nanos" },
      "level": { "type": "keyword" },
      "service": { "type": "keyword" },
      "message": {
        "type": "text",
        "fields": {
          "keyword": { "type": "keyword" }
        }
      },
      "request_ip": { "type": "ip" },
      "duration_ms": { "type": "integer" }
    }
  }
}
JSON

es_post "/logs/_bulk" "application/x-ndjson" <<'NDJSON'
{"index":{}}
{"timestamp":"2025-04-01T10:00:00.123456789Z","level":"INFO","service":"api","message":"Server started on port 8080","request_ip":"10.0.0.12","duration_ms":7}
{"index":{}}
{"timestamp":"2025-04-01T10:05:23.456789123Z","level":"WARN","service":"api","message":"Slow query detected","request_ip":"10.0.0.34","duration_ms":2300}
{"index":{}}
{"timestamp":"2025-04-01T10:10:45.999000111Z","level":"ERROR","service":"worker","message":"Failed to process job #4521","request_ip":"10.0.1.4","duration_ms":984}
{"index":{}}
{"timestamp":"2025-04-01T10:15:00.000100200Z","level":"INFO","service":"worker","message":"Retrying job #4521","request_ip":"10.0.1.4","duration_ms":82}
{"index":{}}
{"timestamp":"2025-04-01T10:15:02.000100200Z","level":"INFO","service":"worker","message":"Job #4521 completed successfully","request_ip":"10.0.1.4","duration_ms":41}
NDJSON

es_put "/logs/_alias/logs_current" <<'JSON'
{}
JSON

curl -sS -X PUT "$ES_URL/_data_stream/metrics-prod"

es_post "/metrics-prod/_bulk" "application/x-ndjson" <<'NDJSON'
{"create":{}}
{"@timestamp":"2025-04-01T10:00:00Z","service":"api","host":"api-1","cpu_pct":0.42,"mem_bytes":482344960,"labels":{"region":"us-west","env":"dev"}}
{"create":{}}
{"@timestamp":"2025-04-01T10:01:00Z","service":"api","host":"api-2","cpu_pct":0.64,"mem_bytes":598736896,"labels":{"region":"us-west","env":"dev"}}
{"create":{}}
{"@timestamp":"2025-04-01T10:02:00Z","service":"worker","host":"worker-1","cpu_pct":0.81,"mem_bytes":734003200,"labels":{"region":"us-east","env":"dev"}}
NDJSON

# =================================================================
# Large index for streaming-ingestion testing. 10M docs; refresh is
# disabled during the bulk load and re-enabled after, so indexing stays
# fast on the small container heap.
# =================================================================

es_put "/events_10m" <<'JSON'
{
  "settings": { "refresh_interval": "-1", "number_of_replicas": 0 },
  "mappings": {
    "properties": {
      "id": { "type": "long" },
      "user_id": { "type": "integer" },
      "event_type": { "type": "keyword" },
      "event_time": { "type": "date" },
      "device": { "type": "keyword" },
      "country": { "type": "keyword" },
      "amount": { "type": "scaled_float", "scaling_factor": 100 }
    }
  }
}
JSON

echo "Seeding events_10m (10,000,000 docs)..."
TOTAL=10000000
BATCH=10000
i=0
while [ $i -lt $TOTAL ]; do
  end=$((i + BATCH))
  awk -v s="$i" -v e="$end" 'BEGIN {
    split("view click purchase signup logout", et, " ")
    split("ios android web", dv, " ")
    split("US GB DE CA AU JP", cc, " ")
    for (n = s + 1; n <= e; n++) {
      printf "{\"index\":{\"_id\":\"%d\"}}\n", n
      printf "{\"id\":%d,\"user_id\":%d,\"event_type\":\"%s\",\"event_time\":\"2025-06-%02dT00:00:00Z\",\"device\":\"%s\",\"country\":\"%s\",\"amount\":%d.%02d}\n", \
        n, n % 100000, et[(n % 5) + 1], (n % 28) + 1, dv[(n % 3) + 1], cc[(n % 6) + 1], n % 500, n % 100
    }
  }' | curl -sS -X POST "$ES_URL/events_10m/_bulk" \
    -H 'Content-Type: application/x-ndjson' --data-binary @- >/dev/null
  i=$end
done

es_put "/events_10m/_settings" <<'JSON'
{ "index": { "refresh_interval": "1s" } }
JSON

curl -sS -X POST "$ES_URL/_refresh"

echo ""
echo "Elasticsearch seed data loaded."
