//! Integration tests for the SQLite driver. SQLite is embedded, so there is no
//! container — each test owns a fresh in-memory database (`:memory:`) and is
//! therefore independent and parallel-safe. Queries run through the engine's
//! `DatabaseDriver::run_query` / `explain_query` / `list_schemas` (the same path
//! the app uses), and the returned `QueryResult` / `PlanResult` / `SchemaNode`
//! tree is asserted.
//!
//! Run with:
//!   `cargo test -p arris-engines --test sqlite_integration`
//!
//! Object kinds SQLite does NOT have (asserted indirectly by their absence /
//! noted here rather than tested): materialized views, stored functions &
//! procedures, sequences (autoincrement uses rowid, not a sequence object).
//! `list_schemas` therefore only ever yields Table / View / Index / Trigger.
//!
//! Access control: SQLite is a single-user embedded engine with no roles,
//! users, or `GRANT`/`REVOKE`. The access-control coverage required of
//! client/server engines does not apply here.

use arris_engines::{
    ConnectionConfig, DatabaseDriver, DatabaseKind, DriverError, ExplainMode, ObjectRef, PlanNode,
    QueryLanguage, QueryResult, QueryValue, SchemaNode, SchemaNodeKind, driver_for_kind,
};

// ── harness ─────────────────────────────────────────────────────────────────

/// Connect a driver to a fresh in-memory database. The single underlying
/// `rusqlite::Connection` is reused for every call on this driver, so the
/// in-memory DB persists across queries for the lifetime of the test.
async fn start_sqlite() -> Box<dyn DatabaseDriver> {
    let mut cfg = ConnectionConfig::new("it-sqlite", DatabaseKind::Sqlite);
    cfg.file_path = Some(":memory:".to_string());

    let driver = driver_for_kind(DatabaseKind::Sqlite).expect("sqlite driver");
    driver.connect(&cfg).await.expect("connect to sqlite");
    driver
}

async fn run(driver: &dyn DatabaseDriver, sql: &str) -> QueryResult {
    driver
        .run_query(sql, &[], QueryLanguage::Native)
        .await
        .unwrap_or_else(|e| panic!("query failed: {sql}\n  error: {e:?}"))
}

/// Run a statement and assert how many rows it reported as affected.
async fn exec_affected(driver: &dyn DatabaseDriver, sql: &str) -> i64 {
    run(driver, sql)
        .await
        .rows_affected
        .unwrap_or_else(|| panic!("expected rows_affected for: {sql}"))
}

/// First column of the first row.
fn scalar(result: &QueryResult) -> &QueryValue {
    result
        .rows
        .first()
        .and_then(|row| row.first())
        .unwrap_or_else(|| panic!("expected at least one row/column, got {result:?}"))
}

fn as_i64(v: &QueryValue) -> i64 {
    match v {
        QueryValue::Int(i) => *i,
        other => panic!("expected Int, got {other:?}"),
    }
}

fn as_text(v: &QueryValue) -> &str {
    match v {
        QueryValue::Text(s) => s,
        other => panic!("expected Text, got {other:?}"),
    }
}

/// Whether the schema-browser tree contains a node with the given name + kind
/// anywhere in its hierarchy.
fn has_node(nodes: &[SchemaNode], name: &str, kind: SchemaNodeKind) -> bool {
    nodes
        .iter()
        .any(|n| (n.name == name && n.kind == kind) || has_node(&n.children, name, kind))
}

async fn schema_tree(driver: &dyn DatabaseDriver) -> Vec<SchemaNode> {
    driver.list_schemas().await.expect("list_schemas")
}

fn col_names(result: &QueryResult) -> Vec<&str> {
    result.columns.iter().map(|c| c.name.as_str()).collect()
}

fn col_type<'a>(result: &'a QueryResult, name: &str) -> &'a str {
    result
        .columns
        .iter()
        .find(|c| c.name == name)
        .map(|c| c.type_hint.as_str())
        .unwrap_or_else(|| panic!("no column named {name} in {:?}", result.columns))
}

