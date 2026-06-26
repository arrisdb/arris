import type { DatabaseKind } from "../../CombinedConnectionsTree/types";
import { postgresDriver } from "./postgres";
import { mysqlDriver } from "./mysql";
import { mariadbDriver } from "./mariadb";
import { mssqlDriver } from "./mssql";
import { oracleDriver } from "./oracle";
import { sqliteDriver } from "./sqlite";
import { duckdbDriver } from "./duckdb";
import { mongodbDriver } from "./mongodb";
import { kafkaDriver } from "./kafka";
import { mixpanelDriver } from "./mixpanel";
import { redisDriver } from "./redis";
import { elasticsearchDriver } from "./elasticsearch";
import { bigqueryDriver } from "./bigquery";
import { redshiftDriver } from "./redshift";
import { snowflakeDriver } from "./snowflake";
import { clickhouseDriver } from "./clickhouse";
import { trinoDriver } from "./trino";
import { dynamodbDriver } from "./dynamodb";
import { starrocksDriver } from "./starrocks";
import type { ConnectionDriver } from "./types";

const DRIVERS: Record<DatabaseKind, ConnectionDriver> = {
  postgres: postgresDriver,
  mysql: mysqlDriver,
  mariadb: mariadbDriver,
  mssql: mssqlDriver,
  oracle: oracleDriver,
  sqlite: sqliteDriver,
  duckdb: duckdbDriver,
  mongodb: mongodbDriver,
  kafka: kafkaDriver,
  mixpanel: mixpanelDriver,
  redis: redisDriver,
  elasticsearch: elasticsearchDriver,
  bigquery: bigqueryDriver,
  redshift: redshiftDriver,
  snowflake: snowflakeDriver,
  clickhouse: clickhouseDriver,
  trino: trinoDriver,
  dynamodb: dynamodbDriver,
  starrocks: starrocksDriver,
};

const PICKER_KINDS: DatabaseKind[] = [
  "postgres",
  "mysql",
  "mariadb",
  "mssql",
  "oracle",
  "sqlite",
  "duckdb",
  "mongodb",
  "kafka",
  "mixpanel",
  "redis",
  "elasticsearch",
  "bigquery",
  "redshift",
  "snowflake",
  "clickhouse",
  "trino",
  "dynamodb",
  "starrocks",
];

export function driverForKind(kind: DatabaseKind): ConnectionDriver {
  return DRIVERS[kind];
}

export function pickerKinds(): DatabaseKind[] {
  return PICKER_KINDS;
}

export function allDrivers(): ConnectionDriver[] {
  return Object.values(DRIVERS);
}

export type { ConnectionDriver } from "./types";
export { defaultTableRefFromNode } from "./defaults";
