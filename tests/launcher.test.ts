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
