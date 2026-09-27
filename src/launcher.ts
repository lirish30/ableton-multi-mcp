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

// Launches are identified by diffing the running PIDs before and after
// `open -n`. Two launches overlapping would each see the other's new PID as
// "fresh", so the snapshot -> open -> poll sequence must run one at a time.
// Module-level state is correct here: one server process, one queue.
let launchQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const result = launchQueue.then(work);
  // Keep the chain alive after a failed launch; the caller still sees the
  // rejection through `result`.
  launchQueue = result.catch(() => {});
  return result;
}

export async function launchProject(opts: {
  appPath: string;
  projectPath: string;
  timeoutMs?: number;
}): Promise<LaunchResult> {
  const { appPath } = opts;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const projectPath = await validateProjectPath(opts.projectPath);
  return serialized(() => launchAndIdentify(appPath, projectPath, timeoutMs));
}

async function launchAndIdentify(
  appPath: string,
  projectPath: string,
  timeoutMs: number
): Promise<LaunchResult> {
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
