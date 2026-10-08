// The 1200x630 social preview image: an SVG built here and rendered to PNG with resvg (no browser involved).
// SVG has no text wrapping, so lines are wrapped by measuring real glyph widths with the bundled DM Sans.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const fontsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/fonts');
const FONT = {
  fontFiles: [path.join(fontsDir, 'DMSans-ExtraBold.ttf'), path.join(fontsDir, 'DMSans-Medium.ttf')],
  loadSystemFonts: true, // fallback only, for glyphs DM Sans lacks
  defaultFontFamily: 'DM Sans',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Rendered width in px of one line of text. */
function measure(text, size, weight) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="${size * 2}"><text x="0" y="${size * 1.2}" font-family="DM Sans" font-weight="${weight}" font-size="${size}" xml:space="preserve">${esc(text)}</text></svg>`;
  return new Resvg(svg, { font: FONT }).getBBox()?.width ?? 0;
}

/** Greedy word wrap to `maxWidth`; a single over-long word gets a line to itself. */
export function wrap(text, size, weight, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || measure(candidate, size, weight) <= maxWidth) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Largest size that fits the headline in the box; truncates with an ellipsis only as a last resort. */
export function fitHeadline(text, { maxWidth = 1056, maxHeight = 290, sizes = [76, 68, 60, 54, 48, 44], lineHeight = 1.14 } = {}) {
  for (const size of sizes) {
    const lines = wrap(text, size, 800, maxWidth);
    if (lines.length * size * lineHeight <= maxHeight) return { size, lines, lineHeight };
  }
  const size = sizes.at(-1);
  const max = Math.floor(maxHeight / (size * lineHeight));
  const lines = wrap(text, size, 800, maxWidth).slice(0, max);
  let last = lines.at(-1);
  while (last.length > 1 && measure(`${last}…`, size, 800) > maxWidth) last = last.slice(0, -1).trimEnd();
  lines[lines.length - 1] = `${last}…`;
  return { size, lines, lineHeight };
}

export function ogSvg({ dateLabel, headline, tagline }) {
  const fit = fitHeadline(headline);
  const top = 236;
  const lines = fit.lines
    .map((line, i) => `<text x="72" y="${Math.round(top + fit.size * 0.9 + i * fit.size * fit.lineHeight)}" font-size="${fit.size}" font-weight="800" fill="#e6e6e6">${esc(line)}</text>`)
    .join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}" font-family="DM Sans">
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#2a2830"/>
  <rect width="16" height="${OG_HEIGHT}" fill="#aa72f0"/>
  <circle cx="86" cy="92" r="14" fill="#aa72f0"/>
  <text x="114" y="106" font-size="44" font-weight="800" fill="#d5d5d5">AI Signal</text>
  <text x="${OG_WIDTH - 72}" y="104" font-size="28" font-weight="500" fill="#b4b3b9" text-anchor="end">${esc(dateLabel)}</text>
  <line x1="72" y1="160" x2="${OG_WIDTH - 72}" y2="160" stroke="#898989" stroke-width="2" opacity="0.5"/>
  ${lines}
  <text x="72" y="568" font-size="30" font-weight="500" fill="#aa72f0">${esc(tagline)}</text>
</svg>`;
}

/** @returns {Buffer} PNG bytes */
export function renderOg(input) {
  return new Resvg(ogSvg(input), { font: FONT, fitTo: { mode: 'width', value: OG_WIDTH } }).render().asPng();
}
