# Video DVR

Specify the behavior of the HLS-based video so it has configured playback behavior. 
It is useful for testing player playback behavior and measurement SDKs.

## Development

This is a Next.js app with MDX (MDX is markdown + react).

1. `git clone`
1. `yarn install`
1. `node app.js`
1. Browse to http://localhost:3000/index.html

## Usage

You specify how a video plays by providing a playback specification in the path to the 
video manifest file. A playback manifest will be created and each action will be taken 
for the specified segment.

A specification looks something like this:
's5-p30-e404'
Each action is separated by a '-', the entire url looks like this:
http://localhost:3000/s5-p30-e404/media.m3u8

The following options are available:
* Startup Time delay: 's' + delay time (optional, defaults to 5 seconds)
* Playback: 'p' + playback time (optional, defaults to 30 seconds)
* Rebuffer: 'r' + delay time (optional, defaults to 30 seconds)
  - Note: "rebuffer of X seconds" does not translate to exactly X seconds of rebuffering, it delays delivery of the segment for X seconds
* Error: 'e' + error code (optional, defaults to code 500)

Some examples of playback specifications:
Long startup (5 second startup delay and then regular playback):
http://localhost/s5-p30/media.m3u8

Stalling during the video (10 seconds of playback, 9 seconds of delay, 10 more seconds of playback):
http://localhost/p10-r9-p10/media.m3u8

500 Server Error to end the stream:
http://localhost/p30-e/media.m3u8

### Playing

Use the url, including the desired specification, with your favorite video player.
