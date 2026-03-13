# Feature PRD: Per-Rendition Segment Sizing

## Overview

For ABR simulation to produce realistic player behavior, each rendition's segments
must be the correct byte size for their declared bandwidth. A player estimates
available bandwidth as bytes_received / download_time — if all renditions serve the
same file size, the player cannot distinguish between them and ABR decisions become
unreliable.

## Goals

- Segment responses are sized to match each rendition's declared bandwidth
- Video remains watchable at all renditions
- No large video files stored in git
- Works with the existing global bandwidth throttle op for network simulation

## Approach

Store a single small (~300KB) base segment file. For each rendition, pad the response
to the correct target size using a valid MP4 `free` box, which players silently ignore.
Target size = bandwidth × segmentDuration / 8 bytes.

Using a 300KB base file ensures all standard Apple HLS ladder renditions
(200kbps–9Mbps) can be served by padding up — no truncation needed, video intact.

## Specifications

- Base segment file must be ≤ 300KB per segment
- Single-rendition (inline) specs use their one declared rendition's bandwidth
- If no rendition bandwidth is available, serve the file as-is (no padding)
- The global `bandwidth` op throttle continues to work on top of sizing
