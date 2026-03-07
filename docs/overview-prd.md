video-dvr is a tool that helps simulate internet video playback for use in player integrations. It allows the developer to specify how the video delivery and playback should proceed in order to test and validate behavior of the player. 

The tool can simulate the following behaviors:
* Startup time
* Errors
* Stalls
* Length of playback

A playback specification can be specified by the developer in the url and and the video segments will be returned with the desired behavior. The video player will not know about the video behavior and does not require changes to make the behavior work during the session. The tool is intended to allow for player testing with actual playback and failure scenarios.


## Goals

* Allow for testing of player and application implementation in real-world scenarios
* Constrain behavior of the video playback to specific, specified scenarios that allow for testing of specific real-world behavior.
* Reduce the amount of manual testing needed to validate player and application behavior 


## Personas 

* Developers that build applications that contain video, including implementation of applications, players, SDKs, or tooling


## Specification

You specify video playback by providing a playback specification in the path to the 
video manifest file. A playback manifest will be created and each action will be taken 
for the specified segment.

A specification looks like: 's5-p30-e404'

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


## High-level Architecture

The application is built in JavaScript on node. Try to keep the number of dependecies to a minimum, where possible. The developer will run the tool on a machine (usually their local development machine).

Question: Should this tool continue to implement the serving logic itself or sit in front of a web server and implement the application logic on top of it. 

