import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DbtDocsPreview } from "./index";
import type { DbtDocs } from "@shared";

const DOCS: DbtDocs = {
  schemaVersion: "https://schemas.getdbt.com/dbt/manifest/v12.json",
  dbtVersion: "1.12.0",
  schemaVersionSupported: true,
  models: [
    {
      uniqueId: "model.jaffle_shop.dim_customers",
      name: "dim_customers",
      resourceType: "model",
      description: "Customer dimension table",
      schema: "public_marts",
      database: "postgres",
      materialized: "table",
      filePath: "models/marts/dim_customers.sql",
      columns: [
        { name: "customer_id", type: "integer", description: "Primary key" },
        { name: "total_amount", type: "bigint" },
      ],
      dependsOn: ["model.jaffle_shop.stg_customers", "model.jaffle_shop.stg_orders"],
    },
  ],
};

function noop() {}

describe("DbtDocsPreview", () => {
  it("renders the selected model's description, columns, types and dependencies", () => {
    render(
      <DbtDocsPreview
        docs={DOCS}
        modelId="model.jaffle_shop.dim_customers"
        isLoading={false}
        isStale={false}
        onRefresh={noop}
        onCollapse={noop}
      />,
    );
    expect(screen.getByText("dim_customers")).toBeTruthy();
    expect(screen.getByText("Customer dimension table")).toBeTruthy();
    expect(screen.getByText("customer_id")).toBeTruthy();
    expect(screen.getByText("integer")).toBeTruthy();
    expect(screen.getByText("Primary key")).toBeTruthy();
    expect(screen.getByText("total_amount")).toBeTruthy();
    expect(screen.getByText("bigint")).toBeTruthy();
    // Dependencies render by short name.
    expect(screen.getByText("stg_customers")).toBeTruthy();
    expect(screen.getByText("stg_orders")).toBeTruthy();
  });

  it("shows a placeholder when the current model has no docs", () => {
    render(
      <DbtDocsPreview
        docs={DOCS}
        modelId="model.jaffle_shop.unknown"
        isLoading={false}
        isStale={false}
        onRefresh={noop}
        onCollapse={noop}
      />,
    );
    expect(screen.getByTestId("docs-no-model")).toBeTruthy();
  });

  it("shows a placeholder when no docs are loaded yet", () => {
    render(
      <DbtDocsPreview
        docs={null}
        modelId="model.jaffle_shop.dim_customers"
        isLoading={false}
        isStale={false}
        onRefresh={noop}
        onCollapse={noop}
      />,
    );
    expect(screen.queryByTestId("docs-content")).toBeNull();
  });

  it("shows the command-logs pointer when generation failed and no docs are loaded", () => {
    render(
      <DbtDocsPreview
        docs={null}
        modelId="model.jaffle_shop.dim_customers"
        isLoading={false}
        isStale={false}
        hasError
        onRefresh={noop}
        onCollapse={noop}
      />,
    );
    expect(screen.getByTestId("docs-error").textContent).toContain("command logs");
  });

  it("shows the spinning database icon while generating, suppressing the error message", () => {
    render(
      <DbtDocsPreview
        docs={null}
        modelId="model.jaffle_shop.dim_customers"
        isLoading
        isStale={false}
        hasError
        onRefresh={noop}
        onCollapse={noop}
      />,
    );
    expect(screen.getByTestId("docs-loading-spinner")).toBeTruthy();
    expect(screen.queryByTestId("docs-error")).toBeNull();
  });

  it("warns when the manifest schema version is unsupported", () => {
    render(
      <DbtDocsPreview
        docs={{ ...DOCS, schemaVersionSupported: false }}
        modelId="model.jaffle_shop.dim_customers"
        isLoading={false}
        isStale={false}
        onRefresh={noop}
        onCollapse={noop}
      />,
    );
    expect(screen.getByTestId("docs-schema-warning")).toBeTruthy();
  });

  it("invokes onRefresh when the regenerate button is clicked", () => {
    const onRefresh = vi.fn();
    render(
      <DbtDocsPreview
        docs={DOCS}
        modelId="model.jaffle_shop.dim_customers"
        isLoading={false}
        isStale={true}
        onRefresh={onRefresh}
        onCollapse={noop}
      />,
    );
    expect(screen.getByTestId("docs-stale-chip")).toBeTruthy();
    screen.getByTestId("docs-refresh-button").click();
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
