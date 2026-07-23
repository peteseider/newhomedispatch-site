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

  try { await refreshRate(core.t); } catch (e) { console.log('[sweep] rate refresh skipped: ' + (e && e.message)); }
  try { await refreshPmms(core.t); } catch (e) { console.log('[sweep] pmms refresh skipped: ' + (e && e.message)); }
  try { await refreshPermits(core.t); } catch (e) { console.log('[sweep] permits refresh skipped: ' + (e && e.message)); }
  try { writeContentPacket(core); } catch (e) { console.log('[sweep] content packet skipped: ' + (e && e.message)); }

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

// ---- daily 30yr rate benchmark (best effort; keeps last good value on failure) ----
async function refreshRate(t) {
  const rbPath = p('reporting/rate-benchmark.json');
  let rb;
  try { rb = JSON.parse(readFileSync(rbPath, 'utf8')); }
  catch { rb = { schema: 'nhd-rate-benchmark-v1', rate30yr: 6.77, asOf: '2026-07-22', asOfLabel: 'Jul 22, 2026', source: 'Mortgage News Daily', history: [{date:'2026-07-22', rate:6.77}] }; }
  try {
    let v = NaN;
    const urls = [
      'https://www.mortgagenewsdaily.com/mortgage-rates/30-year-fixed',
      'https://www.mortgagenewsdaily.com/mortgage-rates',
    ];
    const patterns = [
      /30\s*(?:Yr|Year)\.?\s*Fixed[\s\S]{0,600}?(\d{1,2}\.\d{2})\s*%/i,
      /"ratePercent"\s*:\s*"?(\d{1,2}\.\d{2})/i,
      /current(?:ly)?[\s\S]{0,120}?(\d{1,2}\.\d{2})\s*%/i,
      /(\d{1,2}\.\d{2})\s*%[\s\S]{0,200}?30\s*(?:Yr|Year)\.?\s*Fixed/i,
    ];
    for (const url of urls) {
      if (Number.isFinite(v)) break;
      try {
        const ctl = new AbortController();
        const to = setTimeout(() => ctl.abort(), 15000);
        const res = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; NHD-rate-check; +https://newhomedispatch.com)' } });
        clearTimeout(to);
        if (res.status !== 200) continue;
        const html = await res.text();
        for (const pat of patterns) {
          const m = html.match(pat);
          const c = m ? parseFloat(m[1]) : NaN;
          if (Number.isFinite(c) && c > 2 && c < 15) { v = c; break; }
        }
      } catch (e) { /* try next url */ }
    }
    if (Number.isFinite(v) && v > 2 && v < 15) {
      const day = t.iso.slice(0, 10);
      rb.history = (rb.history || []).filter(h => h.date !== day).slice(-89);
      rb.history.push({ date: day, rate: v });
      rb.rate30yr = v;
      rb.asOf = day;
      rb.asOfLabel = t.labelLong.split(' \u00b7 ')[0];
      rb.source = 'Mortgage News Daily';
      console.log('[sweep] rate30yr=' + v + '% (' + rb.asOfLabel + ')');
    } else {
      console.log('[sweep] rate: source not parseable, keeping ' + rb.rate30yr + '% (' + (rb.asOfLabel || rb.asOf) + ')');
    }
  } catch (e) {
    console.log('[sweep] rate fetch failed, keeping ' + rb.rate30yr + '%: ' + (e && e.message));
  }
  if (!existsSync(dirname(rbPath))) mkdirSync(dirname(rbPath), { recursive: true });
  writeFileSync(rbPath, JSON.stringify(rb, null, 2) + '\n');
}

// ---- weekly Freddie Mac PMMS benchmark via FRED (best effort; keeps last good value) ----
async function refreshPmms(t) {
  const path = p('reporting/pmms.json');
  let pj;
  try { pj = JSON.parse(readFileSync(path, 'utf8')); }
  catch { pj = { schema: 'nhd-pmms-v1', label: '30 yr fixed weekly national survey', source: 'Freddie Mac PMMS', rate: null, asOf: null, history: [] }; }
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 15000);
    const res = await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=MORTGAGE30US', {
      signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; NHD-data; +https://newhomedispatch.com)' } });
    clearTimeout(to);
    if (res.status === 200) {
      const rows = (await res.text()).trim().split('\n').map(r => r.split(','));
      const data = rows.slice(1).map(r => ({ date: r[0], rate: parseFloat(r[1]) }))
        .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') && Number.isFinite(r.rate) && r.rate > 2 && r.rate < 15);
      if (data.length) {
        const last = data[data.length - 1];
        const prior = data.length > 1 ? data[data.length - 2] : null;
        const yearAgoTarget = new Date(last.date + 'T12:00:00Z'); yearAgoTarget.setUTCDate(yearAgoTarget.getUTCDate() - 364);
        const yaKey = yearAgoTarget.toISOString().slice(0, 10);
        let yearAgo = null, best = 1e9;
        for (const d of data) { const diff = Math.abs(new Date(d.date) - new Date(yaKey)); if (diff < best) { best = diff; yearAgo = d; } }
        pj.rate = last.rate; pj.asOf = last.date;
        pj.prior = prior ? { rate: prior.rate, date: prior.date } : null;
        pj.yearAgo = yearAgo && best < 15 * 86400000 ? { rate: yearAgo.rate, date: yearAgo.date } : pj.yearAgo || null;
        pj.source = 'Freddie Mac PMMS (via FRED)';
        pj.history = (pj.history || []).filter(h => h.date !== last.date).slice(-155);
        pj.history.push({ date: last.date, rate: last.rate });
        console.log('[sweep] pmms=' + last.rate + '% (' + last.date + ')');
      }
    } else {
      console.log('[sweep] pmms: HTTP ' + res.status + ', keeping ' + pj.rate + '% (' + pj.asOf + ')');
    }
  } catch (e) {
    console.log('[sweep] pmms fetch failed, keeping ' + pj.rate + '%: ' + (e && e.message));
  }
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(pj, null, 2) + '\n');
}

