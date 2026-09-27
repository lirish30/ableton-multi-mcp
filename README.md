# ableton-multi-mcp

Opens multiple Ableton Live projects at once on macOS, driven by your AI agent.

## What this is

Running more than one instance of Ableton Live at the same time is an
**unsupported community workaround**, not a feature Ableton ships or
endorses. This server automates that workaround (macOS lets you launch a
second copy of an already-running app with `open -n`) so an AI agent can open
several Live Sets side by side. It uses a standard macOS mechanism
(`open -n`) that this project's test suite verifies launches genuinely
separate instances, but you are relying on behaviour Ableton doesn't
officially support — see
[Limitations](#limitations) below before you lean on it for anything
important.

## Requirements

- macOS
- Node.js 18+
- Any Ableton Live version 9-12, any edition, including Trial

## Install

### Claude Desktop

Add this to your `claude_desktop_config.json`:

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

### Claude Code

```bash
claude mcp add ableton-multi -- npx -y ableton-multi-mcp
```

## Usage

Once connected, just talk to your agent in plain language:

- "Open my Midnight Drive set in a new window"
- "What Ableton projects do I have?"
- "What's running right now?"

## Limitations

Running multiple Live instances comes with real trade-offs. From the server's
own warnings:

- Only the first Live instance has a fully functional browser. Secondary instances have a read-only browser: no saving presets, no tagging, no collections, no folder management.
- All instances share a single preferences file, so they cannot be given different audio or MIDI settings.
- The first instance holds the Live library, plugin folders and linked browser folders.
- Expect higher CPU and RAM use, and possible audio device contention if your interface is claimed exclusively.
- Running multiple instances is a community workaround and is not supported by Ableton. Save your work often.

## Configuration

Both variables are optional; the server has sensible defaults.

- `ABLETON_APP_PATH` — full path to a specific Ableton Live `.app` bundle to
  use, if it isn't in `/Applications` or `~/Applications`, or if you have
  multiple versions installed and want to pin one.

  ```bash
  export ABLETON_APP_PATH="/Volumes/Audio/Ableton Live 11 Suite.app"
  ```

- `ABLETON_PROJECTS_DIRS` — colon-separated list of directories to search for
  `.als` project files, if your projects don't live in the defaults
  (`~/Music/Ableton` and `~/Documents/Ableton`).

  ```bash
  export ABLETON_PROJECTS_DIRS="/Volumes/Audio/Projects:/Users/me/Ableton"
  ```

## Troubleshooting

**Ableton not found** — The server searches `/Applications` and
`~/Applications` for a bundle named like `Ableton Live *.app`. If Live is
installed somewhere else (an external drive, a renamed bundle, or a
non-standard folder), set `ABLETON_APP_PATH` to the full path of the `.app`
bundle.

**Projects not found** — Project discovery prefers Spotlight (`mdfind`) for
speed, falling back to a plain filesystem search of `ABLETON_PROJECTS_DIRS`
(or the defaults) if Spotlight returns nothing. If Spotlight indexing is
disabled for the volume your projects live on, Spotlight won't see them and
you'll need `ABLETON_PROJECTS_DIRS` pointed at the right folders so the
filesystem fallback can find them.

**Second instance shows an authorisation dialog** — The first time macOS
launches a second copy of Live, or the first time that copy runs at all, Live
or macOS may show a licence, authorisation, or Gatekeeper dialog instead of
opening the project. Bring Live to the foreground, clear the dialog once, and
try again — subsequent launches are typically silent.

## How it works

Opening a second instance relies on `open -n -a <AbletonPath> <project.als>`,
the macOS `open` flag that forces a **n**ew instance of an app instead of
activating the one already running. To confirm the launch actually produced a
new process (rather than, say, Live silently ignoring the request), the
server snapshots the PIDs of running Ableton processes before the `open`
call, then polls the process list afterward and diffs the two sets — any PID
that's new is the instance that was just launched, and its absence means the
launch could not be confirmed.
