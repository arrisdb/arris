import { describe, it, expect } from "vitest";
import { coerceQueryValue, typeHintToKind, extractIpcError, ipcErrorMessage } from "./backendTypes";

describe("coerceQueryValue", () => {
  it("coerces 'true'/'false' to bool when target is bool", () => {
    expect(coerceQueryValue("true", "bool")).toEqual({ kind: "bool", value: true });
    expect(coerceQueryValue("false", "bool")).toEqual({ kind: "bool", value: false });
    expect(coerceQueryValue("1", "bool")).toEqual({ kind: "bool", value: true });
    expect(coerceQueryValue("0", "bool")).toEqual({ kind: "bool", value: false });
  });

  it("falls back to text for unparseable bool", () => {
    expect(coerceQueryValue("yes", "bool")).toEqual({ kind: "text", value: "yes" });
  });

  it("coerces integers", () => {
    expect(coerceQueryValue("42", "int")).toEqual({ kind: "int", value: 42 });
    expect(coerceQueryValue("-7", "int")).toEqual({ kind: "int", value: -7 });
  });

  it("falls back to text for non-integer", () => {
    expect(coerceQueryValue("3.14", "int")).toEqual({ kind: "text", value: "3.14" });
    expect(coerceQueryValue("abc", "int")).toEqual({ kind: "text", value: "abc" });
  });

  it("coerces doubles", () => {
    expect(coerceQueryValue("3.14", "double")).toEqual({ kind: "double", value: 3.14 });
    expect(coerceQueryValue("42", "double")).toEqual({ kind: "double", value: 42 });
  });

  it("returns null for empty or 'null' string", () => {
    expect(coerceQueryValue("", "text")).toEqual({ kind: "null" });
    expect(coerceQueryValue("null", "int")).toEqual({ kind: "null" });
    expect(coerceQueryValue("NULL", "bool")).toEqual({ kind: "null" });
  });

  it("returns text for text target", () => {
    expect(coerceQueryValue("hello", "text")).toEqual({ kind: "text", value: "hello" });
  });

  it("returns json kind for json target", () => {
    expect(coerceQueryValue('{"a":1}', "json")).toEqual({ kind: "json", value: '{"a":1}' });
  });
});

describe("typeHintToKind", () => {
  it("maps bool hints", () => {
    expect(typeHintToKind("bool")).toBe("bool");
    expect(typeHintToKind("boolean")).toBe("bool");
  });

  it("maps integer hints", () => {
    expect(typeHintToKind("int")).toBe("int");
    expect(typeHintToKind("int4")).toBe("int");
    expect(typeHintToKind("bigint")).toBe("int");
    expect(typeHintToKind("serial")).toBe("int");
    expect(typeHintToKind("smallint")).toBe("int");
    expect(typeHintToKind("integer")).toBe("int");
  });

  it("maps float hints", () => {
    expect(typeHintToKind("float8")).toBe("double");
    expect(typeHintToKind("numeric")).toBe("double");
    expect(typeHintToKind("decimal")).toBe("double");
    expect(typeHintToKind("real")).toBe("double");
    expect(typeHintToKind("double")).toBe("double");
  });

  it("maps json hints", () => {
    expect(typeHintToKind("json")).toBe("json");
    expect(typeHintToKind("jsonb")).toBe("json");
  });

  it("maps binary hints", () => {
    expect(typeHintToKind("bytea")).toBe("data");
    expect(typeHintToKind("blob")).toBe("data");
  });

  it("defaults to text for unknown", () => {
    expect(typeHintToKind("varchar")).toBe("text");
    expect(typeHintToKind("text")).toBe("text");
    expect(typeHintToKind("uuid")).toBe("text");
    expect(typeHintToKind("timestamp")).toBe("text");
  });
});

describe("extractIpcError", () => {
  it("extracts IpcError with code and message", () => {
    const e = { code: "queryFailed", message: "table not found" };
    expect(extractIpcError(e)).toEqual({ code: "queryFailed", message: "table not found" });
  });

  it("extracts object with only message", () => {
    const e = { message: "something broke" };
    expect(extractIpcError(e)).toEqual({ code: "other", message: "something broke" });
  });

  it("JSON.stringifies object without message", () => {
    const e = { foo: "bar" };
    expect(extractIpcError(e)).toEqual({ code: "other", message: '{"foo":"bar"}' });
  });

  it("handles plain string", () => {
    expect(extractIpcError("plain error")).toEqual({ code: "other", message: "plain error" });
  });

  it("handles null", () => {
    expect(extractIpcError(null).message).toBe("null");
  });

  it("handles undefined", () => {
    expect(extractIpcError(undefined).message).toBe("undefined");
  });
});

describe("ipcErrorMessage", () => {
  it("returns message from IpcError", () => {
    expect(ipcErrorMessage({ code: "queryFailed", message: "bad sql" })).toBe("bad sql");
  });

  it("returns JSON for unknown object shape", () => {
    expect(ipcErrorMessage({ wrapped: { code: "x", message: "y" } })).toBe('{"wrapped":{"code":"x","message":"y"}}');
  });

  it("returns string for string error", () => {
    expect(ipcErrorMessage("timeout")).toBe("timeout");
  });
});
