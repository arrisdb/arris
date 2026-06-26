#!/bin/bash
set -e

REDIS="redis-cli -h redis -p 6379"

echo "=== Populating Redis db 0 with sample data ==="

# =================================================================
# Canonical sample dataset — one hash per row, key `<table>:<pk>`.
# Same keys / fields / values as every other engine so cross-source
# joins line up.
# =================================================================
echo "--- canonical customers ---"
$REDIS HSET customers:1  customer_id 1  first_name Ada       last_name Lovelace     email ada@example.com       country_code GB signup_date 2025-01-01 updated_at 2025-01-01T09:00:00Z
$REDIS HSET customers:2  customer_id 2  first_name Grace     last_name Hopper       email grace@example.com     country_code US signup_date 2025-01-02 updated_at 2025-01-02T09:00:00Z
$REDIS HSET customers:3  customer_id 3  first_name Katherine last_name Johnson      email katherine@example.com country_code US signup_date 2025-01-03 updated_at 2025-01-03T09:00:00Z
$REDIS HSET customers:4  customer_id 4  first_name Radia     last_name Perlman      email radia@example.com     country_code CA signup_date 2025-01-04 updated_at 2025-01-04T09:00:00Z
$REDIS HSET customers:5  customer_id 5  first_name Margaret  last_name Hamilton     email margaret@example.com  country_code US signup_date 2025-01-05 updated_at 2025-01-05T09:00:00Z
$REDIS HSET customers:6  customer_id 6  first_name Barbara   last_name Liskov       email barbara@example.com   country_code US signup_date 2025-01-06 updated_at 2025-01-06T09:00:00Z
$REDIS HSET customers:7  customer_id 7  first_name Joan      last_name Clarke       email joan@example.com      country_code GB signup_date 2025-01-07 updated_at 2025-01-07T09:00:00Z
$REDIS HSET customers:8  customer_id 8  first_name Karen     last_name Sparck-Jones email karen@example.com     country_code GB signup_date 2025-01-08 updated_at 2025-01-08T09:00:00Z
$REDIS HSET customers:9  customer_id 9  first_name Shafi     last_name Goldwasser   email shafi@example.com     country_code US signup_date 2025-01-09 updated_at 2025-01-09T09:00:00Z
$REDIS HSET customers:10 customer_id 10 first_name Frances   last_name Allen        email frances@example.com   country_code CA signup_date 2025-01-10 updated_at 2025-01-10T09:00:00Z
$REDIS HSET customers:11 customer_id 11 first_name Lynn      last_name Conway       email lynn@example.com      country_code AU signup_date 2025-01-11 updated_at 2025-01-11T09:00:00Z
$REDIS HSET customers:12 customer_id 12 first_name Sophie    last_name Wilson       email sophie@example.com    country_code DE signup_date 2025-01-12 updated_at 2025-01-12T09:00:00Z

echo "--- canonical products ---"
$REDIS HSET products:1 product_id 1 product_name "Mechanical Keyboard"         category Peripherals price 129.00
$REDIS HSET products:2 product_id 2 product_name "Wireless Mouse"              category Peripherals price 49.00
$REDIS HSET products:3 product_id 3 product_name "USB-C Hub"                   category Accessories price 35.00
$REDIS HSET products:4 product_id 4 product_name "27in Monitor"               category Displays    price 299.00
$REDIS HSET products:5 product_id 5 product_name "Laptop Stand"               category Accessories price 42.00
$REDIS HSET products:6 product_id 6 product_name "Webcam 1080p"               category Peripherals price 69.00
$REDIS HSET products:7 product_id 7 product_name "Noise-Cancelling Headphones" category Audio      price 199.00
$REDIS HSET products:8 product_id 8 product_name "Desk Mat"                   category Accessories price 19.00