// ── CRUD ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn crud_insert_update_delete_select() {
    let driver = start_sqlite().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER)",
    )
    .await;

    // Multi-row insert reports the affected count.
    let inserted = exec_affected(
        d,
        "INSERT INTO users (name, age) VALUES ('alice', 30), ('bob', 25), ('carol', 40)",
    )
    .await;
    assert_eq!(inserted, 3);

    // Insert-returning: SQLite supports `RETURNING`, but the engine routes a
    // bare INSERT through execute(), which reports rows_affected and drops the
    // RETURNING rows. The new row is therefore read back with a follow-up
    // SELECT keyed on the autoincrement rowid.
    let dave_id = exec_affected(d, "INSERT INTO users (name, age) VALUES ('dave', 22)").await;
    assert_eq!(dave_id, 1);
    let dave = run(d, "SELECT name FROM users ORDER BY id DESC LIMIT 1").await;
    assert_eq!(as_text(scalar(&dave)), "dave");

    // SELECT with filter / ORDER BY / LIMIT — assert column names and types too.
    let top = run(
        d,
        "SELECT name, age FROM users WHERE age >= 25 ORDER BY age DESC LIMIT 2",
    )
    .await;
    assert_eq!(col_names(&top), ["name", "age"]);
    assert_eq!(col_type(&top, "name"), "TEXT");
    assert_eq!(col_type(&top, "age"), "INTEGER");
    assert_eq!(top.rows.len(), 2);
    assert_eq!(as_text(&top.rows[0][0]), "carol");
    assert_eq!(as_i64(&top.rows[0][1]), 40);
    assert_eq!(as_text(&top.rows[1][0]), "alice");
    assert_eq!(as_i64(&top.rows[1][1]), 30);

    // JOIN.
    run(
        d,
        "CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, amount INTEGER)",
    )
    .await;
    run(
        d,
        "INSERT INTO orders (user_id, amount) SELECT id, 100 FROM users WHERE name = 'alice'",
    )
    .await;
    let joined = run(
        d,
        "SELECT u.name, o.amount FROM users u JOIN orders o ON o.user_id = u.id",
    )
    .await;
    assert_eq!(joined.rows.len(), 1);
    assert_eq!(as_text(&joined.rows[0][0]), "alice");
    assert_eq!(as_i64(&joined.rows[0][1]), 100);

    // UPDATE.
    assert_eq!(
        exec_affected(d, "UPDATE users SET age = 31 WHERE name = 'alice'").await,
        1
    );
    let aged = run(d, "SELECT age FROM users WHERE name = 'alice'").await;
    assert_eq!(as_i64(scalar(&aged)), 31);

    // DELETE.
    assert_eq!(
        exec_affected(d, "DELETE FROM users WHERE name = 'bob'").await,
        1
    );
    let count = run(d, "SELECT count(*) FROM users").await;
    assert_eq!(as_i64(scalar(&count)), 3); // alice, carol, dave
}

// ── Window / analytic functions (SQLite 3.25+) ──────────────────────────────

#[tokio::test]
async fn window_functions() {
    let driver = start_sqlite().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE sales (region TEXT, amount INTEGER)").await;
    run(
        d,
        "INSERT INTO sales (region, amount) VALUES \
         ('east', 10), ('east', 20), ('east', 30), ('west', 40), ('west', 50)",
    )
    .await;

    let r = run(
        d,
        "SELECT region, amount, \
           ROW_NUMBER() OVER (PARTITION BY region ORDER BY amount DESC) AS rn, \
           RANK() OVER (ORDER BY amount DESC) AS rnk, \
           LAG(amount) OVER (ORDER BY amount) AS prev, \
           LEAD(amount) OVER (ORDER BY amount) AS nxt, \
           SUM(amount) OVER (PARTITION BY region ORDER BY amount \
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running \
         FROM sales ORDER BY amount",
    )
    .await;
    assert_eq!(r.rows.len(), 5);

    // Ordered by amount asc: [10, 20, 30, 40, 50].
    // First row (amount=10, region east): LAG is NULL, running within east = 10.
    let first = &r.rows[0];
    assert_eq!(as_i64(&first[1]), 10);
    assert_eq!(as_i64(&first[2]), 3); // row_number within east desc
    assert_eq!(as_i64(&first[3]), 5); // global rank desc
    assert!(first[4].is_null()); // LAG of first row
    assert_eq!(as_i64(&first[5]), 20); // LEAD
    assert_eq!(as_i64(&first[6]), 10); // running sum

    // Third row (amount=30, region east): top of its partition, running = 60.
    let third = &r.rows[2];
    assert_eq!(as_i64(&third[1]), 30);
    assert_eq!(as_i64(&third[2]), 1); // row_number within east desc
    assert_eq!(as_i64(&third[3]), 3); // global rank desc
    assert_eq!(as_i64(&third[4]), 20); // LAG
    assert_eq!(as_i64(&third[5]), 40); // LEAD
    assert_eq!(as_i64(&third[6]), 60); // running sum 10+20+30
}

