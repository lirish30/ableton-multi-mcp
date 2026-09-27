import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmod, mkdtemp, mkdir, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isBackupPath,
  projectFolderFor,
  scoreMatch,
  rankProjects,
  defaultProjectRoots,
  findProjects,
  findList,
  listProjectFiles,
  type LiveProject,
} from "../src/project-finder.js";

function proj(name: string, path: string, iso: string): LiveProject {
  return { name, path, modifiedAt: new Date(iso), projectFolder: null };
}

describe("isBackupPath", () => {
  it("flags files inside an Ableton Backup folder", () => {
    expect(isBackupPath("/a/My Set Project/Backup/My Set [2024-01-01].als")).toBe(true);
  });

  it("does not flag a normal project file", () => {
    expect(isBackupPath("/a/My Set Project/My Set.als")).toBe(false);
  });

  it("does not flag a folder merely containing the word backup", () => {
    expect(isBackupPath("/a/Backups Of Stuff/My Set.als")).toBe(false);
  });
});

describe("projectFolderFor", () => {
  it("returns the containing Ableton project folder", () => {
    expect(projectFolderFor("/a/My Set Project/My Set.als")).toBe("/a/My Set Project");
  });

  it("returns null for a loose .als file", () => {
    expect(projectFolderFor("/a/Desktop/My Set.als")).toBeNull();
  });
});

describe("scoreMatch", () => {
  it("scores an exact name match highest", () => {
    expect(scoreMatch("midnight drive", "Midnight Drive")).toBe(1);
  });

  it("scores a prefix match above a substring match", () => {
    expect(scoreMatch("midnight", "Midnight Drive")).toBeGreaterThan(
      scoreMatch("drive", "Midnight Drive")
    );
  });

  it("scores a subsequence match above nothing", () => {
    expect(scoreMatch("mdrv", "Midnight Drive")).toBeGreaterThan(0);
  });

  it("scores an unrelated query as zero", () => {
    expect(scoreMatch("banana", "Midnight Drive")).toBe(0);
  });

  it("ignores case and the .als extension", () => {
    expect(scoreMatch("MIDNIGHT DRIVE", "midnight drive.als")).toBe(1);
  });
});

describe("rankProjects", () => {
  const items = [
    proj("Midnight Drive", "/a/Midnight Drive.als", "2024-01-01T00:00:00Z"),
    proj("Midnight Drive Remix", "/a/Midnight Drive Remix.als", "2025-01-01T00:00:00Z"),
    proj("Sunrise", "/a/Sunrise.als", "2026-01-01T00:00:00Z"),
  ];

  it("drops non-matching projects when a query is given", () => {
    expect(rankProjects(items, "midnight").map((p) => p.name)).toEqual([
      "Midnight Drive Remix",
      "Midnight Drive",
    ]);
  });

  it("sorts by recency when no query is given", () => {
    expect(rankProjects(items).map((p) => p.name)).toEqual([
      "Sunrise",
      "Midnight Drive Remix",
      "Midnight Drive",
    ]);
  });

  it("respects the limit", () => {
    expect(rankProjects(items, undefined, 2)).toHaveLength(2);
  });
});

describe("defaultProjectRoots", () => {
  it("uses Music and Documents Ableton folders by default", () => {
    expect(defaultProjectRoots({}, "/Users/x")).toEqual([
      "/Users/x/Music/Ableton",
      "/Users/x/Documents/Ableton",
    ]);
  });

  it("honours ABLETON_PROJECTS_DIRS as a colon-separated list", () => {
    expect(defaultProjectRoots({ ABLETON_PROJECTS_DIRS: "/one:/two" }, "/Users/x")).toEqual([
      "/one",
      "/two",
    ]);
  });
});

