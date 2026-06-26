import { describe, expect, it } from "vitest";
import { dbtDefinitionOffset, dbtReferenceAt } from "./dbtReference";

describe("dbtReferenceAt", () => {
  it("resolves ref() to the model name", () => {
    const sql = "select * from {{ ref('stg_orders') }}";
    expect(dbtReferenceAt(sql, sql.indexOf("stg_orders"))).toEqual({ kind: "ref", name: "stg_orders" });
  });

  it("resolves the model arg from two-argument refs", () => {
    const sql = "{{ ref('shared', \"dim_customers\") }}";
    expect(dbtReferenceAt(sql, sql.indexOf("shared"))).toEqual({ kind: "ref", name: "dim_customers" });
  });

  it("resolves source() to source + table names", () => {
    const sql = "select * from {{ source('raw', 'orders') }}";
    expect(dbtReferenceAt(sql, sql.indexOf("orders"))).toEqual({
      kind: "source",
      sourceName: "raw",
      tableName: "orders",
    });
  });

  it("resolves doc() to the block name", () => {
    const sql = "{{ doc('order_status') }}";
    expect(dbtReferenceAt(sql, sql.indexOf("order_status"))).toEqual({ kind: "doc", name: "order_status" });
  });

  it("resolves a macro call inside an expression block", () => {
    const sql = "select {{ cents_to_dollars('amount') }} from x";
    expect(dbtReferenceAt(sql, sql.indexOf("cents_to_dollars"))).toEqual({ kind: "macro", name: "cents_to_dollars" });
  });

  it("resolves a macro call inside a statement block", () => {
    const sql = "{% set total = sum_amount(orders) %}";
    expect(dbtReferenceAt(sql, sql.indexOf("sum_amount"))).toEqual({ kind: "macro", name: "sum_amount" });
  });

  it("ignores plain SQL function calls outside jinja", () => {
    const sql = "select count(*) from orders";
    expect(dbtReferenceAt(sql, sql.indexOf("count"))).toBeNull();
  });

  it("returns null when the cursor is outside any reference", () => {
    const sql = "select * from {{ ref('stg_orders') }}";
    expect(dbtReferenceAt(sql, sql.indexOf("select"))).toBeNull();
  });
});

describe("dbtDefinitionOffset", () => {
  it("locates a macro definition by name", () => {
    const text = "{% macro other(x) %}{% endmacro %}\n{% macro to_dollars(x) %}{{ x }}{% endmacro %}";
    const offset = dbtDefinitionOffset(text, { kind: "macro", name: "to_dollars" });
    expect(offset).toBe(text.indexOf("{% macro to_dollars"));
  });

  it("locates a docs block by name", () => {
    const text = "{% docs intro %}hi{% enddocs %}\n{% docs order_status %}desc{% enddocs %}";
    const offset = dbtDefinitionOffset(text, { kind: "doc", name: "order_status" });
    expect(offset).toBe(text.indexOf("{% docs order_status"));
  });

  it("locates a source table definition in yaml", () => {
    const text = "sources:\n  - name: raw\n    tables:\n      - name: orders\n      - name: customers\n";
    const offset = dbtDefinitionOffset(text, { kind: "source", sourceName: "raw", tableName: "customers" });
    expect(offset).toBe(text.indexOf("- name: customers"));
  });

  it("returns undefined for refs (models open at the top)", () => {
    expect(dbtDefinitionOffset("select 1", { kind: "ref", name: "stg_orders" })).toBeUndefined();
  });
});