// ── SQLite-specific: upsert via ON CONFLICT DO UPDATE ───────────────────────

#[tokio::test]
async fn upsert_on_conflict_do_update() {
    let driver = start_sqlite().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE kv (k TEXT PRIMARY KEY, v INTEGER)").await;
    run(d, "INSERT INTO kv (k, v) VALUES ('a', 1)").await;

    // Conflict on the PK accumulates using the excluded pseudo-table.
    run(
        d,
        "INSERT INTO kv (k, v) VALUES ('a', 5) \
         ON CONFLICT(k) DO UPDATE SET v = kv.v + excluded.v",
    )
    .await;
    assert_eq!(as_i64(scalar(&run(d, "SELECT v FROM kv WHERE k = 'a'").await)), 6);

    // A non-conflicting key inserts normally.
    run(
        d,
        "INSERT INTO kv (k, v) VALUES ('b', 9) \
         ON CONFLICT(k) DO UPDATE SET v = kv.v + excluded.v",
    )
    .await;
    let all = run(d, "SELECT k, v FROM kv ORDER BY k").await;
    assert_eq!(all.rows.len(), 2);
    assert_eq!(as_text(&all.rows[0][0]), "a");
    assert_eq!(as_i64(&all.rows[0][1]), 6);
    assert_eq!(as_text(&all.rows[1][0]), "b");
    assert_eq!(as_i64(&all.rows[1][1]), 9);
}

// ── SQLite-specific: WITH RECURSIVE CTE ─────────────────────────────────────

#[tokio::test]
async fn recursive_cte() {
    let driver = start_sqlite().await;
    let d = driver.as_ref();

    // Sum 1..5 via a recursive CTE (routed to the SELECT path by the engine).
    let sum = run(
        d,
        "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t WHERE n < 5) \
         SELECT sum(n) FROM t",
    )
    .await;
    assert_eq!(as_i64(scalar(&sum)), 15);

    // Materialise the full series and assert the row set.
    let series = run(
        d,
        "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t WHERE n < 5) \
         SELECT n FROM t ORDER BY n",
    )
    .await;
    assert_eq!(series.rows.len(), 5);
    let ns: Vec<i64> = series.rows.iter().map(|row| as_i64(&row[0])).collect();
    assert_eq!(ns, [1, 2, 3, 4, 5]);
}

// ── SQLite-specific: JSON1 functions ────────────────────────────────────────

#[tokio::test]
async fn json1_functions() {
    let driver = start_sqlite().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE jdocs (id INTEGER, body TEXT)").await;
    // json_object builds the document text.
    run(
        d,
        "INSERT INTO jdocs VALUES \
         (1, json_object('name', 'alice', 'age', 30)), \
         (2, json_object('name', 'bob', 'age', 25))",
    )
    .await;

    // json_extract returns the typed leaf: text for a string, integer for a number.
    let name = run(d, "SELECT json_extract(body, '$.name') FROM jdocs WHERE id = 1").await;
    assert_eq!(as_text(scalar(&name)), "alice");
    let age = run(d, "SELECT json_extract(body, '$.age') FROM jdocs WHERE id = 1").await;
    assert_eq!(as_i64(scalar(&age)), 30);

    // ->> extracts as SQL text; -> keeps the JSON representation (also text).
    let bob = run(d, "SELECT body->>'name' FROM jdocs WHERE id = 2").await;
    assert_eq!(as_text(scalar(&bob)), "bob");
    let age_json = run(d, "SELECT body->'age' FROM jdocs WHERE id = 1").await;
    assert_eq!(as_text(scalar(&age_json)), "30");

    // json_object round-trips to canonical JSON text.
    let obj = run(d, "SELECT json_object('k', 'v', 'n', 1)").await;
    assert_eq!(as_text(scalar(&obj)), "{\"k\":\"v\",\"n\":1}");

    // Filter rows by an extracted JSON value.
    let older = run(d, "SELECT count(*) FROM jdocs WHERE json_extract(body, '$.age') >= 30").await;
    assert_eq!(as_i64(scalar(&older)), 1);
}

