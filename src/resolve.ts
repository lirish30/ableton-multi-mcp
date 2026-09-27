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