echo "--- canonical orders ---"
$REDIS HSET orders:100 order_id 100 customer_id 1  order_date 2025-01-03 status completed amount 129.00
$REDIS HSET orders:101 order_id 101 customer_id 1  order_date 2025-01-15 status shipped   amount 49.00
$REDIS HSET orders:102 order_id 102 customer_id 2  order_date 2025-01-04 status completed amount 299.00
$REDIS HSET orders:103 order_id 103 customer_id 3  order_date 2025-01-05 status pending   amount 35.00
$REDIS HSET orders:104 order_id 104 customer_id 4  order_date 2025-01-06 status returned  amount 42.00
$REDIS HSET orders:105 order_id 105 customer_id 5  order_date 2025-01-07 status completed amount 69.00
$REDIS HSET orders:106 order_id 106 customer_id 6  order_date 2025-01-08 status completed amount 199.00
$REDIS HSET orders:107 order_id 107 customer_id 7  order_date 2025-01-09 status shipped   amount 19.00
$REDIS HSET orders:108 order_id 108 customer_id 2  order_date 2025-01-12 status completed amount 129.00
$REDIS HSET orders:109 order_id 109 customer_id 8  order_date 2025-01-14 status cancelled amount 49.00
$REDIS HSET orders:110 order_id 110 customer_id 9  order_date 2025-01-16 status completed amount 299.00
$REDIS HSET orders:111 order_id 111 customer_id 10 order_date 2025-01-18 status shipped   amount 35.00
$REDIS HSET orders:112 order_id 112 customer_id 11 order_date 2025-01-20 status completed amount 42.00
$REDIS HSET orders:113 order_id 113 customer_id 12 order_date 2025-01-22 status pending   amount 69.00
$REDIS HSET orders:114 order_id 114 customer_id 1  order_date 2025-01-25 status completed amount 199.00
$REDIS HSET orders:115 order_id 115 customer_id 3  order_date 2025-01-27 status completed amount 19.00
$REDIS HSET orders:116 order_id 116 customer_id 5  order_date 2025-02-01 status shipped   amount 129.00
$REDIS HSET orders:117 order_id 117 customer_id 6  order_date 2025-02-03 status completed amount 49.00
$REDIS HSET orders:118 order_id 118 customer_id 7  order_date 2025-02-05 status returned  amount 299.00
$REDIS HSET orders:119 order_id 119 customer_id 9  order_date 2025-02-07 status completed amount 35.00
$REDIS HSET orders:120 order_id 120 customer_id 2  order_date 2025-02-09 status completed amount 42.00
$REDIS HSET orders:121 order_id 121 customer_id 4  order_date 2025-02-11 status shipped   amount 69.00
$REDIS HSET orders:122 order_id 122 customer_id 8  order_date 2025-02-13 status completed amount 199.00
$REDIS HSET orders:123 order_id 123 customer_id 10 order_date 2025-02-15 status pending   amount 19.00
$REDIS HSET orders:124 order_id 124 customer_id 11 order_date 2025-02-17 status completed amount 129.00
$REDIS HSET orders:125 order_id 125 customer_id 12 order_date 2025-02-19 status shipped   amount 49.00
$REDIS HSET orders:126 order_id 126 customer_id 1  order_date 2025-02-21 status completed amount 299.00
$REDIS HSET orders:127 order_id 127 customer_id 5  order_date 2025-02-23 status cancelled amount 35.00
$REDIS HSET orders:128 order_id 128 customer_id 6  order_date 2025-02-25 status completed amount 42.00
$REDIS HSET orders:129 order_id 129 customer_id 3  order_date 2025-02-27 status completed amount 69.00