// ── SQLite-specific: GROUP_CONCAT ───────────────────────────────────────────

#[tokio::test]
async fn group_concat_aggregate() {
    let driver = start_sqlite().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE tags (grp TEXT, val TEXT)").await;
    run(
        d,
        "INSERT INTO tags (grp, val) VALUES \
         ('a', 'x'), ('a', 'y'), ('a', 'z'), ('b', 'q')",
    )
    .await;

    // Ordered aggregation gives a deterministic concatenation per group.
    let r = run(
        d,
        "SELECT grp, group_concat(val, ',' ORDER BY val) AS vals \
         FROM tags GROUP BY grp ORDER BY grp",
    )
    .await;
    assert_eq!(col_names(&r), ["grp", "vals"]);
    assert_eq!(r.rows.len(), 2);
    assert_eq!(as_text(&r.rows[0][0]), "a");
    assert_eq!(as_text(&r.rows[0][1]), "x,y,z");
    assert_eq!(as_text(&r.rows[1][0]), "b");
    assert_eq!(as_text(&r.rows[1][1]), "q");
}

// ── SQLite-specific: STRICT tables & type affinity ──────────────────────────

#[tokio::test]
async fn strict_tables_and_type_affinity() {
    let driver = start_sqlite().await;
    let d = driver.as_ref();

    // STRICT enforces the declared column types.
    run(d, "CREATE TABLE strict_t (id INTEGER, label TEXT) STRICT").await;
    assert_eq!(
        exec_affected(d, "INSERT INTO strict_t (id, label) VALUES (1, 'ok')").await,
        1
    );

    // A non-integer in a STRICT INTEGER column is rejected.
    assert!(
        driver
            .run_query(
                "INSERT INTO strict_t (id, label) VALUES ('notanint', 'x')",
                &[],
                QueryLanguage::Native,
            )
            .await
            .is_err()
    );
    // The rejected row left no trace.
    assert_eq!(
        as_i64(scalar(&run(d, "SELECT count(*) FROM strict_t").await)),
        1
    );

    // In a non-STRICT table, TEXT affinity coerces an inserted integer to text.
    run(d, "CREATE TABLE loose_t (n TEXT)").await;
    run(d, "INSERT INTO loose_t (n) VALUES (123)").await;
    let row = run(d, "SELECT typeof(n), n FROM loose_t").await;
    assert_eq!(as_text(&row.rows[0][0]), "text");
    assert_eq!(as_text(&row.rows[0][1]), "123");
}

// ── SQLite-specific: FTS5 full-text search virtual table + lifecycle ────────

#[tokio::test]
async fn fts5_full_text_search_lifecycle() {
    let driver = start_sqlite().await;
    let d = driver.as_ref();

    // CREATE a contentless-free FTS5 virtual table and index two documents.
    run(d, "CREATE VIRTUAL TABLE docs USING fts5(body)").await;
    run(
        d,
        "INSERT INTO docs (body) VALUES \
         ('the quick brown fox'), ('lazy dog sleeps all day')",
    )
    .await;

    // MATCH performs a full-text query; only the fox document matches 'fox'.
    let fox = run(d, "SELECT count(*) FROM docs WHERE docs MATCH 'fox'").await;
    assert_eq!(as_i64(scalar(&fox)), 1);

    // rowid lets us pinpoint the matched document.
    let dog = run(d, "SELECT rowid FROM docs WHERE docs MATCH 'dog'").await;
    assert_eq!(as_i64(scalar(&dog)), 2);

    // Prefix query matches the 'quick' token.
    let prefix = run(d, "SELECT count(*) FROM docs WHERE docs MATCH 'qui*'").await;
    assert_eq!(as_i64(scalar(&prefix)), 1);

    // The virtual table surfaces in the schema browser as a Table.
    assert!(has_node(&schema_tree(d).await, "docs", SchemaNodeKind::Table));

    // DROP removes it; a follow-up query against it errors.
    run(d, "DROP TABLE docs").await;
    assert!(!has_node(&schema_tree(d).await, "docs", SchemaNodeKind::Table));
    assert!(
        driver
            .run_query("SELECT * FROM docs", &[], QueryLanguage::Native)
            .await
            .is_err()
    );
}

