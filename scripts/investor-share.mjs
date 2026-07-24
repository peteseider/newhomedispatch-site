#!/usr/bin/env node
/*
 * New Home Dispatch — investor ownership sensor (CAD owner classification)
 * ------------------------------------------------------------------------
 * Who actually owns the neighborhood: classifies appraisal-roll owner names
 * per community into owner-occupant vs investor classes, producing the
 * investor-share metric that feeds BOTH the consumer Community Report Card
 * and B2B product 5 (Investor Intelligence).
 *
 * INPUT: data-sources/cad/*.csv  (county appraisal roll exports dropped in by
 *   a fetch step or by hand; column names vary by county, mapped below).
 *   Expected columns (case-insensitive, best-effort): owner_name, situs or
 *   address, subdivision or legal_description, mail_address (optional).
 * OUTPUT: data/derived/investor-share.json  per community: parcel count,
 *   investor share by class, absentee share (mail != situs), sample label.
 *
 * Classifier: transparent rule tiers, exported for testing.
 *   T1 named national SFR/BTR/iBuyer operators (exact-ish list)
 *   T2 builder-owned (matches the builder master: unsold inventory, not investors)
 *   T3 entity forms: LLC, LP, LTD, INC, CORP, TRUST (non-family), LLLP, REIT
 *   T4 absentee individual (mailing address differs from situs) = small investor proxy
 *   else owner-occupant presumption
 * Honesty: this measures OWNERSHIP STRUCTURE from public rolls, not intent;
 * family trusts inflate T3 slightly and the notes say so.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const p = (rel) => ROOT + rel;
const ensure = (f) => { const d = dirname(f); if (!existsSync(d)) mkdirSync(d, { recursive: true }); };

export const SFR_OPERATORS = [
  'PROGRESS RESIDENTIAL', 'INVITATION HOMES', 'AMERICAN HOMES 4 RENT', 'AMH ', 'TRICON',
  'FIRSTKEY', 'MAIN STREET RENEWAL', 'AMHERST', 'MSR ', 'OPENDOOR', 'OFFERPAD', 'ZILLOW HOMES',
  'SFR JV', 'HOME PARTNERS', 'PATHWAY HOMES', 'DIVVY', 'ARRIVED', 'VINEBROOK', 'YIELDSTREET'
];
export const BUILDER_TOKENS = [
  'D R HORTON', 'DR HORTON', 'HORTON', 'LENNAR', 'PULTE', 'CENTEX', 'KB HOME', 'KBH', 'MERITAGE',
  'TAYLOR MORRISON', 'TOLL BROS', 'TOLL BROTHERS', 'TRI POINTE', 'M/I HOMES', 'MI HOMES',
  'CENTURY COMMUNITIES', 'LGI HOMES', 'ASHTON', 'BROHN', 'PERRY HOMES', 'DAVID WEEKLEY',
  'HIGHLAND HOMES', 'GEHAN', 'BROOKFIELD', 'CHESMAR', 'COVENTRY', 'DREES', 'STARLIGHT', 'PACESETTER'
];
export function classifyOwner(name = '', mailAddr = '', situsAddr = '') {
  const n = name.toUpperCase();
  if (SFR_OPERATORS.some(t => n.includes(t))) return 'sfr_operator';
  if (BUILDER_TOKENS.some(t => n.includes(t))) return 'builder_inventory';
  if (/\b(LLC|L L C|LP|LLP|LLLP|LTD|INC|CORP|COMPANY|PARTNERS|HOLDINGS|CAPITAL|PROPERTIES|INVESTMENTS|REIT|BORROWER)\b/.test(n)) return 'entity';
  if (/\b(TRUST|TR|TRUSTEE)\b/.test(n) && !/\b(FAMILY|LIVING|REV|REVOCABLE)\b/.test(n)) return 'trust';
  const mailCore = (mailAddr || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 18);
  const situsCore = (situsAddr || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 18);
  if (mailCore && situsCore && mailCore !== situsCore) return 'absentee_individual';
  return 'owner_occupant_presumed';
}

// ---- ingest whatever CAD exports are present ----
if (process.env.NHD_CLASSIFIER_ONLY === '1') { /* imported for tests */ }
else {
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
const dir = p('data-sources/cad');
if (!existsSync(dir)) { console.log('[investor] no data-sources/cad exports present; classifier ready, awaiting rolls'); process.exit(0); }
const files = readdirSync(dir).filter(f => f.endsWith('.csv'));
const FIELD = (h) => {
  const map = {};
  h.forEach((c, i) => {
    const k = c.trim().toLowerCase();
    if (/owner.*name|name.*owner|^owner$/.test(k)) map.owner = i;
    if (/subdivision|legal/.test(k) && map.legal === undefined) map.legal = i;
    if (/situs|prop.*addr|property.*address/.test(k) && map.situs === undefined) map.situs = i;
    if (/mail/.test(k) && map.mail === undefined) map.mail = i;
  });
  return map;
};
let communities = [];
try {
  const ent = JSON.parse(readFileSync(p('entities.json'), 'utf8'));
  communities = (ent.communities || ent.records || []).map(c => ({ slug: c.slug || c.communitySlug, name: (c.name || c.community || '').toLowerCase() })).filter(c => c.slug && c.name);
} catch { }
const stats = {};
let total = 0;
for (const f of files) {
  const rows = parseCsv(readFileSync(`${dir}/${f}`, 'utf8'));
  const m = FIELD(rows[0] || []);
  if (m.owner === undefined) { console.error(`[investor] ${f}: no owner column recognized, skipped`); continue; }
  for (const r of rows.slice(1)) {
    const legal = (r[m.legal] || '').toLowerCase();
    const hit = communities.find(c => c.name.length > 3 && legal.includes(c.name.split(' ')[0]) && legal.includes(c.name.split(' ').slice(-1)[0]));
    if (!hit) continue;
    const cls = classifyOwner(r[m.owner], m.mail !== undefined ? r[m.mail] : '', m.situs !== undefined ? r[m.situs] : '');
    const s = (stats[hit.slug] ||= { parcels: 0, sfr_operator: 0, builder_inventory: 0, entity: 0, trust: 0, absentee_individual: 0, owner_occupant_presumed: 0 });
    s.parcels++; s[cls]++; total++;
  }
}
const out = {
  schema: 'nhd-investor-share-v1',
  metric: 'Ownership structure per community from county appraisal rolls (public records)',
  generated: new Date().toISOString(),
  honesty: 'Measures ownership structure, not intent. Family trusts may inflate the trust/entity classes slightly; builder-owned parcels are unsold inventory, reported separately from investors. Absentee-individual uses mailing vs situs address as a small-investor proxy.',
  parcelsMatched: total,
  communities: Object.fromEntries(Object.entries(stats).map(([slug, s]) => {
    const inv = s.sfr_operator + s.entity + s.trust + s.absentee_individual;
    return [slug, { ...s, investorSharePct: s.parcels ? +((inv / s.parcels) * 100).toFixed(1) : null }];
  }))
};
ensure(p('data/derived/investor-share.json'));
writeFileSync(p('data/derived/investor-share.json'), JSON.stringify(out, null, 2));
console.log(`[investor] ${total} parcels classified across ${Object.keys(stats).length} communities from ${files.length} export(s)`);
}
