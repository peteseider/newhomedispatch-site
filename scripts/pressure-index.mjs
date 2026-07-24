#!/usr/bin/env node
/*
 * New Home Dispatch — Builder Pressure Index v0.1
 * -----------------------------------------------
 * The first composite: is this builder motivated right now?
 * Recomputed from derived data only (never from raw scrapes directly), with
 * per-component coverage flags and an overall maturity gate. Methodology:
 * see methodology-pressure-index.md — published before the index is.
 *
 * COMPONENTS (0-100 each, equal weights v0.1, weights are in the file):
 *   depth      advertised value vs the builder's own observed history
 *   urgency    deadline behavior: renewals + expired-but-displayed observations
 *   churn      offer change frequency (from completed spans)
 *   fiscal     proximity to the builder's fiscal quarter end (majors, verified FY ends)
 *   strings    lender-tie share (tied money = pushing its captive lender = motivated
 *              to move inventory, but worth less to the buyer; shown separately)
 * OUTPUT: data/derived/pressure-index.json
 * HONESTY: components with no data are null and excluded from the average;
 * builders with < 2 live components are listed as "insufficient data", and the
 * whole index carries mature:false until the event log passes 28 days.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const p = (rel) => ROOT + rel;
const ensure = (f) => { const d = dirname(f); if (!existsSync(d)) mkdirSync(d, { recursive: true }); };
const load = (rel, fb) => existsSync(p(rel)) ? JSON.parse(readFileSync(p(rel), 'utf8')) : fb;

const inc = load('incentives.json', { records: [] });
const renewal = load('data/derived/renewal-ledger.json', { builders: {}, observationRuns: 0 });
const halfLife = load('data/derived/half-life.json', { byBuilder: {}, mature: false });
const logPath = p('data/derived/offer-events.jsonl');
const log = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];

// verified fiscal year ends (month-day) for the majors; sources in the methodology
const FY_END = { 'dr-horton': '09-30', 'toll-brothers': '10-31', 'lennar': '11-30', 'kb-home': '11-30', 'pulte-homes': '12-31', 'centex': '12-31', 'meritage': '12-31', 'taylor-morrison': '12-31', 'tri-pointe': '12-31', 'mi-homes': '12-31', 'century-communities': '12-31', 'lgi-homes': '12-31' };

const today = new Date();
function daysToQuarterEnd(slug) {
  const fy = FY_END[slug]; if (!fy) return null;
  const [m, d] = fy.split('-').map(Number);
  // quarter ends: fy end and each 3 months back
  const ends = [0, 3, 6, 9].map(off => { const dt = new Date(today.getFullYear(), m - 1 - off, d); if (dt < today) dt.setFullYear(dt.getFullYear() + 1); return dt; });
  const next = ends.sort((a, b) => a - b)[0];
  return Math.round((next - today) / 864e5);
}
const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));

const builders = [...new Set(inc.records.map(r => r.builderSlug))];
const rows = builders.map(slug => {
  const recs = inc.records.filter(r => r.builderSlug === slug);
  // depth: current value vs own history min-max
  let depth = null;
  const hist = recs.flatMap(r => (r.history || []).map(h => h.value)).filter(v => v > 0);
  if (hist.length >= 2) {
    const cur = Math.max(...recs.map(r => r.advertisedValue || 0));
    const lo = Math.min(...hist), hi = Math.max(...hist);
    depth = hi > lo ? clamp(((cur - lo) / (hi - lo)) * 100) : 50;
  }
  // urgency from renewal ledger
  const rl = renewal.builders[slug];
  const urgency = rl ? clamp(20 * (rl.deadlineExtensions || 0) + 10 * Math.min(5, rl.expiredButDisplayedObservations || 0)) : null;
  // churn from half-life
  const hb = halfLife.byBuilder ? halfLife.byBuilder[slug] : null;
  const churn = hb && hb.completedMedian != null ? clamp(100 - Math.min(100, hb.completedMedian * (100 / 45))) : null; // 0 days->100, 45+->0
  // fiscal clock
  const dq = daysToQuarterEnd(slug);
  const fiscal = dq == null ? null : clamp(100 - Math.min(100, dq * (100 / 45))); // <45 days out ramps up
  const strings = recs.length ? clamp((recs.filter(r => r.lenderTied).length / recs.length) * 100) : null;

  const comps = { depth, urgency, churn, fiscal, strings };
  const live = Object.values(comps).filter(v => v !== null);
  const score = live.length >= 2 ? Math.round(live.reduce((a, b) => a + b, 0) / live.length) : null;
  return { builder: slug, score, components: comps, liveComponents: live.length, offersTracked: recs.length, daysToFiscalQuarterEnd: dq };
}).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

const out = {
  schema: 'nhd-builder-pressure-index-v0.1',
  metric: 'Builder Pressure Index: observed motivation signals per builder (0-100)',
  lastUpdated: new Date().toISOString(),
  mature: !!halfLife.mature && (renewal.observationRuns || 0) >= 56,
  maturityNote: 'Publish externally only when mature=true (28+ days of twice-daily event log). Until then this is an internal read.',
  weights: 'v0.1 equal-weights across live components; components with no data are excluded, never imputed.',
  methodology: 'methodology-pressure-index.md',
  ranked: rows.filter(r => r.score !== null),
  insufficientData: rows.filter(r => r.score === null).map(r => r.builder)
};
ensure(p('data/derived/pressure-index.json'));
writeFileSync(p('data/derived/pressure-index.json'), JSON.stringify(out, null, 2));
console.log(`[pressure] ${out.ranked.length} builders scored, ${out.insufficientData.length} insufficient, mature=${out.mature}`);
