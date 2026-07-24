#!/usr/bin/env node
/*
 * New Home Dispatch — MLS member-export ingester (PRIVATE lane)
 * -------------------------------------------------------------
 * Reads reporting/mls-export.csv (Pete's member export; see MLS-COMPLIANCE-LANE.md)
 * and writes ONLY under data-private/ (gitignored). This script structurally
 * refuses to write MLS-derived data anywhere public: every output path is
 * data-private/, and it ensures .gitignore contains data-private/ before writing.
 *
 * Outputs (internal only):
 *   data-private/mls/closings-YYYY-MM.json      raw-ish monthly closings snapshot
 *   data-private/derived/advertised-vs-sold.json  per community: advertised tape vs sold
 *   data-private/derived/incentive-to-close.json  event-aligned response series (accrues)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const p = (rel) => ROOT + rel;
const ensure = (f) => { const d = dirname(f); if (!existsSync(d)) mkdirSync(d, { recursive: true }); };

// ---- structural safety: enforce gitignore before any write ----
const giPath = p('.gitignore');
let gi = existsSync(giPath) ? readFileSync(giPath, 'utf8') : '';
if (!gi.split('\n').some(l => l.trim() === 'data-private/')) {
  writeFileSync(giPath, gi.trimEnd() + '\ndata-private/\n');
  console.log('[mls] added data-private/ to .gitignore');
}

const csvPath = p('reporting/mls-export.csv');
if (!existsSync(csvPath)) { console.log('[mls] no export present; nothing to ingest'); process.exit(0); }

function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (cur !== '' || row.length) { row.push(cur); rows.push(row); row = []; cur = ''; } }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const rows = parseCsv(readFileSync(csvPath, 'utf8'));
const header = rows[0].map(h => h.trim().toLowerCase());
const col = (r, name) => { const i = header.indexOf(name); return i >= 0 ? (r[i] || '').trim() : ''; };
const data = rows.slice(1).filter(r => r.length > 3 && col(r, 'new_construction').toLowerCase() === 'yes');

// entity spine for text matching
let communities = [];
try {
  const ent = JSON.parse(readFileSync(p('entities.json'), 'utf8'));
  communities = (ent.communities || ent.records || []).map(c => ({ slug: c.slug || c.communitySlug, name: (c.name || c.community || '').toLowerCase() })).filter(c => c.slug && c.name);
} catch { }
const matchCommunity = (txt) => {
  const t = (txt || '').toLowerCase();
  const hit = communities.find(c => t.includes(c.name) || c.name.includes(t));
  return hit ? hit.slug : null;
};

const closings = data.map(r => ({
  closeDate: col(r, 'close_date'), listDate: col(r, 'list_date'),
  community: col(r, 'community_slug') || matchCommunity(col(r, 'subdivision')) || '_unmatched',
  builder: col(r, 'builder_slug') || (col(r, 'builder') || '').toLowerCase().replace(/[^a-z0-9]+/g, '-') || '_unknown',
  listPrice: +col(r, 'list_price') || null, closePrice: +col(r, 'close_price') || null,
  sqft: +col(r, 'sqft') || null, dom: +col(r, 'dom') || null,
  concessions: col(r, 'seller_concessions_yn').toLowerCase() === 'yes'
}));

const month = new Date().toISOString().slice(0, 7);
ensure(p(`data-private/mls/closings-${month}.json`));
writeFileSync(p(`data-private/mls/closings-${month}.json`), JSON.stringify({ pulled: new Date().toISOString(), rows: closings }, null, 2));

// ---- advertised vs sold, per community ----
let adv = {};
try {
  const inc = JSON.parse(readFileSync(p('incentives.json'), 'utf8'));
  for (const r of inc.records || []) adv[r.communitySlug] = { builder: r.builderSlug, advertisedValue: r.advertisedValue };
} catch { }
const byComm = {};
for (const c of closings) {
  if (c.community === '_unmatched' || !c.closePrice || !c.listPrice) continue;
  const g = (byComm[c.community] ||= { n: 0, sumRatio: 0, sumSpread: 0, withConcessions: 0 });
  g.n++; g.sumRatio += c.closePrice / c.listPrice; g.sumSpread += c.listPrice - c.closePrice;
  if (c.concessions) g.withConcessions++;
}
const avs = Object.entries(byComm).map(([slug, g]) => ({
  community: slug, closings: g.n,
  medianishCloseToList: +((g.sumRatio / g.n)).toFixed(3),
  avgListMinusClose: Math.round(g.sumSpread / g.n),
  concessionShare: +(g.withConcessions / g.n).toFixed(2),
  advertisedNow: adv[slug] || null
}));
ensure(p('data-private/derived/advertised-vs-sold.json'));
writeFileSync(p('data-private/derived/advertised-vs-sold.json'), JSON.stringify({
  schema: 'nhd-advertised-vs-sold-v1-PRIVATE',
  boundary: 'INTERNAL ONLY. MLS-derived. Never publish or commit publicly; see MLS-COMPLIANCE-LANE.md.',
  generated: new Date().toISOString(), communities: avs
}, null, 2));
console.log(`[mls] ${closings.length} new-construction closings ingested (${avs.length} communities), all under data-private/`);
