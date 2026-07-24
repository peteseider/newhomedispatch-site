#!/usr/bin/env node
/*
 * New Home Dispatch — S6 builder earnings sensor (weekly)
 * -------------------------------------------------------
 * Pulls SEC EDGAR XBRL facts for the public builders on our entity spine and
 * builds the earnings tape: quarterly revenue, gross profit, and gross margin
 * per builder, plus earnings-release events appended to the event spine.
 *
 * WHY (the proprietary part is the JOIN, not the filing): earnings are public,
 * but nobody joins national margin compression to a LOCAL advertised-incentive
 * tape. Once both series accrue, we can measure the Earnings-to-Tape lag:
 * does a builder's Austin advertising deepen before or after its margins
 * compress? That lead/lag is ours alone, because the local tape is ours alone.
 *
 * Sources: data.sec.gov XBRL companyconcept + submissions APIs (free, public;
 * SEC asks for a descriptive User-Agent and modest request rates, honored here).
 * Consolidated national figures, clearly labeled as such; never presented as
 * Austin-specific numbers.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const p = (rel) => ROOT + rel;
const ensure = (f) => { const d = dirname(f); if (!existsSync(d)) mkdirSync(d, { recursive: true }); };
const UA = { 'User-Agent': 'NewHomeDispatch research desk (newhomedispatch.com; pete.seider@gmail.com)' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// public builders on the entity spine -> SEC CIK (10 digits)
const CIK = {
  'dr-horton': '0000882184', 'lennar': '0000920760', 'pulte-homes': '0000822416',
  'kb-home': '0000795266', 'toll-brothers': '0000794170', 'meritage': '0001018844',
  'taylor-morrison': '0001562476', 'century-communities': '0001576940',
  'lgi-homes': '0001580670', 'mi-homes': '0000799292', 'tri-pointe': '0001561680'
};
const REV_TAGS = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax'];

async function concept(cik, tag) {
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`, { headers: UA });
  if (!res.ok) return null;
  return res.json();
}
export function quarterly(conceptJson) {
  // exported for offline testing: pick quarterly (~3 month) USD facts from 10-Q/10-K
  if (!conceptJson || !conceptJson.units || !conceptJson.units.USD) return [];
  const rows = conceptJson.units.USD.filter(u => u.form === '10-Q' || u.form === '10-K');
  const qs = rows.filter(u => {
    const days = (Date.parse(u.end) - Date.parse(u.start)) / 864e5;
    return days > 75 && days < 105; // a fiscal quarter, not YTD or annual
  });
  const byEnd = new Map();
  for (const q of qs) byEnd.set(q.end, q); // latest filed wins per period end
  return [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
}

const tape = { schema: 'nhd-earnings-tape-v1', metric: 'Public builder quarterly revenue, gross profit, gross margin (consolidated national, SEC XBRL)', source: 'https://data.sec.gov (EDGAR XBRL)', lastUpdated: new Date().toISOString(), builders: {} };
const logPath = p('data/derived/offer-events.jsonl');
ensure(logPath);
const logText = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';

let ok = 0;
for (const [slug, cik] of Object.entries(CIK)) {
  try {
    let rev = null;
    for (const tag of REV_TAGS) { rev = await concept(cik, tag); if (rev && rev.units) break; await sleep(150); }
    await sleep(150);
    const gp = await concept(cik, 'GrossProfit');
    await sleep(150);
    const revQ = quarterly(rev), gpQ = quarterly(gp);
    const gpByEnd = new Map(gpQ.map(q => [q.end, q.val]));
    const quarters = revQ.slice(-8).map(q => ({
      end: q.end, fp: q.fp, fy: q.fy,
      revenue: q.val, grossProfit: gpByEnd.get(q.end) ?? null,
      grossMarginPct: gpByEnd.has(q.end) && q.val ? +((gpByEnd.get(q.end) / q.val) * 100).toFixed(1) : null
    }));
    const margins = quarters.map(q => q.grossMarginPct).filter(v => v !== null);
    const last = margins.at(-1) ?? null;
    const prior4 = margins.slice(-5, -1);
    tape.builders[slug] = {
      cik, quarters, noData: quarters.length === 0,
      latestMarginPct: last,
      marginVsPrior4Avg: last !== null && prior4.length ? +(last - prior4.reduce((a, b) => a + b, 0) / prior4.length).toFixed(1) : null
    };
    if (quarters.length === 0) { console.error(`[earnings] ${slug}: no quarterly data returned (network or tag miss)`); continue; }
    // earnings-release events from the latest filings
    const sub = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: UA }).then(r => r.ok ? r.json() : null);
    await sleep(150);
    if (sub && sub.filings && sub.filings.recent) {
      const f = sub.filings.recent;
      for (let i = 0; i < f.form.length && i < 40; i++) {
        if (f.form[i] === '10-Q' || f.form[i] === '10-K') {
          const key = `${slug}|${f.accessionNumber[i]}`;
          if (!logText.includes(JSON.stringify(key))) {
            appendFileSync(logPath, JSON.stringify({ t: new Date().toISOString(), runKey: `${f.filingDate[i]}-EARNINGS`, key, type: 'earnings_filing', builder: slug, form: f.form[i], filed: f.filingDate[i] }) + '\n');
          }
        }
      }
    }
    ok++;
  } catch (e) { console.error(`[earnings] ${slug}: ${e.message}`); }
}
tape.note = 'Consolidated national figures from SEC filings; never Austin-specific. The research use is the join: margin trend vs our local advertised tape (Earnings-to-Tape lag), computable once both series accrue.';
ensure(p('data/derived/earnings-tape.json'));
writeFileSync(p('data/derived/earnings-tape.json'), JSON.stringify(tape, null, 2));
console.log(`[earnings] ${ok}/${Object.keys(CIK).length} builders tapped`);
