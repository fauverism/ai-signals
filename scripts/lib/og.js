// The 1200x630 social preview image: an SVG built here and rendered to PNG with resvg (no browser involved).
// SVG has no text wrapping, so lines are wrapped by measuring real glyph widths with the bundled Abril Fatface.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const fontsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/fonts');
const FONT = {
  fontFiles: ['AbrilFatface-Regular', 'UnifrakturCook-Bold', 'LibreCaslonText-Regular', 'LibreCaslonText-Italic', 'LibreCaslonText-Bold'].map((f) => path.join(fontsDir, `${f}.ttf`)),
  loadSystemFonts: true, // fallback only, for glyphs the bundled fonts lack
  defaultFontFamily: 'Libre Caslon Text',
};
const HEADLINE_FAMILY = 'Abril Fatface';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Rendered width in px of one line of text. */
function measure(text, size, weight) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="${size * 2}"><text x="0" y="${size * 1.2}" font-family="${HEADLINE_FAMILY}" font-weight="${weight}" font-size="${size}" xml:space="preserve">${esc(text)}</text></svg>`;
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
export function fitHeadline(text, { maxWidth = 1040, maxHeight = 262, sizes = [64, 58, 52, 48, 44, 40], lineHeight = 1.12 } = {}) {
  for (const size of sizes) {
    const lines = wrap(text, size, 400, maxWidth);
    if (lines.length * size * lineHeight <= maxHeight) return { size, lines, lineHeight };
  }
  const size = sizes.at(-1);
  const max = Math.floor(maxHeight / (size * lineHeight));
  const lines = wrap(text, size, 400, maxWidth).slice(0, max);
  let last = lines.at(-1);
  while (last.length > 1 && measure(`${last}…`, size, 400) > maxWidth) last = last.slice(0, -1).trimEnd();
  lines[lines.length - 1] = `${last}…`;
  return { size, lines, lineHeight };
}

export function ogSvg({ dateLabel, headline, tagline }) {
  const fit = fitHeadline(headline);
  const top = 268;
  const lines = fit.lines
    .map((line, i) => `<text x="${OG_WIDTH / 2}" y="${Math.round(top + fit.size * 0.85 + i * fit.size * fit.lineHeight)}" font-family="${HEADLINE_FAMILY}" font-size="${fit.size}" fill="#231c14" text-anchor="middle">${esc(line)}</text>`)
    .join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}" font-family="Libre Caslon Text">
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#f3ead3"/>
  <rect x="22" y="22" width="${OG_WIDTH - 44}" height="${OG_HEIGHT - 44}" fill="none" stroke="#231c14" stroke-width="4"/>
  <rect x="34" y="34" width="${OG_WIDTH - 68}" height="${OG_HEIGHT - 68}" fill="none" stroke="#231c14" stroke-width="1.5"/>
  <text x="${OG_WIDTH / 2}" y="140" font-family="UnifrakturCook" font-weight="700" font-size="92" fill="#231c14" text-anchor="middle"><tspan font-family="${HEADLINE_FAMILY}" font-weight="400" font-size="76" letter-spacing="2" dx="-6">AI</tspan><tspan dx="16">Broadside</tspan></text>
  <line x1="72" y1="168" x2="${OG_WIDTH - 72}" y2="168" stroke="#231c14" stroke-width="4"/>
  <line x1="72" y1="177" x2="${OG_WIDTH - 72}" y2="177" stroke="#231c14" stroke-width="1.5"/>
  <text x="${OG_WIDTH / 2}" y="214" font-size="24" letter-spacing="3" fill="#231c14" text-anchor="middle">${esc(dateLabel.toUpperCase())}</text>
  <line x1="72" y1="232" x2="${OG_WIDTH - 72}" y2="232" stroke="#231c14" stroke-width="1.5"/>
  ${lines}
  <text x="${OG_WIDTH / 2}" y="572" font-style="italic" font-size="26" fill="#a52d1c" text-anchor="middle">${esc(tagline)}</text>
</svg>`;
}

/** @returns {Buffer} PNG bytes */
export function renderOg(input) {
  return new Resvg(ogSvg(input), { font: FONT, fitTo: { mode: 'width', value: OG_WIDTH } }).render().asPng();
}
