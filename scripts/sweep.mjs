#!/usr/bin/env node
/*
 * New Home Dispatch — Concession Index auto-publish sweep
 * -------------------------------------------------------
 * Runs on GitHub Actions twice daily (see .github/workflows/incentive-sweep.yml).
 * GitHub's runners are NOT firewalled the way the authoring sandbox is, so this
 * is the ONE place the live site can be updated hands-off.
 *
 * WHAT IT DOES (deterministic core — always safe, cannot publish a wrong number):
 *   1. Reads incentives.json (the verified, human-maintained dataset).
 *   2. Recomputes the Concession Index = median advertised cash incentive across
 *      the tracked verified offers, plus offer count, distinct builders, and how
 *      many tracked offers are past their advertised expiration.
 *   3. Appends a timestamped point to concession-index.json and stamps the exact
 *      run time in America/Chicago. Idempotent per run-slot (AM/PM) per day.
 *
 * The index is ALWAYS re-derived from the verified file. This script never
 * invents a value — if incentives.json has not changed, the index does not
 * change; only the "last checked" timestamp advances. That is the honest
 * behaviour Pete asked for: proof the sweep ran, on the exact minute it ran.
 *
 * OPTIONAL detection layer (only if ANTHROPIC_API_KEY is set):
 *   4. Asks Claude (with web search) whether any daily-tier builder appears to
 *      have changed its advertised incentive since the verified file was written,
 *      and writes the candidates to reporting/sweep-latest.json for a human to
 *      verify and promote. It NEVER edits the verified values automatically —
 *      accuracy of the public number stays human-gated by design.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const p = (rel) => ROOT + rel;

// ---------- time helpers (America/Chicago, no external deps) ----------
function ctParts(now = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
  const parts = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  // offset like "GMT-5" -> "-05:00"
  const off = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', timeZoneName: 'shortOffset',
  }).formatToParts(now).find((x) => x.type === 'timeZoneName').value;
  const m = off.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  const sign = m ? m[1] : '-';
  const hh = m ? String(m[2]).padStart(2, '0') : '05';
  const mm = m && m[3] ? m[3] : '00';
  const offsetStr = `${sign}${hh}:${mm}`;

  const hour24 = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: '2-digit', hour12: false,
  }).formatToParts(now).find((x) => x.type === 'hour').value;
  const slot = Number(hour24) < 12 ? 'AM' : 'PM';

  // ISO wall-clock in CT with real offset
  const isoLocal = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now).reduce((o, x) => (o[x.type] = x.value, o), {});
  const iso = `${isoLocal.year}-${isoLocal.month}-${isoLocal.day}T${isoLocal.hour}:${isoLocal.minute}:${isoLocal.second}${offsetStr}`;

  return {
    iso,
    label: `${parts.month} ${Number(parts.day)}`,          // "Jul 22"
    labelLong: `${parts.month} ${Number(parts.day)}, ${parts.year} · ${parts.hour}:${parts.minute} ${parts.dayPeriod} CT`,
    dateKey: `${parts.year}-${parts.month}-${String(parts.day)}`, // month is short name; use numeric below
    ymd: `${isoLocal.year}-${isoLocal.month}-${isoLocal.day}`,
    slot,
  };
}

// ---------- median ----------
function median(nums) {
  const v = [...nums].sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// ---------- deterministic core ----------
function recomputeIndex() {
  const inc = JSON.parse(readFileSync(p('incentives.json'), 'utf8'));
  const records = inc.records || [];
  const values = records.map((r) => Number(r.advertisedValue)).filter((n) => Number.isFinite(n));
  const idx = median(values);
  const builders = new Set(records.map((r) => r.builder)).size;
  const offers = records.length;

  const now = new Date();
  const t = ctParts(now);
  const expired = records.filter((r) => r.expires && r.expires < t.ymd).length;

  const ci = JSON.parse(readFileSync(p('concession-index.json'), 'utf8'));
  ci.lastUpdated = t.iso;
  ci.lastUpdatedLabel = t.labelLong;

  const point = { t: t.iso, label: t.label, slot: t.slot, index: idx, offers, builders, expired };

  ci.points = Array.isArray(ci.points) ? ci.points : [];
  // idempotent per (ymd, slot): replace an existing point from the same run-slot today
  const sameSlot = (pt) => {
    const d = (pt.t || '').slice(0, 10);
    return d === t.ymd && (pt.slot || '') === t.slot;
  };
  const at = ci.points.findIndex(sameSlot);
  if (at >= 0) ci.points[at] = point;
  else ci.points.push(point);

  ci.points.sort((a, b) => String(a.t).localeCompare(String(b.t)));

  writeFileSync(p('concession-index.json'), JSON.stringify(ci, null, 2) + '\n');
  return { idx, offers, builders, expired, t, pointCount: ci.points.length };
}

// ---------- Buyer Advantage Score v0.1 + score history (reproducible; matches the methodology page) ----------
function clamp(x) { return Math.max(0, Math.min(100, x)); }
function bandFor(s) { return s >= 80 ? 'Strongly favors buyers' : s >= 60 ? 'High' : s >= 40 ? 'Balanced' : 'Favors builders'; }

function recomputeScore(t) {
  const inc = JSON.parse(readFileSync(p('incentives.json'), 'utf8'));
  const records = inc.records || [];
  const v = records.map((r) => Number(r.advertisedValue)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const median = v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : 0;
  const stringFreeShare = records.length ? records.filter((r) => r.lenderTied === false).length / records.length : 0;

  // Broader tracked counts come from the editorial sweep — read from sweep-inputs.json,
  // falling back to the last published values so the score is always defined.
  let inp = { buildersLive: 23, offersVerified: 35, expiredDisplayed: 14, deadlines14d: 11 };
  try { inp = Object.assign(inp, JSON.parse(readFileSync(p('sweep-inputs.json'), 'utf8'))); } catch { /* defaults */ }

  const cIncentive   = clamp((median - 5000) / 20000 * 100);   // 30%
  const cCompetition = clamp(inp.buildersLive / 25 * 100);     // 20%
  const displayed    = inp.offersVerified + inp.expiredDisplayed;
  const cFriction    = displayed ? clamp(inp.expiredDisplayed / displayed * 300) : 0; // 15%
  const cStringFree  = clamp(stringFreeShare * 100);           // 20%
  const cDeadline    = clamp(inp.deadlines14d / 12 * 100);     // 15%

  const score = Math.round(0.30 * cIncentive + 0.20 * cCompetition + 0.15 * cFriction + 0.20 * cStringFree + 0.15 * cDeadline);
  const band = bandFor(score);

  let hist;
  try { hist = JSON.parse(readFileSync(p('score-history.json'), 'utf8')); }
  catch { hist = { schema: 'nhd-buyer-advantage-score-history-v1', metric: 'Buyer Advantage Score (v0.1 public-signal model)', points: [] }; }
  hist.points = Array.isArray(hist.points) ? hist.points : [];
  const point = {
    t: t.iso, label: t.label, slot: t.slot, score, band,
    components: { incentive: Math.round(cIncentive), competition: Math.round(cCompetition), friction: Math.round(cFriction), stringFree: Math.round(cStringFree), deadline: Math.round(cDeadline) },
  };
  const at = hist.points.findIndex((pt) => (pt.t || '').slice(0, 10) === t.ymd && (pt.slot || '') === t.slot);
  if (at >= 0) hist.points[at] = point; else hist.points.push(point);
  hist.points.sort((a, b) => String(a.t).localeCompare(String(b.t)));
  hist.lastUpdated = t.iso;
  hist.lastUpdatedLabel = t.labelLong;
  writeFileSync(p('score-history.json'), JSON.stringify(hist, null, 2) + '\n');
  return { score, band, pointCount: hist.points.length };
}

