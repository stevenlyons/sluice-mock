const Koa = require('koa');
const fs = require('fs');
const { Readable } = require('stream');
const app = module.exports = new Koa();
const path = require('path');
const throttle = require('koa-throttle2');
const { segmentLength, shouldIgnoreRequest, checkRequestType,
        extractRenditionName, resolveRenditions, resolveRenditionErrors,
        extractRenditionFromSegment, parseSpecification, createSegmentTimeline,
        calculateElapsedPlayheadTime, calculateMediaLength,
        extractMimetype, findBox, padSegmentBuffer } = require('./lib/logic');
const { buildMasterPlaylist, buildRenditionPlaylist, buildDashMPD } = require('./lib/manifest');

// Caches
let specCache = {};
let timelineCache = {};

app.use(async ctx => {
  const filepath = path.dirname(ctx.path);
  const filename = path.basename(ctx.path);

  console.log(`Request: path: ${filepath} name: ${filename}`);

  if (shouldIgnoreRequest(filename)) return;

  if (!specCache[filepath]) {
    specCache[filepath] = await loadSpecification(filepath);
    console.log('loadSpecification: ' + filepath);
    console.dir(specCache[filepath]);
  }
  const spec = specCache[filepath];

  switch (checkRequestType(filename)) {
    case 'media':
      console.log('Media request');
      outputString(ctx, 'application/x-mpegURL', buildMasterPlaylist(spec.renditions));
      break;
    case 'rendition': {
      console.log('Rendition request');
      const renditionName = extractRenditionName(filename);
      const renditionError = renditionName && spec.renditionErrors.playlist[renditionName];
      if (renditionError) {
        outputError(ctx, renditionError);
      } else {
        outputString(ctx, 'application/x-mpegURL', buildRenditionPlaylist(spec.mediaLength, renditionName));
      }
      break;
    }
    case 'dash-manifest': {
      console.log('DASH manifest request');
      outputString(ctx, 'application/dash+xml', buildDashMPD(spec.mediaLength, spec.renditions));
      break;
    }
    case 'segment': {
      console.log('Segment request');
      const { rendition: segRendition, segment: segNum } = extractRenditionFromSegment(filename);
      if (segRendition && spec.renditionErrors.segment[segRendition]) {
        const err = spec.renditionErrors.segment[segRendition];
        if (segNum >= err.activateAtSegment) {
          outputError(ctx, err.code);
          break;
        }
      }
      if (!timelineCache[filepath]) {
        timelineCache[filepath] = createSegmentTimeline(spec.operations);
        console.log('createSegmentTimeline:');
        console.dir(timelineCache[filepath]);
      }
      const timeline = timelineCache[filepath];
      const time = calculateElapsedPlayheadTime(filename);
      const renditionBandwidth = segRendition
        ? spec.renditions.find(r => r.name === segRendition)?.bandwidth
        : undefined;
      await processSegment(ctx, timeline, time, filename, renditionBandwidth);
      break;
    }
    default:
      await outputFile(ctx, '/media', filename);
      break;
  }
});

const portFlagIndex = process.argv.findIndex(a => a === '--port' || a === '-p');
const port = portFlagIndex !== -1 ? parseInt(process.argv[portFlagIndex + 1]) : 3030;
if (require.main === module) app.listen(port, () => console.log(`Listening on port ${port}`));

module.exports.loadSpecification = loadSpecification;

async function loadSpecification(filepath) {
  const name = filepath.startsWith('/') ? filepath.substring(1) : filepath;
  const specFile = path.join(__dirname, 'specs', `${name}.json`);
  try {
    const contents = await fs.promises.readFile(specFile, 'utf8');
    const json = JSON.parse(contents);
    const operations = json.operations || [];
    const renditionErrors = resolveRenditionErrors(json.operations);
    const mediaLength = calculateMediaLength(operations);
    return { operations, mediaLength, renditions: resolveRenditions(json), renditionErrors };
  } catch {
    const operations = parseSpecification(filepath);
    const mediaLength = calculateMediaLength(operations);
    return { operations, mediaLength, renditions: resolveRenditions({ operations }), renditionErrors: { playlist: {}, segment: {} } };
  }
}

