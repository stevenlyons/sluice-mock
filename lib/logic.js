const path = require('path');

const segmentLength = 6.006; // seconds

function shouldIgnoreRequest(filename) {
  const ignore = ['favicon.ico', 'apple-touch-icon-precomposed.png', 'apple-touch-icon.png'];
  return ignore.includes(filename);
}

function checkRequestType(filename) {
  if (!filename) return;

  const ext = path.extname(filename);

  if (ext === '.m4s') {
    return 'segment';
  } else if (ext === '.m3u8') {
    if (filename === 'media.m3u8') {
      return 'media';
    } else if (filename === 'rendition.m3u8' || /^rendition-\w+\.m3u8$/.test(filename)) {
      return 'rendition';
    }
  } else if (ext === '.mpd') {
    return 'dash-manifest';
  }
}

function extractRenditionName(filename) {
  if (filename === 'rendition.m3u8') return null;
  const match = filename.match(/^rendition-([a-zA-Z]\w*)\.m3u8$/);
  return match ? match[1] : null;
}

function resolveRenditions(spec) {
  if (!spec.renditions) {
    return [{ bandwidth: 2493700, resolution: '1280x720' }];
  }
  return spec.renditions.map(r => ({ ...r }));
}

function resolveRenditionErrors(timeline) {
  if (!timeline) return { playlist: {}, segment: {} };
  const playlist = {};
  const segment = {};
  let currentSegment = 0;
  for (const cue of timeline) {
    if (cue.cue === 'playback') {
      currentSegment += cueSegmentCount(cue);
    }
    if (cue.cue === 'error' && cue.rendition) {
      const code = cue.code || 500;
      if (cue.on === 'segment' || (cue.on !== 'playlist' && currentSegment > 0)) {
        segment[cue.rendition] = { code, activateAtSegment: currentSegment + 1 };
      } else {
        playlist[cue.rendition] = code;
      }
      currentSegment += cueSegmentCount(cue);
    }
  }
  return { playlist, segment };
}

function extractRenditionFromSegment(filename) {
  const named = filename.match(/^seg-([a-zA-Z]\w*)-(\d+)\.m4s$/);
  if (named) {
    return { rendition: named[1], segment: parseInt(named[2]) };
  }
  const plain = filename.match(/^seg-(\d+)\.m4s$/);
  if (plain) {
    return { rendition: null, segment: parseInt(plain[1]) };
  }
  return { rendition: null, segment: null };
}

// Parses the path to pull out the cues. Changes:
// '/s5-p30-r10/' to [{ cue: 'startup', delay: 5 }, { cue: 'playback', time: 30 }, { cue: 'rebuffer', delay: 10 }]
function parseSpecification(specPath) {
  if (!specPath) return;
  const cueString = specPath.startsWith('/') ? specPath.substring(1) : specPath;
  return cueString.split('-').map(parseCue).filter(Boolean);
}

function parseCue(cueString) {
  const data = cueString.length > 1 ? parseInt(cueString.substring(1)) : undefined;
  switch (cueString.charAt(0)) {
    case 's': return { cue: 'startup', delay: data || 5 };
    case 'p': return { cue: 'playback', time: data || 30 };
    case 'r': return { cue: 'rebuffer', delay: data || 30 };
    case 'e': return { cue: 'error', ...(data && { code: data }) };
    default:  return null;
  }
}

// Processes the cue timeline and generates the actions for each segment.
// Outputs an array with the action for each segment file. The filename is the index
// into the segment e.g. [{ segment: 0, delay: X }] is for 0.ts, etc.
// Only global cues (no rendition field) are included.
function createSegmentTimeline(timeline) {
  const entries = [];
  let currentSegment = 0;

  if (!timeline) return entries;

  for (const cue of timeline) {
    if (cue.rendition) continue; // skip rendition-targeted cues

    switch (cue.cue) {
      case 'startup':
        entries.push({ segment: 0, delay: cue.delay });
        break;
      case 'playback':
        currentSegment += cueSegmentCount(cue);
        break;
      case 'rebuffer':
        entries.push({ segment: currentSegment, delay: cue.delay });
        // the current segment doesn't increment because rebuffering requires
        // another action after it
        break;
      case 'error': {
        const el = entries.at(-1);
        if (el && el.segment === currentSegment) {
          el.error = cue.code || '500';
        } else {
          entries.push({ segment: currentSegment, error: cue.code || '500' });
        }
        currentSegment += cueSegmentCount(cue);
        break;
      }
      case 'bandwidth':
        entries.push({ segment: currentSegment, bandwidthKbps: cue.kbps });
        break;
      default:
        break;
    }
  }

  return entries;
}

function calculateElapsedPlayheadTime(filename) {
  if (!filename) return;

  const baseName = path.basename(filename, path.extname(filename));
  const named = baseName.match(/^seg-[a-zA-Z]\w*-(\d+)$/);
  if (named) return (parseInt(named[1]) - 1) * segmentLength;

  const plain = baseName.match(/^seg-(\d+)$/);
  if (plain) return (parseInt(plain[1]) - 1) * segmentLength;
}

// Returns the number of segments a cue occupies in the timeline.
function cueSegmentCount(cue) {
  if (cue.cue === 'playback') return Math.ceil(cue.time / segmentLength);
  if (cue.cue === 'error') return 1;
  return 0;
}

function calculateMediaLength(timeline) {
  if (!timeline) return;
  return timeline.reduce((total, cue) => total + cueSegmentCount(cue) * segmentLength, 0);
}

function roundToSegmentSize(length) {
  return Math.ceil(length / segmentLength) * segmentLength;
}

function padSegmentBuffer(buf, targetBytes) {
  if (targetBytes <= buf.length) return buf;
  const paddingSize = targetBytes - buf.length;
  const freeBox = Buffer.allocUnsafe(paddingSize);
  freeBox.writeUInt32BE(paddingSize, 0);  // total free box size
  freeBox.write('free', 4, 'ascii');      // box type
  freeBox.fill(0, 8);                     // zero the rest
  return Buffer.concat([buf, freeBox]);
}

function extractMimetype(ext) {
  if (ext === 'm3u8') return 'application/x-mpegURL';
  if (ext === 'mpd') return 'application/dash+xml';
  if (ext === 'm4s') return 'video/iso.segment';
  return ext;
}

// Returns the byte offset of the start of the first MP4 box with the given 4-char type,
// or -1 if not found.
function findBox(buf, type) {
  const b0 = type.charCodeAt(0), b1 = type.charCodeAt(1),
        b2 = type.charCodeAt(2), b3 = type.charCodeAt(3);
  for (let i = 0; i <= buf.length - 8; i++) {
    if (buf[i+4] === b0 && buf[i+5] === b1 && buf[i+6] === b2 && buf[i+7] === b3) {
      return i;
    }
  }
  return -1;
}

module.exports = {
  segmentLength,
  shouldIgnoreRequest,
  checkRequestType,
  extractRenditionName,
  resolveRenditions,
  resolveRenditionErrors,
  extractRenditionFromSegment,
  parseSpecification,
  parseCue,
  createSegmentTimeline,
  calculateElapsedPlayheadTime,
  calculateMediaLength,
  roundToSegmentSize,
  extractMimetype,
  findBox,
  padSegmentBuffer,
};