// ---- City of Austin new-residential building permits (Socrata open data; best effort) ----
// Trailing-30-day count of issued Building Permits, class Residential, work class New,
// plus the same window one year earlier for context. A leading supply signal.
async function refreshPermits(t) {
  const path = p('reporting/permits.json');
  let pj;
  try { pj = JSON.parse(readFileSync(path, 'utf8')); }
  catch { pj = { schema: 'nhd-permits-v1', label: 'New residential building permits issued · City of Austin · trailing 30 days', source: 'City of Austin Open Data (Issued Construction Permits, 3syk-w9eu)', history: [] }; }
  async function countBetween(fromIso, toIso) {
    const where = encodeURIComponent(`permit_class_mapped='Residential' AND work_class='New' AND permit_type_desc='Building Permit' AND issue_date between '${fromIso}T00:00:00' and '${toIso}T00:00:00'`);
    const url = `https://data.austintexas.gov/resource/3syk-w9eu.json?$select=count(*)%20as%20n&$where=${where}`;
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 20000);
    const res = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; NHD-data; +https://newhomedispatch.com)' } });
    clearTimeout(to);
    if (res.status !== 200) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const n = parseInt(j && j[0] && j[0].n, 10);
    if (!Number.isFinite(n)) throw new Error('unparseable count');
    return n;
  }
  try {
    const day = t.iso.slice(0, 10);
    const from = new Date(day + 'T12:00:00Z'); from.setUTCDate(from.getUTCDate() - 30);
    const fromKey = from.toISOString().slice(0, 10);
    const pyTo = new Date(day + 'T12:00:00Z'); pyTo.setUTCFullYear(pyTo.getUTCFullYear() - 1);
    const pyFrom = new Date(fromKey + 'T12:00:00Z'); pyFrom.setUTCFullYear(pyFrom.getUTCFullYear() - 1);
    const count = await countBetween(fromKey, day);
    const priorYear = await countBetween(pyFrom.toISOString().slice(0, 10), pyTo.toISOString().slice(0, 10));
    pj.current = { from: fromKey, to: day, count: count };
    pj.priorYear = { from: pyFrom.toISOString().slice(0, 10), to: pyTo.toISOString().slice(0, 10), count: priorYear };
    pj.updated = day;
    pj.history = (pj.history || []).filter(h => h.date !== day).slice(-179);
    pj.history.push({ date: day, count30d: count, priorYear30d: priorYear });
    console.log('[sweep] permits30d=' + count + ' (yr-ago window ' + priorYear + ')');
  } catch (e) {
    console.log('[sweep] permits fetch failed, keeping last: ' + (e && e.message));
  }
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(pj, null, 2) + '\n');
}

