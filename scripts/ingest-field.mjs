#!/usr/bin/env node
/*
 * New Home Dispatch — S3 field stream ingester
 * --------------------------------------------
 * Ingests reporting/field-intake.csv (rows captured at sales offices; see the
 * FIELD-INTAKE-README) into the event spine as field_observation events, and
 * cross-checks each row against the scraped verified offers.
 *
 * CONSTITUTION COMPLIANCE: sensors never write conclusions. This script NEVER
 * edits incentives.json. Where a field row confirms or contradicts a scraped
 * offer it writes a suggestion to reporting/field-confirmations.json for the
 * human editor to promote (confirm -> confidence upgrade; contradict -> the
 * verification queue and a possible "sign vs site" segment).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const p = (rel) => ROOT + rel;
const ensure = (f) => { const d = dirname(f); if (!existsSync(d)) mkdirSync(d, { recursive: true }); };

const csvPath = p('reporting/field-intake.csv');
if (!existsSync(csvPath)) { console.log('[field] no intake file; nothing to ingest'); process.exit(0); }

// dependency-free CSV parse (handles quoted fields with commas)
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
const header = rows[0].map(h => h.trim());
const data = rows.slice(1).filter(r => r.length > 3 && !(r.join('').includes('DELETE THIS EXAMPLE ROW')));
const col = (r, name) => { const i = header.indexOf(name); return i >= 0 ? (r[i] || '').trim() : ''; };

const inc = existsSync(p('incentives.json')) ? JSON.parse(readFileSync(p('incentives.json'), 'utf8')) : { records: [] };
const logPath = p('data/derived/offer-events.jsonl');
ensure(logPath);
const logText = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';

const confirmations = [];
let added = 0;
for (const r of data) {
  const builder = col(r, 'builder_slug'), community = col(r, 'community_slug'), date = col(r, 'date');
  if (!builder || !community || !date) continue;
  const key = `${date}|${builder}|${community}|${col(r, 'offer_desc')}`;
  if (logText.includes(JSON.stringify(key))) continue;
  appendFileSync(logPath, JSON.stringify({
    t: new Date().toISOString(), runKey: `${date}-FIELD`, key, type: 'field_observation',
    builder, community, offerDesc: col(r, 'offer_desc'),
    advertisedValue: +col(r, 'advertised_value') || null,
    rateOffered: +col(r, 'rate_offered') || null, rateType: col(r, 'rate_type'),
    lenderRequired: col(r, 'lender_required'), deadlineStated: col(r, 'deadline_stated'),
    webGap: col(r, 'web_gap').toLowerCase() === 'yes', flyer: col(r, 'flyer_file'),
    quote: col(r, 'quote_context'), tier: 'T4'
  }) + '\n');
  added++;

  // cross-check vs scraped record for the same builder+community
  const scraped = (inc.records || []).find(x => x.builderSlug === builder && x.communitySlug === community);
  if (scraped) {
    const fieldVal = +col(r, 'advertised_value') || null;
    const agrees = fieldVal !== null && Math.abs(fieldVal - scraped.advertisedValue) <= 0.1 * Math.max(fieldVal, scraped.advertisedValue);
    confirmations.push({
      id: scraped.id, builder, community, fieldDate: date,
      suggestion: agrees ? 'CONFIRM (upgrade confidence: web + field agree within 10%)' : 'CONTRADICTION (verification queue; possible sign vs site segment)',
      scrapedValue: scraped.advertisedValue, fieldValue: fieldVal,
      webGapFlag: col(r, 'web_gap').toLowerCase() === 'yes', quote: col(r, 'quote_context')
    });
  }
}
ensure(p('reporting/field-confirmations.json'));
writeFileSync(p('reporting/field-confirmations.json'), JSON.stringify({
  generated: new Date().toISOString(),
  note: 'Human-gated suggestions from the field stream. Promote confirms into incentives.json confidence; send contradictions to the verification queue. This file never edits verified data itself.',
  items: confirmations
}, null, 2));
console.log(`[field] ${added} observations ingested, ${confirmations.length} cross-checks written`);
