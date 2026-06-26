import { describe, it, expect } from "vitest";
import { pickerKindGroups } from "./utils";
import { pickerKinds } from "../utils/drivers/registry";

const groupTitles = (query: string) => pickerKindGroups(query).map((group) => group.title);
const allKinds = (query: string) =>
  pickerKindGroups(query).flatMap((group) => group.options.map((option) => option.kind));

describe("pickerKindGroups", () => {
  it("covers every picker kind exactly once when query is empty", () => {
    expect(allKinds("")).toHaveLength(pickerKinds().length);
  });

  it("splits standard databases from the Others group", () => {
    expect(groupTitles("")).toEqual(["Data sources", "Others"]);
  });

  it("places Mixpanel under Others, not Databases", () => {
    const groups = pickerKindGroups("");
    const databases = groups.find((group) => group.title === "Data sources");
    const others = groups.find((group) => group.title === "Others");
    expect(databases?.options.some((option) => option.kind === "mixpanel")).toBe(false);
    expect(others?.options.map((option) => option.kind)).toEqual(["mixpanel"]);
  });

  it("orders the Databases group alphabetically by display name", () => {
    const databases = pickerKindGroups("").find((group) => group.title === "Data sources");
    const names = databases?.options.map((option) => option.displayName) ?? [];
    expect(names[0]).toBe("BigQuery");
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("filters by display name case-insensitively", () => {
    expect(allKinds("POSTGRE")).toEqual(["postgres"]);
  });

  it("drops empty groups, keeping only Others when it matches", () => {
    expect(groupTitles("mixpanel")).toEqual(["Others"]);
  });

  it("returns no groups when nothing matches", () => {
    expect(pickerKindGroups("nonexistent-db")).toEqual([]);
  });
});
