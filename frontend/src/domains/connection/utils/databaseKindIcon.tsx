
import type { DatabaseKind } from "@shared";

export interface KindStyle {
  symbol: string;
  color: string;
  displayName: string;
  logo?: string;
}

const STYLE: Record<DatabaseKind, KindStyle> = {
  postgres: { symbol: "PG", color: "var(--m-db-postgres, #6aa1ff)", displayName: "PostgreSQL", logo: "/db-logos/postgres.png" },
  mongodb: { symbol: "MN", color: "var(--m-db-mongo, #74d39c)", displayName: "MongoDB", logo: "/db-logos/mongodb.png" },
  mysql: { symbol: "MY", color: "#f59e3b", displayName: "MySQL", logo: "/db-logos/mysql.png" },
  mariadb: { symbol: "MA", color: "#a23843", displayName: "MariaDB", logo: "/db-logos/mariadb.png" },
  sqlite: { symbol: "SL", color: "#7adce4", displayName: "SQLite", logo: "/db-logos/sqlite.png" },
  redis: { symbol: "RD", color: "var(--m-db-redis, #ff7a7a)", displayName: "Redis", logo: "/db-logos/redis.png" },
  kafka: { symbol: "KA", color: "#1f1f1f", displayName: "Kafka", logo: "/db-logos/kafka.png" },
  bigquery: { symbol: "BQ", color: "var(--m-db-bigquery, #6aa1ff)", displayName: "BigQuery", logo: "/db-logos/bigquery.png" },
  redshift: { symbol: "RS", color: "#ff6b6b", displayName: "Redshift", logo: "/db-logos/redshift.png" },
  snowflake: { symbol: "SF", color: "var(--m-db-snowflake, #5ad6f4)", displayName: "Snowflake", logo: "/db-logos/snowflake.png" },
  mssql: { symbol: "MS", color: "var(--m-accent-2)", displayName: "SQL Server", logo: "/db-logos/mssql.png" },
  oracle: { symbol: "OR", color: "#e63946", displayName: "Oracle", logo: "/db-logos/oracle.png" },
  mixpanel: { symbol: "MX", color: "var(--m-db-mixpanel, #a78bff)", displayName: "Mixpanel", logo: "/db-logos/mixpanel.png" },
  duckdb: { symbol: "DD", color: "var(--m-db-duckdb, #ffc266)", displayName: "DuckDB", logo: "/db-logos/duckdb.png" },
  clickhouse: { symbol: "CH", color: "var(--m-db-clickhouse, #ffd960)", displayName: "ClickHouse", logo: "/db-logos/clickhouse.png" },
  elasticsearch: { symbol: "ES", color: "#5be39a", displayName: "Elasticsearch", logo: "/db-logos/elasticsearch.svg" },
  trino: { symbol: "TR", color: "#dd00a1", displayName: "Trino", logo: "/db-logos/trino.png" },
  dynamodb: { symbol: "DY", color: "#4d72e0", displayName: "DynamoDB", logo: "/db-logos/dynamodb.png" },
  starrocks: { symbol: "SR", color: "#3299ff", displayName: "StarRocks", logo: "/db-logos/starrocks.png" },
};

export function kindStyle(kind: DatabaseKind): KindStyle {
  return STYLE[kind] ?? STYLE.postgres;
}

interface Props {
  kind: DatabaseKind;
  size?: number;
}

export function DatabaseKindIcon({ kind, size = 28 }: Props) {
  const s = kindStyle(kind);
  if (s.logo) {
    return (
      <img className="mdbc-db-kind-logo"
        src={s.logo}
        alt={s.displayName}
        title={s.displayName}
        width={size}
        height={size}

      />
    );
  }
  return (
    <span className="mdbc-db-kind-badge mdbc-db-kind-badge-swatch"
      title={s.displayName}
      style={{ "--mdbc-db-kind-size-width": `${size}px`, "--mdbc-db-kind-size-height": `${size}px`, "--mdbc-db-kind-color": s.color, "--mdbc-db-kind-symbol-size": `${Math.max(9, size * 0.4)}px` } as any}
    >
      {s.symbol}
    </span>
  );
}
