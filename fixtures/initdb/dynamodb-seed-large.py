#!/usr/bin/env python3
"""Seeds DynamoDB Local with a large `events_large` table for exercising the
streaming query path (NextToken paging, multi-chunk RowChunkPump). Runs as a
one-shot sidecar (python:3-slim + boto3) against the `dynamodb` service.

DynamoDB Local has no in-database row generator, so items are generated here and
written with BatchWriteItem (25 per request) across a thread pool. The row shape
mirrors the Oracle/other large fixtures: event_id, customer_id, event_type,
page, duration_ms, event_ts.
"""
import concurrent.futures
import time

import boto3
from botocore.config import Config

ENDPOINT = "http://dynamodb:8000"
REGION = "us-east-1"
TABLE = "events_large"
TOTAL = 1_000_000
WORKERS = 16
EVENT_TYPES = ["view", "click", "scroll", "purchase"]
BASE_TS = "2025-01-01T00:00:00"
BASE_EPOCH = int(time.mktime(time.strptime(BASE_TS, "%Y-%m-%dT%H:%M:%S")))


def _client():
    # A fresh client per worker: boto3 clients are not meant to be shared across
    # threads. Generous pool + retries so the local emulator is not starved.
    cfg = Config(max_pool_connections=WORKERS * 2, retries={"max_attempts": 10})
    return boto3.client(
        "dynamodb",
        endpoint_url=ENDPOINT,
        region_name=REGION,
        aws_access_key_id="dummy",
        aws_secret_access_key="dummy",
        config=cfg,
    )


def _item(event_id):
    ts = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(BASE_EPOCH + event_id))
    return {
        "event_id": {"N": str(event_id)},
        "customer_id": {"N": str(event_id % 12 + 1)},
        "event_type": {"S": EVENT_TYPES[event_id % 4]},
        "page": {"S": f"/page/{event_id % 100}"},
        "duration_ms": {"N": str(event_id % 5000)},
        "event_ts": {"S": ts},
    }


def _write_range(start, end):
    client = _client()
    batch = []
    for event_id in range(start, end):
        batch.append({"PutRequest": {"Item": _item(event_id)}})
        if len(batch) == 25:
            _flush(client, batch)
            batch = []
    if batch:
        _flush(client, batch)


def _flush(client, batch):
    request = {TABLE: batch}
    while request:
        resp = client.batch_write_item(RequestItems=request)
        unprocessed = resp.get("UnprocessedItems") or {}
        request = unprocessed if unprocessed.get(TABLE) else None


def _wait_for_table():
    client = _client()
    while True:
        try:
            client.list_tables()
            return client
        except Exception:
            print("waiting for dynamodb-local...", flush=True)
            time.sleep(1)


def _ensure_table(client):
    existing = client.list_tables().get("TableNames", [])
    if TABLE in existing:
        count = client.describe_table(TableName=TABLE)["Table"]["ItemCount"]
        if count >= TOTAL:
            print(f"{TABLE} already seeded ({count} items), skipping.", flush=True)
            return False
    else:
        client.create_table(
            TableName=TABLE,
            AttributeDefinitions=[{"AttributeName": "event_id", "AttributeType": "N"}],
            KeySchema=[{"AttributeName": "event_id", "KeyType": "HASH"}],
            BillingMode="PAY_PER_REQUEST",
        )
        client.get_waiter("table_exists").wait(TableName=TABLE)
    return True


def main():
    client = _wait_for_table()
    if not _ensure_table(client):
        return
    print(f"seeding {TABLE} with {TOTAL} items across {WORKERS} workers...", flush=True)
    started = time.time()
    span = (TOTAL + WORKERS - 1) // WORKERS
    ranges = [(i * span + 1, min((i + 1) * span, TOTAL) + 1) for i in range(WORKERS)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = [pool.submit(_write_range, s, e) for s, e in ranges if s < e]
        for f in concurrent.futures.as_completed(futures):
            f.result()
    print(f"seeded {TABLE} in {time.time() - started:.1f}s", flush=True)


if __name__ == "__main__":
    main()