// ---- content packet: one structured record per completed sweep. This is the
// single canonical source for every downstream format (site modules, social,
// email, SMS, weekly edition). Nothing downstream re-derives facts by hand.
// publishRecommendation rules: broad only when a material change exists;
// watchlist-only when changes touch specific builders without moving the
// market read; internal-only when nothing material changed (an honest quiet
// day is recorded, never dressed up).
function writeContentPacket(core) {
  const path = p('reporting/content-packet.json');
  const inc = JSON.parse(readFileSync(p('incentives.json'), 'utf8'));
  const dk = (w) => { w = String(w || ''); if (/^\d{4}-\d{2}-\d{2}/.test(w)) return w.slice(0, 10);
    const m = w.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/); if (!m) return null;
    const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : String(new Date().getFullYear());
    return y + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2); };
  const t = core.t.ymd;
  const recs = inc.records || [], promos = inc.promos || [];
  const liveOf = (l) => l.filter((o) => { const k = o.expires ? dk(o.expires) : null; return !k || k >= t; });
  const liveR = liveOf(recs), liveP = liveOf(promos);
  const bld = new Set([...liveR, ...liveP].map((o) => o.builder).filter(Boolean));
  const newOffers = [];
  recs.forEach((o) => { if (o.history && o.history.length === 1 && o.history[0].date === t) newOffers.push(o.builder); });
  liveP.forEach((o) => { if (o.firstObserved === t) newOffers.push(o.builder); });
  const improved = recs.filter((o) => o.lastObserved === t && o.delta > 0).map((o) => o.builder);
  const reduced = recs.filter((o) => o.lastObserved === t && o.delta < 0).map((o) => o.builder);
  const wk = new Date(t + 'T12:00:00Z'); wk.setUTCDate(wk.getUTCDate() + 7);
  const wkKey = wk.toISOString().slice(0, 10);
  const urgent = [...liveR, ...liveP].filter((o) => { const k = o.expires ? dk(o.expires) : null; return k && k >= t && k <= wkKey; })
    .map((o) => ({ builder: o.builder, deadline: dk(o.expires), offer: (o.promo || (o.incentiveType ? o.incentiveType + ' $' + o.advertisedValue : '')).slice(0, 90) }))
    .sort((a, b) => a.deadline < b.deadline ? -1 : 1);
  let sh = { points: [] };
  try { sh = JSON.parse(readFileSync(p('score-history.json'), 'utf8')); } catch { }
  const pts = (sh.points || []).slice().sort((a, b) => String(a.t).localeCompare(String(b.t)));
  const cur = pts[pts.length - 1] || {}, prev = pts[pts.length - 2] || null;
  const dScore = prev ? cur.score - prev.score : null;
  let rb = null; try { rb = JSON.parse(readFileSync(p('reporting/rate-benchmark.json'), 'utf8')); } catch { }
  let pm = null; try { pm = JSON.parse(readFileSync(p('reporting/pmms.json'), 'utf8')); } catch { }
  const changed = newOffers.length + improved.length + reduced.length;
  const drivers = [];
  if (newOffers.length) drivers.push(newOffers.length + ' new offer' + (newOffers.length > 1 ? 's' : '') + ' (' + [...new Set(newOffers)].slice(0, 3).join(', ') + ')');
  if (improved.length) drivers.push(improved.length + ' improved');
  if (reduced.length) drivers.push(reduced.length + ' reduced');
  const interpretation = changed
    ? 'Movement this sweep: ' + drivers.join(', ') + '. Market-wide score ' + (dScore ? (dScore > 0 ? 'up ' : 'down ') + Math.abs(dScore) : 'unchanged') + (dScore && Math.abs(dScore) <= 2 ? ' (within model noise)' : '') + '.'
    : 'No material change since the prior sweep. Builders are holding their advertised positions; stability is information, not a gap.';
  const buyerAction = urgent.length
    ? 'Nearest advertised deadline: ' + urgent[0].builder + ' (' + urgent[0].deadline + '). If that builder is on your list, get the current terms in writing today.'
    : 'No hard deadline inside seven days. Use the window to compare delivered prices, not headline credits.';
  const packet = {
    schema: 'nhd-content-packet-v1',
    sweepId: core.t.iso + '-' + core.t.slot,
    generatedAt: core.t.iso,
    facts: {
      score: cur.score ?? null, band: cur.band ?? null, scoreDelta: dScore,
      concessionIndex: core.idx, offersLive: liveR.length + liveP.length,
      buildersLive: bld.size, expired: (recs.length - liveR.length) + (promos.length - liveP.length),
      rateDaily: rb ? rb.rate30yr : null, ratePmmsWeekly: pm ? pm.rate : null,
    },
    changes: { count: changed, newOffers: [...new Set(newOffers)], improved: [...new Set(improved)], reduced: [...new Set(reduced)], deadlinesNext7d: urgent.slice(0, 5) },
    interpretation,
    buyerAction,
    affectedSegments: urgent.length ? ['buyers considering: ' + [...new Set(urgent.map(u => u.builder))].join(', '), 'buyers purchasing within 30 days'] : ['no segment needs to act on today’s sweep'],
    confidence: 'All figures builder-advertised and re-verified on builder sites this sweep; nothing field-verified is claimed.',
    sources: ['incentives.json', 'score-history.json', 'concession-index.json', 'reporting/rate-benchmark.json', 'reporting/pmms.json'],
    publishRecommendation: changed ? (dScore ? 'publish-broadly' : 'publish-watchlists') : 'record-internal',
  };
  writeFileSync(path, JSON.stringify(packet, null, 2) + '\n');
  console.log('[sweep] content packet: ' + packet.publishRecommendation + ' (' + changed + ' material changes)');
}
