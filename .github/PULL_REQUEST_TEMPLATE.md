## What does this change?

<!-- One or two sentences on what changed and why. -->

## How was this tested?

<!-- `npm test` output, or manual steps against real Ableton Live. -->

## Checklist

- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` succeeds
- [ ] I did not introduce a shell string for any subprocess call (every
      `open`/`pgrep`/`mdfind`/`find`/`osacompile` call uses `execFile` with an
      argument array)
- [ ] I updated the README/CHANGELOG if user-facing behavior changed
