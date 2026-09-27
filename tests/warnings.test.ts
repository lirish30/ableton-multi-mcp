import { describe, it, expect } from "vitest";
import { warningsFor, MULTI_INSTANCE_WARNINGS } from "../src/warnings.js";

describe("warningsFor", () => {
  it("returns no warnings for a single instance", () => {
    expect(warningsFor(1)).toEqual([]);
  });

  it("returns the full warning list once a second instance exists", () => {
    expect(warningsFor(2)).toEqual([...MULTI_INSTANCE_WARNINGS]);
  });

  it("mentions the read-only browser", () => {
    expect(warningsFor(2).join(" ")).toMatch(/read-only browser/i);
  });

  it("mentions shared preferences", () => {
    expect(warningsFor(2).join(" ")).toMatch(/preferences/i);
  });

  it("states that this is unsupported by Ableton", () => {
    expect(warningsFor(2).join(" ")).toMatch(/not.*supported|unsupported/i);
  });
});
