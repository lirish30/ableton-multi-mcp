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
  if (installs.length === 0) {
    throw new Error("selectNewest called with an empty array");
  }
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
