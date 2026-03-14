const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildMasterPlaylist, buildRenditionPlaylist, buildDashMPD } = require('./manifest');

describe('buildMasterPlaylist', () => {
  it('starts with #EXTM3U and version tag', () => {
    const result = buildMasterPlaylist([{ name: 'low', bandwidth: 400000, resolution: '640x360' }]);
    assert.ok(result.startsWith('#EXTM3U\n#EXT-X-VERSION:7'));
  });

  it('includes STREAM-INF with bandwidth and resolution', () => {
    const result = buildMasterPlaylist([{ name: 'low', bandwidth: 400000, resolution: '640x360' }]);
    assert.ok(result.includes('#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=640x360'));
  });

  it('uses default codecs when none specified', () => {
    const result = buildMasterPlaylist([{ name: 'low', bandwidth: 400000, resolution: '640x360' }]);
    assert.ok(result.includes('CODECS="mp4a.40.2,avc1.640020"'));
  });

  it('uses custom codecs when specified', () => {
    const result = buildMasterPlaylist([{ name: 'low', bandwidth: 400000, resolution: '640x360', codecs: 'avc1.42001f' }]);
    assert.ok(result.includes('CODECS="avc1.42001f"'));
  });

  it('uses rendition name in filename for named renditions', () => {
    const result = buildMasterPlaylist([{ name: 'high', bandwidth: 5000000, resolution: '1920x1080' }]);
    assert.ok(result.includes('rendition-high.m3u8'));
  });

  it('uses index-based filename for unnamed renditions', () => {
    const result = buildMasterPlaylist([{ bandwidth: 400000, resolution: '640x360' }]);
    assert.ok(result.includes('rendition-0.m3u8'));
  });

  it('includes all renditions for multiple entries', () => {
    const renditions = [
      { name: 'low',  bandwidth: 400000,  resolution: '640x360' },
      { name: 'high', bandwidth: 5000000, resolution: '1920x1080' },
    ];
    const result = buildMasterPlaylist(renditions);
    assert.ok(result.includes('rendition-low.m3u8'));
    assert.ok(result.includes('rendition-high.m3u8'));
    assert.ok(result.includes('BANDWIDTH=400000'));
    assert.ok(result.includes('BANDWIDTH=5000000'));
  });
});

describe('buildRenditionPlaylist', () => {
  it('starts with #EXTM3U', () => {
    const result = buildRenditionPlaylist(6.006, 'low');
    assert.ok(result.startsWith('#EXTM3U'));
  });

  it('ends with #EXT-X-ENDLIST', () => {
    const result = buildRenditionPlaylist(6.006, 'low');
    assert.ok(result.endsWith('#EXT-X-ENDLIST'));
  });

  it('includes required HLS tags', () => {
    const result = buildRenditionPlaylist(6.006, 'low');
    assert.ok(result.includes('#EXT-X-PLAYLIST-TYPE:VOD'));
    assert.ok(result.includes('#EXT-X-MAP:URI="init.mp4"'));
    assert.ok(result.includes('#EXTINF:6.006,'));
  });

  it('generates correct number of segments for given media length', () => {
    const result = buildRenditionPlaylist(30.03, 'low'); // 5 segments
    const segmentCount = (result.match(/#EXTINF/g) || []).length;
    assert.equal(segmentCount, 5);
  });

  it('uses named segment filenames for named rendition', () => {
    const result = buildRenditionPlaylist(12.012, 'mid');
    assert.ok(result.includes('seg-mid-1.m4s'));
    assert.ok(result.includes('seg-mid-2.m4s'));
  });

  it('uses plain segment filenames for unnamed rendition', () => {
    const result = buildRenditionPlaylist(12.012, null);
    assert.ok(result.includes('seg-1.m4s'));
    assert.ok(result.includes('seg-2.m4s'));
    assert.ok(!result.includes('seg-null'));
  });

  it('segments are numbered sequentially from 1', () => {
    const result = buildRenditionPlaylist(18.018, 'low');
    assert.ok(result.includes('seg-low-1.m4s'));
    assert.ok(result.includes('seg-low-2.m4s'));
    assert.ok(result.includes('seg-low-3.m4s'));
  });
});

describe('buildDashMPD', () => {
  it('includes media presentation duration', () => {
    const result = buildDashMPD(30.03, [{ name: 'low', bandwidth: 400000, resolution: '640x360' }]);
    assert.ok(result.includes('mediaPresentationDuration="PT30.03S"'));
  });

  it('uses rendition name as representation id', () => {
    const result = buildDashMPD(30.03, [{ name: 'high', bandwidth: 5000000, resolution: '1920x1080' }]);
    assert.ok(result.includes('id="high"'));
  });

  it('uses 1-based index as representation id for unnamed renditions', () => {
    const result = buildDashMPD(30.03, [{ bandwidth: 400000, resolution: '640x360' }]);
    assert.ok(result.includes('id="1"'));
  });

  it('includes bandwidth and resolution for each rendition', () => {
    const result = buildDashMPD(30.03, [{ name: 'low', bandwidth: 400000, resolution: '640x360' }]);
    assert.ok(result.includes('bandwidth="400000"'));
    assert.ok(result.includes('width="640"'));
    assert.ok(result.includes('height="360"'));
  });

  it('includes all representations for multiple renditions', () => {
    const renditions = [
      { name: 'low',  bandwidth: 400000,  resolution: '640x360' },
      { name: 'high', bandwidth: 5000000, resolution: '1920x1080' },
    ];
    const result = buildDashMPD(30.03, renditions);
    assert.ok(result.includes('id="low"'));
    assert.ok(result.includes('id="high"'));
    assert.ok(result.includes('bandwidth="400000"'));
    assert.ok(result.includes('bandwidth="5000000"'));
  });

  it('includes segment template with correct timescale', () => {
    const result = buildDashMPD(30.03, [{ name: 'low', bandwidth: 400000, resolution: '640x360' }]);
    assert.ok(result.includes('duration="6006" timescale="1000"'));
  });
});
