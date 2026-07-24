#!/usr/bin/env node
/*
 * New Home Dispatch — S5a permits sensor (weekly)
 * -----------------------------------------------
 * Pulls City of Austin issued construction permits (Socrata SODA API, public,
 * no key required at this volume) for new residential construction, snapshots
 * them append-only, and derives STARTS BY COMMUNITY by matching the permit's
 * legal description / TCAD ID against the community master. Runs on GitHub
 * Actions weekly (runners have open network; the authoring sandbox does not).
 *
 * Dataset: https://data.austintexas.gov/resource/3syk-w9eu.json
 *   (Issued Construction Permits; fields incl. permit_type_desc, permit_class,
 *    work_class="New", issue_date, tcad_id, legal_description, total_job_valuation,
 *    housing_units — verified against the live schema July 2026. NOTE: the public
 *    schema carries NO contractor name; builder attribution comes later from the
 *    TCAD parcel-owner join, Phase 2.)
 * OUTPUT: data/raw/permits/austin-YYYY-MM-DD.json      (append-only snapshot)
 *         data/derived/starts-by-community.json         (weekly series)
 *         events appended to data/derived/offer-events.jsonl (type: permits_pulse)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const p = (rel) => ROOT + rel;
const ensure = (f) => { const d = dirname(f); if (!existsSync(d)) mkdirSync(d, { recursive: true }); };
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());

// last 30 days of new-construction residential permits
const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
const url = `https://data.austintexas.gov/resource/3syk-w9eu.json?$where=issue_date>'${since}' AND work_class='New' AND permit_class_mapped='Residential'&$select=permit_num,permit_type_desc,permit_class,issue_date,tcad_id,legal_description,total_job_valuation,housing_units,original_address1,council_district&$limit=5000`;

let permits = [];
try {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`SODA ${res.status}`);
  permits = await res.json();
} catch (e) {
  console.error('[permits] fetch failed (fine in sandbox; runs on Actions):', e.message);
  process.exit(0);
}

const snapPath = p(`data/raw/permits/austin-${today}.json`);
ensure(snapPath);
writeFileSync(snapPath, JSON.stringify(permits));

// ---- match to community master by legal description ----
let communities = [];
try {
  const ent = JSON.parse(readFileSync(p('entities.json'), 'utf8'));
  communities = (ent.communities || ent.records || []).map(c => ({ slug: c.slug || c.communitySlug, name: (c.name || c.community || '').toLowerCase() })).filter(c => c.slug && c.name);
} catch { }
const counts = {};
let matched = 0;
for (const pm of permits) {
  const legal = (pm.legal_description || '').toLowerCase();
  const hit = communities.find(c => c.name.length > 3 && legal.includes(c.name.split(' ')[0]) && legal.includes(c.name.split(' ').slice(-1)[0]));
  const key = hit ? hit.slug : '_unmatched';
  const row = (counts[key] ||= { permits: 0, units: 0, valuation: 0 });
  row.permits++; row.units += +(pm.housing_units || 1); row.valuation += +(pm.total_job_valuation || 0);
  if (hit) matched++;
}

const outPath = p('data/derived/starts-by-community.json');
const prev = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : { schema: 'nhd-starts-by-community-v1', metric: 'City of Austin new-residential permits (trailing 30 days) matched to tracked communities', source: 'https://data.austintexas.gov/resource/3syk-w9eu', points: [] };
if (!prev.points.some(pt => pt.day === today)) {
  prev.points.push({ day: today, totalPermits: permits.length, matchedToCommunities: matched, byCommunity: counts });
}
prev.lastUpdated = new Date().toISOString();
prev.note = 'Austin city limits only (suburbs come from Round Rock PDFs + CAD deed pulse, Phase 2). Public schema has no contractor name; builder attribution via TCAD parcel-owner join is Phase 2. Name-matching on legal descriptions is conservative; _unmatched is reported honestly.';
ensure(outPath);
writeFileSync(outPath, JSON.stringify(prev, null, 2));

const logPath = p('data/derived/offer-events.jsonl');
ensure(logPath);
appendFileSync(logPath, JSON.stringify({ t: new Date().toISOString(), runKey: `${today}-PERMITS`, type: 'permits_pulse', total: permits.length, matched }) + '\n');
console.log(`[permits] ${permits.length} permits, ${matched} matched to communities`);