echo "--- canonical order_items ---"
$REDIS HSET order_items:1  order_item_id 1  order_id 100 product_id 1 quantity 1 unit_price 129.00
$REDIS HSET order_items:2  order_item_id 2  order_id 101 product_id 2 quantity 1 unit_price 49.00
$REDIS HSET order_items:3  order_item_id 3  order_id 102 product_id 4 quantity 1 unit_price 299.00
$REDIS HSET order_items:4  order_item_id 4  order_id 103 product_id 3 quantity 1 unit_price 35.00
$REDIS HSET order_items:5  order_item_id 5  order_id 104 product_id 5 quantity 1 unit_price 42.00
$REDIS HSET order_items:6  order_item_id 6  order_id 105 product_id 6 quantity 1 unit_price 69.00
$REDIS HSET order_items:7  order_item_id 7  order_id 106 product_id 7 quantity 1 unit_price 199.00
$REDIS HSET order_items:8  order_item_id 8  order_id 107 product_id 8 quantity 1 unit_price 19.00
$REDIS HSET order_items:9  order_item_id 9  order_id 108 product_id 1 quantity 1 unit_price 129.00
$REDIS HSET order_items:10 order_item_id 10 order_id 109 product_id 2 quantity 1 unit_price 49.00
$REDIS HSET order_items:11 order_item_id 11 order_id 110 product_id 4 quantity 1 unit_price 299.00
$REDIS HSET order_items:12 order_item_id 12 order_id 111 product_id 3 quantity 1 unit_price 35.00
$REDIS HSET order_items:13 order_item_id 13 order_id 112 product_id 5 quantity 1 unit_price 42.00
$REDIS HSET order_items:14 order_item_id 14 order_id 113 product_id 6 quantity 1 unit_price 69.00
$REDIS HSET order_items:15 order_item_id 15 order_id 114 product_id 7 quantity 1 unit_price 199.00
$REDIS HSET order_items:16 order_item_id 16 order_id 115 product_id 8 quantity 1 unit_price 19.00
$REDIS HSET order_items:17 order_item_id 17 order_id 116 product_id 1 quantity 1 unit_price 129.00
$REDIS HSET order_items:18 order_item_id 18 order_id 117 product_id 2 quantity 1 unit_price 49.00
$REDIS HSET order_items:19 order_item_id 19 order_id 118 product_id 4 quantity 1 unit_price 299.00
$REDIS HSET order_items:20 order_item_id 20 order_id 119 product_id 3 quantity 1 unit_price 35.00
$REDIS HSET order_items:21 order_item_id 21 order_id 120 product_id 5 quantity 1 unit_price 42.00
$REDIS HSET order_items:22 order_item_id 22 order_id 121 product_id 6 quantity 1 unit_price 69.00
$REDIS HSET order_items:23 order_item_id 23 order_id 122 product_id 7 quantity 1 unit_price 199.00
$REDIS HSET order_items:24 order_item_id 24 order_id 123 product_id 8 quantity 1 unit_price 19.00
$REDIS HSET order_items:25 order_item_id 25 order_id 124 product_id 1 quantity 1 unit_price 129.00
$REDIS HSET order_items:26 order_item_id 26 order_id 125 product_id 2 quantity 1 unit_price 49.00
$REDIS HSET order_items:27 order_item_id 27 order_id 126 product_id 4 quantity 1 unit_price 299.00
$REDIS HSET order_items:28 order_item_id 28 order_id 127 product_id 3 quantity 1 unit_price 35.00
$REDIS HSET order_items:29 order_item_id 29 order_id 128 product_id 5 quantity 1 unit_price 42.00
$REDIS HSET order_items:30 order_item_id 30 order_id 129 product_id 6 quantity 1 unit_price 69.00
$REDIS HSET order_items:31 order_item_id 31 order_id 100 product_id 8 quantity 2 unit_price 19.00
$REDIS HSET order_items:32 order_item_id 32 order_id 102 product_id 2 quantity 1 unit_price 49.00
$REDIS HSET order_items:33 order_item_id 33 order_id 106 product_id 3 quantity 1 unit_price 35.00
$REDIS HSET order_items:34 order_item_id 34 order_id 110 product_id 5 quantity 2 unit_price 42.00
$REDIS HSET order_items:35 order_item_id 35 order_id 114 product_id 8 quantity 1 unit_price 19.00
$REDIS HSET order_items:36 order_item_id 36 order_id 122 product_id 2 quantity 1 unit_price 49.00
$REDIS HSET order_items:37 order_item_id 37 order_id 126 product_id 1 quantity 1 unit_price 129.00

# =================================================================
# Feature-demo keys exercising every Redis data type for the schema browser.
# =================================================================

# ── Strings ──────────────────────────────────────────────────
echo "--- strings ---"
$REDIS SET app:config:site_name "Arris Demo"
$REDIS SET app:config:max_connections 100
$REDIS SET app:config:debug_mode "false"
$REDIS SET app:config:version "2.4.1"
$REDIS SET app:config:motd "Welcome to the Arris demo environment"

for i in $(seq 1 20); do
  $REDIS SET "session:token:$i" "tok_$(head -c 16 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 24)"
  $REDIS EXPIRE "session:token:$i" $((3600 + RANDOM % 7200))
done

# ── Lists ────────────────────────────────────────────────────
echo "--- lists ---"
LEVELS=("INFO" "WARN" "ERROR" "DEBUG")
COMPONENTS=("api" "auth" "db" "cache" "worker")
MESSAGES=("request processed" "cache miss" "connection timeout" "retry succeeded" "rate limit hit"
          "query slow" "batch complete" "health check ok" "token refreshed" "schema migrated")

