type TypeCategory = "numeric" | "text" | "temporal" | "boolean" | "uuid" | "json" | "other";

const NUMERIC_TYPES = /^(?:int|integer|bigint|smallint|tinyint|mediumint|serial|bigserial|smallserial|float|double|real|decimal|numeric|number|money)\b/i;
const TEXT_TYPES = /^(?:text|varchar|char|character|string|name|citext|bpchar|nvarchar|nchar|clob)\b/i;
const TEMPORAL_TYPES = /^(?:date|time|timestamp|timestamptz|datetime|interval)\b/i;
const BOOLEAN_TYPES = /^(?:bool|boolean|bit)\b/i;
const UUID_TYPES = /^(?:uuid|uniqueidentifier)\b/i;
const JSON_TYPES = /^(?:json|jsonb)\b/i;

function categorizeType(typeStr: string | undefined): TypeCategory {
  if (!typeStr) return "other";
  const t = typeStr.trim();
  if (NUMERIC_TYPES.test(t)) return "numeric";
  if (TEXT_TYPES.test(t)) return "text";
  if (TEMPORAL_TYPES.test(t)) return "temporal";
  if (BOOLEAN_TYPES.test(t)) return "boolean";
  if (UUID_TYPES.test(t)) return "uuid";
  if (JSON_TYPES.test(t)) return "json";
  return "other";
}

function typesCompatible(a: TypeCategory, b: TypeCategory): boolean {
  if (a === "other" || b === "other") return false;
  return a === b;
}

export { categorizeType, typesCompatible };

export type { TypeCategory };
