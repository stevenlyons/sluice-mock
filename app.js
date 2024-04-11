const Koa = require('koa');
const fs = require('fs');
const app = module.exports = new Koa();
const path = require('path');
const throttle = require('koa-throttle2');

// Segment length is 5 seconds
const segmentLength = 5;

// Caches
var specCache = {};
var timelineCache = {};

app.use(async ctx => {
    const filepath = path.dirname(ctx.path);
    const filename = path.basename(ctx.path);

    console.log(`Request: path: ${filepath} name: ${filename}`);  

    if (shouldIgnoreRequest(filename)) return;
    
    const operations = specCache[filepath] ||= parseSpecification(filepath);

    switch (checkRequestType(filename)) {
      case 'media':
        console.log('Media request');

        // Choose number of renditions (currently hardcoded to 1 rendition)
        await generateMediaPlaylist(ctx, filepath, filename);
        break;
      case 'rendition':
        console.log('Rendition request');

        // Generate rendition based on specification in request
        const mediaLength = calculateMediaLength(operations);
        await generateRendition(ctx, mediaLength);
        break;
      case 'segment':
        console.log('Segment request');

        // Build the session timeline
        const timeline = timelineCache[filepath] ||= createSegmentTimeline(operations);
        // Calculate the current progress in the video session
        const time = calculateElapsedPlayheadTime(filename);

        // take appropriate action
        await processSegment(ctx, timeline, time);
        break;
      default:
        await outputFile(ctx, '/media', filename);
        break;
    }
});

if (!module.parent) app.listen(3000);

// Request handlers

function shouldIgnoreRequest(filename) {
  const ignore = ['favicon.ico', 'apple-touch-icon-precomposed.png', 'apple-touch-icon.png']
  return ignore.includes(filename) ? true : false;
}

function checkRequestType(filename) {
  if (!filename) return;

  const ext = path.extname(filename);

  if (ext === '.ts') {
    return 'segment';
  } else if (ext === '.m3u8') {
    // Going with a hardcoded check for now
    if (filename === 'media.m3u8') {
      return 'media';
    } else if (filename === 'rendition.m3u8') {
      return 'rendition';
    }
  }
}

async function generateMediaPlaylist(ctx, filepath, filename) {
  await outputFile(ctx, '/media', filename);
}

async function generateRendition(ctx, medialength) {
  const start = 
`#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-PLAYLIST-TYPE:VOD`;
  const end = `\n#EXT-X-ENDLIST`;
  var segments = '';

  for (let i = 0; i < medialength / segmentLength; i++) {
    segments += 
`\n#EXTINF:5,
${i}.ts`;
  }

  outputString(ctx, 'application/x-mpegURL', start + segments + end);
}

async function processSegment(ctx, timeline, time) {
  if (!timeline || time === undefined) return;

  const segmentNum = Math.ceil(time / segmentLength);
  const segment = timeline.find((el) => el.segment === segmentNum);

  const filename = '0.ts';

  if (segment) {
    // Delayed playback for startup or rebuffer
    if (segment.delay > 0) {
      //await sleep(segment.delay);
      await outputFile(ctx, '/media', filename, segment.delay);
    } 

    // Throw an Error
    if (segment.error > 0) {
      outputError(ctx, segment.error);
    }
  } else {
    // Nominal playback
    await outputFile(ctx, '/media', filename);
  }
};

// Specification parsing

// Parses the path to pull out the operations. Changes:
// '/s5-p30-r10/' to [{ op: 'startup', delay: 5 }, { op: 'playback', time: 30 }, { op: 'rebuffer', delay: 10 }]
function parseSpecification(path) {
  if (!path) return;

  const opString = path.startsWith('/') ? path.substring(1) : path;
  const rawOps = opString.split('-');
  var ops = [];

  for (const rawOp of rawOps) {
    var op = parseOp(rawOp);

    if (op) {
      ops.push(op);
    }
  }

  console.log('parseSpecification: ' + path);
  console.dir(ops);
  return ops;
}