// ── Views: create / read / drop + schema browser ────────────────────────────
//
// SQLite views are read-only and have no `CREATE OR REPLACE`; redefining a view
// is DROP + CREATE. Materialized views do not exist in SQLite.

#[tokio::test]
async fn view_lifecycle() {
    let driver = start_sqlite().await;
    let d = driver.as_ref();

    run(
        d,
        "CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, dept TEXT, salary INTEGER)",
    )
    .await;
    run(
        d,
        "INSERT INTO employees (name, dept, salary) VALUES \
         ('alice', 'eng', 150), ('bob', 'eng', 90), \
         ('carol', 'sales', 120), ('dave', 'sales', 80)",
    )
    .await;

    // CREATE.
    run(
        d,
        "CREATE VIEW high_earners AS \
         SELECT id, name, salary FROM employees WHERE salary >= 100",
    )
    .await;

    // READ through the view — assert columns, types (decl types propagate for
    // direct base-table column references), and the full row set.
    let v = run(d, "SELECT * FROM high_earners ORDER BY salary DESC").await;
    assert_eq!(col_names(&v), ["id", "name", "salary"]);
    assert_eq!(col_type(&v, "salary"), "INTEGER");
    assert_eq!(v.rows.len(), 2);
    assert_eq!(as_text(&v.rows[0][1]), "alice");
    assert_eq!(as_i64(&v.rows[0][2]), 150);
    assert_eq!(as_text(&v.rows[1][1]), "carol");
    assert_eq!(as_i64(&v.rows[1][2]), 120);

    // The schema browser surfaces the view.
    assert!(has_node(&schema_tree(d).await, "high_earners", SchemaNodeKind::View));

    // Redefine via DROP + CREATE with a tighter filter; the row set shrinks.
    run(d, "DROP VIEW high_earners").await;
    run(
        d,
        "CREATE VIEW high_earners AS \
         SELECT id, name, salary FROM employees WHERE salary >= 130",
    )
    .await;
    let v2 = run(d, "SELECT * FROM high_earners ORDER BY salary DESC").await;
    assert_eq!(v2.rows.len(), 1);
    assert_eq!(as_text(&v2.rows[0][1]), "alice");
    assert_eq!(as_i64(&v2.rows[0][2]), 150);

    // DROP — the view disappears from the browser and can no longer be queried.
    run(d, "DROP VIEW high_earners").await;
    assert!(!has_node(&schema_tree(d).await, "high_earners", SchemaNodeKind::View));
    assert!(
        driver
            .run_query("SELECT * FROM high_earners", &[], QueryLanguage::Native)
            .await
            .is_err()
    );
}

// ── Triggers: create / fire / drop + schema browser ─────────────────────────

