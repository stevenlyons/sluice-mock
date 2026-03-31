# Contributing to Sluice Mock

## Setup

```bash
git clone https://github.com/stevenlyons/sluice-mock
cd sluice-mock
pnpm install
```

## Development

```bash
pnpm start         # Start the server (default port 3030)
pnpm dev           # Start with file watching
pnpm test          # Run tests
pnpm lint          # Lint
pnpm format        # Format
```

Browse to `http://localhost:3030/index.html` to use the built-in player and example scenarios.

## Architecture

The server is implemented in `app.js` using [Koa](https://koajs.com/) with `koa-throttle2` for bandwidth and delay simulation. Pure logic functions live in `lib/logic.js` and manifest generation in `lib/manifest.js`.

### Request flow

1. A request arrives with a path like `/s5-p30-e404/media.m3u8` or `/my-scenario/media.m3u8`
2. The directory portion is the **spec identifier** — resolved once and cached
3. The filename determines the request type:
   * `media.m3u8` — generate an HLS master playlist listing all renditions
   * `rendition-<name>.m3u8` — generate an HLS rendition playlist
   * `media.mpd` — generate a DASH MPD manifest
   * `*.m4s` / `*.ts` — segment request; look up the segment in the timeline and apply the action

### Spec loading

Two modes:

**Inline** — parsed from the URL path by `parseSpecification()`:
* `s<N>` → startup delay
* `p<N>` → playback time
* `r<N>` → rebuffer delay
* `e<code>` → HTTP error

**Named** — JSON files in the `specs/` directory. The `specs/` directory defaults to the current working directory but can be overridden via `--specs` or `SLUICE_SPECS`.

### Segment timeline

`createSegmentTimeline()` maps spec cues to segment numbers. Only segments with special behavior appear in the timeline — everything else is nominal. The timeline is cached per spec.

### Throttle mechanism

Two modes via `koa-throttle2`:
* **Delay** — chunk size calculated so the file takes the desired number of seconds to transfer
* **Bandwidth** — chunk size calculated as `kbps * 1000 / 8 / 10` bytes per 100ms interval

### Key constants

* `segmentLength = 2.002` seconds — all segment math derives from this

## Tests

Tests use the Node.js built-in test runner and are colocated with the files they cover:

* `lib/logic.test.js` — pure logic functions
* `lib/manifest.test.js` — playlist and manifest generation
* `app.test.js` — server integration tests
