# ableton-multi-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a macOS-only MCP server that opens additional Ableton Live projects in new instances, found by name, distributed via npm.

**Architecture:** Seven small single-responsibility modules behind a thin MCP
stdio server. The core is `open -n -a "<Live.app>" "<project.als>"`, invoked
through `execFile` with an argument array. New-instance PIDs are captured by
diffing `pgrep` output before and after launch.

**Tech Stack:** TypeScript 5.9 (ESM), Node >= 18, `@modelcontextprotocol/sdk` 1.30, `zod` 4, Vitest 5. No runtime dependencies beyond the SDK and zod.

**Spec:** `docs/superpowers/specs/2026-09-15-ableton-multi-mcp-design.md`

## Global Constraints

- **macOS only.** Refuse to start on any other platform.
- **Node >= 18.** Set in `package.json` `engines`.
- **ESM only.** `"type": "module"`; all relative imports carry a `.js` extension.
- **Never build a shell string.** Every subprocess call uses `execFile` with an argument array. Project paths contain spaces, apostrophes and non-ASCII characters; shell interpolation is both a correctness bug and a command-injection vector.
- **Version- and edition-agnostic.** Live 9-12, Lite/Intro/Standard/Suite/Trial. No version-specific code paths.
- **Exclude `Backup/`.** Ableton auto-backups must never appear in search results.
- **Never guess between projects.** Ambiguous names return candidates and take no action.
- **TypeScript pinned to `^5.9.3`,** not 7.x, deliberately: 5.9 is the battle-tested compiler and this project has no need for the new one.

## Verified Platform Facts

These were confirmed experimentally on macOS before this plan was written. Do
not re-litigate them; do not "fix" code that depends on them.

1. `open -n -a <App> <file>` launches a **genuinely separate instance** each time. Two consecutive calls produced two distinct PIDs.
2. The document path is delivered by **Apple Event (`odoc`), not `argv`.** A shell-script fake bundle logs `ARGV=[]`. Any test that asserts on a fake app's `argv` will fail for the wrong reason.
3. An **AppleScript applet built with `osacompile` does receive the document** in its `on open` handler, including paths containing spaces. This is the only viable fake-bundle test harness, and it is what Task 4 uses.

## File Structure

| File | Responsibility |
|---|---|
| `src/platform.ts` | macOS guard. Nothing else. |
| `src/ableton-locator.ts` | Find the Live app bundle; order multiple installs by version. |
| `src/project-finder.ts` | Discover `.als` files, exclude backups, rank by name and recency. |
| `src/launcher.ts` | Validate the project path, build `open` args, launch, capture the new PID. |
| `src/ledger.ts` | In-memory `pid -> project` record. |
| `src/warnings.ts` | The multi-instance warning text, in one place. |
| `src/server.ts` | MCP tool schemas and handlers. No discovery or launch logic. |
| `src/index.ts` | `bin` entry point: platform guard, then start the server. |
| `tests/*.test.ts` | One test file per module. |
| `tests/helpers/fake-app.ts` | Builds an AppleScript applet fake bundle for tests. |

---

### Task 1: Project scaffold and platform guard

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/platform.ts`
- Test: `tests/platform.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `assertMacOS(platform?: NodeJS.Platform): void` and `class UnsupportedPlatformError extends Error`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ableton-multi-mcp",
  "version": "0.1.0",
  "description": "Open multiple Ableton Live projects at once on macOS, via MCP.",
  "type": "module",
  "license": "MIT",
  "bin": { "ableton-multi-mcp": "dist/index.js" },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsc && chmod +x dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.30.0",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@types/node": "^22.20.3",
    "typescript": "^5.9.3",
    "vitest": "^5.0.1"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
  },
});
```

30 seconds because Task 4's tests launch real processes and poll for them.

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: completes with no peer-dependency errors.

- [ ] **Step 5: Write the failing test**

Create `tests/platform.test.ts`:

```ts
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
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run tests/platform.test.ts`
Expected: FAIL — cannot resolve `../src/platform.js`.

- [ ] **Step 7: Write the implementation**

Create `src/platform.ts`:

```ts
export class UnsupportedPlatformError extends Error {
  constructor(public readonly detected: NodeJS.Platform) {
    super(
      `ableton-multi-mcp requires macOS, but detected platform "${detected}". ` +
        `The multi-instance mechanism this server uses (the macOS "open -n" command) ` +
        `does not exist on other platforms.`
    );
    this.name = "UnsupportedPlatformError";
  }
}

