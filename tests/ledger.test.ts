import { describe, it, expect } from "vitest";
import { Ledger } from "../src/ledger.js";

describe("Ledger", () => {
  it("records and looks up a launch", () => {
    const l = new Ledger();
    l.record(123, "/p/Set.als");
    expect(l.lookup(123)?.projectPath).toBe("/p/Set.als");
  });

  it("returns undefined for an unknown pid", () => {
    expect(new Ledger().lookup(999)).toBeUndefined();
  });

  it("lists every recorded launch", () => {
    const l = new Ledger();
    l.record(1, "/a.als");
    l.record(2, "/b.als");
    expect(l.all()).toHaveLength(2);
  });

  it("overwrites a recycled pid rather than keeping the stale entry", () => {
    const l = new Ledger();
    l.record(1, "/a.als");
    l.record(1, "/b.als");
    expect(l.lookup(1)?.projectPath).toBe("/b.als");
  });
});
