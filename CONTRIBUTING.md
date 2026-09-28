# Contributing

Thanks for considering a contribution to `ableton-multi-mcp`. This is a small,
focused tool — the goal is to keep it that way.

## Before you start

This project is macOS-only by design, because the mechanism it wraps
(`open -n`, and the way macOS delivers a document to a running app via an
Apple Event) simply doesn't exist on other platforms. Windows/Linux support
is not a goal — see the design spec under `docs/superpowers/specs/` if you
want the full reasoning.

For anything beyond a small fix, please open an issue first to discuss the
change before writing code. It saves everyone a rewritten PR.

## Development setup

Requirements: macOS, [Node.js](https://nodejs.org/) matching the version in
[`.nvmrc`](.nvmrc) (use [nvm](https://github.com/nvm-sh/nvm) or
[fnm](https://github.com/Schniz/fnm) and run `nvm use` / `fnm use`).

```bash
git clone https://github.com/lirish30/ableton-multi-mcp.git
cd ableton-multi-mcp
npm install
```

Note: the runtime tool itself only needs Node 18+ (see `engines` in
`package.json`) — the newer floor in `.nvmrc` and CI is because the test
runner (`vitest`) requires it, not because the shipped server does.

## Running the checks

```bash
npm test          # vitest — real filesystem and subprocess behavior, no mocking of the OS
npm run typecheck  # tsc --noEmit
npm run build      # compiles to dist/
```

All three run in CI on `macos-latest` for every pull request.

A few tests in `tests/launcher.test.ts` build a real `.app` bundle with
`osacompile` and launch real processes to prove the core multi-instance
mechanism actually works — they are intentionally not mocked. This is the one
part of the codebase where a shallow mock would defeat the entire point of
the test, so please don't introduce one there.

## Code style

- TypeScript, ESM only (`"type": "module"`) — relative imports need the
  `.js` extension, even though the source files are `.ts`.
- Every subprocess call uses `execFile` with an argument array — never a
  shell string. Project and application paths routinely contain spaces,
  apostrophes, and non-ASCII characters; shell interpolation is both a
  correctness bug and a command-injection risk.
- Each `src/` module has one clear responsibility (see the file table in the
  design spec). Keep new code in the module it belongs to rather than adding
  a new concern to an existing one.
- Match the test style already in the codebase: real filesystem operations
  in a temp directory, not mocks, wherever that's practical.

## Submitting a change

1. Fork the repo and create a branch from `main`.
2. Make your change, with tests.
3. Run `npm test && npm run typecheck && npm run build` locally.
4. Open a pull request describing what changed and why.

By contributing, you agree your contribution is licensed under this
project's [MIT license](LICENSE).

## Reporting bugs

Please include:
- Your macOS version.
- Your Ableton Live version and edition (Suite/Standard/Lite/Trial).
- The exact output the MCP tool returned (Claude will show you this if you
  ask it to show the tool result).

## Code of Conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). By
participating, you're expected to uphold it.