describe("findProjects", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "abl-proj-"));
    await mkdir(join(dir, "Midnight Drive Project", "Backup"), { recursive: true });
    await writeFile(join(dir, "Midnight Drive Project", "Midnight Drive.als"), "x");
    await writeFile(join(dir, "Midnight Drive Project", "Backup", "Midnight Drive [old].als"), "x");
    await writeFile(join(dir, "Sunrise.als"), "x");
    const old = new Date("2020-01-01T00:00:00Z");
    await utimes(join(dir, "Midnight Drive Project", "Midnight Drive.als"), old, old);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("excludes files inside Backup folders", async () => {
    const listFiles = async () => [
      join(dir, "Midnight Drive Project", "Midnight Drive.als"),
      join(dir, "Midnight Drive Project", "Backup", "Midnight Drive [old].als"),
      join(dir, "Sunrise.als"),
    ];
    const results = await findProjects({ listFiles });
    expect(results.every((r) => !r.path.includes("/Backup/"))).toBe(true);
    expect(results).toHaveLength(2);
  });

  it("populates name, projectFolder and modifiedAt", async () => {
    const target = join(dir, "Midnight Drive Project", "Midnight Drive.als");
    const listFiles = async () => [target];
    const [result] = await findProjects({ listFiles });
    expect(result.name).toBe("Midnight Drive");
    expect(result.projectFolder).toBe(join(dir, "Midnight Drive Project"));
    expect(result.modifiedAt.getUTCFullYear()).toBe(2020);
  });

  it("skips paths that no longer exist instead of throwing", async () => {
    const listFiles = async () => [join(dir, "ghost.als"), join(dir, "Sunrise.als")];
    const results = await findProjects({ listFiles });
    expect(results.map((r) => r.name)).toEqual(["Sunrise"]);
  });

  it("filters by query", async () => {
    const listFiles = async () => [
      join(dir, "Midnight Drive Project", "Midnight Drive.als"),
      join(dir, "Sunrise.als"),
    ];
    const results = await findProjects({ query: "sunrise", listFiles });
    expect(results.map((r) => r.name)).toEqual(["Sunrise"]);
  });
});

describe("findList (direct search of the configured roots)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "abl-find-"));
  });

  afterEach(async () => {
    // Restore permissions first, or rm cannot descend into the locked folder.
    await chmod(join(dir, "Locked"), 0o755).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps every readable match when a subdirectory is unreadable", async () => {
    await mkdir(join(dir, "Good Project"), { recursive: true });
    await writeFile(join(dir, "Good Project", "Good.als"), "x");
    await mkdir(join(dir, "Locked"), { recursive: true });
    await writeFile(join(dir, "Locked", "Unreachable.als"), "x");
    await chmod(join(dir, "Locked"), 0o000);

    const found = await findList([dir]);
    expect(found).toContain(join(dir, "Good Project", "Good.als"));
  });

  it("skips hidden folders and AppleDouble ._ files", async () => {
    await mkdir(join(dir, ".Trashes"), { recursive: true });
    await writeFile(join(dir, ".Trashes", "Deleted.als"), "x");
    await writeFile(join(dir, "._Real.als"), "x");
    await writeFile(join(dir, "Real.als"), "x");

    expect(await findList([dir])).toEqual([join(dir, "Real.als")]);
  });

  it("still searches a root whose own name starts with a dot", async () => {
    await mkdir(join(dir, ".sets", "Inner"), { recursive: true });
    await writeFile(join(dir, ".sets", "Inner", "Dotted.als"), "x");

    expect(await findList([join(dir, ".sets")])).toEqual([
      join(dir, ".sets", "Inner", "Dotted.als"),
    ]);
  });

  it("returns nothing, rather than throwing, when no root exists", async () => {
    expect(await findList([join(dir, "missing")])).toEqual([]);
  });
});

describe("listProjectFiles", () => {
  let dir: string;
  let elsewhere: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "abl-roots-"));
    elsewhere = await mkdtemp(join(tmpdir(), "abl-spot-"));
    await writeFile(join(dir, "On External Drive.als"), "x");
    await writeFile(join(elsewhere, "Indexed By Spotlight.als"), "x");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  });

  it("searches the configured roots even when Spotlight finds other files", async () => {
    const spotlight = async () => [join(elsewhere, "Indexed By Spotlight.als")];
    const files = await listProjectFiles([dir], spotlight);
    expect(files).toContain(join(dir, "On External Drive.als"));
    expect(files).toContain(join(elsewhere, "Indexed By Spotlight.als"));
  });

  it("de-duplicates files found by both Spotlight and the root search", async () => {
    const shared = join(dir, "On External Drive.als");
    const files = await listProjectFiles([dir], async () => [shared]);
    expect(files.filter((f) => f === shared)).toHaveLength(1);
  });

  it("still searches the roots when Spotlight fails outright", async () => {
    const spotlight = async (): Promise<string[]> => {
      throw new Error("mdfind unavailable");
    };
    expect(await listProjectFiles([dir], spotlight)).toEqual([
      join(dir, "On External Drive.als"),
    ]);
  });

  it("is findProjects' default, so a root outside Spotlight is found end to end", async () => {
    // No listFiles override: this wires through the real mdfind. It only
    // discriminates the old bug on a machine where Spotlight returns other .als
    // files; the injected-Spotlight tests above cover that case everywhere.
    const results = await findProjects({ roots: [dir], query: "On External Drive" });
    expect(results.map((r) => r.path)).toContain(join(dir, "On External Drive.als"));
  });
});