#[tokio::test]
async fn trigger_fires_and_appears_in_browser() {
    let driver = start_sqlite().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INTEGER)").await;
    run(d, "CREATE TABLE account_audit (account_id INTEGER, new_balance INTEGER)").await;
    run(
        d,
        "CREATE TRIGGER trg_audit_ins AFTER INSERT ON accounts \
         BEGIN INSERT INTO account_audit (account_id, new_balance) \
         VALUES (NEW.id, NEW.balance); END",
    )
    .await;
    run(
        d,
        "CREATE TRIGGER trg_audit_upd AFTER UPDATE ON accounts \
         BEGIN INSERT INTO account_audit (account_id, new_balance) \
         VALUES (NEW.id, NEW.balance); END",
    )
    .await;

    // The triggers fire on INSERT and UPDATE.
    run(d, "INSERT INTO accounts (id, balance) VALUES (1, 100)").await;
    run(d, "UPDATE accounts SET balance = 250 WHERE id = 1").await;

    let audit = run(
        d,
        "SELECT account_id, new_balance FROM account_audit ORDER BY new_balance",
    )
    .await;
    assert_eq!(audit.rows.len(), 2);
    assert_eq!(as_i64(&audit.rows[0][0]), 1);
    assert_eq!(as_i64(&audit.rows[0][1]), 100); // from the INSERT
    assert_eq!(as_i64(&audit.rows[1][1]), 250); // from the UPDATE

    assert!(has_node(&schema_tree(d).await, "trg_audit_ins", SchemaNodeKind::Trigger));
    assert!(has_node(&schema_tree(d).await, "trg_audit_upd", SchemaNodeKind::Trigger));

    // DROP the update trigger; it leaves the browser and no longer fires.
    run(d, "DROP TRIGGER trg_audit_upd").await;
    assert!(!has_node(&schema_tree(d).await, "trg_audit_upd", SchemaNodeKind::Trigger));

    run(d, "UPDATE accounts SET balance = 500 WHERE id = 1").await;
    let after = run(d, "SELECT count(*) FROM account_audit").await;
    assert_eq!(as_i64(scalar(&after)), 2); // unchanged: the update trigger is gone
}

// ── Indexes: create / appear in browser / used by the planner / drop ────────

fn plan_uses_index(node: &PlanNode) -> bool {
    node.label.to_uppercase().contains("USING INDEX")
        || node.label.to_uppercase().contains("USING COVERING INDEX")
        || node.children.iter().any(plan_uses_index)
}

#[tokio::test]
async fn index_lifecycle_and_explain_usage() {
    let driver = start_sqlite().await;
    let d = driver.as_ref();

    run(d, "CREATE TABLE items (id INTEGER PRIMARY KEY, sku TEXT, qty INTEGER)").await;
    // Seed 1000 rows via a recursive CTE so the planner has a reason to index.
    run(
        d,
        "INSERT INTO items (sku, qty) \
         WITH RECURSIVE g(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM g WHERE n < 1000) \
         SELECT 'sku' || n, n FROM g",
    )
    .await;
    run(d, "CREATE INDEX idx_items_sku ON items (sku)").await;
    run(d, "ANALYZE items").await;

    // The schema browser surfaces the index.
    assert!(has_node(&schema_tree(d).await, "idx_items_sku", SchemaNodeKind::Index));

    // The planner uses the index — read the plan through the engine's explain
    // path (`EXPLAIN QUERY PLAN`).
    let plan = driver
        .explain_query(
            "SELECT id, qty FROM items WHERE sku = 'sku500'",
            &[],
            QueryLanguage::Native,
            ExplainMode::DryRun,
        )
        .await
        .expect("explain");
    assert!(
        plan_uses_index(&plan.root),
        "expected an index scan, got plan: {}",
        plan.raw
    );

    // DROP removes the index from the browser.
    run(d, "DROP INDEX idx_items_sku").await;
    assert!(!has_node(&schema_tree(d).await, "idx_items_sku", SchemaNodeKind::Index));

    // Without the index the planner falls back to a full scan.
    let plan2 = driver
        .explain_query(
            "SELECT id, qty FROM items WHERE sku = 'sku500'",
            &[],
            QueryLanguage::Native,
            ExplainMode::DryRun,
        )
        .await
        .expect("explain");
    assert!(
        !plan_uses_index(&plan2.root),
        "expected a full scan after dropping the index, got plan: {}",
        plan2.raw
    );
}

// ── new-database file creation ─────────────────────────────────────
// Picking a directory + naming a file should let the driver create the .db.

