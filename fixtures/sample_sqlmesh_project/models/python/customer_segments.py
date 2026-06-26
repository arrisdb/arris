from __future__ import annotations

import typing as t
from datetime import datetime

import pandas as pd
from sqlmesh import ExecutionContext, model


@model(
    "analytics_shop.customer_segments",
    kind="FULL",
    columns={
        "customer_id": "int",
        "lifetime_value": "double",
        "segment": "text",
    },
    grain="customer_id",
    description="Buckets customers into value segments based on lifetime value.",
)
def execute(
    context: ExecutionContext,
    start: datetime,
    end: datetime,
    execution_time: datetime,
    **kwargs: t.Any,
) -> pd.DataFrame:
    table = context.resolve_table("analytics_shop.dim_customers")
    df = context.fetchdf(f"SELECT customer_id, lifetime_value FROM {table}")

    def bucket(value: float) -> str:
        if value >= 500:
            return "high"
        if value >= 100:
            return "medium"
        return "low"

    df["segment"] = df["lifetime_value"].apply(bucket)
    return df
