# TDD: Tool Deployment

## Overview

Publish `sluice-mock` to npm so developers can run it via `npx` or `bunx` without cloning the repository. Spec files are stored alongside the consuming project's source code and resolved from the working directory at runtime.

## Goals

- `npx sluice-mock` starts the server from any project directory
- `bunx sluice-mock` works identically
- Spec JSON files live in the consumer project (e.g., `specs/`) and are committed to their VCS
- No changes to the URL API or existing spec format

---

## npm Package Changes

### `package.json`

```json
{
  "name": "sluice-mock",
  "version": "0.3.0",
  "bin": {
    "sluice-mock": "./bin/sluice-mock.js"
  },
  "files": [
    "app.js",
    "lib/",
    "media/",
    "bin/"
  ],
  "engines": {
    "node": ">=18"
  }
}
```

The `files` array controls what gets published to npm. `specs/` is intentionally omitted — specs come from the consumer project.

### `bin/sluice-mock.js`

New thin CLI entry point:

```js
#!/usr/bin/env node
require('../app.js');
```

The shebang line enables direct execution by npm's bin linking. The file must be executable (`chmod +x`).

---

## Specs Directory Resolution

Currently `loadSpecification()` in `app.js` resolves spec files relative to `__dirname` (the package install directory). This must change so specs are resolved from the project using the tool.

### Resolution Order

1. `--specs <dir>` CLI flag
2. `SLUICE_SPECS` environment variable
3. Default: `./specs` relative to `process.cwd()`

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
  return path.join(process.cwd(), 'specs');
}

const specsDir = resolveSpecsDir();
```

In `loadSpecification()`, replace:
```js
const specFile = path.join(__dirname, 'specs', `${name}.json`);
```
with:
```js
const specFile = path.join(specsDir, `${name}.json`);
```

---

## CLI Port Argument

The current positional port argument (`node app.js 8080`) still works via `process.argv[2]`. The `--specs` flag uses a named argument to avoid collision.

Port parsing must skip the `--specs` flag and its value:

```js
const port = parseInt(
  process.argv.find((a, i) =>
    !isNaN(parseInt(a)) &&
    process.argv[i - 1] !== '--specs'
  )
) || 3030;
```

---

## Consumer Project Usage

After publishing to npm, a developer integrates the tool as follows:

**Option A — npx (no install)**
```bash
npx sluice-mock
npx sluice-mock 8080
npx sluice-mock --specs ./test/fixtures/specs
```

**Option B — devDependency**
```json
{
  "devDependencies": {
    "sluice-mock": "^0.3.0"
  },
  "scripts": {
    "mock": "sluice-mock"
  }
}
```
```bash
npm run mock
```

**Option C — Bun**
```bash
bunx sluice-mock
bun run sluice-mock  # if installed as devDependency
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

Existing test suite (`npm test`) continues to cover `lib/logic.js` and `app.js` behavior.

New tests to add in `app.test.js`:

- `resolveSpecsDir()` returns `process.cwd()/specs` by default
- `resolveSpecsDir()` respects `--specs` flag
- `resolveSpecsDir()` respects `SLUICE_SPECS` env var
- `loadSpecification()` reads from the resolved specs dir (not `__dirname/specs`)

---

## Publishing

```bash
npm version patch   # bump to 0.3.0
npm publish         # requires npm login with publish rights
```

After publish, verify with:
```bash
npx sluice-mock@latest --version   # if --version flag is added
npx sluice-mock@latest 3031        # smoke test
```

---

## Open Questions

1. **npm package name** — Is `sluice-mock` available on npm, or do we need a scoped name like `@acme/sluice-mock`?
2. **`--version` flag** — Should the CLI support `--version` to print the current package version?
3. **Bun-specific testing** — Do we need to verify Bun compatibility explicitly, or is running under Node sufficient?
