import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseVersion,
  selectNewest,
  findInstallsIn,
  locateAbleton,
  AbletonNotFoundError,
} from "../src/ableton-locator.js";

let dir: string;

async function makeBundle(root: string, name: string) {
  await mkdir(join(root, name, "Contents", "MacOS"), { recursive: true });
  await writeFile(join(root, name, "Contents", "Info.plist"), "<plist/>");
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "abl-loc-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("parseVersion", () => {
  it("reads the version from a Suite bundle name", () => {
    expect(parseVersion("Ableton Live 12 Suite.app")).toBe(12);
  });

  it("reads the version from a Standard bundle name", () => {
    expect(parseVersion("Ableton Live 11 Standard.app")).toBe(11);
  });

  it("reads the version from a Lite bundle name", () => {
    expect(parseVersion("Ableton Live 10 Lite.app")).toBe(10);
  });

  it("reads the version from a Trial bundle name", () => {
    expect(parseVersion("Ableton Live 11 Trial.app")).toBe(11);
  });

  it("returns null when there is no version number", () => {
    expect(parseVersion("Ableton Live.app")).toBeNull();
  });
});

describe("selectNewest", () => {
  it("prefers the highest version", () => {
    const installs = [
      { appPath: "/a", bundleName: "Ableton Live 11 Suite.app", version: 11 },
      { appPath: "/b", bundleName: "Ableton Live 12 Suite.app", version: 12 },
    ];
    expect(selectNewest(installs).version).toBe(12);
  });

  it("prefers a versioned install over an unversioned one", () => {
    const installs = [
      { appPath: "/a", bundleName: "Ableton Live.app", version: null },
      { appPath: "/b", bundleName: "Ableton Live 9 Suite.app", version: 9 },
    ];
    expect(selectNewest(installs).version).toBe(9);
  });
});

describe("findInstallsIn", () => {
  it("finds Ableton Live bundles and ignores unrelated apps", async () => {
    await makeBundle(dir, "Ableton Live 11 Suite.app");
    await makeBundle(dir, "Spotify.app");
    const found = await findInstallsIn(dir);
    expect(found.map((i) => i.bundleName)).toEqual(["Ableton Live 11 Suite.app"]);
  });

  it("returns an empty array for a directory that does not exist", async () => {
    expect(await findInstallsIn(join(dir, "nope"))).toEqual([]);
  });
});

describe("locateAbleton", () => {
  it("honours ABLETON_APP_PATH verbatim", async () => {
    await makeBundle(dir, "Custom Live.app");
    const custom = join(dir, "Custom Live.app");
    const found = await locateAbleton({ env: { ABLETON_APP_PATH: custom }, searchDirs: [] });
    expect(found.appPath).toBe(custom);
  });

  it("rejects an ABLETON_APP_PATH that does not exist", async () => {
    await expect(
      locateAbleton({ env: { ABLETON_APP_PATH: join(dir, "ghost.app") }, searchDirs: [] })
    ).rejects.toThrow(/ABLETON_APP_PATH/);
  });

  it("picks the newest install across the search directories", async () => {
    await makeBundle(dir, "Ableton Live 11 Suite.app");
    await makeBundle(dir, "Ableton Live 12 Suite.app");
    const found = await locateAbleton({ env: {}, searchDirs: [dir] });
    expect(found.version).toBe(12);
  });

  it("throws AbletonNotFoundError listing every searched directory", async () => {
    const err = await locateAbleton({ env: {}, searchDirs: [dir] }).catch((e) => e);
    expect(err).toBeInstanceOf(AbletonNotFoundError);
    expect(err.searched).toEqual([dir]);
    expect(err.message).toMatch(/ABLETON_APP_PATH/);
  });
});
