import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locateAbleton } from "../src/ableton-locator.js";
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

describe("concurrent launchProject calls", () => {
  let dir: string;
  let appPath: string;
  let projectA: string;
  let projectB: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "abl-concurrent-"));
    appPath = await buildFakeLiveApp(dir, join(dir, "events.log"));
    projectA = join(dir, "Set A.als");
    projectB = join(dir, "Set B.als");
    await writeFile(projectA, "x");
    await writeFile(projectB, "x");
  }, 60000);

  afterAll(async () => {
    await killInstances(appPath);
    await rm(dir, { recursive: true, force: true });
  });

  it("gives each concurrent call its own, distinct PID", async () => {
    // A real MCP client may dispatch "open A and open B" as parallel tool
    // calls. Unserialised, both calls snapshot "before" ahead of either
    // launch and can both claim the same new PID.
    const [a, b] = await Promise.all([
      launchProject({ appPath, projectPath: projectA }),
      launchProject({ appPath, projectPath: projectB }),
    ]);

    expect(a.confirmed).toBe(true);
    expect(b.confirmed).toBe(true);
    expect(a.pid).toBeTypeOf("number");
    expect(b.pid).toBeTypeOf("number");
    expect(a.pid).not.toBe(b.pid);
    expect(a.projectPath).toMatch(/Set A\.als$/);
    expect(b.projectPath).toMatch(/Set B\.als$/);
    expect([a.instanceCount, b.instanceCount].sort()).toEqual([1, 2]);

    const running = await listInstancePids(appPath);
    expect(running).toContain(a.pid);
    expect(running).toContain(b.pid);
  });

  it("keeps serving launches after one in the queue fails", async () => {
    const [bad, good] = await Promise.allSettled([
      launchProject({ appPath: join(dir, "No Such App.app"), projectPath: projectA }),
      launchProject({ appPath, projectPath: projectB }),
    ]);
    expect(bad.status).toBe("rejected");
    expect(good.status).toBe("fulfilled");
    if (good.status === "fulfilled") expect(good.value.confirmed).toBe(true);
  });
});

describe("launchProject with a non-canonical ABLETON_APP_PATH", () => {
  let dir: string;
  let appPath: string;
  let projectPath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "abl-symlink-"));
    appPath = await buildFakeLiveApp(dir, join(dir, "events.log"));
    projectPath = join(dir, "Linked Set.als");
    await writeFile(projectPath, "x");
    await symlink(appPath, join(dir, "Live Link.app"));
  }, 60000);

  afterAll(async () => {
    await killInstances(appPath);
    await rm(dir, { recursive: true, force: true });
  });

  it("confirms the launch when the override is a symlink with a trailing slash", async () => {
    // Before canonicalisation in locateAbleton, the pgrep pattern was built
    // from "…/Live Link.app/" and never matched the running process, so the
    // launch reported confirmed: false and instanceCount: 0.
    const app = await locateAbleton({
      env: { ABLETON_APP_PATH: `${join(dir, "Live Link.app")}/` },
      searchDirs: [],
    });
    const result = await launchProject({ appPath: app.appPath, projectPath });
    expect(result.confirmed).toBe(true);
    expect(result.pid).toBeTypeOf("number");
    expect(result.instanceCount).toBe(1);
    expect(await listInstancePids(app.appPath)).toContain(result.pid);
  });
});