export function assertMacOS(platform: NodeJS.Platform = process.platform): void {
  if (platform !== "darwin") {
    throw new UnsupportedPlatformError(platform);
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/platform.test.ts`
Expected: 4 passed.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/platform.ts tests/platform.test.ts
git commit -m "feat: scaffold project and add macOS platform guard"
```

---

### Task 2: Locate the Ableton Live application bundle

**Files:**
- Create: `src/ableton-locator.ts`
- Test: `tests/ableton-locator.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface AbletonInstall { appPath: string; bundleName: string; version: number | null }`
  - `function parseVersion(bundleName: string): number | null`
  - `function selectNewest(installs: AbletonInstall[]): AbletonInstall`
  - `function findInstallsIn(dir: string): Promise<AbletonInstall[]>`
  - `function locateAbleton(opts?: { env?: NodeJS.ProcessEnv; searchDirs?: string[] }): Promise<AbletonInstall>`
  - `class AbletonNotFoundError extends Error { readonly searched: string[] }`

- [ ] **Step 1: Write the failing test**

Create `tests/ableton-locator.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ableton-locator.test.ts`
Expected: FAIL — cannot resolve `../src/ableton-locator.js`.

- [ ] **Step 3: Write the implementation**

Create `src/ableton-locator.ts`:

```ts
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AbletonInstall {
  appPath: string;
  bundleName: string;
  version: number | null;
}

export class AbletonNotFoundError extends Error {
  constructor(public readonly searched: string[]) {
    super(
      `Could not find Ableton Live. Searched:\n` +
        searched.map((d) => `  - ${d}`).join("\n") +
        `\n\nIf Live is installed somewhere else (an external drive, a renamed ` +
        `bundle, or a non-standard folder), set the ABLETON_APP_PATH environment ` +
        `variable to the full path of the .app bundle, for example:\n` +
        `  ABLETON_APP_PATH="/Volumes/Audio/Ableton Live 11 Suite.app"`
    );
    this.name = "AbletonNotFoundError";
  }
}

export function parseVersion(bundleName: string): number | null {
  const match = /^Ableton Live (\d+)\b/.exec(bundleName);
  return match ? Number(match[1]) : null;
}

export function selectNewest(installs: AbletonInstall[]): AbletonInstall {
  return [...installs].sort((a, b) => (b.version ?? -1) - (a.version ?? -1))[0];
}

export async function findInstallsIn(dir: string): Promise<AbletonInstall[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => /^Ableton Live\b.*\.app$/.test(name))
    .map((name) => ({
      appPath: join(dir, name),
      bundleName: name,
      version: parseVersion(name),
    }));
}

export function defaultSearchDirs(home: string = homedir()): string[] {
  return ["/Applications", join(home, "Applications")];
}

export async function locateAbleton(opts: {
  env?: NodeJS.ProcessEnv;
  searchDirs?: string[];
} = {}): Promise<AbletonInstall> {
  const env = opts.env ?? process.env;
  const searchDirs = opts.searchDirs ?? defaultSearchDirs();

  const override = env.ABLETON_APP_PATH;
  if (override) {
    try {
      const info = await stat(override);
      if (!info.isDirectory()) throw new Error("not a bundle");
    } catch {
      throw new Error(
        `ABLETON_APP_PATH is set to "${override}", but no application bundle ` +
          `exists there. Point it at a .app bundle, or unset it to search the ` +
          `default locations.`
      );
    }
    const bundleName = override.replace(/\/+$/, "").split("/").pop() ?? override;
    return { appPath: override, bundleName, version: parseVersion(bundleName) };
  }

  const found: AbletonInstall[] = [];
  for (const dir of searchDirs) {
    found.push(...(await findInstallsIn(dir)));
  }
  if (found.length === 0) throw new AbletonNotFoundError(searchDirs);
  return selectNewest(found);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/ableton-locator.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add src/ableton-locator.ts tests/ableton-locator.test.ts
git commit -m "feat: locate Ableton Live bundles across versions and editions"
```

---

### Task 3: Discover and rank Live projects

**Files:**
- Create: `src/project-finder.ts`
- Test: `tests/project-finder.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface LiveProject { name: string; path: string; modifiedAt: Date; projectFolder: string | null }`
  - `function isBackupPath(p: string): boolean`
  - `function projectFolderFor(p: string): string | null`
  - `function scoreMatch(query: string, name: string): number`
  - `function rankProjects(projects: LiveProject[], query?: string, limit?: number): LiveProject[]`
  - `function defaultProjectRoots(env?: NodeJS.ProcessEnv, home?: string): string[]`
  - `function findProjects(opts?: { query?: string; limit?: number; roots?: string[]; listFiles?: () => Promise<string[]> }): Promise<LiveProject[]>`

- [ ] **Step 1: Write the failing test**

Create `tests/project-finder.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isBackupPath,
  projectFolderFor,
  scoreMatch,
  rankProjects,
  defaultProjectRoots,
  findProjects,
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
      "Midnight Drive",
      "Midnight Drive Remix",
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/project-finder.test.ts`
Expected: FAIL — cannot resolve `../src/project-finder.js`.

- [ ] **Step 3: Write the implementation**

Create `src/project-finder.ts`:

```ts
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface LiveProject {
  name: string;
  path: string;
  modifiedAt: Date;
  projectFolder: string | null;
}

export function isBackupPath(p: string): boolean {
  return p.split("/").includes("Backup");
}

export function projectFolderFor(p: string): string | null {
  const folder = dirname(p);
  return basename(folder).endsWith(" Project") ? folder : null;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\.als$/, "").trim();
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

export function scoreMatch(query: string, name: string): number {
  const q = normalize(query);
  const n = normalize(name);
  if (q.length === 0) return 0;
  if (n === q) return 1;
  if (n.startsWith(q)) return 0.8;
  if (n.includes(q)) return 0.6;
  if (isSubsequence(q.replace(/\s+/g, ""), n.replace(/\s+/g, ""))) return 0.4;
  return 0;
}

export function rankProjects(
  projects: LiveProject[],
  query?: string,
  limit = 20
): LiveProject[] {
  const scored = projects.map((p) => ({
    p,
    score: query ? scoreMatch(query, p.name) : 1,
  }));
  return scored
    .filter((s) => s.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || b.p.modifiedAt.getTime() - a.p.modifiedAt.getTime()
    )
    .slice(0, limit)
    .map((s) => s.p);
}

export function defaultProjectRoots(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string[] {
  const override = env.ABLETON_PROJECTS_DIRS;
  if (override) return override.split(":").filter(Boolean);
  return [join(home, "Music", "Ableton"), join(home, "Documents", "Ableton")];
}

async function spotlightList(): Promise<string[]> {
  const { stdout } = await run("mdfind", ['kMDItemFSName == "*.als"'], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.split("\n").filter(Boolean);
}

async function findList(roots: string[]): Promise<string[]> {
  const existing: string[] = [];
  for (const root of roots) {
    try {
      if ((await stat(root)).isDirectory()) existing.push(root);
    } catch {
      // root does not exist; skip it
    }
  }
  if (existing.length === 0) return [];
  const { stdout } = await run(
    "find",
    [...existing, "-maxdepth", "6", "-type", "f", "-name", "*.als"],
    { maxBuffer: 16 * 1024 * 1024 }
  );
  return stdout.split("\n").filter(Boolean);
}

export async function findProjects(
  opts: {
    query?: string;
    limit?: number;
    roots?: string[];
    listFiles?: () => Promise<string[]>;
  } = {}
): Promise<LiveProject[]> {
  const roots = opts.roots ?? defaultProjectRoots();
  const listFiles =
    opts.listFiles ??
    (async () => {
      let paths: string[] = [];
      try {
        paths = await spotlightList();
      } catch {
        paths = [];
      }
      if (paths.length === 0) paths = await findList(roots);
      return paths;
    });

  const paths = (await listFiles()).filter((p) => !isBackupPath(p));

  const projects: LiveProject[] = [];
  for (const path of paths) {
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      projects.push({
        name: basename(path, ".als"),
        path,
        modifiedAt: info.mtime,
        projectFolder: projectFolderFor(path),
      });
    } catch {
      // Spotlight can return stale paths; skip anything that vanished.
    }
  }

  return rankProjects(projects, opts.query, opts.limit);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/project-finder.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add src/project-finder.ts tests/project-finder.test.ts
git commit -m "feat: discover and rank Live projects, excluding auto-backups"
```

---

### Task 4: Launch a new instance and capture its PID

This is the heart of the project. Read the "Verified Platform Facts" section
above before starting. In particular: **do not assert on a fake app's `argv`.**
Documents arrive by Apple Event, so the test harness is an AppleScript applet.

**Files:**
- Create: `src/launcher.ts`
- Create: `tests/helpers/fake-app.ts`
- Test: `tests/launcher.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface LaunchResult { pid: number | null; confirmed: boolean; projectPath: string; appPath: string; instanceCount: number }`
  - `class InvalidProjectError extends Error`
  - `class LaunchError extends Error`
  - `function escapeRegex(s: string): string`
  - `function buildOpenArgs(appPath: string, projectPath: string): string[]`
  - `function validateProjectPath(p: string): Promise<string>`
  - `function listInstancePids(appPath: string): Promise<number[]>`
  - `function launchProject(opts: { appPath: string; projectPath: string; timeoutMs?: number }): Promise<LaunchResult>`

- [ ] **Step 1: Write the fake-app test helper**

Create `tests/helpers/fake-app.ts`:

```ts
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Builds an AppleScript applet that behaves enough like Ableton Live for tests:
 * it is a real .app bundle with an event loop, so macOS delivers documents to
 * it via the `odoc` Apple Event exactly as it does to Live.
 *
 * A shell-script bundle CANNOT be used here: macOS does not pass the document
 * in argv, so such a fake receives nothing. This was verified experimentally.
 */
export async function buildFakeLiveApp(dir: string, logPath: string): Promise<string> {
  const appPath = join(dir, "Ableton Live 99 Suite.app");
  const src = join(dir, "fake.applescript");
  await writeFile(
    src,
    [
      "on run",
      `  do shell script "echo RUN >> " & quoted form of "${logPath}"`,
      "  delay 20",
      "end run",
      "",
      "on open theFiles",
      "  repeat with f in theFiles",
      `    do shell script "echo OPEN:" & quoted form of (POSIX path of f) & " >> " & quoted form of "${logPath}"`,
      "  end repeat",
      "  delay 20",
      "end open",
    ].join("\n")
  );
  await run("osacompile", ["-o", appPath, src]);
  return appPath;
}

export async function killInstances(appPath: string): Promise<void> {
  try {
    await run("pkill", ["-f", appPath]);
  } catch {
    // pkill exits non-zero when nothing matched; that is fine.
  }
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/launcher.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  escapeRegex,
  buildOpenArgs,
  validateProjectPath,
  listInstancePids,
  launchProject,
  InvalidProjectError,
} from "../src/launcher.js";
import { buildFakeLiveApp, killInstances, wait } from "./helpers/fake-app.js";

describe("escapeRegex", () => {
  it("escapes regex metacharacters found in real paths", () => {
    expect(escapeRegex("/Apps/Live 12+ (beta).app")).toBe(
      "/Apps/Live 12\\+ \\(beta\\)\\.app"
    );
  });
});

describe("buildOpenArgs", () => {
  it("builds an argument array, never a shell string", () => {
    expect(buildOpenArgs("/A/Live.app", "/p/My Set.als")).toEqual([
      "-n",
      "-a",
      "/A/Live.app",
      "/p/My Set.als",
    ]);
  });

  it("does not quote or escape, because there is no shell", () => {
    const args = buildOpenArgs("/A/Live.app", "/p/It's \"Mine\".als");
    expect(args[3]).toBe("/p/It's \"Mine\".als");
  });
});

describe("validateProjectPath", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "abl-val-"));
    await writeFile(join(dir, "Set.als"), "x");
    await writeFile(join(dir, "notes.txt"), "x");
    await mkdir(join(dir, "Folder.als"), { recursive: true });
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("accepts an existing .als file", async () => {
    await expect(validateProjectPath(join(dir, "Set.als"))).resolves.toContain("Set.als");
  });

  it("rejects a non-.als file", async () => {
    await expect(validateProjectPath(join(dir, "notes.txt"))).rejects.toThrow(
      InvalidProjectError
    );
  });

  it("rejects a path that does not exist", async () => {
    await expect(validateProjectPath(join(dir, "ghost.als"))).rejects.toThrow(
      InvalidProjectError
    );
  });

  it("rejects a directory named like a project file", async () => {
    await expect(validateProjectPath(join(dir, "Folder.als"))).rejects.toThrow(
      InvalidProjectError
    );
  });
});

describe("launchProject against a fake Live bundle", () => {
  let dir: string;
  let appPath: string;
  let logPath: string;
  let projectPath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "abl-launch-"));
    logPath = join(dir, "events.log");
    appPath = await buildFakeLiveApp(dir, logPath);
    projectPath = join(dir, "My Test Set.als");
    await writeFile(projectPath, "x");
  }, 60000);

  afterAll(async () => {
    await killInstances(appPath);
    await rm(dir, { recursive: true, force: true });
  });

  it("reports no instances before anything is launched", async () => {
    expect(await listInstancePids(appPath)).toEqual([]);
  });

  it("launches a first instance and confirms its PID", async () => {
    const result = await launchProject({ appPath, projectPath });
    expect(result.confirmed).toBe(true);
    expect(result.pid).toBeTypeOf("number");
    expect(result.instanceCount).toBe(1);
  });

  it("launches a SECOND, genuinely separate instance", async () => {
    const first = await listInstancePids(appPath);
    const result = await launchProject({ appPath, projectPath });
    expect(result.confirmed).toBe(true);
    expect(first).not.toContain(result.pid);
    expect(result.instanceCount).toBe(2);
    expect((await listInstancePids(appPath)).length).toBe(2);
  });

  it("delivers the project path to every instance", async () => {
    await wait(1500);
    const log = await readFile(logPath, "utf8");
    const opens = log.split("\n").filter((l) => l.startsWith("OPEN:"));
    expect(opens.length).toBeGreaterThanOrEqual(2);
    expect(opens.every((l) => l.endsWith("My Test Set.als"))).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/launcher.test.ts`
Expected: FAIL — cannot resolve `../src/launcher.js`.

- [ ] **Step 4: Write the implementation**

Create `src/launcher.ts`:

```ts
import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface LaunchResult {
  pid: number | null;
  confirmed: boolean;
  projectPath: string;
  appPath: string;
  instanceCount: number;
}

export class InvalidProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProjectError";
  }
}

export class LaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LaunchError";
  }
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildOpenArgs(appPath: string, projectPath: string): string[] {
  return ["-n", "-a", appPath, projectPath];
}

export async function validateProjectPath(p: string): Promise<string> {
  if (!p.toLowerCase().endsWith(".als")) {
    throw new InvalidProjectError(
      `"${p}" is not an Ableton Live Set. This server only opens .als files.`
    );
  }
  let info;
  try {
    info = await stat(p);
  } catch {
    throw new InvalidProjectError(`No file exists at "${p}".`);
  }
  if (!info.isFile()) {
    throw new InvalidProjectError(`"${p}" is not a file.`);
  }
  return realpath(p);
}

export async function listInstancePids(appPath: string): Promise<number[]> {
  const pattern = escapeRegex(`${appPath}/Contents/MacOS/`);
  try {
    const { stdout } = await run("pgrep", ["-f", pattern]);
    return stdout.split("\n").filter(Boolean).map(Number);
  } catch {
    // pgrep exits 1 when there are no matches.
    return [];
  }
}

const POLL_INTERVAL_MS = 150;

export async function launchProject(opts: {
  appPath: string;
  projectPath: string;
  timeoutMs?: number;
}): Promise<LaunchResult> {
  const { appPath } = opts;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const projectPath = await validateProjectPath(opts.projectPath);

  const before = new Set(await listInstancePids(appPath));

  try {
    await run("open", buildOpenArgs(appPath, projectPath));
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new LaunchError(
      `macOS could not launch "${appPath}".` + (stderr ? ` ${stderr}` : "")
    );
  }

  const deadline = Date.now() + timeoutMs;
  let pids: number[] = [];
  let fresh: number[] = [];
  while (Date.now() < deadline) {
    pids = await listInstancePids(appPath);
    fresh = pids.filter((pid) => !before.has(pid));
    if (fresh.length > 0) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  return {
    pid: fresh[0] ?? null,
    confirmed: fresh.length > 0,
    projectPath,
    appPath,
    instanceCount: pids.length,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/launcher.test.ts`
Expected: all passed, including the two-distinct-instances assertion and the
`OPEN:` log assertion. If the `OPEN:` assertion fails, do not weaken it — it is
the assertion that proves the product works.

- [ ] **Step 6: Commit**

```bash
git add src/launcher.ts tests/launcher.test.ts tests/helpers/fake-app.ts
git commit -m "feat: launch Live projects in new instances and capture their PIDs"
```

---

### Task 5: Ledger, warnings, and name resolution

Three small modules with no I/O of their own. They exist so that `server.ts`
contains only MCP wiring.

**Files:**
- Create: `src/ledger.ts`, `src/warnings.ts`, `src/resolve.ts`
- Test: `tests/ledger.test.ts`, `tests/warnings.test.ts`, `tests/resolve.test.ts`

**Interfaces:**
- Consumes: `LiveProject`, `findProjects`, `scoreMatch` from `src/project-finder.ts`; `defaultProjectRoots` from the same.
- Produces:
  - `interface LedgerEntry { pid: number; projectPath: string; startedAt: Date }`
  - `class Ledger { record(pid: number, projectPath: string): void; lookup(pid: number): LedgerEntry | undefined; all(): LedgerEntry[] }`
  - `const MULTI_INSTANCE_WARNINGS: readonly string[]`
  - `function warningsFor(instanceCount: number): string[]`
  - `type Resolution = { kind: "resolved"; path: string; project: LiveProject | null } | { kind: "ambiguous"; candidates: LiveProject[] } | { kind: "none"; query: string }`
  - `function resolveProject(nameOrPath: string, deps?: { find?: typeof findProjects }): Promise<Resolution>`

- [ ] **Step 1: Write the failing ledger test**

Create `tests/ledger.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/ledger.test.ts`
Expected: FAIL — cannot resolve `../src/ledger.js`.

- [ ] **Step 3: Implement the ledger**

Create `src/ledger.ts`:

```ts
export interface LedgerEntry {
  pid: number;
  projectPath: string;
  startedAt: Date;
}

/**
 * In-memory only. A server restart forgets prior launches, and those instances
 * then report an unknown project. This is deliberate: reading another process's
 * open document reliably would require accessibility permissions, which is a
 * disproportionate ask for a cosmetic field.
 */
export class Ledger {
  private entries = new Map<number, LedgerEntry>();

  record(pid: number, projectPath: string): void {
    this.entries.set(pid, { pid, projectPath, startedAt: new Date() });
  }

  lookup(pid: number): LedgerEntry | undefined {
    return this.entries.get(pid);
  }

  all(): LedgerEntry[] {
    return [...this.entries.values()];
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/ledger.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Write the failing warnings test**

Create `tests/warnings.test.ts`:

```ts
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
```

- [ ] **Step 6: Run it to verify it fails, then implement**

Run: `npx vitest run tests/warnings.test.ts` → FAIL.

Create `src/warnings.ts`:

```ts
export const MULTI_INSTANCE_WARNINGS: readonly string[] = [
  "Only the first Live instance has a fully functional browser. Secondary instances have a read-only browser: no saving presets, no tagging, no collections, no folder management.",
  "All instances share a single preferences file, so they cannot be given different audio or MIDI settings.",
  "The first instance holds the Live library, plugin folders and linked browser folders.",
  "Expect higher CPU and RAM use, and possible audio device contention if your interface is claimed exclusively.",
  "Running multiple instances is a community workaround and is not supported by Ableton. Save your work often.",
];

export function warningsFor(instanceCount: number): string[] {
  return instanceCount > 1 ? [...MULTI_INSTANCE_WARNINGS] : [];
}
```

Run: `npx vitest run tests/warnings.test.ts` → 5 passed.

- [ ] **Step 7: Write the failing resolver test**

Create `tests/resolve.test.ts`:

```ts
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
```

- [ ] **Step 8: Run it to verify it fails, then implement**

Run: `npx vitest run tests/resolve.test.ts` → FAIL.

Create `src/resolve.ts`:

```ts
import { stat } from "node:fs/promises";
import { findProjects, scoreMatch, type LiveProject } from "./project-finder.js";

export type Resolution =
  | { kind: "resolved"; path: string; project: LiveProject | null }
  | { kind: "ambiguous"; candidates: LiveProject[] }
  | { kind: "none"; query: string };

async function isExistingFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

export async function resolveProject(
  nameOrPath: string,
  deps: { find?: typeof findProjects } = {}
): Promise<Resolution> {
  const find = deps.find ?? findProjects;

  if (nameOrPath.includes("/") && (await isExistingFile(nameOrPath))) {
    return { kind: "resolved", path: nameOrPath, project: null };
  }

  const candidates = await find({ query: nameOrPath, limit: 10 });
  if (candidates.length === 0) return { kind: "none", query: nameOrPath };
  if (candidates.length === 1) {
    return { kind: "resolved", path: candidates[0].path, project: candidates[0] };
  }

  const exact = candidates.filter((c) => scoreMatch(nameOrPath, c.name) === 1);
  if (exact.length === 1) {
    return { kind: "resolved", path: exact[0].path, project: exact[0] };
  }

  return { kind: "ambiguous", candidates };
}
```

Run: `npx vitest run tests/resolve.test.ts` → 5 passed.

- [ ] **Step 9: Commit**

```bash
git add src/ledger.ts src/warnings.ts src/resolve.ts tests/ledger.test.ts tests/warnings.test.ts tests/resolve.test.ts
git commit -m "feat: add launch ledger, multi-instance warnings and name resolution"
```

---

### Task 6: MCP server wiring

`server.ts` translates MCP calls into the modules above and formats results. It
contains no discovery or launch logic of its own.

**Files:**
- Create: `src/server.ts`, `src/index.ts`
- Test: `tests/server.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces:
  - `interface ServerDeps { locate: typeof locateAbleton; find: typeof findProjects; resolve: typeof resolveProject; launch: typeof launchProject; listPids: typeof listInstancePids; ledger: Ledger }`
  - `function createServer(deps?: Partial<ServerDeps>): McpServer`
  - `function startServer(): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/server.test.ts`. It drives the real server through an in-memory
MCP client, with the filesystem and process layers injected:

```ts
import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { Ledger } from "../src/ledger.js";
import type { LiveProject } from "../src/project-finder.js";

const APP = { appPath: "/A/Ableton Live 11 Suite.app", bundleName: "Ableton Live 11 Suite.app", version: 11 };

function proj(name: string, path: string): LiveProject {
  return { name, path, modifiedAt: new Date("2026-01-01T00:00:00Z"), projectFolder: null };
}

async function connect(deps: Parameters<typeof createServer>[0]) {
  const server = createServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function textOf(result: unknown): string {
  return (result as { content: { type: string; text: string }[] }).content
    .map((c) => c.text)
    .join("\n");
}

describe("MCP server", () => {
  it("exposes exactly the three documented tools", async () => {
    const client = await connect({});
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "find_projects",
      "list_open_instances",
      "open_project",
    ]);
  });

  it("find_projects returns matching project names", async () => {
    const client = await connect({
      find: async () => [proj("Midnight Drive", "/a/Midnight Drive.als")],
    });
    const result = await client.callTool({ name: "find_projects", arguments: { query: "mid" } });
    expect(textOf(result)).toContain("Midnight Drive");
  });

  it("find_projects reports plainly when nothing matches", async () => {
    const client = await connect({ find: async () => [] });
    const result = await client.callTool({ name: "find_projects", arguments: { query: "zzz" } });
    expect(textOf(result)).toMatch(/no .*projects/i);
  });

  it("open_project launches and reports the new instance", async () => {
    const ledger = new Ledger();
    const client = await connect({
      locate: async () => APP,
      resolve: async () => ({ kind: "resolved", path: "/a/Set.als", project: null }),
      launch: async () => ({
        pid: 4242,
        confirmed: true,
        projectPath: "/a/Set.als",
        appPath: APP.appPath,
        instanceCount: 2,
      }),
      ledger,
    });
    const text = textOf(await client.callTool({ name: "open_project", arguments: { name_or_path: "Set" } }));
    expect(text).toContain("4242");
    expect(text).toContain("Ableton Live 11 Suite.app");
    expect(ledger.lookup(4242)?.projectPath).toBe("/a/Set.als");
  });

  it("open_project surfaces the multi-instance warnings on the second instance", async () => {
    const client = await connect({
      locate: async () => APP,
      resolve: async () => ({ kind: "resolved", path: "/a/Set.als", project: null }),
      launch: async () => ({
        pid: 1,
        confirmed: true,
        projectPath: "/a/Set.als",
        appPath: APP.appPath,
        instanceCount: 2,
      }),
    });
    expect(textOf(await client.callTool({ name: "open_project", arguments: { name_or_path: "Set" } })))
      .toMatch(/read-only browser/i);
  });

  it("open_project refuses to guess between ambiguous names", async () => {
    const client = await connect({
      locate: async () => APP,
      resolve: async () => ({
        kind: "ambiguous",
        candidates: [proj("A Set", "/a/A Set.als"), proj("A Set 2", "/a/A Set 2.als")],
      }),
      launch: async () => {
        throw new Error("must not launch when ambiguous");
      },
    });
    const text = textOf(await client.callTool({ name: "open_project", arguments: { name_or_path: "a set" } }));
    expect(text).toMatch(/which/i);
    expect(text).toContain("A Set 2");
  });

  it("open_project explains when Ableton cannot be found", async () => {
    const client = await connect({
      locate: async () => {
        throw new Error("Could not find Ableton Live. Set ABLETON_APP_PATH.");
      },
    });
    const result = await client.callTool({ name: "open_project", arguments: { name_or_path: "Set" } });
    expect(textOf(result)).toMatch(/ABLETON_APP_PATH/);
  });

  it("open_project reports an unconfirmed launch honestly", async () => {
    const client = await connect({
      locate: async () => APP,
      resolve: async () => ({ kind: "resolved", path: "/a/Set.als", project: null }),
      launch: async () => ({
        pid: null,
        confirmed: false,
        projectPath: "/a/Set.als",
        appPath: APP.appPath,
        instanceCount: 0,
      }),
    });
    expect(textOf(await client.callTool({ name: "open_project", arguments: { name_or_path: "Set" } })))
      .toMatch(/could not confirm/i);
  });

  it("list_open_instances labels instances it did not launch as unknown", async () => {
    const ledger = new Ledger();
    ledger.record(11, "/a/Known.als");
    const client = await connect({
      locate: async () => APP,
      listPids: async () => [11, 22],
      ledger,
    });
    const text = textOf(await client.callTool({ name: "list_open_instances", arguments: {} }));
    expect(text).toContain("Known.als");
    expect(text).toMatch(/unknown/i);
  });

  it("list_open_instances says so when nothing is running", async () => {
    const client = await connect({ locate: async () => APP, listPids: async () => [] });
    expect(textOf(await client.callTool({ name: "list_open_instances", arguments: {} })))
      .toMatch(/no .*instances/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/server.test.ts`
Expected: FAIL — cannot resolve `../src/server.js`.

- [ ] **Step 3: Implement the server**

Create `src/server.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { locateAbleton } from "./ableton-locator.js";
import { findProjects } from "./project-finder.js";
import { resolveProject } from "./resolve.js";
import { launchProject, listInstancePids } from "./launcher.js";
import { Ledger } from "./ledger.js";
import { warningsFor } from "./warnings.js";

export interface ServerDeps {
  locate: typeof locateAbleton;
  find: typeof findProjects;
  resolve: typeof resolveProject;
  launch: typeof launchProject;
  listPids: typeof listInstancePids;
  ledger: Ledger;
}

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createServer(overrides: Partial<ServerDeps> = {}): McpServer {
  const deps: ServerDeps = {
    locate: locateAbleton,
    find: findProjects,
    resolve: resolveProject,
    launch: launchProject,
    listPids: listInstancePids,
    ledger: new Ledger(),
    ...overrides,
  };

  const server = new McpServer({ name: "ableton-multi-mcp", version: "0.1.0" });

  server.registerTool(
    "find_projects",
    {
      title: "Find Ableton projects",
      description:
        "Search the user's Ableton Live Sets (.als files) by name. Auto-backup files are excluded. With no query, returns the most recently modified projects.",
      inputSchema: {
        query: z.string().optional().describe("Part of the project name to search for."),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum results (default 20)."),
      },
    },
    async ({ query, limit }) => {
      try {
        const projects = await deps.find({ query, limit });
        if (projects.length === 0) {
          return text(
            query
              ? `No Ableton projects matched "${query}". Set ABLETON_PROJECTS_DIRS if your projects live outside ~/Music/Ableton and ~/Documents/Ableton.`
              : "No Ableton projects were found."
          );
        }
        const lines = projects.map(
          (p) => `- ${p.name}\n  path: ${p.path}\n  modified: ${p.modifiedAt.toISOString()}`
        );
        return text(`Found ${projects.length} project(s):\n${lines.join("\n")}`);
      } catch (err) {
        return text(`Could not search for projects: ${errorMessage(err)}`);
      }
    }
  );

  server.registerTool(
    "open_project",
    {
      title: "Open a project in a new Ableton instance",
      description:
        "Open an Ableton Live project in a NEW instance of Live, leaving any already-open project untouched. Accepts a project name or an absolute path to a .als file.",
      inputSchema: {
        name_or_path: z
          .string()
          .describe("Project name (e.g. \"Midnight Drive\") or absolute path to a .als file."),
      },
    },
    async ({ name_or_path }) => {
      let app;
      try {
        app = await deps.locate();
      } catch (err) {
        return text(errorMessage(err));
      }

      let resolution;
      try {
        resolution = await deps.resolve(name_or_path);
      } catch (err) {
        return text(`Could not resolve "${name_or_path}": ${errorMessage(err)}`);
      }

      if (resolution.kind === "none") {
        return text(
          `No Ableton project matched "${resolution.query}". Try find_projects to see what is available.`
        );
      }
      if (resolution.kind === "ambiguous") {
        const list = resolution.candidates.map((c) => `- ${c.name}\n  ${c.path}`).join("\n");
        return text(
          `Several projects match "${name_or_path}". Which one did you mean?\n${list}`
        );
      }

      let result;
      try {
        result = await deps.launch({ appPath: app.appPath, projectPath: resolution.path });
      } catch (err) {
        return text(`Could not open the project: ${errorMessage(err)}`);
      }

      if (result.pid !== null) deps.ledger.record(result.pid, result.projectPath);

      const header = result.confirmed
        ? `Opened "${result.projectPath}" in a new instance of ${app.bundleName} (pid ${result.pid}). ${result.instanceCount} instance(s) of Live are now running.`
        : `Asked macOS to open "${result.projectPath}" with ${app.bundleName}, but could not confirm that a new instance started. Check whether Live is showing a dialog, such as a licence or authorisation prompt.`;

      const warnings = warningsFor(result.instanceCount);
      const warningText =
        warnings.length > 0 ? `\n\nThings to know about running multiple instances:\n${warnings.map((w) => `- ${w}`).join("\n")}` : "";

      return text(header + warningText);
    }
  );

  server.registerTool(
    "list_open_instances",
    {
      title: "List running Ableton instances",
      description:
        "List the currently running instances of Ableton Live and, where known, which project each one has open.",
      inputSchema: {},
    },
    async () => {
      let app;
      try {
        app = await deps.locate();
      } catch (err) {
        return text(errorMessage(err));
      }

      let pids: number[];
      try {
        pids = await deps.listPids(app.appPath);
      } catch (err) {
        return text(`Could not list Ableton instances: ${errorMessage(err)}`);
      }

      if (pids.length === 0) return text("No instances of Ableton Live are running.");

      const lines = pids.map((pid) => {
        const entry = deps.ledger.lookup(pid);
        return entry
          ? `- pid ${pid}: ${entry.projectPath} (launched by this server at ${entry.startedAt.toISOString()})`
          : `- pid ${pid}: project unknown (not launched by this server)`;
      });
      return text(`${pids.length} instance(s) of ${app.bundleName} running:\n${lines.join("\n")}`);
    }
  );

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
```

- [ ] **Step 4: Create the binary entry point**

Create `src/index.ts`:

```ts
#!/usr/bin/env node
import { assertMacOS, UnsupportedPlatformError } from "./platform.js";
import { startServer } from "./server.js";

// Never write to stdout: it carries the MCP protocol stream.
try {
  assertMacOS();
} catch (err) {
  if (err instanceof UnsupportedPlatformError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

startServer().catch((err) => {
  console.error(`ableton-multi-mcp failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/server.test.ts`
Expected: 10 passed.

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck && npm run build`
Expected: all tests pass, no type errors, `dist/index.js` produced and executable.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts src/index.ts tests/server.test.ts
git commit -m "feat: wire MCP server with find_projects, open_project and list_open_instances"
```

---

### Task 7: Documentation, CI, and release preparation

**Files:**
- Create: `README.md`, `LICENSE`, `CHANGELOG.md`, `.github/workflows/ci.yml`

- [ ] **Step 1: Add the MIT LICENSE**

Create `LICENSE` with the standard MIT text, copyright `2026 Logan Irish`.

- [ ] **Step 2: Write the README**

Create `README.md`. It must contain, in this order:

1. One-sentence description: opens multiple Ableton Live projects at once on macOS, driven by your AI agent.
2. **A "What this is" note stating plainly that running multiple Live instances is an unsupported community workaround, not an Ableton feature.**
3. Requirements: macOS, Node 18+, any Ableton Live version 9-12, any edition including Trial.
4. Install — Claude Desktop, in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ableton-multi": {
      "command": "npx",
      "args": ["-y", "ableton-multi-mcp"]
    }
  }
}
```

5. Install — Claude Code: `claude mcp add ableton-multi -- npx -y ableton-multi-mcp`
6. Usage examples in plain language: "open my Midnight Drive set in a new window", "what Ableton projects do I have?", "what's running right now?"
7. **Limitations**, verbatim from `src/warnings.ts`, as a bulleted list.
8. Configuration: `ABLETON_APP_PATH` and `ABLETON_PROJECTS_DIRS`, each with an example.
9. Troubleshooting: Ableton not found, projects not found (Spotlight disabled), second instance shows an authorisation dialog.
10. A "How it works" paragraph: `open -n -a` plus PID diffing.

- [ ] **Step 3: Write the CHANGELOG**

Create `CHANGELOG.md` with an `## 0.1.0` section listing the three tools and the macOS-only constraint.

- [ ] **Step 4: Add CI**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

macOS runner is mandatory: the Task 4 tests build a real `.app` bundle with
`osacompile` and launch real processes. They cannot run on Linux.

- [ ] **Step 5: Verify the packaged binary actually runs**

```bash
npm run build
npm pack --dry-run
```

Expected: the tarball contains `dist/`, `README.md` and `LICENSE`, and nothing else.

- [ ] **Step 6: Commit**

```bash
git add README.md LICENSE CHANGELOG.md .github/workflows/ci.yml
git commit -m "docs: add README, licence, changelog and macOS CI"
```

- [ ] **Step 7: HUMAN GATE — smoke test against real Ableton Live**

**Do not publish to npm before this passes.** The author runs the server
against a real Live install and confirms:

1. `find_projects` lists real sets, with no `Backup/` entries.
2. With one project already open, `open_project` opens a second in a **separate** instance.
3. **The second instance actually loads the project**, rather than opening empty. If it opens empty, stop: the Apple Event document delivery differs on that Live version, and `open_project` needs a documented fallback before release.
4. `list_open_instances` reports both instances.
5. The reported warnings match observed behaviour.

Record the Live version and edition tested in `CHANGELOG.md` under 0.1.0.

- [ ] **Step 8: Publish**

```bash
npm publish --access public
```

Then create the GitHub repository and push.

---

## Self-Review Notes

Checked against `docs/superpowers/specs/2026-09-15-ableton-multi-mcp-design.md`:

- Every spec section maps to a task: platform guard (1), version/edition support (2), project discovery and backup filtering (3), core mechanism and PID capture (4), ledger, warnings and ambiguity handling (5), the three tools and error table (6), distribution and the human verification gate (7).
- No placeholders: every code step contains runnable code, and the README step enumerates its required sections rather than saying "write docs".
- Type consistency: `LiveProject`, `AbletonInstall`, `LaunchResult`, `Resolution` and `Ledger` are defined once and referenced with identical names and shapes in later tasks. `findProjects`, `locateAbleton`, `resolveProject`, `launchProject` and `listInstancePids` keep their signatures where `ServerDeps` reuses them via `typeof`.
- One spec deviation, deliberate: the spec listed `warnings.ts` and `ledger.ts` but no resolver module. Name resolution was going to land in `server.ts`, which the spec says must hold no discovery logic, so `src/resolve.ts` was added in Task 5.
