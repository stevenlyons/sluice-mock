# TDD: Per-Rendition Segment Sizing

## Context

All renditions previously served the same physical segment files (~4.5MB each) regardless of declared bandwidth. A player estimates available bandwidth as `bytes_received / download_time` — if all renditions are the same size, the player cannot distinguish them and ABR decisions become unreliable.

---

## PRD Goals (from `docs/prd/per-rendition-segment-sizing.md`)

- Segment responses are sized to match each rendition's declared bandwidth
- Video remains watchable at all renditions
- No large video files stored in git
- Works alongside the existing global `bandwidth` throttle op

---

## Design Decisions

- **Pad-only, never truncate** — base segment file must be ≤ smallest rendition's target size; responses are padded up, never shrunk
- **MP4 `free` box** for padding — valid ISO BMFF box that players silently ignore; appended after the existing segment data
- **Target size formula**: `Math.round(bandwidth × segmentLength / 8)` bytes
- **Single-rendition fallback** — inline specs (one rendition) use that rendition's bandwidth for sizing
- **No bandwidth available** — serve file as-is (no padding)
- **Global bandwidth throttle cue** continues to work on top of sizing; they are independent

---

## Base Segment Files

The physical `media/seg-*.m4s` files were replaced with small (~3KB) synthetic fMP4 segments generated via ffmpeg's DASH muxer from a test pattern source, then stripped of their `styp`/`sidx` prefix boxes so each file begins with `moof` at byte 0 (required by the existing mfhd/tfdt patching code).

```bash
# Generate DASH segments from a synthetic color source
ffmpeg -f lavfi -i "color=c=blue:size=640x360:rate=25:duration=30.03" \
  -c:v libx264 -b:v 200k -profile:v baseline -level 3.0 \
  -x264opts "keyint=150:min-keyint=150:no-scenecut" \
  -seg_duration 6 -use_timeline 1 -use_template 1 \
  -init_seg_name init_new.mp4 \
  -media_seg_name 'seg_new_$Number$.m4s' \
  -f dash -y /tmp/output.mpd

# Strip styp + sidx prefix from each segment so moof starts at byte 0
python3 -c "
import struct
for i in range(1, 6):
    with open(f'/tmp/seg_new_{i}.m4s', 'rb') as f:
        data = f.read()
    j = 0
    while j < len(data) - 8:
        size = struct.unpack('>I', data[j:j+4])[0]
        if data[j+4:j+8] == b'moof':
            with open(f'media/seg-{i}.m4s', 'wb') as fw:
                fw.write(data[j:])
            break
        j += size
"
```

Resulting files: `init.mp4` (~828B), `seg-1.m4s` (~3.7KB), `seg-2.m4s` through `seg-5.m4s` (~3.1KB each). All well under the smallest rendition target (~300KB at 400kbps).

### MP4 Box Structure Compatibility

The patching code assumes:
- `moof` starts at byte 0
- `mfhd` is the first child of `moof` at offset 8; sequence_number field at offset 20
- `tfdt` is found via `findBox(buf, 'tfdt')`; version=1, 64-bit decode time at `tfdtOffset + 12`

The generated segments satisfy all of these.

---

## `padSegmentBuffer(buf, targetBytes)`

Pure function in `lib/logic.js`. Returns `buf` unchanged if `targetBytes ≤ buf.length`. Otherwise appends a valid MP4 `free` box:

```js
function padSegmentBuffer(buf, targetBytes) {
  if (targetBytes <= buf.length) return buf;
  const paddingSize = targetBytes - buf.length;
  const freeBox = Buffer.allocUnsafe(paddingSize);
  freeBox.writeUInt32BE(paddingSize, 0);  // total free box size
  freeBox.write('free', 4, 'ascii');      // box type
  freeBox.fill(0, 8);                     // zero the rest
  return Buffer.concat([buf, freeBox]);
}
```

