const Koa = require('koa');
const fs = require('fs');
const app = module.exports = new Koa();
const path = require('path');
const throttle = require('koa-throttle2');
const { segmentLength, shouldIgnoreRequest, checkRequestType,
        parseSpecification, createSegmentTimeline,
        calculateElapsedPlayheadTime, calculateMediaLength,
        extractMimetype } = require('./lib/logic');

// Caches
var specCache = {};
var timelineCache = {};

app.use(async ctx => {
    const filepath = path.dirname(ctx.path);
    const filename = path.basename(ctx.path);

    console.log(`Request: path: ${filepath} name: ${filename}`);

    if (shouldIgnoreRequest(filename)) return;

    if (!specCache[filepath]) {
        specCache[filepath] = parseSpecification(filepath);
        console.log('parseSpecification: ' + filepath);
        console.dir(specCache[filepath]);
    }
    const operations = specCache[filepath];

    switch (checkRequestType(filename)) {
      case 'media':
        console.log('Media request');

        await generateMediaPlaylist(ctx, filepath, filename);
        break;
      case 'rendition':
        console.log('Rendition request');

        const mediaLength = calculateMediaLength(operations);
        await generateRendition(ctx, mediaLength);
        break;
      case 'dash-manifest':
        console.log('DASH manifest request');

        const dashLength = calculateMediaLength(operations);
        await generateDashMPD(ctx, dashLength);
        break;
      case 'segment':
        console.log('Segment request');

        if (!timelineCache[filepath]) {
            timelineCache[filepath] = createSegmentTimeline(operations);
            console.log('createSegmentTimeline:');
            console.dir(timelineCache[filepath]);
        }
        const timeline = timelineCache[filepath];
        const time = calculateElapsedPlayheadTime(filename);

        await processSegment(ctx, timeline, time);
        break;
      default:
        await outputFile(ctx, '/media', filename);
        break;
    }
});

if (!module.parent) app.listen(3000);

// Request handlers

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

async function generateDashMPD(ctx, mediaLength) {
  const mpd =
`<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
     type="static"
     mediaPresentationDuration="PT${mediaLength}S"
     minBufferTime="PT2S">
  <Period>
    <AdaptationSet mimeType="video/mp4" segmentAlignment="true">
      <Representation id="1" bandwidth="2493700" codecs="avc1.640020" width="1280" height="720">
        <SegmentTemplate media="$Number$.m4s" duration="5" timescale="1" startNumber="0"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

  outputString(ctx, 'application/dash+xml', mpd);
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
