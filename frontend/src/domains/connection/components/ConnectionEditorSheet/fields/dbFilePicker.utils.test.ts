import { describe, expect, it } from "vitest";
import { splitFilePath, joinFilePath } from "./dbFilePicker.utils";

describe("splitFilePath", () => {
  it("splits a full file path", () => {
    expect(splitFilePath("/a/b/x.db")).toEqual({ dir: "/a/b", name: "x.db" });
  });
  it("treats a trailing separator as a bare folder", () => {
    expect(splitFilePath("/a/b/")).toEqual({ dir: "/a/b", name: "" });
  });
  it("returns no dir for a bare name", () => {
    expect(splitFilePath("x.db")).toEqual({ dir: "", name: "x.db" });
  });
  it("handles an empty string", () => {
    expect(splitFilePath("")).toEqual({ dir: "", name: "" });
  });
  it("splits a Windows path", () => {
    expect(splitFilePath("C:\\data\\x.duckdb")).toEqual({ dir: "C:\\data", name: "x.duckdb" });
  });
});

describe("joinFilePath", () => {
  it("joins with a slash", () => {
    expect(joinFilePath("/a/b", "x.db")).toBe("/a/b/x.db");
  });
  it("does not double the separator", () => {
    expect(joinFilePath("/a/b/", "x.db")).toBe("/a/b/x.db");
  });
  it("joins a Windows path with a backslash", () => {
    expect(joinFilePath("C:\\data", "x.duckdb")).toBe("C:\\data\\x.duckdb");
  });
  it("returns the name unchanged when dir is empty", () => {
    expect(joinFilePath("", "x.db")).toBe("x.db");
  });
});
