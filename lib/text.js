'use strict';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    const e = body.toLowerCase();
    if (e[0] === '#') {
      const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : match;
  });
}

/** Turn product/collection HTML into one line of plain text. */
function stripHtml(html) {
  if (!html) return '';
  const noBlocks = String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  const spaced = noBlocks.replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, ' ').replace(/<[^>]*>/g, ' ');
  return decodeEntities(spaced).replace(/\s+/g, ' ').trim();
}

/** Shorten to `max` characters, preferring a sentence boundary, then a word boundary. */
function truncate(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sentence = cut.lastIndexOf('. ');
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '') + '…';
}

/** Escape text for use inside a markdown link label. */
function mdLabel(s) {
  return String(s).replace(/[\[\]]/g, (m) => '\\' + m).replace(/\s+/g, ' ').trim();
}

/** Make a URL safe inside a markdown link destination. */
function mdUrl(u) {
  return String(u).replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20');
}

module.exports = { stripHtml, truncate, mdLabel, mdUrl, decodeEntities };