The `free` box format is: 4-byte big-endian size (including the 8-byte header), 4-byte ASCII type `free`, then arbitrary zero bytes.

---

## `app.js` Changes

### Rendition bandwidth lookup (segment case)

After `extractRenditionFromSegment(filename)` returns `segRendition`:

```js
const renditionBandwidth = segRendition
  ? spec.renditions.find(r => r.name === segRendition)?.bandwidth
  : undefined;
```

Padding only applies when the segment filename contains a rendition name (e.g., `seg-low-1.m4s`). Plain `seg-N.m4s` filenames — used by inline specs and single-rendition specs — are served as-is with no padding. This preserves existing behavior for all non-ABR usage.

### `processSegment(ctx, timeline, time, requestedFilename, renditionBandwidth)`

`renditionBandwidth` added as last param; threaded through to both `outputFile` call sites.

### `outputFile(ctx, filepath, filename, delay, bandwidthKbps, sequenceNumber, renditionBandwidth)`

After mfhd/tfdt patching, padding is applied before setting `ctx.length`:

```js
if (renditionBandwidth) {
  const targetBytes = Math.round(renditionBandwidth * segmentLength / 8);
  buf = padSegmentBuffer(buf, targetBytes);
}
ctx.length = buf.length;
```

`ctx.length` is now always set from `buf.length` (after potential padding), not from `fstat.size`.

### Delay throttle chunk fix

```js
// was: const chunk = (fstat.size / 10) / delay;
const chunk = (ctx.length / 10) / delay;
```

The delay throttle now uses the final (possibly padded) buffer size so the delay duration is accurate.

---

## Content-Length and Throttle Interaction

When `koa-throttle2` is active (bandwidth throttle or startup delay), it replaces `ctx.body` with a new `Readable` stream. Koa's `ctx.body` setter removes the `Content-Length` header and sets `Transfer-Encoding: chunked` when the body is a stream. Therefore:

- **No throttle active** → `ctx.length = buf.length` is preserved → `Content-Length` header is sent
- **Throttle active** → `Content-Length` header is absent; response uses chunked encoding

Integration tests use `abr-sizing-test` (playback-only spec, no throttle) to verify `Content-Length` correctness.

---

## Test Spec: `specs/abr-sizing-test.json`

```json
{
  "description": "ABR sizing test — multiple renditions, playback only, no throttle or errors",
  "renditions": [
    { "name": "low",  "bandwidth": 600000,  "resolution": "640x360" },
    { "name": "high", "bandwidth": 5000000, "resolution": "1920x1080" }
  ],
  "timeline": [
    { "cue": "playback", "time": 30 }
  ]
}
```

The `low` rendition bandwidth (600kbps → 450,450 byte target) is chosen to be above the maximum physical base file size (~388KB), ensuring padding is always applied and can be tested. The `high` rendition (5Mbps → 3,753,750 bytes) tests large padding.

---

## Implementation

### `lib/logic.js`

- `padSegmentBuffer(buf, targetBytes)` — pads with MP4 `free` box; pad-only, never truncates; exported

### `app.js`

- Segment case: looks up `renditionBandwidth` from `spec.renditions` by name (or single-rendition fallback)
- `processSegment()` — accepts and threads `renditionBandwidth` to `outputFile`
- `outputFile()` — pads buffer, sets `ctx.length = buf.length`, fixes delay chunk calc

---

## Relevant Files

- `lib/logic.js` — `padSegmentBuffer` added and exported
- `lib/logic.test.js` — 6 unit tests for `padSegmentBuffer`
- `app.js` — segment case, `processSegment`, `outputFile`
- `app.test.js` — 6 integration tests using `abr-sizing-test`
- `media/seg-1.m4s` through `seg-5.m4s` — replaced with small synthetic fMP4 segments (~3KB each)
- `media/init.mp4` — replaced with matching init segment (~828B)
- `specs/abr-sizing-test.json` — new test spec for sizing verification
- `docs/prd/per-rendition-segment-sizing.md` — PRD
