// Rules JSON Schema can't express (ids, slots, references, ordering), shared by validate.js and rank.js.
import { createHash } from 'node:crypto';
import path from 'node:path';

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

export function semanticErrors(kind, data, file) {
  const errs = [];
  const checkId = (item, where) => {
    if (item.id !== sha1(item.canonicalUrl)) errs.push(`${where}: id is not the sha1 of canonicalUrl`);
  };
  if (kind === 'raw-file') {
    data.forEach((item, i) => checkId(item, `[${i}]`));
    return errs;
  }
  if (kind === 'deduped') {
    const ids = new Set();
    data.items.forEach((it, i) => {
      checkId(it, `items[${i}]`);
      if (ids.has(it.id)) errs.push(`items[${i}]: duplicate id`);
      ids.add(it.id);
    });
    data.clusters.forEach((c, i) => {
      for (const id of c.itemIds) if (!ids.has(id)) errs.push(`clusters[${i}]: itemId ${id} not in items`);
      if (!c.itemIds.includes(c.leadItemId)) errs.push(`clusters[${i}]: leadItemId is not in itemIds`);
    });
    const clusterIds = new Set(data.clusters.map((c) => c.id));
    for (const it of data.items) if (it.clusterId && !clusterIds.has(it.clusterId)) errs.push(`item ${it.id}: unknown clusterId`);
    if (data.items.length > data.params.cap) errs.push('more items than the cap');
    return errs;
  }
  if (kind === 'sources') {
    const seen = new Set();
    data.forEach((s, i) => {
      if (seen.has(s.id)) errs.push(`[${i}]: duplicate id ${s.id}`);
      seen.add(s.id);
    });
    return errs;
  }
  if (kind === 'keywords' || kind === 'batch' || kind === 'scored' || kind === 'dropped') return errs;
  if (kind === 'archive') {
    for (let i = 1; i < data.length; i++) {
      if (data[i - 1].date <= data[i].date) errs.push(`[${i}]: not newest first / duplicate date ${data[i].date}`);
    }
    return errs;
  }

  // edition
  const stamp = path.basename(file).match(/(\d{4}-\d{2}-\d{2})\.json$/)?.[1];
  if (stamp && stamp !== data.date) errs.push(`date ${data.date} does not match filename ${stamp}`);

  const pool = new Map();
  const add = (item, where, slot) => {
    checkId(item, where);
    if (slot && item.featuredSlot !== slot) errs.push(`${where}: featuredSlot is ${item.featuredSlot}, expected ${slot}`);
    pool.set(item.id, item);
  };
  add(data.lead, 'lead', 'lead');
  data.top.forEach((it, i) => add(it, `top[${i}]`, 'top'));
  data.innovations.forEach((it, i) => add(it, `innovations[${i}]`, 'innovation'));
  for (const [cat, items] of Object.entries(data.byCategory)) {
    items.forEach((it, i) => {
      add(it, `byCategory.${cat}[${i}]`);
      if (it.category !== cat) errs.push(`byCategory.${cat}[${i}]: category is ${it.category}`);
    });
  }
  if (new Set(data.top.map((it) => it.id)).size !== data.top.length) errs.push('top: duplicate items');
  data.trending.forEach((c, i) => {
    for (const id of c.itemIds) if (!pool.has(id)) errs.push(`trending[${i}]: itemId ${id} not found in this edition`);
    if (!c.itemIds.includes(c.leadItemId)) errs.push(`trending[${i}]: leadItemId is not in itemIds`);
  });
  const { collected, afterDedupe, ranked } = data.stats;
  if (!(collected >= afterDedupe && afterDedupe >= ranked)) errs.push('stats: need collected >= afterDedupe >= ranked');
  return errs;
}
