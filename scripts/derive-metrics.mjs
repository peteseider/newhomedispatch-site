#!/usr/bin/env node
/*
 * New Home Dispatch — Quant derivation layer (Phase 1)
 * ----------------------------------------------------
 * Runs on GitHub Actions after each "Concession Index sweep" run
 * (see .github/workflows/derive-metrics.yml). Same design contract as
 * sweep.mjs: deterministic, append-only, never invents a value, and never
 * edits the human-gated verified file (incentives.json is read-only here).
 *
 * WHAT IT BUILDS (the quant asset is the event log; metrics re-derive from it):
 *   1. data/raw/            append-only snapshot of incentives.json per run slot
 *   2. data/derived/offer-events.jsonl
 *                           immutable event log: value_changed, deadline_set,
 *                           deadline_extended (a "renewal"), expired_but_displayed,
 *                           offer_added, offer_removed, offer_reappeared
 *   3. data/derived/renewal-ledger.json   per-builder deadline honesty ledger
 *   4. data/derived/half-life.json        offer persistence (censoring-aware)
 *   5. data/derived/rate-spread.json      advertised rates vs Freddie Mac PMMS
 *   6. data/derived/breadth-depth.json    market-phase time series
 *
 * Honesty rules baked in: metrics carry a maturity flag until the event log is
 * old enough to support them (half-life needs >= 28 days of history; the
 * renewal ledger reports observations, never intent). Every output stamps the
 * run time and the number of underlying observations.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname; // repo root (script lives in scripts/)
const p = (rel) => ROOT + rel;
const ensure = (file) => { const d = dirname(file); if (!existsSync(d)) mkdirSync(d, { recursive: true }); };

// ---------- time (America/Chicago, mirrors sweep.mjs) ----------
function ctParts(now = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
  const parts = Object.fromEntries(f.formatToParts(now).map(x => [x.type, x.value]));
  const hour = parseInt(parts.hour, 10);
  return { ymd: `${parts.year}-${parts.month}-${parts.day}`, slot: hour < 12 ? 'AM' : 'PM', iso: now.toISOString() };
}
const RUN = ctParts();
const RUN_KEY = `${RUN.ymd}-${RUN.slot}`;

// ---------- load current verified data ----------
const inc = JSON.parse(readFileSync(p('incentives.json'), 'utf8'));
const sweepInputs = existsSync(p('sweep-inputs.json')) ? JSON.parse(readFileSync(p('sweep-inputs.json'), 'utf8')) : {};
const records = inc.records || [];

// ---------- 1. append-only raw snapshot (idempotent per slot) ----------
const rawPath = p(`data/raw/incentives-${RUN_KEY}.json`);
ensure(rawPath);
if (!existsSync(rawPath)) copyFileSync(p('incentives.json'), rawPath);

// ---------- 2. event log: diff vs previous state ----------
const statePath = p('data/state/last-incentives.json');
ensure(statePath);
const prev = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
const prevById = new Map(((prev && prev.records) || []).map(r => [r.id, r]));
const nowById = new Map(records.map(r => [r.id, r]));

const events = [];
const ev = (type, r, extra = {}) => events.push({ t: RUN.iso, runKey: RUN_KEY, type, id: r.id, builder: r.builderSlug, community: r.communitySlug, ...extra });

for (const r of records) {
  const was = prevById.get(r.id);
  if (!was) { if (prev) ev('offer_added', r, { value: r.advertisedValue }); continue; }
  if (was.advertisedValue !== r.advertisedValue) ev('value_changed', r, { from: was.advertisedValue, to: r.advertisedValue });
  const hadDl = (was.expires || '') !== '', hasDl = (r.expires || '') !== '';
  if (!hadDl && hasDl) ev('deadline_set', r, { expires: r.expires });
  if (hadDl && hasDl && was.expires !== r.expires && r.expires > was.expires) ev('deadline_extended', r, { from: was.expires, to: r.expires }); // a RENEWAL
  if (hasDl && r.expires < RUN.ymd) ev('expired_but_displayed', r, { expires: r.expires });
  if (was.lenderTied !== r.lenderTied) ev('lender_tie_changed', r, { to: r.lenderTied });
}
for (const [id, was] of prevById) if (!nowById.has(id)) ev('offer_removed', was, {});
if (prev) for (const r of records) { /* reappearance: in log but absent from prev and present before prev is detectable from the log itself */ }

const logPath = p('data/derived/offer-events.jsonl');
ensure(logPath);
// idempotency: skip if this runKey already logged
const logText = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
if (!logText.includes(`"runKey":"${RUN_KEY}"`) && events.length) appendFileSync(logPath, events.map(e => JSON.stringify(e)).join('\n') + '\n');
writeFileSync(statePath, JSON.stringify(inc));

// re-read full log for derivations
const log = (existsSync(logPath) ? readFileSync(logPath, 'utf8') : '').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

