# Sluice Video Mock

Specify the behavior of an HLS or DASH video stream with configured playback responses.
This is useful for testing video player playback behavior and video player SDK functionality.

The following behavior can be specified:
* Playback time
* Renditions
* Startup Time delay
* Stalls (Rebuffering)
* Errors

## Development

1. `git clone`
1. `npm install`
1. `node app.js` (or `npm run dev` for watch mode)
1. Browse to http://localhost:3030/index.html

## Testing

```
npm test
```

Tests cover the pure logic functions in `lib/logic.js` using the Node.js built-in test runner.

## Usage

You specify video playback behavior by providing a playback specification in the path to the
video manifest file. A playback manifest will be created and each action will be taken
for the specified segment.

### Spec in url path

A specification in the url path looks something like this: `s5-p30-e404`

Each cue is separated by a `-`. Cues are order-sensitive — position in the string determines when in the timeline each cue fires. The protocol is determined by the manifest extension: `.m3u8` for HLS, `.mpd` for DASH.

HLS: `http://localhost:3030/s5-p30-e404/media.m3u8`
DASH: `http://localhost:3030/s5-p30-e404/media.mpd`

The following cues are available:
* Startup Time delay: `s` + delay time (optional, defaults to 5 seconds)
* Playback: `p` + playback time (optional, defaults to 30 seconds) — rounds up to the nearest segment boundary (~6 seconds)
* Stall (Rebuffer): `r` + delay time (optional, defaults to 30 seconds)
  - Note: "stall of X seconds" delays delivery of the segment for X seconds, not wall-clock stall time
* Error: `e` + error code (optional, defaults to code 500)

Some examples of playback specifications:

Long startup (5 second startup delay and then regular playback):
- HLS: `http://localhost:3030/s5-p30/media.m3u8`
- DASH: `http://localhost:3030/s5-p30/media.mpd`

Stalling during the video (10 seconds of playback, 9 seconds of delay, 10 more seconds of playback):
- HLS: `http://localhost:3030/p10-r9-p10/media.m3u8`
- DASH: `http://localhost:3030/p10-r9-p10/media.mpd`

500 Server Error to end the stream:
- HLS: `http://localhost:3030/p30-e/media.m3u8`
- DASH: `http://localhost:3030/p30-e/media.mpd`

### Named Spec Files

Instead of an inline spec string, you can reference a named JSON file stored in the `specs/` directory. This is useful for sharing, versioning, and reusing complex scenarios.

Create `specs/my-scenario.json`:

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

Then reference it by name in the URL:

- HLS: `http://localhost:3030/my-scenario/media.m3u8`
- DASH: `http://localhost:3030/my-scenario/media.mpd`

If no matching file is found in `specs/`, the path is treated as an inline spec string.

By default the server looks for spec files in the `specs/` directory of the current working directory. You can point it at a different directory using the `--specs` flag or the `SLUICE_SPECS` environment variable:

```bash
node app.js --specs /path/to/my-specs
SLUICE_SPECS=/path/to/my-specs node app.js
```

Several example spec files are included in `specs/` to get started: `example.json`, `stall-and-recover.json`, `multiple-stalls.json`, `segment-error.json`, `network-congestion.json`, `abr-example.json`, `abr-rendition-fallback.json`, and `abr-rendition-segment-error.json`.

### Multiple Renditions (ABR)

Named spec files support multiple renditions for testing ABR player behavior. Renditions are named and referenced by name in playlist URLs.

```json
{
  "description": "Force player to low rendition, then make it unavailable",
  "renditions": [
    { "name": "low",  "bandwidth": 400000,  "resolution": "640x360" },
    { "name": "mid",  "bandwidth": 2493700, "resolution": "1280x720" },
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

The master playlist at `/my-scenario/media.m3u8` lists `rendition-low.m3u8`, `rendition-mid.m3u8`, and `rendition-high.m3u8`.

**Cues:**
- `bandwidth` — throttles all segment delivery to the specified kbps; the player's ABR algorithm picks the rendition based on measured throughput
- `error` with `rendition` — returns an HTTP error when that rendition's playlist is requested, making that quality level unavailable
- All other cues (`startup`, `playback`, `rebuffer`, `error` without `rendition`) apply globally to segment delivery
- `playback` time rounds up to the nearest segment boundary (~6 seconds)

### Playing

Use the URL, including the desired specification, with your favorite video player.

## Credits

Video sample credit to: 
Ruvim Miksanskiy
https://www.pexels.com/video/video-of-forest-1448735/