const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('./app');
const { loadSpecification } = app;
const { findBox } = require('./lib/logic');

function readTfdt(buf) {
  const offset = findBox(buf, 'tfdt');
  if (offset === -1) return null;
  const version = buf[offset + 8];
  return version === 1 ? Number(buf.readBigUInt64BE(offset + 12)) : buf.readUInt32BE(offset + 12);
}

// HTTP helper — makes a GET request and returns { statusCode, headers, body: Buffer }
function get(server, path) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
  });
}

describe('mfhd sequence_number patching', () => {
  let server;
  before(() => new Promise(resolve => {
    server = http.createServer(app.callback()).listen(0, '127.0.0.1', resolve);
  }));
  after(() => new Promise(resolve => server.close(resolve)));

  it('seg-1.m4s has sequence_number 1 at byte offset 20', async () => {
    const { statusCode, body } = await get(server, '/p30/seg-1.m4s');
    assert.equal(statusCode, 200);
    assert.equal(body.readUInt32BE(20), 1);
  });

  it('seg-2.m4s has sequence_number 2 at byte offset 20', async () => {
    const { statusCode, body } = await get(server, '/p30/seg-2.m4s');
    assert.equal(statusCode, 200);
    assert.equal(body.readUInt32BE(20), 2);
  });

  it('seg-6.m4s has sequence_number 6 at byte offset 20 (looped)', async () => {
    const { statusCode, body } = await get(server, '/p30/seg-6.m4s');
    assert.equal(statusCode, 200);
    assert.equal(body.readUInt32BE(20), 6);
  });

  it('seg-6.m4s and seg-1.m4s share identical content outside of patched fields', async () => {
    const [r1, r6] = await Promise.all([
      get(server, '/p30/seg-1.m4s'),
      get(server, '/p30/seg-6.m4s'),
    ]);
    // mfhd sequence_number: bytes 20–23 (fixed position)
    assert.deepEqual(r1.body.slice(24, findBox(r1.body, 'tfdt') + 12),
                     r6.body.slice(24, findBox(r6.body, 'tfdt') + 12));
    // after tfdt baseMediaDecodeTime field (version=1: 8-byte field at offset +12)
    const afterTfdt1 = findBox(r1.body, 'tfdt') + 20;
    const afterTfdt6 = findBox(r6.body, 'tfdt') + 20;
    assert.deepEqual(r1.body.slice(afterTfdt1), r6.body.slice(afterTfdt6));
  });

  it('seg-1.m4s and seg-2.m4s differ after byte 24 (different physical files)', async () => {
    const [r1, r2] = await Promise.all([
      get(server, '/p30/seg-1.m4s'),
      get(server, '/p30/seg-2.m4s'),
    ]);
    assert.notDeepEqual(r1.body.slice(24), r2.body.slice(24));
  });

  it('init.mp4 is served without modification (no sequence_number patch)', async () => {
    const { statusCode, body } = await get(server, '/p30/init.mp4');
    assert.equal(statusCode, 200);
    // init.mp4 should not be empty
    assert.ok(body.length > 0);
    // Verify it starts with ftyp or moov box (4-byte size + 4-byte type)
    const boxType = body.slice(4, 8).toString('ascii');
    assert.ok(boxType === 'ftyp' || boxType === 'moov', `expected ftyp or moov, got ${boxType}`);
  });

  it('seg-1.m4s content-type is video/iso.segment', async () => {
    const { headers } = await get(server, '/p30/seg-1.m4s');
    assert.equal(headers['content-type'], 'video/iso.segment');
  });

  it('seg-1.m4s has base media decode time 0', async () => {
    const { body } = await get(server, '/p30/seg-1.m4s');
    assert.equal(readTfdt(body), 0);
  });

  it('seg-2.m4s has base media decode time 144144', async () => {
    const { body } = await get(server, '/p30/seg-2.m4s');
    assert.equal(readTfdt(body), 144144);
  });

  it('seg-3.m4s has base media decode time 288288 (corrected from physical file)', async () => {
    const { body } = await get(server, '/p30/seg-3.m4s');
    assert.equal(readTfdt(body), 288288);
  });

  it('seg-6.m4s has base media decode time 720720 (looped)', async () => {
    const { body } = await get(server, '/p30/seg-6.m4s');
    assert.equal(readTfdt(body), 144144 * 5);
  });
});

