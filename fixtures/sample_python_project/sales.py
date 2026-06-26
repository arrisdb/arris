"""Tiny sales helpers used by main.py and mirrored in analysis.ipynb.

Pure standard library so it runs under any Python 3 interpreter.
"""

from __future__ import annotations

import statistics

DAILY_SALES = [120, 95, 143, 88, 167, 210, 130]


def summary(sales: list[int]) -> dict[str, float]:
    """Mean, median and population standard deviation of daily sales."""
    return {
        "mean": round(statistics.mean(sales), 2),
        "median": statistics.median(sales),
        "stdev": round(statistics.pstdev(sales), 2),
    }


def best_day(sales: list[int]) -> tuple[int, int]:
    """Return the 1-based day number and units of the best sales day."""
    peak = max(range(len(sales)), key=lambda i: sales[i])
    return peak + 1, sales[peak]
