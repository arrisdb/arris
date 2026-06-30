type NavItem = {
  label: string;
  href: string;
  badge?: string;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

const docsNav: NavGroup[] = [
  {
    title: "Getting started",
    items: [
      { label: "Install Arris", href: "/getting-started/install" },
      { label: "Your first query", href: "/getting-started/first-query" },
    ],
  },
  {
    title: "Connections",
    items: [
      { label: "Overview", href: "/connections/overview" },
      { label: "Security", href: "/connections/secrets" },
      { label: "SSH tunnels", href: "/connections/ssh-tunnels" },
      { label: "SSL", href: "/connections/ssl" },
    ],
  },
  {
    title: "Supported data sources",
    items: [
      { label: "BigQuery", href: "/supported-data-sources/bigquery" },
      { label: "ClickHouse", href: "/supported-data-sources/clickhouse" },
      { label: "DuckDB", href: "/supported-data-sources/duckdb" },
      { label: "DynamoDB", href: "/supported-data-sources/dynamodb" },
      { label: "Elasticsearch", href: "/supported-data-sources/elasticsearch" },
      { label: "Kafka", href: "/supported-data-sources/kafka" },
      { label: "MariaDB", href: "/supported-data-sources/mariadb" },
      { label: "Mixpanel", href: "/supported-data-sources/mixpanel" },
      { label: "MongoDB", href: "/supported-data-sources/mongodb" },
      { label: "MSSQL", href: "/supported-data-sources/mssql" },
      { label: "MySQL", href: "/supported-data-sources/mysql" },
      { label: "Oracle", href: "/supported-data-sources/oracle" },
      { label: "PostgreSQL", href: "/supported-data-sources/postgres" },
      { label: "Redis", href: "/supported-data-sources/redis" },
      { label: "Redshift", href: "/supported-data-sources/redshift" },
      { label: "SQLite", href: "/supported-data-sources/sqlite" },
      { label: "Snowflake", href: "/supported-data-sources/snowflake" },
      { label: "StarRocks", href: "/supported-data-sources/starrocks" },
      { label: "Trino", href: "/supported-data-sources/trino" },
    ],
  },
  {
    title: "Querying",
    items: [
      { label: "Editor", href: "/querying/editor" },
      { label: "Results viewer", href: "/querying/results" },
      { label: "Command logs", href: "/querying/command-logs" },
      { label: "Cross-source queries", href: "/querying/cross-source" },
    ],
  },
  {
    title: "Git",
    items: [
      { label: "Version control", href: "/git/version-control" },
    ],
  },
  {
    title: "Analytics engineering",
    items: [
      { label: "dbt", href: "/analytics-engineering/dbt" },
      { label: "SQLMesh", href: "/analytics-engineering/sqlmesh" },
    ],
  },
  {
    title: "AI",
    items: [
      { label: "AI Agent", href: "/ai/agent" },
      { label: "Canvas", href: "/ai/canvas" },
    ],
  },
  {
    title: "Reference",
    items: [
      { label: "Keyboard shortcuts", href: "/reference/shortcuts" },
      { label: "Debug logs", href: "/reference/debug-logs" },
    ],
  },
];

export type { NavItem, NavGroup };
export { docsNav };
