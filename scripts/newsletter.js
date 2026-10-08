#!/usr/bin/env node
// Turns the published edition into a Buttondown email and saves it as a DRAFT. It never sends: you review and send from Buttondown.
//   node scripts/newsletter.js [--date YYYY-MM-DD] [--dry-run]
//   node scripts/newsletter.js --weekly [--date YYYY-MM-DD] [--dry-run]    Sunday digest: the week's 10 highest totals + the longest-running trending cluster
// --dry-run writes the Markdown to data/work/<date>.newsletter.md (or .weekly.md) and does not touch the network.
// BUTTONDOWN_API_KEY comes from the environment only and is never printed.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SITE_URL as CONFIG_SITE_URL } from '../site/config.js';
import { editionDate } from './lib/dates.js';
import { createDraft, dailyMarkdown, dailySubject, weeklyMarkdown, weeklySubject, weeklyTop, wordCount } from './lib/newsletter.js';
import { root } from './lib/schemas.js';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueOf = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const die = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

const dryRun = flag('--dry-run');
const weekly = flag('--weekly');
const date = valueOf('--date') ?? editionDate();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die(`--date must be YYYY-MM-DD, got "${date}".`);

const siteUrl = (process.env.SITE_URL ?? CONFIG_SITE_URL).replace(/\/+$/, '');
if (siteUrl.includes('YOUR_DOMAIN')) {
  if (!dryRun) die('SITE_URL is still the placeholder (site/config.js), so the email would link to nowhere. Set it, or use --dry-run.');
  console.log('note: SITE_URL is still the placeholder; the footer links will not resolve yet.');
}

const readJson = (file) => readFile(path.join(root, file), 'utf8').then(JSON.parse);

let subject;
let body;
let marker;
let outFile;
if (!weekly) {
  const edition = await readJson('data/latest.json').catch(() => die('data/latest.json is missing or unreadable. Publish an edition first.'));
  if (edition.date !== date) die(`data/latest.json is the ${edition.date} edition, not ${date}. Nothing was drafted.`);
  subject = dailySubject(edition);
  body = dailyMarkdown(edition, { siteUrl });
  marker = `daily:${date}`;
  outFile = `data/work/${date}.newsletter.md`;
} else {
  // The seven edition days ending on `date`.
  const end = new Date(`${date}T12:00:00Z`);
  const days = new Set(Array.from({ length: 7 }, (_, i) => new Date(end - i * 86400000).toISOString().slice(0, 10)));
  const names = (await readdir(path.join(root, 'data/editions'))).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && days.has(f.slice(0, 10))).sort();
  if (!names.length) die(`No editions found for the week ending ${date}.`);
  const editions = await Promise.all(names.map((f) => readJson(`data/editions/${f}`)));
  subject = weeklySubject(weeklyTop(editions));
  body = weeklyMarkdown(editions, date, { siteUrl });
  marker = `weekly:${date}`;
  outFile = `data/work/${date}.weekly.md`;
}

console.log(`Subject: ${subject}\nWords:   ${wordCount(body)}`);

if (dryRun) {
  await mkdir(path.join(root, 'data/work'), { recursive: true });
  await writeFile(path.join(root, outFile), body);
  console.log(`Dry run: wrote ${outFile}. Nothing was sent to Buttondown.`);
} else {
  try {
    const draft = await createDraft({ subject, body, marker }, { apiKey: process.env.BUTTONDOWN_API_KEY });
    console.log(`Draft ${draft.action} in Buttondown: ${draft.id}${draft.url ? `\n${draft.url}` : ''}\nIt has NOT been sent. Review and send it from Buttondown.`);
  } catch (e) {
    die(e.message);
  }
}
