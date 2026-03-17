# TDD: File-based Specifications

## Context

Currently, playback scenarios are encoded directly in the URL path (e.g. `/s5-p30-e404/media.m3u8`). This is convenient for ad-hoc use but makes it hard to share, version-control, and reuse complex scenarios across projects or platforms. This TDD describes how to support named spec files that can be referenced by name in the URL.

---

## File Format

JSON files stored in a `specs/` directory at the project root. Named by scenario (e.g. `specs/startup-test.json`).

```json
{
  "description": "5s startup delay, 30s playback, then 404 error",
  "timeline": [
    { "cue": "startup", "delay": 5 },
    { "cue": "playback", "time": 30 },
    { "cue": "error", "code": 404 }
  ]
}
```

The `timeline` array maps directly to the existing cue objects consumed by `createSegmentTimeline()` and `calculateMediaLength()` in `lib/logic.js` — no changes needed to those functions.

The `description` field is optional.

---

## URL Format

No change to the URL structure. The spec name replaces the inline spec string:

- **Named spec:** `http://localhost:3030/startup-test/media.m3u8`
- **Inline spec:** `http://localhost:3030/s5-p30-e404/media.m3u8`

---

## Detection

In `app.js`, replace the direct `parseSpecification()` call with a new async `loadSpecification(filepath)` function:

1. Strip the leading `/` from `filepath` to get the spec name
2. Check if `specs/<name>.json` exists
3. If yes → read the file, return `parsed.timeline`
4. If no → fall back to `parseSpecification(filepath)` (existing inline parsing)

The existing `specCache` already handles per-filepath caching, so the file is only read once per server instance.

---

## Code Changes

### `app.js`

Replaced the `parseSpecification` cache block with an awaited call to `loadSpecification()`.

Added `loadSpecification()`:
```js
async function loadSpecification(filepath) {
  const name = filepath.startsWith('/') ? filepath.substring(1) : filepath;
  const specFile = path.join(__dirname, 'specs', `${name}.json`);
  try {
    const contents = await fs.promises.readFile(specFile, 'utf8');
    return JSON.parse(contents).timeline;
  } catch {
    return parseSpecification(filepath);
  }
}
```

No changes to `lib/logic.js` — `createSegmentTimeline()`, `calculateMediaLength()`, and `parseSpecification()` are all reused as-is.

---

## Files Created / Modified

- `specs/example.json` — example named spec file (checked in for reference)
- `app.js` — replaced spec-loading block + added `loadSpecification()`
- `docs/tdd/file-specifications.md` — this document
- `FEATURES.md` — tracks TDD implementation status

---

## Verification

1. Create `specs/test-scenario.json` with known cues
2. Start server: `node app.js`
3. `curl http://localhost:3030/test-scenario/rendition.m3u8` — should return correct segment count
4. `curl http://localhost:3030/s5-p30/rendition.m3u8` — inline spec still works
5. `npm test` — all existing tests pass (no logic changes)
