const { segmentLength } = require('./logic');

const DEFAULT_CODECS = 'mp4a.40.2,avc1.640020';

function buildMasterPlaylist(renditions) {
  let playlist = '#EXTM3U\n#EXT-X-VERSION:7';
  renditions.forEach((r, i) => {
    const codecs = r.codecs || DEFAULT_CODECS;
    const renditionFile = r.name ? `rendition-${r.name}.m3u8` : `rendition-${i}.m3u8`;
    playlist += `\n\n#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${r.resolution},CODECS="${codecs}"\n${renditionFile}`;
  });
  return playlist;
}

function buildRenditionPlaylist(mediaLength, renditionName) {
  const header =
`#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:7
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-MAP:URI="init.mp4"`;

  let segments = '';
  for (let i = 0; i < mediaLength / segmentLength; i++) {
    const segFile = renditionName ? `seg-${renditionName}-${i+1}.m4s` : `seg-${i+1}.m4s`;
    segments += `\n#EXTINF:6.006,\n${segFile}`;
  }

  return header + segments + '\n#EXT-X-ENDLIST';
}

function buildDashMPD(mediaLength, renditions) {
  const representations = renditions.map((r, i) => {
    const [width, height] = r.resolution.split('x');
    const id = r.name || (i + 1);
    return `      <Representation id="${id}" bandwidth="${r.bandwidth}" codecs="avc1.640020" width="${width}" height="${height}"/>`;
  }).join('\n');

  return (
`<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT${mediaLength}S" minBufferTime="PT2S">
  <Period>
    <AdaptationSet mimeType="video/mp4" segmentAlignment="true">
      <SegmentTemplate initialization="init.mp4" media="seg-$Number$.m4s" duration="6006" timescale="1000" startNumber="1"/>
${representations}
    </AdaptationSet>
  </Period>
</MPD>`);
}

module.exports = { buildMasterPlaylist, buildRenditionPlaylist, buildDashMPD };
