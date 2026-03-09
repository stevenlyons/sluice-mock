const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldIgnoreRequest,
  checkRequestType,
  extractRenditionName,
  resolveRenditions,
  resolveRenditionErrors,
  extractRenditionFromSegment,
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
  it('returns rendition for rendition-low.m3u8', () => {
    assert.equal(checkRequestType('rendition-low.m3u8'), 'rendition');
  });
  it('returns rendition for rendition-high.m3u8', () => {
    assert.equal(checkRequestType('rendition-high.m3u8'), 'rendition');
  });
  it('returns dash-manifest for media.mpd', () => {
    assert.equal(checkRequestType('media.mpd'), 'dash-manifest');
  });
  it('returns undefined for other files', () => {
    assert.equal(checkRequestType('other.html'), undefined);
  });
});

describe('extractRenditionName', () => {
  it('returns null for rendition.m3u8', () => {
    assert.equal(extractRenditionName('rendition.m3u8'), null);
  });
  it('returns low for rendition-low.m3u8', () => {
    assert.equal(extractRenditionName('rendition-low.m3u8'), 'low');
  });
  it('returns high for rendition-high.m3u8', () => {
    assert.equal(extractRenditionName('rendition-high.m3u8'), 'high');
  });
  it('returns mid for rendition-mid.m3u8', () => {
    assert.equal(extractRenditionName('rendition-mid.m3u8'), 'mid');
  });
});

describe('resolveRenditions', () => {
  it('returns single default rendition when no renditions key', () => {
    const result = resolveRenditions({ operations: [] });
    assert.equal(result.length, 1);
    assert.equal(result[0].bandwidth, 2493700);
    assert.equal(result[0].resolution, '1280x720');
  });

  it('returns renditions array without per-rendition operations', () => {
    const spec = {
      renditions: [
        { name: 'low',  bandwidth: 400000,  resolution: '640x360' },
        { name: 'high', bandwidth: 5000000, resolution: '1920x1080' },
      ],
      operations: [{ op: 'playback', time: 30 }],
    };
    const result = resolveRenditions(spec);
    assert.equal(result.length, 2);
    assert.equal(result[0].name, 'low');
    assert.equal(result[1].name, 'high');
  });
});

describe('resolveRenditionErrors', () => {
  it('returns empty playlist and segment maps when no rendition errors', () => {
    const ops = [{ op: 'startup', delay: 5 }, { op: 'playback', time: 30 }];
    assert.deepEqual(resolveRenditionErrors(ops), { playlist: {}, segment: {} });
  });

  it('puts error with no "on" field into playlist', () => {
    const ops = [
      { op: 'playback', time: 30 },
      { op: 'error', code: 404, rendition: 'low' },
    ];
    assert.deepEqual(resolveRenditionErrors(ops), { playlist: { low: 404 }, segment: {} });
  });

  it('puts error with on:playlist into playlist', () => {
    const ops = [{ op: 'error', code: 404, rendition: 'low', on: 'playlist' }];
    assert.deepEqual(resolveRenditionErrors(ops), { playlist: { low: 404 }, segment: {} });
  });

  it('puts error with on:segment into segment', () => {
    const ops = [{ op: 'error', code: 503, rendition: 'mid', on: 'segment' }];
    assert.deepEqual(resolveRenditionErrors(ops), { playlist: {}, segment: { mid: 503 } });
  });

  it('defaults to 500 when no code specified', () => {
    const ops = [{ op: 'error', rendition: 'low' }];
    assert.deepEqual(resolveRenditionErrors(ops), { playlist: { low: 500 }, segment: {} });
  });

  it('handles multiple rendition errors across both targets', () => {
    const ops = [
      { op: 'error', code: 404, rendition: 'low' },
      { op: 'error', code: 503, rendition: 'mid', on: 'segment' },
    ];
    assert.deepEqual(resolveRenditionErrors(ops), { playlist: { low: 404 }, segment: { mid: 503 } });
  });

  it('returns empty maps for null operations', () => {
    assert.deepEqual(resolveRenditionErrors(null), { playlist: {}, segment: {} });
  });
});

describe('extractRenditionFromSegment', () => {
  it('returns rendition and segment for rendition-low-0.ts', () => {
    assert.deepEqual(extractRenditionFromSegment('rendition-low-0.ts'), { rendition: 'low', segment: 0 });
  });
  it('returns rendition and segment for rendition-high-5.ts', () => {
    assert.deepEqual(extractRenditionFromSegment('rendition-high-5.ts'), { rendition: 'high', segment: 5 });
  });
  it('returns rendition and segment for rendition-mid-2.m4s', () => {
    assert.deepEqual(extractRenditionFromSegment('rendition-mid-2.m4s'), { rendition: 'mid', segment: 2 });
  });
  it('returns null rendition for plain 0.ts', () => {
    assert.deepEqual(extractRenditionFromSegment('0.ts'), { rendition: null, segment: 0 });
  });
  it('returns null rendition for plain 6.m4s', () => {
    assert.deepEqual(extractRenditionFromSegment('6.m4s'), { rendition: null, segment: 6 });
  });
  it('returns null segment for unrecognized filename', () => {
    assert.deepEqual(extractRenditionFromSegment('other.ts'), { rendition: null, segment: null });
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
  it('adds bandwidth entry to timeline', () => {
    const timeline = createSegmentTimeline([
      { op: 'bandwidth', kbps: 300 },
      { op: 'startup', delay: 5 },
      { op: 'playback', time: 30 },
    ]);
    assert.deepEqual(timeline, [
      { segment: 0, bandwidthKbps: 300 },
      { segment: 0, delay: 5 },
    ]);
  });
  it('skips rendition-targeted error ops', () => {
    const timeline = createSegmentTimeline([
      { op: 'playback', time: 30 },
      { op: 'error', code: 404, rendition: 'low' },
    ]);
    assert.deepEqual(timeline, []);
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
