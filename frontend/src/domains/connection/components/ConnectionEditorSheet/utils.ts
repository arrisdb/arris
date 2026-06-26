import type {
  ConnectionConfig,
  DatabaseKind,
} from "../CombinedConnectionsTree/types";

const DEFAULT_PORTS: Partial<Record<DatabaseKind, number>> = {
  postgres: 5432,
  mysql: 3306,
  mariadb: 3307,
  mongodb: 27017,
  redis: 6379,
  kafka: 9092,
  mssql: 1433,
  oracle: 1521,
  bigquery: 443,
  redshift: 5439,
  snowflake: 443,
  clickhouse: 8123,
  elasticsearch: 9200,
  trino: 8080,
};

const KIND_FROM_SCHEME: Record<string, DatabaseKind> = {
  postgres: "postgres",
  postgresql: "postgres",
  mysql: "mysql",
  mariadb: "mariadb",
  mongodb: "mongodb",
  redis: "redis",
  duckdb: "duckdb",
  sqlite: "sqlite",
  redshift: "redshift",
  snowflake: "snowflake",
  clickhouse: "clickhouse",
  mssql: "mssql",
  oracle: "oracle",
  kafka: "kafka",
  bigquery: "bigquery",
  mixpanel: "mixpanel",
  trino: "trino",
};

const SCHEME_FROM_KIND: Partial<Record<DatabaseKind, string>> = {
  postgres: "postgres",
  mysql: "mysql",
  mariadb: "mariadb",
  mongodb: "mongodb",
  redis: "redis",
  duckdb: "duckdb",
  sqlite: "sqlite",
  redshift: "redshift",
  snowflake: "snowflake",
  clickhouse: "clickhouse",
  kafka: "kafka",
  mssql: "mssql",
  oracle: "oracle",
  bigquery: "bigquery",
  elasticsearch: "https",
  mixpanel: "mixpanel",
  trino: "trino",
};

function blankConfig(kind: DatabaseKind): ConnectionConfig {
  return {
    id: crypto.randomUUID(),
    name: "Untitled",
    kind,
    host: "localhost",
    port: defaultPortFor(kind) ?? 5432,
    database: "",
    user: "",
    password: "",
    isSRV: false,
    options: "",
    sslMode: "preferred",
  };
}

function initialConfig(
  initial: ConnectionConfig | null,
  kind: DatabaseKind,
): ConnectionConfig {
  return initial ?? blankConfig(kind);
}

function initialUri(config: ConnectionConfig): string {
  return buildUri(config);
}

function defaultPortFor(kind: DatabaseKind): number | undefined {
  return DEFAULT_PORTS[kind];
}

function parseUri(uri: string): Partial<ConnectionConfig> {
  const url = new URL(uri.replace(/^mongodb\+srv/, "mongodb"));
  const scheme = url.protocol.replace(":", "");
  const kind = KIND_FROM_SCHEME[scheme] ?? "postgres";
  const port = url.port ? Number(url.port) : DEFAULT_PORTS[kind];
  return {
    kind,
    host: url.hostname || "localhost",
    port: port ?? 5432,
    database: url.pathname.replace(/^\//, "") || "",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    isSRV: uri.startsWith("mongodb+srv"),
    options: url.search.replace(/^\?/, ""),
  };
}

function buildUri(config: ConnectionConfig): string {
  const scheme = config.isSRV && config.kind === "mongodb"
    ? "mongodb+srv"
    : (SCHEME_FROM_KIND[config.kind] ?? config.kind);
  const userPart = config.user
    ? config.password
      ? `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@`
      : `${encodeURIComponent(config.user)}@`
    : "";
  const defaultPort = DEFAULT_PORTS[config.kind];
  const portPart = config.port && config.port !== defaultPort
    ? `:${config.port}`
    : "";
  const dbPart = config.database ? `/${config.database}` : "";
  const optsPart = config.options ? `?${config.options}` : "";
  return `${scheme}://${userPart}${config.host || "localhost"}${portPart}${dbPart}${optsPart}`;
}

function ipcErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function getOption(opts: string, key: string): string {
  const pair = opts.split("&").find((kv) => kv.startsWith(`${key}=`));
  return pair ? pair.slice(key.length + 1) : "";
}

function setOption(opts: string, key: string, val: string): string {
  const pairs = opts.split("&").filter((kv) => kv && !kv.startsWith(`${key}=`));
  if (val) pairs.push(`${key}=${val}`);
  return pairs.join("&");
}

export {
  blankConfig,
  buildUri,
  defaultPortFor,
  getOption,
  initialConfig,
  initialUri,
  ipcErrorMessage,
  parseUri,
  setOption,
};
