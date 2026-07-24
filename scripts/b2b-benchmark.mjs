#!/usr/bin/env node
/*
 * New Home Dispatch — B2B analytics generator (products 1 and 2 of the Directive)
 * -------------------------------------------------------------------------------
 * From the live tape and derived metrics, generates:
 *   data/derived/b2b/builder-benchmark.json   product 1: per-builder competitive
 *     percentiles (depth, breadth, rate aggressiveness, lender-tie, deadline
 *     honesty) plus the weekly moves feed
 *   data/derived/b2b/concession-timeline.json product 2: per-community dated
 *     concession history from the append-only record histories (the appraiser
 *     lookup seed; grows richer as the raw archive accrues)
 *
 * Laws honored: derived analytics only (no raw pages reproduced); consumer
 * surfaces publish first (this runs after the consumer derive step); honest
 * sample labels everywhere; buyers get no editorial say and the output says so.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const p = (rel) => ROOT + rel;
const ensure = (f) => { const d = dirname(f); if (!existsSync(d)) mkdirSync(d, { recursive: true }); };
const load = (rel, fb) => existsSync(p(rel)) ? JSON.parse(readFileSync(p(rel), 'utf8')) : fb;

const inc = load('incentives.json', { records: [] });
const renewal = load('data/derived/renewal-ledger.json', { builders: {} });
const logPath = p('data/derived/offer-events.jsonl');
const log = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const records = inc.records || [];
const DISCLOSURE = 'Independent analytics derived from publicly advertised offers. Benchmark subscribers have no influence on New Home Dispatch editorial coverage. Sample sizes are labeled; verify all figures with the builder before acting.';

const rateRx = /(\d\.\d{1,3})\s?%/;
const builders = [...new Set(records.map(r => r.builderSlug))];
const pctRank = (arr, v) => arr.length > 1 ? Math.round((arr.filter(x => x < v).length / (arr.length - 1)) * 100) : 50;

const rows = builders.map(slug => {
  const recs = records.filter(r => r.builderSlug === slug);
  const depth = Math.max(...recs.map(r => r.advertisedValue || 0));
  const breadth = new Set(recs.map(r => r.communitySlug)).size;
  const rates = recs.map(r => (`${r.incentiveType || ''} ${r.note || ''}`.match(rateRx) || [])[1]).filter(Boolean).map(Number);
  const bestRate = rates.length ? Math.min(...rates) : null;
  const tied = recs.length ? recs.filter(r => r.lenderTied).length / recs.length : null;
  const rl = renewal.builders[slug] || {};
  return { builder: slug, offers: recs.length, communities: breadth, maxAdvertisedValue: depth, bestAdvertisedRate: bestRate, lenderTiedShare: tied === null ? null : +tied.toFixed(2), deadlineExtensions: rl.deadlineExtensions || 0, expiredButDisplayed: rl.expiredButDisplayedObservations || 0 };
});
const depths = rows.map(r => r.maxAdvertisedValue);
const ratesAll = rows.map(r => r.bestAdvertisedRate).filter(v => v !== null);
for (const r of rows) {
  r.percentiles = {
    incentiveDepth: pctRank(depths, r.maxAdvertisedValue),
    rateAggressiveness: r.bestAdvertisedRate !== null ? 100 - pctRank(ratesAll, r.bestAdvertisedRate) : null
  };
  r.deadlineHonesty = (r.deadlineExtensions + r.expiredButDisplayed) === 0 ? 'clean so far' : 'extensions or post-deadline display observed';
}
// weekly moves feed from the event log (last 7 days)
const wk = Date.now() - 7 * 864e5;
const moves = log.filter(e => Date.parse(e.t) > wk && ['value_changed', 'offer_added', 'offer_removed', 'deadline_extended', 'expired_but_displayed'].includes(e.type));

ensure(p('data/derived/b2b/builder-benchmark.json'));
writeFileSync(p('data/derived/b2b/builder-benchmark.json'), JSON.stringify({
  schema: 'nhd-builder-benchmark-v1', product: 'NHD Builder Benchmark (B2B product 1)',
  disclosure: DISCLOSURE, generated: new Date().toISOString(),
  sample: { verifiedOffers: records.length, builders: builders.length, label: records.length < 30 ? 'PILOT SAMPLE: verified tracked offers only; broaden before external sale' : 'production' },
  benchmark: rows.sort((a, b) => b.percentiles.incentiveDepth - a.percentiles.incentiveDepth),
  weeklyMoves: moves
}, null, 2));

// ---- product 2: concession timeline per community ----
const byComm = {};
for (const r of records) {
  const c = (byComm[r.communitySlug] ||= { community: r.community, city: r.city, entries: [] });
  for (const h of (r.history || [])) c.entries.push({ date: h.date, builder: r.builderSlug, advertisedValue: h.value, incentiveType: r.incentiveType, lenderTied: r.lenderTied });
}
for (const c of Object.values(byComm)) c.entries.sort((a, b) => a.date.localeCompare(b.date));
ensure(p('data/derived/b2b/concession-timeline.json'));
writeFileSync(p('data/derived/b2b/concession-timeline.json'), JSON.stringify({
  schema: 'nhd-concession-timeline-v1', product: 'NHD Concession History Lookup (B2B product 2, appraiser seed)',
  disclosure: DISCLOSURE + ' Advertised concessions are builder claims on the stated dates, captured by the sweep; they are not closed-transaction terms.',
  generated: new Date().toISOString(),
  note: 'Grows from the append-only raw archive; each sweep adds dated observations. The history is unreconstructable by anyone starting later.',
  communities: byComm
}, null, 2));
console.log(`[b2b] benchmark: ${rows.length} builders, ${moves.length} weekly moves; timeline: ${Object.keys(byComm).length} communities`);
