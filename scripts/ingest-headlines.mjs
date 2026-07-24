#!/usr/bin/env node
/*
 * New Home Dispatch — S2 headline sensor ingester
 * -----------------------------------------------
 * The Single Shareable's afternoon scrub (Austin market, real estate, mortgage
 * news) becomes a SENSOR: every curated headline is appended to the same event
 * spine the offer scrape writes to, so narrative can be compared against the
 * incentive tape (the "narrative vs tape" divergence play).
 *
 * INPUT:  reporting/headlines-inbox.json  (written by the scrub process/chat)
 *         [{ "headline": "...", "url": "https://...", "source": "MND",
 *            "tags": ["rates"], "stance": "bullish|bearish|neutral",
 *            "relevance": "why it matters to an Austin buyer" }]
 * OUTPUT: data/derived/headline-events.jsonl  (append-only, idempotent per URL+day)
 *         data/derived/narrative-tape.json    (daily stance balance vs Concession Index,
 *                                              the divergence series)
 * RULES:  never invents headlines; only ingests what the human/scrub wrote to the
 *         inbox. Tags are constrained to a fixed vocabulary so the series stays
 *         comparable: rates, inventory, incentives, policy, builder, economy, local.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const p = (rel) => ROOT + rel;
const ensure = (f) => { const d = dirname(f); if (!existsSync(d)) mkdirSync(d, { recursive: true }); };
const TAGS = new Set(['rates', 'inventory', 'incentives', 'policy', 'builder', 'economy', 'local']);

function ctYmd(now = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(now);
}
const today = ctYmd();
const inboxPath = p('reporting/headlines-inbox.json');
if (!existsSync(inboxPath)) { console.log('[headlines] no inbox; nothing to ingest'); process.exit(0); }
const inbox = JSON.parse(readFileSync(inboxPath, 'utf8'));

const logPath = p('data/derived/headline-events.jsonl');
ensure(logPath);
const existing = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
let added = 0;
for (const h of inbox) {
  if (!h.headline || !h.url) continue;
  const key = `${today}|${h.url}`;
  if (existing.includes(JSON.stringify(key))) continue;
  const ev = {
    t: new Date().toISOString(), day: today, key,
    type: 'headline', headline: h.headline, url: h.url, source: h.source || '',
    tags: (h.tags || []).filter(t => TAGS.has(t)),
    stance: ['bullish', 'bearish', 'neutral'].includes(h.stance) ? h.stance : 'neutral',
    relevance: h.relevance || ''
  };
  appendFileSync(logPath, JSON.stringify(ev) + '\n');
  added++;
}

// ---- narrative vs tape daily series ----
const log = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const byDay = {};
for (const e of log) {
  const d = (byDay[e.day] ||= { bullish: 0, bearish: 0, neutral: 0, n: 0 });
  d[e.stance]++; d.n++;
}
let tape = null;
try {
  const ci = JSON.parse(readFileSync(p('concession-index.json'), 'utf8'));
  tape = Object.fromEntries(ci.points.map(pt => [pt.t.slice(0, 10), pt.index]));
} catch { }
const series = Object.entries(byDay).map(([day, d]) => ({
  day, headlines: d.n,
  narrativeBalance: d.n ? +(((d.bullish - d.bearish) / d.n)).toFixed(2) : 0,
  concessionIndex: tape ? (tape[day] ?? null) : null
}));
writeFileSync(p('data/derived/narrative-tape.json'), JSON.stringify({
  schema: 'nhd-narrative-tape-v1',
  metric: 'Daily headline stance balance (bullish minus bearish share) vs the Concession Index',
  note: 'Divergence play: narrative warming while incentives deepen (or the reverse) is the story. Stances are assigned at curation, from the buyer point of view.',
  lastUpdated: new Date().toISOString(), points: series
}, null, 2));
console.log(`[headlines] ingested ${added} new, log days=${series.length}`);
