const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldIgnoreRequest,
  checkRequestType,
  parseSpecification,
  createSegmentTimeline,
  calculateElapsedPlayheadTime,
  calculateMediaLength,
  roundToSegmentSize,
  extractMimetype,
} = require('./logic');

describe('shouldIgnoreRequest', () => {
  it('returns true for favicon.ico', () => {
    assert.equal(shouldIgnoreRequest('favicon.ico'), true);
  });
  it('returns true for apple-touch-icon.png', () => {
    assert.equal(shouldIgnoreRequest('apple-touch-icon.png'), true);
  });
  it('returns true for apple-touch-icon-precomposed.png', () => {
    assert.equal(shouldIgnoreRequest('apple-touch-icon-precomposed.png'), true);
  });
  it('returns false for media.m3u8', () => {
    assert.equal(shouldIgnoreRequest('media.m3u8'), false);
  });
  it('returns false for 0.ts', () => {
    assert.equal(shouldIgnoreRequest('0.ts'), false);
  });
});

describe('checkRequestType', () => {
  it('returns segment for .ts files', () => {
    assert.equal(checkRequestType('0.ts'), 'segment');
  });
  it('returns segment for .m4s files', () => {
    assert.equal(checkRequestType('0.m4s'), 'segment');
  });
  it('returns media for media.m3u8', () => {
    assert.equal(checkRequestType('media.m3u8'), 'media');
  });
  it('returns rendition for rendition.m3u8', () => {
    assert.equal(checkRequestType('rendition.m3u8'), 'rendition');
  });
  it('returns dash-manifest for media.mpd', () => {
    assert.equal(checkRequestType('media.mpd'), 'dash-manifest');
  });
  it('returns undefined for other files', () => {
    assert.equal(checkRequestType('other.html'), undefined);
  });
});

describe('parseSpecification', () => {
  it('parses a full spec string', () => {
    assert.deepEqual(parseSpecification('/s5-p30-e404'), [
      { op: 'startup', delay: 5 },
      { op: 'playback', time: 30 },
      { op: 'error', code: 404 },
    ]);
  });
  it('defaults startup delay to 5', () => {
    const ops = parseSpecification('/s');
    assert.equal(ops[0].delay, 5);
  });
  it('defaults playback time to 30', () => {
    const ops = parseSpecification('/p');
    assert.equal(ops[0].time, 30);
  });
  it('defaults rebuffer delay to 30', () => {
    const ops = parseSpecification('/r');
    assert.equal(ops[0].delay, 30);
  });
  it('error without code has no code property', () => {
    const ops = parseSpecification('/e');
    assert.equal(ops[0].op, 'error');
    assert.equal(ops[0].code, undefined);
  });
});

describe('createSegmentTimeline', () => {
  it('maps startup to segment 0', () => {
    const timeline = createSegmentTimeline([{ op: 'startup', delay: 5 }]);
    assert.deepEqual(timeline, [{ segment: 0, delay: 5 }]);
  });
  it('produces no timeline entries for playback only', () => {
    const timeline = createSegmentTimeline([{ op: 'playback', time: 30 }]);
    assert.deepEqual(timeline, []);
  });
  it('places rebuffer at correct segment after playback', () => {
    const timeline = createSegmentTimeline([
      { op: 'playback', time: 30 },
      { op: 'rebuffer', delay: 10 },
    ]);
    assert.deepEqual(timeline, [{ segment: 6, delay: 10 }]);
  });
  it('places error at correct segment after playback', () => {
    const timeline = createSegmentTimeline([
      { op: 'playback', time: 30 },
      { op: 'error', code: 404 },
    ]);
    assert.deepEqual(timeline, [{ segment: 6, error: 404 }]);
  });
  it('merges rebuffer and error at same segment', () => {
    const timeline = createSegmentTimeline([
      { op: 'playback', time: 30 },
      { op: 'rebuffer', delay: 10 },
      { op: 'error' },
    ]);
    assert.deepEqual(timeline, [{ segment: 6, delay: 10, error: '500' }]);
  });
  it('handles a full chain of operations', () => {
    const timeline = createSegmentTimeline([
      { op: 'startup', delay: 5 },
      { op: 'playback', time: 30 },
      { op: 'rebuffer', delay: 10 },
      { op: 'playback', time: 10 },
      { op: 'error', code: 404 },
    ]);
    assert.deepEqual(timeline, [
      { segment: 0, delay: 5 },
      { segment: 7, delay: 10 },
      { segment: 9, error: 404 },
    ]);
  });
});

describe('calculateElapsedPlayheadTime', () => {
  it('returns 0 for 0.ts', () => {
    assert.equal(calculateElapsedPlayheadTime('0.ts'), 0);
  });
  it('returns 30 for 6.ts', () => {
    assert.equal(calculateElapsedPlayheadTime('6.ts'), 30);
  });
  it('returns 0 for 0.m4s', () => {
    assert.equal(calculateElapsedPlayheadTime('0.m4s'), 0);
  });
  it('returns 30 for 6.m4s', () => {
    assert.equal(calculateElapsedPlayheadTime('6.m4s'), 30);
  });
  it('returns undefined for non-numeric filename', () => {
    assert.equal(calculateElapsedPlayheadTime('abc.ts'), undefined);
  });
});

describe('calculateMediaLength', () => {
  it('sums playback ops correctly', () => {
    assert.equal(calculateMediaLength([{ op: 'playback', time: 30 }]), 30);
  });
  it('non-playback ops contribute one segment each', () => {
    assert.equal(calculateMediaLength([
      { op: 'startup', delay: 5 },
      { op: 'playback', time: 30 },
    ]), 35);
  });
  it('rebuffer ops contribute 0 seconds', () => {
    assert.equal(calculateMediaLength([{ op: 'rebuffer', delay: 10 }]), 0);
  });
  it('handles mixed operations', () => {
    assert.equal(calculateMediaLength([
      { op: 'startup', delay: 5 },
      { op: 'playback', time: 30 },
      { op: 'rebuffer', delay: 10 },
      { op: 'error' },
    ]), 40);
  });
});

describe('roundToSegmentSize', () => {
  it('5 → 5', () => assert.equal(roundToSegmentSize(5), 5));
  it('6 → 10', () => assert.equal(roundToSegmentSize(6), 10));
  it('0 → 0', () => assert.equal(roundToSegmentSize(0), 0));
  it('30 → 30', () => assert.equal(roundToSegmentSize(30), 30));
});

describe('extractMimetype', () => {
  it('m3u8 → application/x-mpegURL', () => {
    assert.equal(extractMimetype('m3u8'), 'application/x-mpegURL');
  });
  it('mpd → application/dash+xml', () => {
    assert.equal(extractMimetype('mpd'), 'application/dash+xml');
  });
  it('m4s → video/iso.segment', () => {
    assert.equal(extractMimetype('m4s'), 'video/iso.segment');
  });
  it('ts → ts', () => {
    assert.equal(extractMimetype('ts'), 'ts');
  });
});
