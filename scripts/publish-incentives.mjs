#!/usr/bin/env node
/*
 * New Home Dispatch -- publish-incentives.mjs
 * -------------------------------------------
 * Merges the Cowork daily builder-sweep's verified publishable feed into the
 * live, human-maintained incentives.json, so the site's Daily Hot Sheet
 * Terminal and Share Kit stop running on stale (previously up to a week old)
 * data. Added 2026-08-03 -- this is the bridge the sweep prompt's STEP 9b
 * comments describe but that never actually existed in this repo.
 *
 * Triggered by .github/workflows/publish-incentives.yml whenever the Cowork
 * sweep task pushes reporting/incentive-sweep/publishable-latest.json here.
 *
 * SAFETY MODEL (deliberately conservative -- this touches live consumer data):
 *   - Only UPDATES records that already exist in incentives.json, matched by
 *     builderSlug + a fuzzy community-name match. It never invents a new
 *     community or builder row -- check_consistency.cjs requires every
 *     tracked communitySlug/builderSlug to already have a profile page +
 *     entities.json entry, so a newly-invented row would fail that gate.
 *   - Unmatched feed rows (a builder/community not yet in incentives.json)
 *     are written to reporting/incentive-sweep/new-page-candidates.json
 *     instead of being silently dropped or silently inserted -- a human
 *     decides whether to stand up a new profile page.
 *   - Every touched record keeps its edit history (old value pushed to
 *     history[]), gets prevValue/delta, and lastObserved stamped to the
 *     feed's asOf date.
 *   - Does NOT auto-expire records absent from today's feed -- the feed only
 *     carries PUBLISHABLE rows, so absence looks identical to a fetch-failed
 *     carry-forward. Expiry stays owned by the sweep's own reviewed delta
 *     ("Expired / stale watch") and a human's periodic pass, to avoid a
 *     false removal.
 *   - promos[] (top-level permanent-rate promos) is synced directly from the
 *     feed's promos[], per the sweep prompt's STEP 10 (flagged there as the
 *     single highest-priority field to keep current).
 *   - Never touches taxRate/taxNote/transferability/buyerValueScore/
 *     submarket/homeType or any other editorial field -- those stay
 *     human-owned.
 *   - Runs check_consistency.cjs itself as a first gate; the workflow runs
 *     it again as a second gate before allowing a commit.
 */
import fs from 'fs';

const FEED_PATH = 'reporting/incentive-sweep/publishable-latest.json';
const INCENTIVES_PATH = 'incentives.json';
const CANDIDATES_PATH = 'reporting/incentive-sweep/new-page-candidates.json';

function log(msg) { console.log(msg); }

if (!fs.existsSync(FEED_PATH)) {
  log('No publishable feed at ' + FEED_PATH + ' -- nothing to merge.');
  process.exit(0);
}

const feed = JSON.parse(fs.readFileSync(FEED_PATH, 'utf8'));
const inc = JSON.parse(fs.readFileSync(INCENTIVES_PATH, 'utf8'));

function normCommunity(s) {
  return (s || '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function findMatch(row) {
  const bySlugAll = inc.records.filter(r => r.builderSlug === row.builderSlug);
  if (bySlugAll.length === 0) return null;
  const target = normCommunity(row.community);
  let match = bySlugAll.find(r => normCommunity(r.community) === target);
  if (match) return match;
  match = bySlugAll.find(r => {
    const rc = normCommunity(r.community);
    return rc && target && (rc.includes(target) || target.includes(rc));
  });
  if (match) return match;
  if (bySlugAll.length === 1) return bySlugAll[0];
  return null;
}

const today = feed.asOf;
let updated = 0;
const skippedNoMatch = [];

for (const row of (feed.incentives || [])) {
  const rec = findMatch(row);
  if (!rec) { skippedNoMatch.push(row); continue; }
  const valueChanged = rec.advertisedValue !== row.advertisedValue;
  const alreadyCurrent = !valueChanged && rec.incentiveType === row.incentiveType && rec.expired !== true && rec.lastObserved === today;
  if (alreadyCurrent) continue;
  if (valueChanged) {
    rec.history = rec.history || [];
    rec.history.push({ value: rec.advertisedValue, asOf: rec.lastObserved || null });
    rec.prevValue = rec.advertisedValue;
    rec.delta = (row.advertisedValue ?? 0) - (rec.advertisedValue ?? 0);
  }
  rec.advertisedValue = row.advertisedValue;
  rec.incentiveType = row.incentiveType || rec.incentiveType;
  if (typeof row.lenderTied !== 'undefined') rec.lenderTied = row.lenderTied;
  if (row.deadline) rec.expires = row.deadline;
  rec.expired = false;
  rec.confidence = 'builder-advertised';
  rec.lastObserved = today;
  rec.source = row.sourceUrl || rec.source;
  rec.note = 'Source: ' + (row.sourceUrl || rec.source || '') + ' (builder-advertised) verified ' + today + '.';
  rec.run = feed.run || rec.run;
  updated++;
}

if (Array.isArray(feed.promos)) {
  inc.promos = feed.promos.map(p => ({
    id: p.id,
    builder: p.builder,
    community: p.community,
    promo: p.promo,
    expires: p.expires,
    lastObserved: p.lastObserved,
    firstObserved: p.firstObserved,
    confidence: p.confidence,
    source: p.source,
    note: p.note,
  }));
}

inc.dates = inc.dates || [];
if (!inc.dates.includes(today)) inc.dates.push(today);
inc.updated = today;

if (skippedNoMatch.length) {
  let candidates = [];
  if (fs.existsSync(CANDIDATES_PATH)) {
    try { candidates = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8')); } catch { candidates = []; }
  }
  const seen = new Set(candidates.map(c => c.builderSlug + '|' + c.community));
  for (const row of skippedNoMatch) {
    const key = row.builderSlug + '|' + row.community;
    if (seen.has(key)) continue;
    candidates.push({
      builderSlug: row.builderSlug,
      builder: row.builder,
      community: row.community,
      advertisedValue: row.advertisedValue,
      firstFlagged: today,
      note: 'No matching record in incentives.json -- needs a profile page or a manual match before it can publish.',
    });
    seen.add(key);
  }
  fs.writeFileSync(CANDIDATES_PATH, JSON.stringify(candidates, null, 2) + '\n');
  log('Flagged ' + skippedNoMatch.length + ' unmatched feed row(s) to ' + CANDIDATES_PATH + ' -- not auto-published.');
}

fs.writeFileSync(INCENTIVES_PATH, JSON.stringify(inc, null, 2) + '\n');
log('Merged ' + updated + ' record(s) from ' + FEED_PATH + ' into ' + INCENTIVES_PATH + ' (asOf ' + today + ').');
