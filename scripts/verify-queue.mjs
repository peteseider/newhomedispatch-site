#!/usr/bin/env node
/*
 * New Home Dispatch — verification triage engine (grows the tape fastest)
 * -----------------------------------------------------------------------
 * The binding constraint on "more builders, more data" is human verification
 * minutes: the sweep observes ~35 offers but only the verified subset publishes.
 * This script merges every pending signal into ONE ranked worklist so the
 * editor's next 20 minutes always promote the highest-value records first.
 *
 * Inputs (all optional; uses whatever exists):
 *   reporting/sweep-latest.json         detection-layer change candidates
 *   reporting/field-confirmations.json  field CONFIRM / CONTRADICT suggestions
 *   incentives.json                     staleness + expired deadlines
 *   data/derived/b2b/tax-cards.json     Partial tax rows blocking the sellable pack
 * Output:
 *   reporting/verify-queue.json  ranked worklist with a reason and a score
 *   reporting/VERIFY-TODAY.md    the human 20-minute checklist, ranked
 * Scoring (transparent, editable): field contradiction 90, sweep change candidate 70,
 * expired-deadline-still-shown 60, stale verified record (>7d) 40 plus 2/day,
 * tax row blocking the sellable pack 50, field confirm (quick promote) 30.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const p = (rel) => ROOT + rel;
const ensure = (f) => { const d = dirname(f); if (!existsSync(d)) mkdirSync(d, { recursive: true }); };
const load = (rel, fb) => existsSync(p(rel)) ? JSON.parse(readFileSync(p(rel), 'utf8')) : fb;

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
const items = [];

// field contradictions and confirms
for (const it of (load('reporting/field-confirmations.json', { items: [] }).items || [])) {
  const contradiction = (it.suggestion || '').startsWith('CONTRADICTION');
  items.push({
    score: contradiction ? 90 : 30,
    action: contradiction ? `RESOLVE field vs web for ${it.builder} at ${it.community}: web $${it.scrapedValue} vs field $${it.fieldValue}. Quote: "${(it.quote || '').slice(0, 90)}"` : `PROMOTE confidence for ${it.builder} at ${it.community} (web and field agree)`,
    kind: contradiction ? 'field_contradiction' : 'field_confirm', ref: it.id
  });
}
// sweep detection candidates (sweep-latest nests them under detection.candidates)
const sweepLatest = load('reporting/sweep-latest.json', null);
const sweepCands = (sweepLatest && ((sweepLatest.detection && sweepLatest.detection.candidates) || sweepLatest.candidates || sweepLatest.changes)) || [];
for (const c of sweepCands) {
  if (!c || c.status === 'UNCHANGED' || c.status === 'UNVERIFIABLE') continue;
  const isNew = c.status === 'NEW_BUILDER_OFFER';
  items.push({
    score: isNew ? 75 : 70,
    kind: isNew ? 'new_builder_offer' : 'sweep_candidate',
    ref: c.id || c.builder || '',
    action: isNew
      ? `VERIFY new watchlist builder offer: ${c.builder}${c.community ? ' at ' + c.community : ''}: ${c.newValue || ''} (${c.sourceUrl || 'no url'}). Confirming adds a builder to the tape.`
      : `VERIFY sweep-detected change: ${c.builder || ''}${c.community ? ' / ' + c.community : ''}: ${c.newValue || ''} (${c.sourceUrl || (c.note || '').slice(0, 80)})`
  });
}
// verified tape hygiene
const inc = load('incentives.json', { records: [] });
for (const r of inc.records || []) {
  if ((r.expires || '') !== '' && r.expires < today) {
    items.push({ score: 60, kind: 'expired_displayed', ref: r.id, action: `CHECK ${r.builder} at ${r.community}: offer shows expired ${r.expires}. Renewed, extended, or gone? (Feeds the Renewal Ledger.)` });
  }
  const staleDays = r.lastObserved ? Math.round((Date.parse(today) - Date.parse(r.lastObserved)) / 864e5) : 99;
  if (staleDays > 7) items.push({ score: Math.min(40 + 2 * (staleDays - 7), 60), kind: 'stale_record', ref: r.id, action: `RECONFIRM ${r.builder} at ${r.community}: last observed ${r.lastObserved} (${staleDays}d ago)` });
}
// tax rows blocking the sellable pack
const cards = load('data/derived/b2b/tax-cards.json', null);
for (const c of (cards && cards.needsVerificationAppendix ? cards.needsVerificationAppendix.cards : []).slice(0, 15)) {
  if ((c.districtType || '') === 'None') continue;
  items.push({ score: 50, kind: 'tax_verify', ref: c.community, action: `VERIFY district rate for ${c.community} (${c.city}): ${c.districtName || c.districtType}. Source: ${c.source || 'county appraisal district'}. Unblocks a sellable tax card.` });
}

items.sort((a, b) => b.score - a.score);
ensure(p('reporting/verify-queue.json'));
writeFileSync(p('reporting/verify-queue.json'), JSON.stringify({ generated: new Date().toISOString(), count: items.length, items }, null, 2));

const md = [`# Verify Today (${today})`, `Ranked worklist. Twenty minutes here grows the published tape fastest.`, ''];
items.slice(0, 20).forEach((it, i) => md.push(`${i + 1}. [${it.score}] ${it.action}`));
if (!items.length) md.push('Queue is clear.');
writeFileSync(p('reporting/VERIFY-TODAY.md'), md.join('\n') + '\n');
console.log(`[verify-queue] ${items.length} items ranked; top: ${items[0] ? items[0].kind : 'none'}`);