async function processSegment(ctx, timeline, time, requestedFilename, renditionBandwidth) {
  if (!timeline || time === undefined) return;

  const segmentNum = Math.ceil(time / segmentLength);
  const segment = timeline.find((el) => el.segment === segmentNum);

  const ext = path.extname(requestedFilename);
  const { segment: requestedSegNum } = extractRenditionFromSegment(path.basename(requestedFilename));
  const NUM_SEGMENTS = 5;
  const filename = isNaN(requestedSegNum)
    ? `seg-1${ext}`
    : `seg-${((requestedSegNum - 1) % NUM_SEGMENTS) + 1}${ext}`;

  // Find the active bandwidth throttle (last bandwidth entry at or before this segment)
  const bandwidthEntry = [...timeline].reverse()
    .find(el => el.bandwidthKbps !== undefined && el.segment <= segmentNum);
  const bandwidthKbps = bandwidthEntry?.bandwidthKbps;

  if (segment) {
    if (segment.error) {
      outputError(ctx, segment.error);
      return;
    }

    // Delayed playback for startup or rebuffer (delay takes precedence over bandwidth)
    if (segment.delay > 0) {
      await outputFile(ctx, '/media', filename, segment.delay, 0, requestedSegNum, renditionBandwidth);
      return;
    }
  }

  // Nominal playback with optional bandwidth throttle
  await outputFile(ctx, '/media', filename, 0, bandwidthKbps, requestedSegNum, renditionBandwidth);
}

// Output

function outputError(ctx, code) {
  ctx.throw(code);
}

function patchM4sBuffer(buf, sequenceNumber, renditionBandwidth) {
  // Patch the mfhd sequence_number at byte offset 20:
  // moof header (8) + mfhd header (8) + version/flags (4) = 20
  buf.writeUInt32BE(sequenceNumber, 20);
  // Patch the tfdt baseMediaDecodeTime so each segment starts at the right point
  // in the timeline regardless of which physical file is being served.
  // 24000 (timescale) * 6.006s (segment duration) = 144144 ticks per segment
  const tfdtOffset = findBox(buf, 'tfdt');
  if (tfdtOffset !== -1) {
    const decodeTime = BigInt(144144) * BigInt(sequenceNumber - 1);
    buf.writeBigUInt64BE(decodeTime, tfdtOffset + 12); // version=1, 64-bit field
  }
  if (renditionBandwidth) {
    const targetBytes = Math.round(renditionBandwidth * segmentLength / 8);
    buf = padSegmentBuffer(buf, targetBytes);
  }
  return buf;
}

async function outputFile(ctx, filepath, filename, delay = 0, bandwidthKbps = 0, sequenceNumber = null, renditionBandwidth = undefined) {
  const fpath = path.join(__dirname, filepath, filename);
  const fstat = await fs.promises.stat(fpath);

  if (fstat.isFile()) {
    const temp = path.extname(fpath);
    const ext = temp.charAt(0) === '.' ? extractMimetype(temp.substring(1)) : temp;

    ctx.type = ext;

    if (sequenceNumber !== null && !isNaN(sequenceNumber) && path.extname(filename) === '.m4s') {
      let buf = await fs.promises.readFile(fpath);
      buf = patchM4sBuffer(buf, sequenceNumber, renditionBandwidth);
      ctx.length = buf.length;
      ctx.body = Readable.from(buf);
    } else {
      ctx.length = fstat.size;
      ctx.body = fs.createReadStream(fpath);
    }

    if (delay > 0) {
      // Calculate the number of bytes per 100ms interval to throttle the file to the specified time
      const chunk = (ctx.length / 10) / delay;
      const throttler = throttle({rate: 100, chunk: chunk});
      await throttler(ctx, () => {;});
    } else if (bandwidthKbps > 0) {
      // Throttle to the specified kbps: bytes per 100ms interval
      const chunk = (bandwidthKbps * 1000 / 8) / 10;
      const throttler = throttle({rate: 100, chunk: chunk});
      await throttler(ctx, () => {;});
    }
  }
}

function outputString(ctx, type, body) {
  ctx.type = type;
  ctx.body = body;
}
