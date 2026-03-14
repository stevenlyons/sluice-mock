# Tool Deploy — Feature Notes

## Key Decisions

- **Specs dir resolution**: cwd-relative by default (`./specs`), overridable via `--specs` flag or `SLUICE_SPECS` env var. `__dirname`-relative resolution replaced entirely.
- **CLI entry**: new `bin/sluice-mock.js` shebang script; `app.js` stays the main module.
- **Port arg**: positional arg kept, but must be parsed carefully to skip `--specs <value>`.
- **Media files**: `media/0.ts` and `media/0.m4s` are bundled in the npm package via `files` in `package.json`.
- **Bun**: expected to work via `bunx` with no code changes; koa runs on Bun.

## Open Questions (pending user answers)

1. Is `sluice-mock` available on npm, or do we need a scoped package name?
2. Should `--version` flag be supported?
3. Is explicit Bun testing required?

## Files Changed (planned)

- `package.json` — add `bin`, `files`, `engines`
- `bin/sluice-mock.js` — new CLI shebang entry point
- `app.js` — `resolveSpecsDir()`, update `loadSpecification()`, fix port parsing
- `app.test.js` — tests for `resolveSpecsDir()` and specs dir resolution
