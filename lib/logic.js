const path = require('path');

const segmentLength = 5;

function shouldIgnoreRequest(filename) {
  const ignore = ['favicon.ico', 'apple-touch-icon-precomposed.png', 'apple-touch-icon.png'];
  return ignore.includes(filename) ? true : false;
}

function checkRequestType(filename) {
  if (!filename) return;

  const ext = path.extname(filename);

  if (ext === '.ts' || ext === '.m4s') {
    return 'segment';
  } else if (ext === '.m3u8') {
    if (filename === 'media.m3u8') {
      return 'media';
    } else if (filename === 'rendition.m3u8') {
      return 'rendition';
    }
  } else if (ext === '.mpd') {
    return 'dash-manifest';
  }
}

// Parses the path to pull out the operations. Changes:
// '/s5-p30-r10/' to [{ op: 'startup', delay: 5 }, { op: 'playback', time: 30 }, { op: 'rebuffer', delay: 10 }]
function parseSpecification(specPath) {
  if (!specPath) return;

  const opString = specPath.startsWith('/') ? specPath.substring(1) : specPath;
  const rawOps = opString.split('-');
  var ops = [];

  for (const rawOp of rawOps) {
    var op = parseOp(rawOp);

    if (op) {
      ops.push(op);
    }
  }

  return ops;
}

function parseOp(opString) {
  var op = {};

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
function createSegmentTimeline(operations) {
  var timeline = [];
  var currentSegment = 0;

  if (!operations) return timeline;

  for (let i = 0; i < operations.length; i++) {
    switch (operations[i].op) {
      case 'startup':
        timeline.push({ segment: 0, delay: operations[i].delay });
        currentSegment++;
        break;
      case 'playback':
        currentSegment += Math.ceil(operations[i].time / segmentLength);
        break;
      case 'rebuffer':
        timeline.push({ segment: currentSegment, delay: operations[i].delay });
        // the current segment doesn't increment because rebuffering requires
        // another action after it
        break;
      case 'error':
        const el = timeline.at(-1);
        if (el && el.segment === currentSegment) {
          el.error = (operations[i].code ? operations[i].code : '500');
        } else {
          timeline.push({
            segment: currentSegment,
            error: (operations[i].code ? operations[i].code : '500')
          });
        }
        currentSegment++;
        break;
      default:
        break;
    }
  }

  return timeline;
}

function calculateElapsedPlayheadTime(filename) {
  if (!filename) return;

  const currentSegment = path.basename(filename, path.extname(filename));
  if (Number.isNaN(parseInt(currentSegment))) return;

  return parseInt(currentSegment) * segmentLength;
}

function calculateMediaLength(operations) {
  if (!operations) return;

  return operations.reduce((total, operation) =>
    total + roundToSegmentSize((operation.op === 'playback' ? operation.time :
      (operation.op === 'rebuffer' ? 0 : segmentLength))), 0);
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

module.exports = {
  segmentLength,
  shouldIgnoreRequest,
  checkRequestType,
  parseSpecification,
  parseOp,
  parseData,
  createSegmentTimeline,
  calculateElapsedPlayheadTime,
  calculateMediaLength,
  roundToSegmentSize,
  extractMimetype,
};
