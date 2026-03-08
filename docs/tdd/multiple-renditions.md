# TDD: Multiple Renditions

## Context

The current server simulates one rendition. Real ABR players choose from multiple renditions based on estimated bandwidth, and switch renditions during playback. Testing ABR selection, rendition switching events, and per-rendition error handling requires the server to advertise multiple renditions in the master playlist and serve each with independent behavior.

---

## PRD Goals (from `docs/prd/multiple-renditions.md`)

- Specify number of renditions and their serving behavior
- Test ABR selection, switching behavior, and per-rendition errors
- Simple, developer-friendly configuration

---

## Design Decisions

- Multi-rendition via **JSON spec files only** — inline strings stay single-rendition
- Renditions are **named** — URLs use the name (`rendition-low.m3u8`), not an index
- Bandwidth is a **global network property** — set via a top-level `bandwidth` op; the player's ABR algorithm chooses the rendition naturally based on measured throughput
- **Rendition errors** are the only rendition-targeted operations — they make a specific quality level unavailable by returning an HTTP error when its playlist is requested
- Both **HLS and DASH** supported

---

## JSON Spec File Format

```json
{
  "description": "Force player to low rendition, then make it unavailable",
  "renditions": [
    { "name": "low",  "bandwidth": 400000,  "resolution": "640x360" },
    { "name": "mid",  "bandwidth": 2493700, "resolution": "1280x720" },
    { "name": "high", "bandwidth": 5000000, "resolution": "1920x1080" }
  ],
  "operations": [
    { "op": "bandwidth", "kbps": 300 },
    { "op": "startup",   "delay": 5 },
    { "op": "playback",  "time": 30 },
    { "op": "error",     "code": 404, "rendition": "low" }
  ]
}
```

- `renditions` array is optional — omitting it preserves single-rendition behavior
- `name` is optional per rendition — unnamed renditions fall back to index-based URLs (`rendition-0.m3u8`)
- `bandwidth` and `resolution` are required per rendition; `codecs` defaults to `"mp4a.40.2,avc1.640020"`
- `bandwidth` op — global, sets sustained throughput throttle from that point forward
- `error` with `rendition` field — HTTP error when that rendition's playlist is requested (entire session)
- `error` without `rendition` field — segment error at that timeline position (existing behavior)

---

## Behavior Model

**Global operations** drive segment delivery — startup, playback, rebuffer, error (without rendition), and bandwidth ops all apply to the shared segment timeline.

**Rendition errors** make a specific quality level unavailable. When the player requests `rendition-low.m3u8`, the server returns the specified HTTP error code. The player's ABR logic falls back to another rendition.

**Bandwidth throttle** is global — all segment delivery is throttled to the specified kbps. The player measures throughput and its ABR algorithm selects the appropriate rendition. Delay ops take precedence over bandwidth throttle when both apply.

All renditions share the same segment URL namespace (`0.ts`, `1.ts`, etc.) — there are no per-rendition segment paths.

---

## URL Structure

### HLS Master Playlist

`/spec/media.m3u8` — dynamically generated, listing all configured renditions:

```
#EXTM3U
#EXT-X-VERSION:5
#EXT-X-INDEPENDENT-SEGMENTS

#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=640x360,CODECS="mp4a.40.2,avc1.640020"
rendition-low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2493700,RESOLUTION=1280x720,CODECS="mp4a.40.2,avc1.640020"
rendition-mid.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="mp4a.40.2,avc1.640020"
rendition-high.m3u8
```

### HLS Rendition Playlists

`/spec/rendition-low.m3u8`, `/spec/rendition-mid.m3u8`, etc. — each returns a VOD playlist with shared segment numbers. Returns an HTTP error if that rendition has a matching `renditionErrors` entry.

`rendition.m3u8` remains valid for single-rendition inline specs (backward compatibility).

### DASH Manifest

`/spec/media.mpd` — dynamically generated with one `Representation` per rendition in a single `AdaptationSet`. Representation IDs use the rendition name when available.

---

## Spec Object Shape

`loadSpecification()` returns:

```js
{
  operations,      // global ops only (rendition-targeted ops excluded) — used for timeline and media length
  renditions,      // array of { name?, bandwidth, resolution, codecs? }
  renditionErrors  // { 'low': 404, ... } — built from error ops with rendition field
}
```

---

## Segment Timeline Extensions

`createSegmentTimeline()` handles two new cases:

- Ops with a `rendition` field are **skipped** — they are handled via `renditionErrors`, not the timeline
- `bandwidth` op pushes `{ segment: currentSegment, bandwidthKbps: kbps }` — does not advance `currentSegment`

`processSegment()` finds the active bandwidth by scanning the timeline in reverse for the last `bandwidthKbps` entry at or before the current segment number, then passes it to `outputFile()`.

---

## Implementation

### `lib/logic.js`

- `checkRequestType()` — updated regex to `rendition-\w+` (word chars, not just digits)
- `extractRenditionName(filename)` — `'rendition-low.m3u8'` → `'low'`, `'rendition.m3u8'` → `null`
- `resolveRenditions(spec)` — normalizes renditions array; no per-rendition operations merging
- `resolveRenditionErrors(operations)` — scans ops for `error` entries with `rendition` field; returns `{ name: code }` map
- `createSegmentTimeline()` — skips rendition-targeted ops; handles `bandwidth` op

### `app.js`

- `loadSpecification()` — returns `{ operations, renditions, renditionErrors }`; global ops filter excludes rendition-targeted errors
- `generateMediaPlaylist()` — uses `rendition-${r.name}.m3u8` for named renditions, `rendition-${i}.m3u8` fallback
- Rendition case — `extractRenditionName(filename)` lookup in `spec.renditionErrors`; returns HTTP error if found
- `processSegment()` — reverse-scans timeline for active `bandwidthKbps`; passes to `outputFile()`
- `outputFile()` — added `bandwidthKbps` param; throttles at `kbps * 1000 / 8 / 10` bytes per 100ms when no delay active
- `generateDashMPD()` — uses `r.name` for representation ID when available

---

## Relevant Files

- `lib/logic.js` — `extractRenditionName`, `resolveRenditions`, `resolveRenditionErrors`, updated `checkRequestType` and `createSegmentTimeline`
- `app.js` — Named rendition routing, rendition error lookup, bandwidth throttle in segment processing
- `specs/abr-example.json` — Example multi-rendition spec with named renditions and bandwidth op
- `lib/logic.test.js` — Tests for all new logic functions
- `app.test.js` — Tests for multi-rendition spec loading and rendition error resolution
