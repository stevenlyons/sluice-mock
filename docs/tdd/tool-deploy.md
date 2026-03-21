# TDD: Tool Deployment

## Overview

Publish `sluice-mock` to npm so developers can install it as a dev dependency and run it from a script. Spec files are stored alongside the consuming project's source code and resolved from the working directory at runtime.

## Goals

- `sluice-mock` starts the server from any project directory when installed as a devDependency
- Spec JSON files live in the consumer project (e.g., `specs/`) and are committed to their VCS
- No changes to the URL API or existing spec format

---

## npm Package Changes

### `package.json`

```json
{
  "name": "@wirevice/sluice-mock",
  "version": "0.3.0",
  "bin": {
    "sluice-mock": "./bin/sluice-mock.js"
  },
  "files": [
    "app.js",
    "lib/logic.js",
    "lib/manifest.js",
    "media/",
    "bin/"
  ],
  "engines": {
    "node": ">=18"
  }
}
```

The `files` array controls what gets published to npm. `specs/`, `static/`, and test files are intentionally omitted — specs come from the consumer project and the test/dev files are not needed at runtime.

### `bin/sluice-mock.js`

Thin CLI entry point:

```js
#!/usr/bin/env node
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  const { version } = require('../package.json');
  console.log(version);
  process.exit(0);
}
require('../app.js');
```

The shebang line enables direct execution by npm's bin linking. The file must be executable (`chmod +x`). Supports `--version` / `-v` to print the package version.

---

## Specs Directory Resolution

`resolveSpecsDir()` in `app.js` resolves the specs directory in the following order:

### Resolution Order

1. `--specs <dir>` CLI flag
2. `SLUICE_SPECS` environment variable
3. `npm_package_config_specs` (set via `npm config set @wirevice/sluice-mock:specs`)
4. Default: `./specs` relative to `process.cwd()`

If no spec file is found for the requested name, fall back to inline URL parsing (existing behavior, unchanged).

### Implementation

```js
function resolveSpecsDir() {
  const flagIndex = process.argv.indexOf('--specs');
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) {
    return path.resolve(process.argv[flagIndex + 1]);
  }
  if (process.env.SLUICE_SPECS) {
    return path.resolve(process.env.SLUICE_SPECS);
  }
  if (process.env.npm_package_config_specs) {
    return path.resolve(process.env.npm_package_config_specs);
  }
  return path.join(process.cwd(), 'specs');
}
```

---

## CLI Port Argument

Port is resolved via named flag, environment variable, or npm package config:

### Resolution Order

1. `--port <N>` or `-p <N>` CLI flag
2. `SLUICE_PORT` environment variable
3. `npm_package_config_port` (set via `npm config set @wirevice/sluice-mock:port`)
4. Default: `3030`

### Implementation

```js
function resolvePort() {
  const flagIndex = process.argv.findIndex(a => a === '--port' || a === '-p');
  if (flagIndex !== -1) {
    return parseInt(process.argv[flagIndex + 1]);
  }
  if (process.env.SLUICE_PORT) {
    return parseInt(process.env.SLUICE_PORT);
  }
  if (process.env.npm_package_config_port) {
    return parseInt(process.env.npm_package_config_port);
  }
  return 3030;
}
```

---

## Static Files

Non-media files (e.g., the built-in player UI) are served from the `static/` directory. Media segment files (`.ts`, `.mp4`) are served from `media/`. The `static/` directory is not included in the published npm package — it is a development/testing convenience only.

---

## Consumer Project Usage

**Install as devDependency:**
```json
{
  "devDependencies": {
    "@wirevice/sluice-mock": "^0.3.0"
  },
  "scripts": {
    "mock": "sluice-mock"
  }
}
```
```bash
npm run mock
```

**Spec files in the consumer project:**
```
my-project/
  specs/
    slow-start.json
    abr-switch.json
  package.json
```

---

## Data Types / Interfaces

No changes to the spec JSON format. Existing spec shape documented in `CLAUDE.md` is unchanged.

---

## Testing

Tests use the Node.js built-in test runner via `pnpm test`.

Tests in `app.test.js` cover:

- `resolveSpecsDir()` returns `process.cwd()/specs` by default
- `resolveSpecsDir()` respects `--specs` flag
- `resolveSpecsDir()` respects `SLUICE_SPECS` env var
- `resolveSpecsDir()` respects `npm_package_config_specs`
- `resolvePort()` returns `3030` by default
- `resolvePort()` respects `--port` and `-p` flags
- `resolvePort()` respects `SLUICE_PORT` env var
- `resolvePort()` respects `npm_package_config_port`
- `loadSpecification()` reads from the resolved specs dir (not `__dirname/specs`)

---

## Publishing

```bash
pnpm login --scope=@wirevice
pnpm publish --access public
```

After publish, verify with:
```bash
npx @wirevice/sluice-mock --version
npx @wirevice/sluice-mock --port 3031
```

---

## Open Questions

1. ~~**npm package name** — Is `sluice-mock` available on npm, or do we need a scoped name like `@acme/sluice-mock`?~~ Resolved: published as `@wirevice/sluice-mock`.
2. ~~**`--version` flag** — Should the CLI support `--version` to print the current package version?~~ Resolved: implemented in `bin/sluice-mock.js`, supports `--version` and `-v`.
3. ~~**Bun-specific testing** — Do we need to verify Bun compatibility explicitly, or is running under Node sufficient?~~ Resolved: project uses pnpm; Bun compatibility is not a goal.
