const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadSpecification } = require('./app');

describe('loadSpecification', () => {
  it('loads operations from a named spec file', async () => {
    const ops = await loadSpecification('/example');
    assert.deepEqual(ops, [
      { op: 'startup', delay: 5 },
      { op: 'playback', time: 30 },
      { op: 'error', code: 404 },
    ]);
  });

  it('falls back to inline parsing when spec file does not exist', async () => {
    const ops = await loadSpecification('/s5-p30-e404');
    assert.deepEqual(ops, [
      { op: 'startup', delay: 5 },
      { op: 'playback', time: 30 },
      { op: 'error', code: 404 },
    ]);
  });

  it('handles filepath without leading slash', async () => {
    const ops = await loadSpecification('example');
    assert.deepEqual(ops, [
      { op: 'startup', delay: 5 },
      { op: 'playback', time: 30 },
      { op: 'error', code: 404 },
    ]);
  });
});