for i in $(seq 1 50); do
  level="${LEVELS[$((RANDOM % 4))]}"
  comp="${COMPONENTS[$((RANDOM % 5))]}"
  msg="${MESSAGES[$((RANDOM % 10))]}"
  $REDIS RPUSH "logs:app" "[$level] $comp: $msg (seq=$i)"
done

TASKS=("Send welcome email" "Generate invoice" "Resize image" "Sync inventory" "Rebuild index"
       "Notify admin" "Export CSV" "Purge cache" "Run backup" "Update sitemap")
for i in $(seq 0 9); do
  $REDIS RPUSH "queue:jobs" "${TASKS[$i]}"
done

# ── Sets ─────────────────────────────────────────────────────
echo "--- sets ---"
ROLES=("admin" "editor" "viewer" "analyst" "developer")
TAGS=("redis" "nosql" "caching" "pubsub" "streams" "cluster" "sentinel" "lua" "pipelining" "transactions")
for tag in "${TAGS[@]}"; do
  $REDIS SADD "tags:all" "$tag"
done

for i in 1 2 3 4 5; do
  count=$((2 + RANDOM % 6))
  for j in $(seq 1 $count); do
    $REDIS SADD "customer:$i:roles" "${ROLES[$((RANDOM % 5))]}"
  done
done

$REDIS SADD "features:enabled" "dark_mode" "notifications" "export_csv" "two_factor"
$REDIS SADD "features:disabled" "beta_ui" "ai_assistant" "webhooks"

# ── Sorted Sets ──────────────────────────────────────────────
echo "--- sorted sets ---"
for i in $(seq 1 20); do
  score=$((RANDOM % 10000))
  $REDIS ZADD "leaderboard:points" "$score" "player:$i"
done

for i in $(seq 1 15); do
  ts=$((1700000000 + RANDOM % 1000000))
  $REDIS ZADD "events:timeline" "$ts" "event:$i"
done

PAGES=("/home" "/products" "/about" "/contact" "/blog" "/docs" "/pricing" "/login" "/signup" "/faq")
for page in "${PAGES[@]}"; do
  hits=$((10 + RANDOM % 5000))
  $REDIS ZADD "analytics:page_views" "$hits" "$page"
done

# ── Streams ──────────────────────────────────────────────────
echo "--- streams ---"
EVENT_TYPES=("login" "logout" "purchase" "refund" "signup" "password_reset")
for i in $(seq 1 30); do
  event_type="${EVENT_TYPES[$((RANDOM % 6))]}"
  customer_id=$((1 + RANDOM % 12))
  $REDIS XADD "stream:customer_events" "*" event "$event_type" customer_id "$customer_id" source "web" seq "$i"
done

ORDER_STATUSES=("created" "paid" "packed" "shipped" "delivered" "cancelled")
for i in $(seq 1 20); do
  status="${ORDER_STATUSES[$((RANDOM % 6))]}"
  amount="$((10 + RANDOM % 900)).$(printf '%02d' $((RANDOM % 100)))"
  $REDIS XADD "stream:orders" "*" order_id "ord_$i" status "$status" amount "$amount"
done

for i in $(seq 1 15); do
  level="${LEVELS[$((RANDOM % 4))]}"
  comp="${COMPONENTS[$((RANDOM % 5))]}"
  $REDIS XADD "stream:audit" "*" level "$level" component "$comp" action "metadata_seed" seq "$i"
done

# ── Populate db 1 with a few keys so list_schemas sees multiple databases ──
echo "--- db 1 ---"
$REDIS -n 1 SET "cache:warm" "yes"
$REDIS -n 1 SET "cache:ttl" "3600"
$REDIS -n 1 HSET "cache:stats" hits 12345 misses 678
$REDIS -n 1 LPUSH "cache:recent_keys" "cache:warm" "cache:ttl" "cache:stats"
$REDIS -n 1 SADD "cache:segments" "hot" "warm" "cold"
$REDIS -n 1 ZADD "cache:eviction_priority" 1 "cache:ttl" 2 "cache:warm" 3 "cache:stats"
$REDIS -n 1 XADD "cache:events" "*" event "warmup" status "ok"

echo "=== Redis init complete: canonical hashes + feature-demo keys across db 0 and db 1 ==="