// ---------- optional detection layer (never mutates verified values) ----------
async function detectChanges() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ran: false, reason: 'no ANTHROPIC_API_KEY set' };

  const model = process.env.SWEEP_MODEL || 'claude-sonnet-4-5';
  const inc = JSON.parse(readFileSync(p('incentives.json'), 'utf8'));
  const verified = inc.records.map((r) => ({
    community: r.community, builder: r.builder,
    advertisedValue: r.advertisedValue, incentiveType: r.incentiveType,
    lenderTied: r.lenderTied, expires: r.expires,
  }));

  const prompt =
    `You are auditing advertised new-home incentives for Austin/Central Texas as of today. ` +
    `Here is New Home Dispatch's currently VERIFIED set (builder-advertised figures we last confirmed):\n` +
    JSON.stringify(verified, null, 2) +
    `\n\nUsing web search, check each builder/community's own website for its CURRENT advertised buyer ` +
    `incentive (closing-cost help, flex cash, rate buydown value, design credit). For each one, report ` +
    `whether the advertised cash figure appears UNCHANGED, CHANGED (give the new advertised figure + the ` +
    `source URL), or UNVERIFIABLE (page not reachable / no clear figure). Do not guess — only report CHANGED ` +
    `when the builder's own site states a different figure. Return a compact JSON array of ` +
    `{community, builder, status, newValue, sourceUrl, note}. Return ONLY the JSON.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 20 }],
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { ran: false, reason: `API ${res.status}: ${body.slice(0, 300)}` };
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  let candidates = [];
  const m = text.match(/\[[\s\S]*\]/);
  if (m) { try { candidates = JSON.parse(m[0]); } catch { /* leave raw */ } }
  return { ran: true, model, candidates, raw: text };
}

// ---------- main ----------
(async () => {
  const core = recomputeIndex();
  console.log(
    `[sweep] index=$${core.idx.toLocaleString()} offers=${core.offers} ` +
    `builders=${core.builders} expired=${core.expired} slot=${core.t.slot} ` +
    `at=${core.t.labelLong} points=${core.pointCount}`
  );

  const bas = recomputeScore(core.t);
  console.log(`[sweep] BuyerAdvantageScore=${bas.score} (${bas.band}) historyPoints=${bas.pointCount}`);

  let detect = { ran: false, reason: 'skipped' };
  try {
    detect = await detectChanges();
  } catch (e) {
    detect = { ran: false, reason: 'exception: ' + (e && e.message) };
  }

  const outPath = p('reporting/sweep-latest.json');
  if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true });
  const changed = (detect.candidates || []).filter((c) => c && c.status === 'CHANGED');
  const summary = {
    schema: 'nhd-sweep-latest-v1',
    ranAt: core.t.iso,
    ranAtLabel: core.t.labelLong,
    slot: core.t.slot,
    index: core.idx,
    offers: core.offers,
    builders: core.builders,
    expired: core.expired,
    detection: detect.ran
      ? { ran: true, model: detect.model, changedCount: changed.length, candidates: detect.candidates }
      : { ran: false, reason: detect.reason },
    note: detect.ran
      ? (changed.length
          ? 'CANDIDATE CHANGES DETECTED — a human must verify on the builder site before the public number moves.'
          : 'No changes detected. Verified figures unchanged; index republished with a fresh timestamp.')
      : 'Detection layer not run (deterministic index still republished with a fresh timestamp).',
  };
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n');
  console.log('[sweep] ' + summary.note);
  if (changed.length) {
    console.log('[sweep] candidates:');
    for (const c of changed) console.log(`   - ${c.builder} / ${c.community}: ${c.newValue} (${c.sourceUrl || 'no url'})`);
  }
})();