describe('per-rendition segment sizing', () => {
  // Use abr-sizing-test (playback only, no throttle or errors) so Content-Length is preserved.
  let server;
  before(() => new Promise(resolve => {
    server = http.createServer(app.callback()).listen(0, '127.0.0.1', resolve);
  }));
  after(() => new Promise(resolve => server.close(resolve)));

  it('seg-low-1.m4s response body is padded to low rendition target size', async () => {
    const { statusCode, body } = await get(server, '/abr-sizing-test/seg-low-1.m4s');
    assert.equal(statusCode, 200);
    const targetBytes = Math.round(600000 * 6.006 / 8);
    assert.equal(body.length, targetBytes);
  });

  it('seg-high-1.m4s response body is padded to high rendition target size', async () => {
    const { statusCode, body } = await get(server, '/abr-sizing-test/seg-high-1.m4s');
    assert.equal(statusCode, 200);
    const targetBytes = Math.round(5000000 * 6.006 / 8);
    assert.equal(body.length, targetBytes);
  });

  it('content-length header matches actual body size for low rendition', async () => {
    const { headers, body } = await get(server, '/abr-sizing-test/seg-low-1.m4s');
    assert.equal(parseInt(headers['content-length']), body.length);
  });

  it('content-length header matches actual body size for high rendition', async () => {
    const { headers, body } = await get(server, '/abr-sizing-test/seg-high-1.m4s');
    assert.equal(parseInt(headers['content-length']), body.length);
  });

  it('video data (moof box) is intact at start of low rendition response', async () => {
    const { body } = await get(server, '/abr-sizing-test/seg-low-1.m4s');
    const moofOffset = body.slice(4, 8).toString('ascii');
    assert.equal(moofOffset, 'moof');
  });

  it('video data (moof box) is intact at start of high rendition response', async () => {
    const { body } = await get(server, '/abr-sizing-test/seg-high-1.m4s');
    const moofOffset = body.slice(4, 8).toString('ascii');
    assert.equal(moofOffset, 'moof');
  });
});

describe('loadSpecification', () => {
  it('loads operations from a named spec file', async () => {
    const spec = await loadSpecification('/example');
    assert.deepEqual(spec.operations, [
      { op: 'startup', delay: 5 },
      { op: 'playback', time: 12 },
      { op: 'error', code: 404 },
    ]);
  });

  it('returns a single default rendition for single-rendition spec file', async () => {
    const spec = await loadSpecification('/example');
    assert.equal(spec.renditions.length, 1);
    assert.equal(spec.renditions[0].bandwidth, 2493700);
  });

  it('returns empty renditionErrors for single-rendition spec file', async () => {
    const spec = await loadSpecification('/example');
    assert.deepEqual(spec.renditionErrors, { playlist: {}, segment: {} });
  });

  it('falls back to inline parsing when spec file does not exist', async () => {
    const spec = await loadSpecification('/s5-p30-e404');
    assert.deepEqual(spec.operations, [
      { op: 'startup', delay: 5 },
      { op: 'playback', time: 30 },
      { op: 'error', code: 404 },
    ]);
  });

  it('handles filepath without leading slash', async () => {
    const spec = await loadSpecification('example');
    assert.deepEqual(spec.operations, [
      { op: 'startup', delay: 5 },
      { op: 'playback', time: 12 },
      { op: 'error', code: 404 },
    ]);
  });

  it('loads named renditions from abr-example spec file', async () => {
    const spec = await loadSpecification('/abr-example');
    assert.equal(spec.renditions.length, 3);
    assert.equal(spec.renditions[0].name, 'mid');
    assert.equal(spec.renditions[1].name, 'high');
    assert.equal(spec.renditions[2].name, 'low');
  });

  it('loads rendition bandwidths from abr-example', async () => {
    const spec = await loadSpecification('/abr-example');
    assert.equal(spec.renditions[0].bandwidth, 2493700);
    assert.equal(spec.renditions[1].bandwidth, 5000000);
    assert.equal(spec.renditions[2].bandwidth, 400000);
  });

  it('resolves rendition errors from abr-example', async () => {
    const spec = await loadSpecification('/abr-example');
    assert.deepEqual(spec.renditionErrors, {
      playlist: {},
      segment: {
        mid: { code: 404, activateAtSegment: 2 },
        low: { code: 404, activateAtSegment: 3 },
      },
    });
  });

  it('resolves segment rendition errors from abr-rendition-segment-error', async () => {
    const spec = await loadSpecification('/abr-rendition-segment-error');
    assert.deepEqual(spec.renditionErrors, { playlist: {}, segment: { low: { code: 503, activateAtSegment: 6 } } });
  });

  it('operations includes rendition-targeted error ops for media length calculation', async () => {
    const spec = await loadSpecification('/abr-example');
    const hasRenditionOp = spec.operations.some(op => op.rendition);
    assert.equal(hasRenditionOp, true);
  });
});