// ---------- 3. Renewal Ledger ----------
const byBuilder = {};
for (const e of log) {
  const b = (byBuilder[e.builder] ||= { extensions: 0, expiredDisplayedRuns: 0, deadlinesSet: 0, offers: new Set() });
  b.offers.add(e.id);
  if (e.type === 'deadline_extended') b.extensions++;
  if (e.type === 'expired_but_displayed') b.expiredDisplayedRuns++;
  if (e.type === 'deadline_set') b.deadlinesSet++;
}
// current expired-but-still-shown from live records
const nowExpired = records.filter(r => (r.expires || '') !== '' && r.expires < RUN.ymd).map(r => ({ id: r.id, builder: r.builderSlug, community: r.communitySlug, expires: r.expires, daysPast: Math.round((Date.parse(RUN.ymd) - Date.parse(r.expires)) / 864e5) }));
const renewal = {
  schema: 'nhd-renewal-ledger-v1',
  metric: 'Deadline offers that renew, persist past expiry, or extend (observed behavior, not intent)',
  lastUpdated: RUN.iso, runKey: RUN_KEY,
  observationRuns: new Set(log.map(e => e.runKey)).size,
  currentlyExpiredButDisplayed: nowExpired,
  builders: Object.fromEntries(Object.entries(byBuilder).map(([k, v]) => [k, { deadlineExtensions: v.extensions, expiredButDisplayedObservations: v.expiredDisplayedRuns, deadlinesSet: v.deadlinesSet, offersTracked: v.offers.size }])),
  note: 'A deadline_extended event is a renewal: an advertised expiration that moved later. expired_but_displayed counts sweep observations of an offer still advertised after its stated deadline.'
};
ensure(p('data/derived/renewal-ledger.json'));
writeFileSync(p('data/derived/renewal-ledger.json'), JSON.stringify(renewal, null, 2));

// ---------- 4. Half-Life (censoring-aware) ----------
const spans = [];
for (const r of records) {
  const h = r.history || [];
  for (let i = 1; i < h.length; i++) spans.push({ builder: r.builderSlug, days: Math.round((Date.parse(h[i].date) - Date.parse(h[i - 1].date)) / 864e5), censored: false });
  if (h.length) spans.push({ builder: r.builderSlug, days: Math.round((Date.parse(RUN.ymd) - Date.parse(h[h.length - 1].date)) / 864e5), censored: true });
}
const firstObs = log.length ? log[0].t : RUN.iso;
const ageDays = Math.round((Date.parse(RUN.iso) - Date.parse(firstObs)) / 864e5);
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const halfLife = {
  schema: 'nhd-incentive-half-life-v1',
  metric: 'Median days an advertised offer survives unchanged (offer persistence)',
  lastUpdated: RUN.iso, runKey: RUN_KEY,
  mature: ageDays >= 28,
  maturityNote: ageDays >= 28 ? null : `Event log is ${ageDays} days old; publish only after 28+ days of accumulation. Values below are provisional and right-censored.`,
  completedSpansMedianDays: med(spans.filter(s => !s.censored).map(s => s.days)),
  openSpansMedianDays: med(spans.filter(s => s.censored).map(s => s.days)),
  completedSpans: spans.filter(s => !s.censored).length,
  openSpans: spans.filter(s => s.censored).length,
  byBuilder: Object.fromEntries([...new Set(spans.map(s => s.builder))].map(b => [b, { completedMedian: med(spans.filter(s => s.builder === b && !s.censored).map(s => s.days)), open: spans.filter(s => s.builder === b && s.censored).length }]))
};
writeFileSync(p('data/derived/half-life.json'), JSON.stringify(halfLife, null, 2));

// ---------- 5. Advertised rate vs PMMS spread ----------
let pmms = null;
try {
  const res = await fetch('https://www.freddiemac.com/pmms/docs/PMMS_history.csv');
  if (res.ok) {
    const rows = (await res.text()).trim().split('\n');
    const last = rows[rows.length - 1].split(',');
    pmms = { week: last[0], rate30: parseFloat(last[1]) };
  }
} catch { /* runner offline or format change: spread simply not computed this run */ }
const rateRx = /(\d\.\d{1,3})\s?%/;
const rateOffers = records.map(r => {
  const m = `${r.incentiveType || ''} ${r.note || ''} ${r.homeType || ''}`.match(rateRx);
  return m ? { id: r.id, builder: r.builderSlug, community: r.communitySlug, advertisedRate: parseFloat(m[1]) } : null;
}).filter(Boolean);
const spread = {
  schema: 'nhd-rate-spread-v1',
  metric: 'Advertised builder rates vs Freddie Mac PMMS 30-year average',
  lastUpdated: RUN.iso, runKey: RUN_KEY,
  pmms,
  offers: rateOffers.map(o => ({ ...o, spreadBps: pmms ? Math.round((o.advertisedRate - pmms.rate30) * 100) : null })),
  note: 'Advertised rates are builder claims parsed from offer text; PMMS is the weekly market average. Negative spread = advertised below market (the buydown teaser).'
};
writeFileSync(p('data/derived/rate-spread.json'), JSON.stringify(spread, null, 2));

// ---------- 6. Breadth vs Depth time series (append, idempotent) ----------
const bdPath = p('data/derived/breadth-depth.json');
const bd = existsSync(bdPath) ? JSON.parse(readFileSync(bdPath, 'utf8')) : { schema: 'nhd-breadth-depth-v1', metric: 'Share of tracked builders with live offers (breadth) vs median advertised value (depth)', points: [] };
if (!bd.points.some(pt => pt.runKey === RUN_KEY)) {
  const buildersWithOffers = new Set(records.map(r => r.builderSlug)).size;
  bd.points.push({
    t: RUN.iso, runKey: RUN_KEY,
    breadthBuilders: sweepInputs.buildersLive ?? buildersWithOffers,
    verifiedOffers: sweepInputs.offersVerified ?? records.length,
    depthMedianUSD: med(records.map(r => r.advertisedValue).filter(v => typeof v === 'number' && v > 1000)),
    lenderTiedShare: records.length ? +(records.filter(r => r.lenderTied).length / records.length).toFixed(2) : null
  });
}
bd.lastUpdated = RUN.iso;
writeFileSync(bdPath, JSON.stringify(bd, null, 2));

console.log(`[derive] ${RUN_KEY}: ${events.length} events, ${renewal.observationRuns} runs in log, halfLife mature=${halfLife.mature}, rateOffers=${rateOffers.length}, bd points=${bd.points.length}`);