function parseOp(opString) {
  var op = {};

  const data = parseData(opString.substring(1));
  switch (opString.charAt(0)) {
    case 's':
        op['op'] = 'startup';
        op['delay'] = data || 5; // Default to 5 seconds
        break;
    case 'p':
        op['op'] = 'playback';
        op['time'] = data || 30; // Default to 30 seconds
        break;
    case 'r':
        op['op'] = 'rebuffer';
        op['delay'] = data || 30; // Default to 30 seconds
        break;
    case 'e':
        op['op'] = 'error';
        if (data) op['code'] = data;
        break;
  };

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
// Currently, 'delay' and 'failure' are the only commands: 
//   [{ segment: 0, delay: 5 }, { segment: 5, failure: 404 }, ...]
function createSegmentTimeline(operations) {
  var timeline = [];
  var currentSegment = 0;

  if (!operations) return timeline;

  for (let i = 0; i < operations.length; i++) {
    switch (operations[i].op) {
      case 'startup':
        // Hardcode startup to first segment
        timeline.push({ segment: 0, delay: operations[i].delay });
        currentSegment++;
        break;
      case 'playback':
        // No action to take for nominal playback
        currentSegment += Math.ceil(operations[i].time / segmentLength);
        break;
      case 'rebuffer':
        timeline.push({ segment: currentSegment, delay: operations[i].delay });
        // the current segment doesn't increment because rebuffering requires 
        // another action after it
        break;
      case 'error':
        // Check last segment and see if it has the same segment number.
        // Bascially, this will merge a rebuffering and errored segment.
        const el = timeline.at(-1);
        if (el && el.segment === currentSegment) {
          el.error = (operations[i].code ? operations[i].code : '500') 
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
  
  console.log('createSegmentTimeline:');
  console.dir(timeline);
  return timeline;
}

function calculateElapsedPlayheadTime(filename) {
  if (!filename) return;

  // Method:
  // Use the current segment request to figure out where in the rendition playlist
  // the player currently is. Each segment is 5sec and each segment is named in 
  // integer order so we can multiply those together.
  const currentSegment = path.basename(filename, path.extname(filename));
  if (Number.isNaN(parseInt(currentSegment))) return;

  return parseInt(currentSegment) * segmentLength;
}

function calculateMediaLength(operations) {
  if (!operations) return;

  // Playback event length is as long as specified (rounded to the segment length), 
  // rebuffering has length 0 because it depends on other actions for segments, 
  // all other events are one segment of playback.
  return operations.reduce((total, operation) => 
    total + roundToSegmentSize((operation.op === 'playback' ? operation.time : 
      (operation.op === 'rebuffer' ? 0 : segmentLength))), 0);
}

function roundToSegmentSize(length) {
  return Math.ceil(length / segmentLength) * segmentLength;
}

// Output

function outputError(ctx, code) {
  ctx.throw(code);
}

// const throttler = throttle({rate: 100, chunk: 15000});
// await throttler(ctx, () => {;});
async function outputFile(ctx, filepath, filename, delay = 0) {
  const fpath = path.join(__dirname, filepath, filename);
  const fstat = await stat(fpath);

  if (fstat.isFile()) {
    const temp = path.extname(fpath);
    var ext = temp.charAt(0) === '.' ? extractMimetype(temp.substring(1)) : temp;

    ctx.type = ext;
    ctx.length = fstat.size;
    ctx.body = fs.createReadStream(fpath);

    if (delay > 0) {
      // Calculate the number of bits per 100ms interval to throttle the file to the specified time 
      const chunk = (fstat.size / 10) / delay;
      const throttler = throttle({rate: 100, chunk: chunk});
      // Throttle the response, pass a no-op function for the expected `next()`
      await throttler(ctx, () => {;});  
    }
  }
}

function outputString(ctx, type, body) {
  ctx.type = type;
  ctx.body = body;
}

function extractMimetype(ext) {
  return ext === 'm3u8' ? 'application/x-mpegURL' : ext;
}

// System functions

function stat(file) {
  return new Promise(function(resolve, reject) {
    fs.stat(file, function(err, stat) {
      if (err) {
        reject(err);
      } else {
        resolve(stat);
      }
    });
  });
}

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}
