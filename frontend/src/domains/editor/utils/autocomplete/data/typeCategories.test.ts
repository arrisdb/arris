import { describe, it, expect } from "vitest";
import { categorizeType, typesCompatible } from "./typeCategories";

describe("categorizeType", () => {
  it("categorizes numeric types", () => {
    expect(categorizeType("integer")).toBe("numeric");
    expect(categorizeType("bigint")).toBe("numeric");
    expect(categorizeType("float")).toBe("numeric");
    expect(categorizeType("decimal")).toBe("numeric");
    expect(categorizeType("numeric(10,2)")).toBe("numeric");
    expect(categorizeType("serial")).toBe("numeric");
  });

  it("categorizes text types", () => {
    expect(categorizeType("text")).toBe("text");
    expect(categorizeType("varchar")).toBe("text");
    expect(categorizeType("varchar(255)")).toBe("text");
    expect(categorizeType("char(10)")).toBe("text");
  });

  it("categorizes temporal types", () => {
    expect(categorizeType("date")).toBe("temporal");
    expect(categorizeType("timestamp")).toBe("temporal");
    expect(categorizeType("timestamptz")).toBe("temporal");
    expect(categorizeType("interval")).toBe("temporal");
  });

  it("categorizes boolean types", () => {
    expect(categorizeType("boolean")).toBe("boolean");
    expect(categorizeType("bool")).toBe("boolean");
  });

  it("categorizes uuid types", () => {
    expect(categorizeType("uuid")).toBe("uuid");
  });

  it("categorizes json types", () => {
    expect(categorizeType("json")).toBe("json");
    expect(categorizeType("jsonb")).toBe("json");
  });

  it("returns other for unknown types", () => {
    expect(categorizeType("bytea")).toBe("other");
    expect(categorizeType(undefined)).toBe("other");
  });
});

describe("typesCompatible", () => {
  it("returns true for same categories", () => {
    expect(typesCompatible("numeric", "numeric")).toBe(true);
    expect(typesCompatible("text", "text")).toBe(true);
    expect(typesCompatible("uuid", "uuid")).toBe(true);
  });

  it("returns false for different categories", () => {
    expect(typesCompatible("numeric", "text")).toBe(false);
    expect(typesCompatible("uuid", "numeric")).toBe(false);
  });

  it("returns false when either is other", () => {
    expect(typesCompatible("other", "numeric")).toBe(false);
    expect(typesCompatible("text", "other")).toBe(false);
  });
});
