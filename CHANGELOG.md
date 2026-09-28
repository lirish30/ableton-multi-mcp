# Changelog

## 0.1.0

Initial release.

- `find_projects` — search Ableton Live Sets (`.als` files) by name, excluding auto-backup files.
- `open_project` — open a project by name or path in a new instance of Ableton Live, leaving any already-open project untouched.
- `list_open_instances` — list running Ableton Live instances and, where known, which project each one has open.

macOS only: the multi-instance mechanism relies on the macOS `open -n` command and has no equivalent on other platforms.

Human smoke test against a real Ableton Live install (Step 7 of the release
checklist) has passed: tested against **Ableton Live 11 Suite.app**. With one
project already open, `open_project` launched a second, genuinely separate
instance that loaded its own project's files correctly (not an empty set),
and `list_open_instances` correctly reported both instances running.