/// A file path inside an existing directory: the driver creates the `.db` on
/// disk and it is immediately queryable through the engine.
#[tokio::test]
async fn connect_creates_db_file_in_existing_dir() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("created.db");
    assert!(!db_path.exists(), "precondition: file does not exist yet");

    let mut cfg = ConnectionConfig::new("it-sqlite-new", DatabaseKind::Sqlite);
    cfg.file_path = Some(db_path.to_string_lossy().into_owned());
    let driver = driver_for_kind(DatabaseKind::Sqlite).expect("sqlite driver");
    driver.connect(&cfg).await.expect("connect creates the file");

    assert!(db_path.exists(), "driver should have created the .db file");
    run(driver.as_ref(), "CREATE TABLE t (id INTEGER)").await;
    let count = run(driver.as_ref(), "SELECT count(*) FROM t").await;
    assert_eq!(as_i64(scalar(&count)), 0);
}

/// A path whose parent directories do not yet exist: the driver creates the
/// missing directories and then the file.
#[tokio::test]
async fn connect_creates_missing_parent_dirs() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("nested/deeper/created.db");
    assert!(
        !db_path.parent().unwrap().exists(),
        "precondition: parent dirs do not exist yet"
    );

    let mut cfg = ConnectionConfig::new("it-sqlite-nested", DatabaseKind::Sqlite);
    cfg.file_path = Some(db_path.to_string_lossy().into_owned());
    let driver = driver_for_kind(DatabaseKind::Sqlite).expect("sqlite driver");
    driver
        .connect(&cfg)
        .await
        .expect("connect creates nested dirs + file");

    assert!(
        db_path.exists(),
        "driver should have created nested dirs and the file"
    );
}

/// A bare directory path (no file name) is rejected with `InvalidArgument` —
/// the user must name the file, not just pick a folder.
#[tokio::test]
async fn connect_rejects_bare_directory_path() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut cfg = ConnectionConfig::new("it-sqlite-dir", DatabaseKind::Sqlite);
    cfg.file_path = Some(dir.path().to_string_lossy().into_owned());
    let driver = driver_for_kind(DatabaseKind::Sqlite).expect("sqlite driver");

    let err = driver
        .connect(&cfg)
        .await
        .expect_err("a directory path must be rejected");
    assert!(
        matches!(err, DriverError::InvalidArgument(_)),
        "expected InvalidArgument, got {err:?}"
    );
}

// ── Transaction control ──────────────────────────────────────────────────────
//
// SQLite is a single embedded connection, so there is no independent second
// session to observe isolation across connections; instead we assert that the
// owning connection sees its own work, that rollback discards it, and that the
// `in_transaction` flag tracks the open transaction. SQLite has no selectable
// isolation level (writers are always serializable), so only `Default` is
// meaningful and `begin_transaction` accepts it as a no-op.

use arris_engines::IsolationLevel;

#[tokio::test]
async fn manual_commit_persists_changes() {
    let tx = start_sqlite().await;
    run(tx.as_ref(), "CREATE TABLE acct (id INTEGER PRIMARY KEY, bal INTEGER)").await;

    assert!(tx.supports_transactions());
    assert!(!tx.in_transaction().await);
    tx.begin_transaction(IsolationLevel::Default).await.expect("begin");
    assert!(tx.in_transaction().await);

    run(tx.as_ref(), "INSERT INTO acct VALUES (1, 100)").await;
    // Visible within the same transaction.
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM acct").await)), 1);

    tx.commit_transaction().await.expect("commit");
    assert!(!tx.in_transaction().await);

    // Still present after commit.
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM acct").await)), 1);
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT bal FROM acct WHERE id = 1").await)), 100);
}

#[tokio::test]
async fn manual_rollback_discards_changes() {
    let tx = start_sqlite().await;
    run(tx.as_ref(), "CREATE TABLE note (id INTEGER)").await;

    tx.begin_transaction(IsolationLevel::Default).await.expect("begin");
    run(tx.as_ref(), "INSERT INTO note VALUES (1), (2)").await;
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM note").await)), 2);

    tx.rollback_transaction().await.expect("rollback");
    assert!(!tx.in_transaction().await);

    // The inserts are gone.
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM note").await)), 0);
}

