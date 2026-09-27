import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../src/resolve.js";
import type { LiveProject } from "../src/project-finder.js";

function proj(name: string, path: string): LiveProject {
  return { name, path, modifiedAt: new Date(), projectFolder: null };
}

describe("resolveProject", () => {
  it("resolves an existing absolute path without searching", async () => {
    const dir = await mkdtemp(join(tmpdir(), "abl-res-"));
    const p = join(dir, "Set.als");
    await writeFile(p, "x");
    const find = async () => {
      throw new Error("should not search when given a real path");
    };
    const result = await resolveProject(p, { find });
    expect(result).toMatchObject({ kind: "resolved", path: p });
    await rm(dir, { recursive: true, force: true });
  });

  it("resolves a unique name match", async () => {
    const find = async () => [proj("Midnight Drive", "/a/Midnight Drive.als")];
    const result = await resolveProject("midnight", { find });
    expect(result).toMatchObject({ kind: "resolved", path: "/a/Midnight Drive.als" });
  });

  it("returns ambiguous candidates rather than guessing", async () => {
    const find = async () => [
      proj("Midnight Drive", "/a/Midnight Drive.als"),
      proj("Midnight Drive Remix", "/a/Midnight Drive Remix.als"),
    ];
    const result = await resolveProject("midnight", { find });
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") expect(result.candidates).toHaveLength(2);
  });

  it("prefers an exact name match over other candidates", async () => {
    const find = async () => [
      proj("Midnight Drive", "/a/Midnight Drive.als"),
      proj("Midnight Drive Remix", "/a/Midnight Drive Remix.als"),
    ];
    const result = await resolveProject("Midnight Drive", { find });
    expect(result).toMatchObject({ kind: "resolved", path: "/a/Midnight Drive.als" });
  });

  it("reports no match when nothing is found", async () => {
    const find = async () => [];
    const result = await resolveProject("banana", { find });
    expect(result).toMatchObject({ kind: "none", query: "banana" });
  });
});
