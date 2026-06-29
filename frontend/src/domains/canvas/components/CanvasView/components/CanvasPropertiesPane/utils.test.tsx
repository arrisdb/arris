import { describe, expect, it } from "vitest";

import { COMPONENT_KINDS } from "../../utils";
import { PROP_SECTION_KINDS, SECTION_FOR } from "./utils";

describe("properties-section registry", () => {
  it("has a section for exactly every component kind (expansion guard)", () => {
    expect([...PROP_SECTION_KINDS].sort()).toEqual([...COMPONENT_KINDS].sort());
    expect(Object.keys(SECTION_FOR).sort()).toEqual([...COMPONENT_KINDS].sort());
  });

  it("every section is a defined component", () => {
    for (const kind of PROP_SECTION_KINDS) expect(SECTION_FOR[kind]).toBeTruthy();
  });
});
