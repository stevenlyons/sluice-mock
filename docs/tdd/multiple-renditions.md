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
- Renditions without `operations` **inherit top-level operations**
- Both **HLS and DASH** supported

---

## JSON Spec File Format

```json
{
  "description": "ABR test: 3 renditions, error on lowest",
  "renditions": [
    { "bandwidth": 400000,  "resolution": "640x360",   "operations": [{ "op": "error", "code": 404 }] },
    { "bandwidth": 2493700, "resolution": "1280x720" },
    { "bandwidth": 5000000, "resolution": "1920x1080" }
  ],
  "operations": [
    { "op": "startup", "delay": 5 },
    { "op": "playback", "time": 30 }
  ]
}
```

- `renditions` array is optional — omitting it preserves single-rendition behavior
- Rendition without `operations` inherits top-level `operations`
- `bandwidth` and `resolution` are required per rendition; `codecs` is optional (defaults to `"mp4a.40.2,avc1.640020"`)

---

## Behavior Model

**Per-rendition operations** control the **rendition playlist response** — errors apply when the player requests that rendition's playlist (e.g., `rendition-0.m3u8`).

**Segment delivery** uses the **top-level operations** shared across all renditions. All renditions serve segments from the same URL namespace using one shared timeline.

---

## URL Structure

### HLS Master Playlist

`/spec/media.m3u8` — dynamically generated, listing all configured renditions:

```
#EXTM3U
#EXT-X-VERSION:5
#EXT-X-INDEPENDENT-SEGMENTS

#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=640x360,CODECS="mp4a.40.2,avc1.640020"
rendition-0.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2493700,RESOLUTION=1280x720,CODECS="mp4a.40.2,avc1.640020"
rendition-1.m3u8
```

### HLS Rendition Playlists

`/spec/rendition-0.m3u8`, `/spec/rendition-1.m3u8`, etc. — each generated from that rendition's resolved operations.

`rendition.m3u8` remains valid as an alias for `rendition-0.m3u8` (backward compatibility for single-rendition inline specs).

### DASH Manifest

`/spec/media.mpd` — dynamically generated with one `Representation` per rendition in a single `AdaptationSet`.

---

## Implementation

### `lib/logic.js`

- `checkRequestType()` — extended to recognize `rendition-N.m3u8` pattern
- `extractRenditionIndex(filename)` — `'rendition-2.m3u8'` → `2`, `'rendition.m3u8'` → `0`
- `resolveRenditions(spec)` — normalizes renditions array with inherited operations

### `app.js`

- `loadSpecification()` — returns `{ operations, renditions }` instead of bare operations array
- `specCache` — stores the full spec object
- `generateMediaPlaylist()` — dynamically generates master playlist from `spec.renditions`
- `rendition` case — uses `extractRenditionIndex(filename)` to look up per-rendition operations; errors on that rendition return HTTP error
- `generateDashMPD()` — generates `<Representation>` for each rendition
- `timelineCache` — uses top-level operations (shared across renditions)

---

## Relevant Files

- `lib/logic.js` — `extractRenditionIndex`, `resolveRenditions`, updated `checkRequestType`
- `app.js` — Dynamic master playlist, per-rendition routing, updated spec/cache shape
- `specs/abr-example.json` — Example multi-rendition spec
- `lib/logic.test.js` — Tests for new logic functions
- `app.test.js` — Tests for multi-rendition spec loading
