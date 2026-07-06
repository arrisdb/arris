const DBT_PROJECT_YML = `name: my_dbt_project
version: "1.0.0"
config-version: 2
profile: default
model-paths: ["models"]
`;

// Local duckdb profile so a freshly scaffolded project runs with no external DB.
// Bind a real connection later via the Connection picker in the dbt pane.
const DBT_PROFILES_YML = `default:
  target: dev
  outputs:
    dev:
      type: duckdb
      path: dev.duckdb
      threads: 1
`;

// Minimal runnable model so \`dbt run\` produces output immediately.
const DBT_EXAMPLE_MODEL_SQL = `-- Example model. Run \`dbt run\` to materialize it.
select 1 as id, 'hello dbt' as message
`;

const SQLMESH_CONFIG_YAML = `gateways:
  local:
    connection:
      type: duckdb
      database: db.db
default_gateway: local
model_defaults:
  dialect: duckdb
`;

// Empty projects ship with a real DuckDB file + connection so the user can run a
// query immediately. File name relative to the project root.
const SAMPLE_DUCKDB_FILE = "sample.duckdb";
const SAMPLE_CONNECTION_NAME = "Sample data";

// Single-statement seed: creates the orders table AND its rows so the connection
// has something queryable the moment it opens.
const SAMPLE_ORDERS_SQL = `CREATE TABLE orders AS
SELECT * FROM (VALUES
  (1, 'Keyboard', 49.99, DATE '2024-01-05'),
  (2, 'Monitor', 199.50, DATE '2024-01-07'),
  (3, 'Mouse', 24.99, DATE '2024-02-02'),
  (4, 'Desk Lamp', 39.00, DATE '2024-02-15'),
  (5, 'USB-C Hub', 59.95, DATE '2024-03-01')
) AS t(id, product, amount, order_date)`;

// Recent-project right-click menu: open that project in a separate window.
const RECENT_MENU_OPEN_NEW_WINDOW_ID = "open-new-window";
const RECENT_MENU_OPEN_NEW_WINDOW_LABEL = "Open in New Window";

// Folder-picker title for the "Open in new window" button.
const OPEN_FOLDER_NEW_WINDOW_DIALOG_TITLE = "Open folder in new window";

export {
  DBT_EXAMPLE_MODEL_SQL,
  DBT_PROFILES_YML,
  DBT_PROJECT_YML,
  OPEN_FOLDER_NEW_WINDOW_DIALOG_TITLE,
  RECENT_MENU_OPEN_NEW_WINDOW_ID,
  RECENT_MENU_OPEN_NEW_WINDOW_LABEL,
  SAMPLE_CONNECTION_NAME,
  SAMPLE_DUCKDB_FILE,
  SAMPLE_ORDERS_SQL,
  SQLMESH_CONFIG_YAML,
};
