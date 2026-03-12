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
  const match = filename.match(/^rendition-(\w+)\.m3u8$/);
  return match ? match[1] : null;
}

function resolveRenditions(spec) {
  if (!spec.renditions) {
    return [{ bandwidth: 2493700, resolution: '1280x720' }];
  }
  return spec.renditions.map(r => ({ ...r }));
}

function resolveRenditionErrors(operations) {
  if (!operations) return { playlist: {}, segment: {} };
  const playlist = {};
  const segment = {};
  for (const op of operations) {
    if (op.op === 'error' && op.rendition) {
      const code = op.code || 500;
      if (op.on === 'segment') {
        segment[op.rendition] = code;
      } else {
        playlist[op.rendition] = code;
      }
    }
  }
  return { playlist, segment };
}

function extractRenditionFromSegment(filename) {
  const match = filename.match(/^rendition-(\w+)-seg-(\d+)\.m4s$/);
  if (match) {
    return { rendition: match[1], segment: parseInt(match[2]) };
  }
  const plain = filename.match(/^seg-(\d+)\.m4s$/);
  if (plain) {
    return { rendition: null, segment: parseInt(plain[1]) };
  }
  return { rendition: null, segment: null };
}

// Parses the path to pull out the operations. Changes:
// '/s5-p30-r10/' to [{ op: 'startup', delay: 5 }, { op: 'playback', time: 30 }, { op: 'rebuffer', delay: 10 }]
function parseSpecification(specPath) {
  if (!specPath) return;

  const opString = specPath.startsWith('/') ? specPath.substring(1) : specPath;
  const rawOps = opString.split('-');
  let ops = [];

  for (const rawOp of rawOps) {
    const op = parseOp(rawOp);

    if (op) {
      ops.push(op);
    }
  }

  return ops;
}

function parseOp(opString) {
  let op = {};

  const data = parseData(opString.substring(1));
  switch (opString.charAt(0)) {
    case 's':
      op['op'] = 'startup';
      op['delay'] = data || 5;
      break;
    case 'p':
      op['op'] = 'playback';
      op['time'] = data || 30;
      break;
    case 'r':
      op['op'] = 'rebuffer';
      op['delay'] = data || 30;
      break;
    case 'e':
      op['op'] = 'error';
      if (data) op['code'] = data;
      break;
    default:
      return null;
  }

  return op;
}

function parseData(dataString) {
  if (dataString) {
    return parseInt(dataString);
  }
}

// Processes the operation specification and generates the actions for each segment.
// Outputs an array with the action for each segment file. The filename is the index
// into the segment e.g. [{ segment: 0, delay: X }] is for 0.ts, etc.
// Only global ops (no rendition field) are included.
function createSegmentTimeline(operations) {
  let timeline = [];
  let currentSegment = 0;

  if (!operations) return timeline;

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (op.rendition) continue; // skip rendition-targeted ops

    switch (op.op) {
      case 'startup':
        timeline.push({ segment: 0, delay: op.delay });
        break;
      case 'playback':
        currentSegment += Math.ceil(op.time / segmentLength);
        break;
      case 'rebuffer':
        timeline.push({ segment: currentSegment, delay: op.delay });
        // the current segment doesn't increment because rebuffering requires
        // another action after it
        break;
      case 'error': {
        const el = timeline.at(-1);
        if (el && el.segment === currentSegment) {
          el.error = (op.code ? op.code : '500');
        } else {
          timeline.push({
            segment: currentSegment,
            error: (op.code ? op.code : '500')
          });
        }
        currentSegment++;
        break;
      }
      case 'bandwidth':
        timeline.push({ segment: currentSegment, bandwidthKbps: op.kbps });
        break;
      default:
        break;
    }
  }

  return timeline;
}

function calculateElapsedPlayheadTime(filename) {
  if (!filename) return;

  const baseName = path.basename(filename, path.extname(filename));
  const match = baseName.match(/^seg-(\d+)$/);
  if (!match) return;

  return (parseInt(match[1]) - 1) * segmentLength;
}

function opDuration(op) {
  if (op.op === 'playback') {
    return op.time;
  }
  if (op.op === 'error') {
    return segmentLength;
  }
  return 0;
}

function calculateMediaLength(operations) {
  if (!operations) return;

  return operations.reduce((total, op) => total + roundToSegmentSize(opDuration(op)), 0);
}

function roundToSegmentSize(length) {
  return Math.ceil(length / segmentLength) * segmentLength;
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
  parseOp,
  parseData,
  createSegmentTimeline,
  calculateElapsedPlayheadTime,
  calculateMediaLength,
  roundToSegmentSize,
  extractMimetype,
  findBox,
};
