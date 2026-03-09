const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadSpecification } = require('./app');

describe('loadSpecification', () => {
  it('loads operations from a named spec file', async () => {
    const spec = await loadSpecification('/example');
    assert.deepEqual(spec.operations, [
      { op: 'startup', delay: 5 },
      { op: 'playback', time: 30 },
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
      { op: 'playback', time: 30 },
      { op: 'error', code: 404 },
    ]);
  });

  it('loads named renditions from abr-example spec file', async () => {
    const spec = await loadSpecification('/abr-example');
    assert.equal(spec.renditions.length, 3);
    assert.equal(spec.renditions[0].name, 'low');
    assert.equal(spec.renditions[1].name, 'mid');
    assert.equal(spec.renditions[2].name, 'high');
  });

  it('loads rendition bandwidths from abr-example', async () => {
    const spec = await loadSpecification('/abr-example');
    assert.equal(spec.renditions[0].bandwidth, 400000);
    assert.equal(spec.renditions[1].bandwidth, 2493700);
    assert.equal(spec.renditions[2].bandwidth, 5000000);
  });

  it('resolves rendition errors from abr-example', async () => {
    const spec = await loadSpecification('/abr-example');
    assert.deepEqual(spec.renditionErrors, { playlist: { low: 404 }, segment: {} });
  });

  it('resolves segment rendition errors from abr-rendition-segment-error', async () => {
    const spec = await loadSpecification('/abr-rendition-segment-error');
    assert.deepEqual(spec.renditionErrors, { playlist: {}, segment: { low: 503 } });
  });

  it('global operations exclude rendition-targeted error ops', async () => {
    const spec = await loadSpecification('/abr-example');
    const hasRenditionOp = spec.operations.some(op => op.rendition);
    assert.equal(hasRenditionOp, false);
  });
});
