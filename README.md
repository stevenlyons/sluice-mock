# Sluice Streaming Media Mock

Simulate HLS and DASH stream delivery for testing media player and observability SDK behavior. Configure startup delays, stalls, errors, bandwidth throttling, and multi-rendition ABR scenarios via URL or JSON spec files.

## Installation

```bash
npm install @wirevice/sluice-mock
```

Then add a script to your `package.json`:

```json
"scripts": {
  "mock": "sluice-mock"
}
```

## Starting the server

```bash
npm run mock
```

Open the URL `http://localhost:3030/p30/media.m3u8`, or any described below, in a browser or any HLS/DASH player.

## Configuration

| Method | Port | Specs directory |
|---|---|---|
| CLI flag | `--port 3031` or `-p 3031` | `--specs ./my-specs` |
| Environment variable | `SLUICE_PORT=8080` | `SLUICE_SPECS=./my-specs` |

CLI flags and environment variables take precedence in that order. By default the server runs on port `3030` and looks for spec files in the `specs/` directory of the current working directory.

## Specification

A scenario specification describes how stream delivery should behave. Specs can be provided inline in the URL or as named JSON files.

### Inline spec strings

Embed a spec directly in the URL path:

```
http://localhost:3030/s5-p30-e404/media.m3u8
http://localhost:3030/s5-p30-e404/media.mpd
```

Cues are separated by `-` and are order-sensitive — position determines when each fires.

| Cue | Syntax | Description |
|---|---|---|
| Startup delay | `s<N>` | Delay first segment by N seconds (default: 5) |
| Playback | `p<N>` | Play for N seconds, rounds up to segment boundary (default: 30) |
| Stall | `r<N>` | Delay a segment by N seconds to simulate rebuffering (default: 30) |
| Error | `e<code>` | Return HTTP error code (default: 500) |

Examples:

```
# 5s startup delay, then 30s of playback
/s5-p30/media.m3u8

# 10s playback, 9s stall, 10s more playback
/p10-r9-p10/media.m3u8

# 30s playback ending in a 500 error
/p30-e/media.m3u8
```

### Named spec files

For complex or reusable scenarios, you can store scenarios in JSON files that can be referenced by name and version controlled. 

Create a `specs/` directory in your project root and add JSON spec files there. Sluice Mock looks for spec files in the `specs/` folder of whichever directory the server is started from. Reference a spec file by name in the URL.

`specs/my-scenario.json`:

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

```
http://localhost:3030/my-scenario/media.m3u8
http://localhost:3030/my-scenario/media.mpd
```

If no matching file is found in `specs/`, the path is treated as an inline spec string.

### Multiple renditions (ABR)

Named spec files support multiple renditions for testing ABR behavior:

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

The master playlist lists `rendition-low.m3u8`, `rendition-mid.m3u8`, and `rendition-high.m3u8`.

**Rendition cues:**

* `bandwidth` — throttles all segment delivery to the specified kbps; the player's ABR algorithm picks the rendition
* `error` with `rendition` — returns an HTTP error when that rendition's playlist is requested, making that quality level unavailable
* All other cues apply globally to segment delivery

## Credits

Video sample credit to Ruvim Miksanskiy — https://www.pexels.com/video/video-of-forest-1448735/
