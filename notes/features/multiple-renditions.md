# Notes: Multiple Renditions — Rendition-Named Segments

## What Changed in the PRD

New spec added: segment filenames in rendition playlists must include the rendition
name, so the server can always identify which rendition a segment request belongs to.

## Decision

- Named renditions → `seg-{name}-{n}.m4s` (always, not just when segment error exists)
- Unnamed / single-rendition → `seg-{n}.m4s` (no change)
- DASH manifest unchanged — uses SegmentTemplate with `seg-$Number$.m4s`

## Root Cause of the Bug

`generateRendition` only used rendition-named filenames when `hasSegmentError` was true.
Result: `low` rendition (no error) used plain `seg-{n}.m4s`, while `mid`/`high` (with
`"on": "segment"` errors) used `rendition-mid-seg-{n}.m4s`.

## Files to Change

### `app.js`
- `generateRendition(ctx, mediaLength, renditionName, hasSegmentError)`:
  - Remove `hasSegmentError` parameter
  - Always use `seg-${renditionName}-${i+1}.m4s` when `renditionName` is set
- Rendition case in router: remove `hasSegmentError` from `generateRendition` call

### `lib/logic.js`
- `calculateElapsedPlayheadTime(filename)`:
  - Currently only matches `seg-{n}.m4s`
  - Must also match `rendition-{name}-seg-{n}.m4s` to extract segment number

### `processSegment` in `app.js`
- `segMatch` regex only handles `seg-{n}` basename
  - Must also parse `rendition-{name}-seg-{n}.m4s` to get segment number

## Tests to Add / Update
- `calculateElapsedPlayheadTime` — add cases for `rendition-low-seg-3.m4s`
- `extractRenditionFromSegment` — already handles the format, no change needed
- App-level: rendition playlist for named rendition uses rendition-named segment filenames
- App-level: rendition playlist for unnamed rendition uses plain segment filenames
