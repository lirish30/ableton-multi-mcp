# ableton-multi-mcp — Design

**Date:** 2026-09-15
**Status:** Approved for planning

## Problem

Ableton Live is a single-instance application. Opening a second project
requires quitting the first, or following a scattered set of community
workarounds involving terminal commands, duplicated application bundles, and
drag-and-drop. There is no first-party support and no packaged tool.

This project packages the macOS workaround as an MCP server, so a user
installs one thing, talks to their AI agent, and gets a second project open.

## Goals

- Open an additional Ableton Live project in a new instance, with one natural-language request.
- Let the user refer to a project by name, not by absolute path.
- Report honestly on the known limitations of running multiple instances.
- Be installable by a non-technical musician with a single config snippet.

## Non-Goals

- Windows or Linux support. macOS only in v1.
- Controlling Live itself (tracks, clips, transport). That is LiveOSC/Max territory.
- Working around the read-only-browser or shared-preferences limitations. They are
  properties of Live, not of this tool.
- Making multiple instances share an audio device cleanly.

## Platform Constraint

macOS only. The server refuses to start on other platforms with a clear message
naming the platform it detected.

## Ableton Version and Edition Support

Version- and edition-agnostic by design. The mechanism is provided by macOS
(`open -n`), not by Live, so it does not depend on anything inside the
application bundle. Live 9, 10, 11 and 12 are all supported, as are the Lite,
Intro, Standard, Suite and Trial editions.

No version-specific code paths exist. The only version-aware logic is app-bundle
discovery, which globs `Ableton Live *.app` and therefore matches any of them.
A trial install is a normal bundle in `/Applications` and works identically,
which means verification does not require a purchased license.

## Core Mechanism

```
open -n -a "<Ableton Live X Suite.app>" "<project.als>"
```

`-n` forces macOS to launch a new instance rather than activating the existing
one. `-a` names the application. The trailing path is the document to open.

Implementation requirements:

- Invoke via `execFile`/`spawn` with an **argument array**. Never build a shell
  string. Project paths routinely contain spaces, apostrophes, and emoji;
  shell interpolation would be both a correctness bug and a command-injection
  vector.
- Capture the new instance's PID by diffing the set of running Live PIDs
  immediately before and after the launch, polling briefly until a new PID
  appears or a timeout elapses.
- Record `pid -> project path` in a launch ledger so `list_open_instances` can
  report which instance holds which project.

## Tools

### `find_projects`

**Input:** `query` (optional string), `limit` (optional number, default 20)
**Output:** list of `{ name, path, modifiedAt, projectFolder }`

Searches for `.als` files. With no query, returns the most recently modified
projects.

Discovery order:
1. Spotlight via `mdfind`, scoped to `.als` files. Fast, and finds projects on
   external drives, which matters because producers commonly keep sets on
   externals.
2. Fallback when Spotlight returns nothing or is disabled: a depth-bounded
   `find` over the configured roots.

Default roots: `~/Music/Ableton`, `~/Documents/Ableton`. Overridable via the
`ABLETON_PROJECTS_DIRS` environment variable (colon-separated).

**Filtering:** results under a `Backup/` directory are excluded. Ableton writes
frequent timestamped auto-backups there; without this filter the majority of
results are noise and the correct project is buried.

**Ranking:** fuzzy name match against `query`, tie-broken by most recently
modified.

### `open_project`

**Input:** `name_or_path` (string)
**Output:** `{ launched: true, pid, projectPath, appPath, instanceCount, warnings[] }`

Resolution:
- If the input resolves to an existing file ending in `.als`, use it directly.
- Otherwise treat it as a name and run the `find_projects` search.
  - Exactly one match, or one match that is a case-insensitive exact name hit:
    open it.
  - Any other multi-match case: **do not guess.** Return the candidates and ask
    the user to disambiguate.
  - No match: return an error listing where it searched.

Validation before launching: path exists, is a regular file, has an `.als`
extension, and is resolved to a real path.

### `list_open_instances`

**Input:** none
**Output:** list of `{ pid, projectPath | "unknown", startedAt, launchedByThisServer }`

Enumerates running Live processes and cross-references the launch ledger. The
ledger is in-memory only, so instances launched before the current server
process started also report `"unknown"`.
Instances this server did not launch report `"unknown"` for the project rather
than guessing. This is deliberate: reading another process's open document
reliably would require accessibility permissions, which is a disproportionate
ask for a cosmetic field.

