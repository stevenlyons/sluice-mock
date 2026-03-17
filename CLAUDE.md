# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**sluice-mock** helps simulate internet video playback for use in player integration testing. It allows the developer to specify how the video delivery and playback should behave to factilite testing and validation of the player. 

## Commands

```bash
npm install        # Install dependencies
node app.js                  # Start the server (default port 3030)
node app.js --port 8080      # Start the server on port 8080
node app.js -p 8080          # Same as --port
SLUICE_PORT=8080 node app.js # Set port via environment variable
npm start          # Same as node app.js
```

Tests use the Node.js built-in test runner (`node --test`). Run with:

```bash
npm test
```

Test file is colocated with the module it tests: `lib/logic.test.js` covers all pure logic functions in `lib/logic.js`.

## Architecture

The entire server is a single file: `app.js`. It uses **Koa** as the HTTP framework and **koa-throttle2** for simulating delays.

### Request Flow

1. A request arrives with a path like `/s5-p30-e404/media.m3u8` or `/my-scenario/media.m3u8`
2. The path (directory portion) is the **spec identifier** — resolved once and cached in `specCache`
3. `loadSpecification(filepath)` resolves the spec:
   - Checks for `specs/<name>.json` — if found, reads and returns its `timeline` array
   - Otherwise falls back to `parseSpecification(filepath)` for inline spec strings
4. The filename determines the request type:
   - `media.m3u8` → dynamically generate an HLS master playlist listing all renditions
   - `rendition-<name>.m3u8` or `rendition.m3u8` → dynamically generate an HLS rendition playlist
   - `media.mpd` → dynamically generate a DASH MPD manifest based on total calculated duration
   - `*.ts` / `*.m4s` → segment request; look up the segment number in the **timeline** and apply the action (delay, bandwidth throttle, or error)

### Spec Loading

Two modes for specifying playback behavior:

**Inline spec strings** — encoded directly in the URL path, parsed by `parseSpecification(path)`:
- `s<N>` → `{ cue: 'startup', delay: N }`
- `p<N>` → `{ cue: 'playback', time: N }`
- `r<N>` → `{ cue: 'rebuffer', delay: N }`
- `e<code>` → `{ cue: 'error', code: N }`

**Named spec files** — JSON files in `specs/` directory, referenced by name in the URL:
```json
{
  "description": "...",
  "renditions": [
    { "name": "low",  "bandwidth": 400000,  "resolution": "640x360" },
    { "name": "high", "bandwidth": 5000000, "resolution": "1920x1080" }
  ],
  "timeline": [
    { "cue": "bandwidth", "kbps": 300 },
    { "cue": "startup",   "delay": 5 },
    { "cue": "playback",  "time": 30 },
    { "cue": "error",     "code": 404, "rendition": "low" }
  ]
}
```

- `renditions` is optional — omit for single-rendition behavior
- `name` is optional per rendition — unnamed renditions use index-based URLs (`rendition-0.m3u8`)
- `bandwidth` and `resolution` are required per rendition; `codecs` defaults to `"mp4a.40.2,avc1.640020"`
- `error` with `rendition` field → HTTP error when that rendition's playlist is requested (makes that quality level unavailable)
- `error` without `rendition` → segment error at that timeline position (existing behavior)
- `bandwidth` cue → sets global sustained throughput throttle from that point forward; the player's ABR algorithm decides which rendition to use

### Spec Object Shape

`loadSpecification()` returns:
```js
{
  timeline,        // global cues (no rendition field) — used for segment timeline and media length
  renditions,      // array of { name?, bandwidth, resolution, codecs? }
  renditionErrors  // { 'low': 404 } — from error cues with rendition field
}
```

### Segment Timeline

`createSegmentTimeline(timeline)` maps cues to specific segment numbers. Only segments with special behavior (delay, bandwidth throttle, or error) appear in the timeline array — everything else is nominal playback. The timeline is cached in `timelineCache`.

Supported timeline entry types:
- `{ segment: N, delay: X }` — startup or rebuffer delay
- `{ segment: N, error: code }` — HTTP error on that segment
- `{ segment: N, bandwidthKbps: X }` — sustained bandwidth throttle from that segment forward

### Throttle Mechanism

Two throttle modes via `koa-throttle2` (not `sleep`):
- **Delay** — chunk size calculated so the file takes the desired number of seconds to transfer
- **Bandwidth** — chunk size calculated as `kbps * 1000 / 8 / 10` bytes per 100ms interval

### Key Constants

- `segmentLength = 6.006` (seconds) — hardcoded; all segment math derives from this
- HLS segment requests (`*.ts`) physically serve `media/0.ts`; DASH segment requests (`*.m4s`) physically serve `media/0.m4s`