#[tokio::test]
async fn failed_statement_does_not_abort_manual_transaction() {
    // Unlike Postgres' "current transaction is aborted" state, SQLite rolls back
    // only the failing statement and keeps the transaction usable.
    let tx = start_sqlite().await;
    run(tx.as_ref(), "CREATE TABLE acct (id INTEGER PRIMARY KEY, bal INTEGER)").await;

    tx.begin_transaction(IsolationLevel::Default).await.expect("begin");
    run(tx.as_ref(), "INSERT INTO acct VALUES (1, 100)").await;

    // Duplicate primary key fails.
    let err = tx
        .run_query("INSERT INTO acct VALUES (1, 999)", &[], QueryLanguage::Native)
        .await;
    assert!(err.is_err(), "duplicate insert should fail");
    assert!(tx.in_transaction().await, "transaction should remain open after error");

    // The next statement runs cleanly.
    run(tx.as_ref(), "INSERT INTO acct VALUES (2, 200)").await;
    tx.commit_transaction().await.expect("commit");
    assert_eq!(as_i64(scalar(&run(tx.as_ref(), "SELECT count(*) FROM acct").await)), 2);
}

// ── object definition (Show Definition) ──────────────────────────────────────

#[tokio::test]
async fn object_definition_returns_stored_ddl_for_each_kind() {
    let d = start_sqlite().await;
    run(d.as_ref(), "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)").await;
    run(d.as_ref(), "CREATE VIEW active AS SELECT id, name FROM users").await;
    run(d.as_ref(), "CREATE INDEX users_name_idx ON users(name)").await;
    run(
        d.as_ref(),
        "CREATE TRIGGER users_ai AFTER INSERT ON users BEGIN SELECT NEW.id; END",
    )
    .await;

    let table = d
        .object_definition(&ObjectRef::new(SchemaNodeKind::Table, "users"))
        .await
        .expect("table ddl");
    assert!(table.starts_with("CREATE TABLE users"), "{table}");
    assert!(table.contains("name TEXT NOT NULL"), "{table}");
    assert!(table.ends_with(';') && !table.ends_with(";;"), "{table}");

    let view = d
        .object_definition(&ObjectRef::new(SchemaNodeKind::View, "active"))
        .await
        .expect("view ddl");
    assert!(view.starts_with("CREATE VIEW active"), "{view}");

    let index = d
        .object_definition(&ObjectRef::new(SchemaNodeKind::Index, "users_name_idx"))
        .await
        .expect("index ddl");
    assert!(index.starts_with("CREATE INDEX users_name_idx"), "{index}");

    let trigger = d
        .object_definition(&ObjectRef::new(SchemaNodeKind::Trigger, "users_ai"))
        .await
        .expect("trigger ddl");
    assert!(trigger.starts_with("CREATE TRIGGER users_ai"), "{trigger}");
}

#[tokio::test]
async fn object_definition_missing_object_errors() {
    let d = start_sqlite().await;
    let err = d
        .object_definition(&ObjectRef::new(SchemaNodeKind::Table, "ghost"))
        .await
        .unwrap_err();
    assert!(matches!(err, DriverError::QueryFailed(_)), "{err:?}");
}

mod dbt_diff_scenario;

/// dbt slim-diff (`Standard` dialect: native `EXCEPT`, `"`-quoting, `LIMIT`)
/// end-to-end: keyless and id-keyed counts + samples against a real SQLite
/// database. See `dbt_diff_scenario` for the canonical data set and expectations.
#[tokio::test]
async fn slim_diff_keyless_and_keyed() {
    use arris_engines::dbt::DiffDialect;

    let d = start_sqlite().await;
    run(&*d, "CREATE TABLE diff_prod (id INTEGER, amount INTEGER)").await;
    run(
        &*d,
        "INSERT INTO diff_prod (id, amount) VALUES (1, 100), (2, 200), (3, 300)",
    )
    .await;

    let prod = "\"diff_prod\"";
    let new_select =
        "SELECT 2 AS id, 200 AS amount UNION ALL SELECT 3, 333 UNION ALL SELECT 4, 400";

    dbt_diff_scenario::assert_keyless(&*d, DiffDialect::Standard, prod, new_select).await;
    dbt_diff_scenario::assert_keyed(&*d, DiffDialect::Standard, prod, new_select).await;
}
