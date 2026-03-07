# Video DVR

Specify the behavior of an HLS or DASH video stream with configured playback responses.
This is useful for testing video player playback behavior and video player SDK functionality.

## Development

1. `git clone`
1. `yarn install`
1. `node app.js`
1. Browse to http://localhost:3000/index.html

## Testing

```
yarn test
```

Tests cover the pure logic functions in `lib/logic.js` using the Node.js built-in test runner.

## Usage

You specify how a video plays by providing a playback specification in the path to the 
video manifest file. A playback manifest will be created and each action will be taken 
for the specified segment.

A specification looks something like this: 's5-p30-e404'

Each action is separated by a '-'. The protocol is determined by the manifest extension: `.m3u8` for HLS, `.mpd` for DASH.

HLS: `http://localhost:3000/s5-p30-e404/media.m3u8`
DASH: `http://localhost:3000/s5-p30-e404/media.mpd`

The following options are available:
* Startup Time delay: 's' + delay time (optional, defaults to 5 seconds)
* Playback: 'p' + playback time (optional, defaults to 30 seconds)
* Rebuffer: 'r' + delay time (optional, defaults to 30 seconds)
  - Note: "rebuffer of X seconds" does not translate to exactly X seconds of rebuffering, it delays delivery of the segment for X seconds
* Error: 'e' + error code (optional, defaults to code 500)

Some examples of playback specifications:
Long startup (5 second startup delay and then regular playback):
- HLS: `http://localhost:3000/s5-p30/media.m3u8`
- DASH: `http://localhost:3000/s5-p30/media.mpd`

Stalling during the video (10 seconds of playback, 9 seconds of delay, 10 more seconds of playback):
- HLS: `http://localhost:3000/p10-r9-p10/media.m3u8`
- DASH: `http://localhost:3000/p10-r9-p10/media.mpd`

500 Server Error to end the stream:
- HLS: `http://localhost:3000/p30-e/media.m3u8`
- DASH: `http://localhost:3000/p30-e/media.mpd`

### Playing

Use the url, including the desired specification, with your favorite video player.