## Locating Ableton Live

1. `ABLETON_APP_PATH` environment variable, if set. Used verbatim.
2. Glob `/Applications` and `~/Applications` for `Ableton Live *.app`.
3. If several are found, select the highest version number, and **report the
   selection in the `open_project` result** so a user with both Live 11 and
   Live 12 installed can see which one was used rather than being surprised.
   `ABLETON_APP_PATH` is the way to pin a specific version or edition.

If none is found, the error names every location searched and explains the
`ABLETON_APP_PATH` override. Installs vary widely — external drives, renamed
bundles, non-standard directories — so this error is a primary user-facing
surface, not an afterthought.

## Warnings

Any `open_project` call that results in more than one running instance returns
a `warnings` array covering the documented limitations:

- Secondary instances have a **read-only browser**: no saving presets, no
  tagging, no collections, no folder management.
- **All instances share a single preferences file.** Per-instance audio settings
  are not possible.
- The first instance holds the Live library, plugin folders, and linked browser
  folders.
- Increased CPU and RAM use.
- Audio device contention, particularly with interfaces claimed exclusively.
- This is an unsupported community workaround, not an Ableton feature.

The README states the same plainly. The tool does not present this as a hidden
official capability.

## Error Handling

| Condition | Behavior |
|---|---|
| Not macOS | Refuse at startup, naming the detected platform. |
| Live not found | Error listing searched paths and the `ABLETON_APP_PATH` override. |
| Project name ambiguous | Return candidate list; take no action. |
| Project not found | Error listing searched roots and the `ABLETON_PROJECTS_DIRS` override. |
| Path is not `.als` | Reject with the offending path. |
| `open` exits nonzero | Surface the real stderr, unmodified. |
| New PID never appears | Report the launch as attempted-but-unconfirmed rather than claiming success. |

## Architecture

Small modules, each independently testable, no module larger than its one job:

- `platform.ts` — macOS guard.
- `ableton-locator.ts` — find the Live app bundle. Version-agnostic; parses
  version numbers only to order multiple installs.
- `project-finder.ts` — Spotlight/`find` discovery, backup filtering, fuzzy ranking.
- `launcher.ts` — argument construction, `execFile` invocation, PID diffing.
- `ledger.ts` — in-memory `pid -> project` record. Not persisted; a server
  restart forgets prior launches, and those instances then report `"unknown"`.
- `warnings.ts` — the warning text, in one place.
- `server.ts` — MCP wiring: tool schemas, handlers, stdio transport.

`server.ts` contains no discovery or launching logic; it only translates between
MCP calls and the modules above.

## Testing

Framework: Vitest. CI: GitHub Actions on `macos-latest`.

**Mechanism test (the important one).** Construct a fake `.app` bundle in a temp
directory whose executable records its argv and sleeps. Then assert that
`open -n` against it produces **two distinct PIDs**, and that the second process
**receives the document path as an argument**. This machine-verifies the entire
core mechanism without requiring Ableton Live to be installed, on any Mac
including CI.

**Unit tests.** App-bundle globbing and version selection, including fixtures
for Live 11 and Live 12 bundles side by side and for non-Suite editions; project discovery with
Spotlight stubbed; `Backup/` exclusion; fuzzy ranking order; argument array
construction for paths containing spaces, quotes, and non-ASCII characters;
every error branch in the table above.

**Human verification.** Before publishing, the author runs the server against a
real Ableton Live install (any version or edition, trial included) and confirms: a second project opens in a genuinely
separate instance, `list_open_instances` reports both, and the warnings match
observed behavior. The package is not published until this passes.

## Distribution

- TypeScript, Node >= 18, ESM.
- Published to npm with a `bin` entry, so users run `npx -y ableton-multi-mcp`
  and clone nothing.
- MIT licensed.

Repository contents: `README.md` (install, Claude Desktop and Claude Code config
snippets, caveats, troubleshooting), `LICENSE`, `package.json`, `tsconfig.json`,
CI workflow, `CHANGELOG.md`.

## References

- https://forum.ableton.com/viewtopic.php?t=220400
- https://www.honeysonic.com/blog/Multiple-Instances-of-Ableton-The%20Easy-Way
- https://forum.ableton.com/viewtopic.php?t=217931
- https://forum.ableton.com/viewtopic.php?t=153447
