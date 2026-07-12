#!/usr/bin/env bash
# Seeds the embedded-engine fixture databases (no container, unlike initdb/):
#   fixtures/embedded/events.duckdb  (DuckDB)
#   fixtures/embedded/events.db      (SQLite)
# Each gets a 10,000,000-row events_10m table matching the mysql/starrocks
# fixture schema, used to exercise streaming ingestion from the app.
# Requires the duckdb and sqlite3 CLIs (brew install duckdb; sqlite3 ships
# with macOS). Safe to re-run: the table is dropped and rebuilt.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p embedded

command -v duckdb >/dev/null || { echo "duckdb CLI not found (brew install duckdb)" >&2; exit 1; }
command -v sqlite3 >/dev/null || { echo "sqlite3 CLI not found" >&2; exit 1; }

echo "Seeding embedded/events.duckdb (10M rows)..."
duckdb embedded/events.duckdb <<'SQL'
CREATE OR REPLACE TABLE events_10m AS
SELECT
    range + 1 AS id,
    (1 + floor(random() * 1000000))::INTEGER AS user_id,
    ['view','click','purchase','signup','logout','share'][(1 + floor(random() * 6))::INT] AS event_type,
    TIMESTAMP '2024-01-01 00:00:00' + to_seconds((floor(random() * 31536000))::BIGINT) AS event_time,
    ['ios','android','web','desktop'][(1 + floor(random() * 4))::INT] AS device,
    ['US','UK','Canada','Germany','France','Japan','Australia','Brazil','India','Mexico'][(1 + floor(random() * 10))::INT] AS country,
    round(random() * 1000, 2)::DECIMAL(10,2) AS amount
FROM range(10000000);
SELECT 'duckdb events_10m rows: ' || COUNT(*) FROM events_10m;
SQL

echo "Seeding embedded/events.db (10M rows)..."
sqlite3 embedded/events.db <<'SQL'
PRAGMA journal_mode = OFF;
PRAGMA synchronous = OFF;
DROP TABLE IF EXISTS events_10m;
CREATE TABLE events_10m (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    event_type  TEXT NOT NULL,
    event_time  TEXT NOT NULL,
    device      TEXT NOT NULL,
    country     TEXT NOT NULL,
    amount      REAL NOT NULL
);
INSERT INTO events_10m (id, user_id, event_type, event_time, device, country, amount)
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 10000000)
SELECT
    n,
    1 + abs(random()) % 1000000,
    CASE abs(random()) % 6
        WHEN 0 THEN 'view' WHEN 1 THEN 'click' WHEN 2 THEN 'purchase'
        WHEN 3 THEN 'signup' WHEN 4 THEN 'logout' ELSE 'share' END,
    datetime('2024-01-01 00:00:00', '+' || (abs(random()) % 31536000) || ' seconds'),
    CASE abs(random()) % 4
        WHEN 0 THEN 'ios' WHEN 1 THEN 'android' WHEN 2 THEN 'web' ELSE 'desktop' END,
    CASE abs(random()) % 10
        WHEN 0 THEN 'US' WHEN 1 THEN 'UK' WHEN 2 THEN 'Canada' WHEN 3 THEN 'Germany'
        WHEN 4 THEN 'France' WHEN 5 THEN 'Japan' WHEN 6 THEN 'Australia'
        WHEN 7 THEN 'Brazil' WHEN 8 THEN 'India' ELSE 'Mexico' END,
    round((abs(random()) % 100000) / 100.0, 2)
FROM seq;
SELECT 'sqlite events_10m rows: ' || COUNT(*) FROM events_10m;
SQL

echo "Done. Connect with file paths:"
echo "  DuckDB: $(pwd)/embedded/events.duckdb"
echo "  SQLite: $(pwd)/embedded/events.db"
