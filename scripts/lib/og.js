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

// The wax seal behind the "AI" initials (100x100 box); the same artwork is inlined in site/css/site.css.
const SEAL = `<defs><radialGradient id='g' cx='36%' cy='30%' r='78%'><stop offset='0' stop-color='#cf4a30'/><stop offset='.55' stop-color='#a52d1c'/><stop offset='1' stop-color='#74200f'/></radialGradient></defs><path d='M94.1 50.0C94.2 54.0 92.4 58.0 91.4 62.2C90.5 66.3 90.8 71.4 88.5 74.8C86.3 78.1 81.3 79.6 78.0 82.3C74.7 85.1 72.4 89.2 68.8 91.1C65.2 93.0 60.4 93.7 56.3 93.9C52.2 94.0 48.1 92.7 43.9 92.3C39.8 91.8 34.9 92.6 31.3 91.0C27.7 89.3 25.2 85.0 22.1 82.2C19.0 79.4 14.6 77.5 12.4 74.1C10.2 70.8 9.9 66.1 9.0 62.0C8.1 58.0 7.4 54.1 7.1 50.0C6.8 45.9 6.6 41.6 7.2 37.4C7.8 33.2 8.3 28.1 10.7 24.8C13.1 21.4 18.3 19.9 21.8 17.5C25.3 15.1 28.3 12.5 31.9 10.4C35.5 8.3 39.4 6.0 43.5 4.8C47.6 3.6 52.5 2.5 56.7 3.2C61.0 3.8 65.1 6.5 68.9 8.7C72.6 10.9 75.6 13.8 79.1 16.4C82.6 19.0 88.0 20.7 89.9 24.3C91.9 27.9 90.2 33.7 90.9 38.0C91.6 42.3 94.0 46.0 94.1 50.0Z' fill='url(#g)'/><circle cx='50' cy='50' r='34' fill='none' stroke='#000' stroke-opacity='.3' stroke-width='2.4'/><circle cx='50.9' cy='51' r='34' fill='none' stroke='#fff' stroke-opacity='.2' stroke-width='1.6'/>`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Rendered width in px of one line of text. */
function measure(text, size, weight, family = HEADLINE_FAMILY) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="${size * 2}"><text x="0" y="${size * 1.2}" font-family="${family}" font-weight="${weight}" font-size="${size}" xml:space="preserve">${esc(text)}</text></svg>`;
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

/** "AI" in a wax seal, then "Broadside" in blackletter, centred as a pair. */
function nameplate() {
  const size = 92;
  const seal = 112;
  const gap = 22;
  const textWidth = measure('Broadside', size, 700, 'UnifrakturCook');
  const x0 = Math.round((OG_WIDTH - (seal + gap + textWidth)) / 2);
  const cy = 112;
  return `<g transform="translate(${x0} ${cy - seal / 2}) scale(${seal / 100})">${SEAL}</g>
  <text x="${x0 + seal / 2}" y="${cy + 15}" font-family="${HEADLINE_FAMILY}" font-size="44" letter-spacing="1" fill="#f8efdb" text-anchor="middle">AI</text>
  <text x="${x0 + seal + gap}" y="140" font-family="UnifrakturCook" font-weight="700" font-size="${size}" fill="#231c14">Broadside</text>`;
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
  ${nameplate()}
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
