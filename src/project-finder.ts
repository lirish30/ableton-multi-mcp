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

export async function findList(roots: string[]): Promise<string[]> {
  const existing: string[] = [];
  for (const root of roots) {
    try {
      if ((await stat(root)).isDirectory()) existing.push(root);
    } catch {
      // root does not exist; skip it
    }
  }
  if (existing.length === 0) return [];
  // Hidden entries below the roots are pruned: external volumes carry
  // root-owned .Spotlight-V100 / .Trashes / .fseventsd folders that a normal
  // user cannot read, and "._Name.als" AppleDouble files that are not real
  // Live Sets. -mindepth 1 keeps a root that itself starts with "." searchable.
  const args = [
    ...existing,
    "-maxdepth", "6",
    "-mindepth", "1",
    "-name", ".*", "-prune",
    "-o", "-type", "f", "-name", "*.als", "-print",
  ];
  let stdout: string;
  try {
    ({ stdout } = await run("find", args, { maxBuffer: 16 * 1024 * 1024 }));
  } catch (err) {
    // find exits non-zero when ANY subdirectory is unreadable, but it still
    // prints every match it could reach. Keep those rather than discarding
    // the whole search; only fail when it produced nothing usable at all.
    const partial = (err as { stdout?: unknown }).stdout;
    if (typeof partial === "string" && partial.trim().length > 0) {
      stdout = partial;
    } else {
      throw err;
    }
  }
  return stdout.split("\n").filter(Boolean);
}

/**
 * Lists candidate .als files from BOTH Spotlight and a direct search of the
 * configured roots, merged and de-duplicated. The roots are always searched,
 * because Spotlight commonly skips external drives and excluded folders, and
 * that is exactly where ABLETON_PROJECTS_DIRS tends to point.
 */
export async function listProjectFiles(
  roots: string[],
  spotlight: () => Promise<string[]> = spotlightList
): Promise<string[]> {
  let fromSpotlight: string[] = [];
  try {
    fromSpotlight = await spotlight();
  } catch {
    fromSpotlight = [];
  }

  let fromRoots: string[] = [];
  try {
    fromRoots = await findList(roots);
  } catch (err) {
    // A failed root search should not hide what Spotlight already found.
    if (fromSpotlight.length === 0) throw err;
  }

  return [...new Set([...fromSpotlight, ...fromRoots])];
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
    (() => listProjectFiles(roots));

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
