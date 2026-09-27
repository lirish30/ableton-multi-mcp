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
