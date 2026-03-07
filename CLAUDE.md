# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
yarn install       # Install dependencies
node app.js        # Start the server (port 3000)
yarn start         # Same as above
```

No test framework is currently set up.

## Architecture

The entire server is a single file: `app.js`. It uses **Koa** as the HTTP framework and **koa-throttle2** for simulating delays.

### Request Flow

1. A request arrives with a path like `/s5-p30-e404/media.m3u8`
2. The path (directory portion) is the **spec string** — parsed once and cached in `specCache`
3. The filename determines the request type:
   - `media.m3u8` → serve static master playlist from `media/`
   - `rendition.m3u8` → dynamically generate an HLS rendition playlist based on total calculated duration
   - `*.ts` → segment request; look up the segment number in the **timeline** and apply the action (delay or error)

### Spec Parsing

`parseSpecification(path)` converts a spec string into an array of operation objects:
- `s<N>` → `{ op: 'startup', delay: N }`
- `p<N>` → `{ op: 'playback', time: N }`
- `r<N>` → `{ op: 'rebuffer', delay: N }`
- `e<code>` → `{ op: 'error', code: N }`

### Segment Timeline

`createSegmentTimeline(operations)` maps operations to specific segment numbers. Only segments with special behavior (delay or error) appear in the timeline array — everything else is nominal playback. The timeline is cached in `timelineCache`.

### Delay Mechanism

Delays are implemented by **throttling the byte delivery rate** via `koa-throttle2` (not via `sleep`). The chunk size is calculated so the single physical file (`media/0.ts`) takes the desired number of seconds to transfer.

### Key Constants

- `segmentLength = 5` (seconds) — hardcoded; all segment math derives from this
- All segment requests physically serve `media/0.ts` regardless of the requested segment filename
