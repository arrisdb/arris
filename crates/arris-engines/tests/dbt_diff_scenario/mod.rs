//! Shared dbt slim-diff scenario used by the per-source integration tests.
//!
//! Every in-scope dialect runs the SAME canonical diff and must produce the
//! same hand-computed counts, proving `DiffSqlBuilder`'s per-dialect set-diff
//! SQL is correct against a real instance. Each source file sets up the scenario
//! in its own DDL (identifier quoting/casing differs per engine) and passes the
//! resulting prod relation + new-side SELECT here. The diff SQL runs through the
//! engine's `DatabaseDriver::run_query` — the same path the app uses.
//!
//! Canonical scenario (shared columns `id`, `amount`; key column `id`):
//!   prod rows: (1, 100) (2, 200) (3, 300)
//!   new  rows: (2, 200) (3, 333) (4, 400)
//! Keyless full-row diff: added 2 {(3,333),(4,400)}, removed 2 {(1,100),(3,300)}.
//! Keyed-by-id diff: added 1 {id 4}, removed 1 {id 1}, updated 1 {id 3}.

#![allow(dead_code)]

use arris_engines::dbt::{DiffDialect, DiffSqlBuilder};
use arris_engines::{DatabaseDriver, QueryLanguage, QueryResult};

async fn run(driver: &dyn DatabaseDriver, sql: &str) -> QueryResult {
    driver
        .run_query(sql, &[], QueryLanguage::Native)
        .await
        .unwrap_or_else(|e| panic!("diff query failed: {sql}\n  error: {e:?}"))
}

fn cols(names: &[&str]) -> Vec<String> {
    names.iter().map(|s| s.to_string()).collect()
}

fn builder(
    dialect: DiffDialect,
    prod_relation: &str,
    new_select: &str,
    keyed: bool,
) -> DiffSqlBuilder {
    DiffSqlBuilder::new(
        dialect,
        prod_relation.to_string(),
        new_select.to_string(),
        cols(&["id", "amount"]),
        if keyed { cols(&["id"]) } else { Vec::new() },
        50,
    )
}

async fn count_rows(driver: &dyn DatabaseDriver, sql: &str) -> usize {
    run(driver, sql).await.rows.len()
}

/// Run the keyless diff and assert the hand-computed counts and sample sizes.
pub async fn assert_keyless(
    driver: &dyn DatabaseDriver,
    dialect: DiffDialect,
    prod_relation: &str,
    new_select: &str,
) {
    let b = builder(dialect, prod_relation, new_select, false);
    let counts = run(driver, &b.counts_sql()).await;
    let row = counts.rows.first().expect("counts row");
    assert_eq!(DiffSqlBuilder::count_at(row, 0), 3, "new_total");
    assert_eq!(DiffSqlBuilder::count_at(row, 1), 3, "prod_total");
    assert_eq!(DiffSqlBuilder::count_at(row, 2), 2, "added_count");
    assert_eq!(DiffSqlBuilder::count_at(row, 3), 2, "removed_count");
    assert_eq!(DiffSqlBuilder::count_at(row, 4), 0, "updated_count");

    assert_eq!(count_rows(driver, &b.added_sample_sql()).await, 2, "added sample");
    assert_eq!(count_rows(driver, &b.removed_sample_sql()).await, 2, "removed sample");
}

/// Run the id-keyed diff and assert the hand-computed counts and aligned samples.
pub async fn assert_keyed(
    driver: &dyn DatabaseDriver,
    dialect: DiffDialect,
    prod_relation: &str,
    new_select: &str,
) {
    let b = builder(dialect, prod_relation, new_select, true);
    let counts = run(driver, &b.counts_sql()).await;
    let row = counts.rows.first().expect("counts row");
    assert_eq!(DiffSqlBuilder::count_at(row, 0), 3, "new_total");
    assert_eq!(DiffSqlBuilder::count_at(row, 1), 3, "prod_total");
    assert_eq!(DiffSqlBuilder::count_at(row, 2), 1, "added_count");
    assert_eq!(DiffSqlBuilder::count_at(row, 3), 1, "removed_count");
    assert_eq!(DiffSqlBuilder::count_at(row, 4), 1, "updated_count");

    assert_eq!(count_rows(driver, &b.added_sample_sql()).await, 1, "added sample");
    assert_eq!(count_rows(driver, &b.removed_sample_sql()).await, 1, "removed sample");
    assert_eq!(count_rows(driver, &b.updated_new_sample_sql()).await, 1, "updated-new sample");
    assert_eq!(count_rows(driver, &b.updated_prod_sample_sql()).await, 1, "updated-prod sample");
}
