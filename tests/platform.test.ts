import { describe, it, expect } from "vitest";
import { assertMacOS, UnsupportedPlatformError } from "../src/platform.js";

describe("assertMacOS", () => {
  it("passes on darwin", () => {
    expect(() => assertMacOS("darwin")).not.toThrow();
  });

  it("throws UnsupportedPlatformError on win32", () => {
    expect(() => assertMacOS("win32")).toThrow(UnsupportedPlatformError);
  });

  it("names the detected platform in the message", () => {
    expect(() => assertMacOS("linux")).toThrow(/linux/);
  });

  it("explains that macOS is required", () => {
    expect(() => assertMacOS("linux")).toThrow(/macOS/);
  });
});
