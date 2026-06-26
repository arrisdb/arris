import type { ComponentType } from "react";
import type { DatabaseKind } from "../../CombinedConnectionsTree/types";
import { DuckDBFields } from "./duckdb";
import { ElasticsearchFields } from "./elasticsearch";
import { KafkaFields } from "./kafka";
import { MariaDBFields } from "./mariadb";
import { MixpanelFields } from "./mixpanel";
import { MongoDBFields } from "./mongodb";
import { MSSQLFields } from "./mssql";
import { MySQLFields } from "./mysql";
import { OracleFields } from "./oracle";
import { PostgresFields } from "./postgres";
import { RedisFields } from "./redis";
import { SnowflakeFields } from "./snowflake";
import { SQLiteFields } from "./sqlite";
import { BigqueryFields } from "./bigquery";
import { ClickHouseFields } from "./clickhouse";
import { TrinoFields } from "./trino";
import { DynamoDBFields } from "./dynamodb";
import { StarRocksFields } from "./starrocks";
import type { FieldsProps } from "./types";

const FIELD_COMPONENTS: Record<DatabaseKind, ComponentType<FieldsProps>> = {
  postgres: PostgresFields,
  mysql: MySQLFields,
  mariadb: MariaDBFields,
  mssql: MSSQLFields,
  oracle: OracleFields,
  sqlite: SQLiteFields,
  duckdb: DuckDBFields,
  mongodb: MongoDBFields,
  kafka: KafkaFields,
  mixpanel: MixpanelFields,
  redis: RedisFields,
  elasticsearch: ElasticsearchFields,
  bigquery: BigqueryFields,
  redshift: PostgresFields,
  snowflake: SnowflakeFields,
  clickhouse: ClickHouseFields,
  trino: TrinoFields,
  dynamodb: DynamoDBFields,
  starrocks: StarRocksFields,
};

function fieldComponentForKind(kind: DatabaseKind): ComponentType<FieldsProps> {
  return FIELD_COMPONENTS[kind];
}

export {
  fieldComponentForKind,
};
