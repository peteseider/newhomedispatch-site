#!/usr/bin/env node
/* New Home Dispatch — pre-deploy consistency checker.
   Run from the site root before every deploy:  node check_consistency.cjs
   Exits non-zero if the publication would contradict itself. Guards the rules
   set after the Executive Review Board audit:
   1. Single source per fact — tracker tax rates must match the community pages'.
   2. Every tracked entity has a profile page.
   3. The Dispatch quotes the tracker — the issue's median row must equal the
      dataset's computed median (current and previous week).
   4. Verification is earned — no 'verified' rows while sample:true.
   5. The registry (entities.json) is in sync with the incentive data. */
const fs = require('fs');

let fails = 0, checks = 0;
function ok(name, cond, detail) {
  checks++;
  if (cond) { console.log('  ✓ ' + name); }
  else { fails++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

const inc = JSON.parse(fs.readFileSync('incentives.json', 'utf8'));
const reg = JSON.parse(fs.readFileSync('entities.json', 'utf8'));

// 1. tax agreement with community pages
let mismatches = [];
for (const f of fs.readdirSync('communities')) {
  const t = fs.readFileSync('communities/' + f, 'utf8');
  const m = t.match(/a_taxRate=([0-9.]+)/);
  if (!m) continue;
  const name = decodeURIComponent((t.match(/a_label=([^&"]+)/) || [])[1] || '').replace(/\+/g, ' ');
  const rec = inc.records.find(r => r.community === name);
  if (rec && Math.abs(rec.taxRate - parseFloat(m[1])) > 0.001) mismatches.push(name + ': tracker ' + rec.taxRate + ' vs page ' + m[1]);
}
ok('Tax rates agree between tracker and community pages', mismatches.length === 0, mismatches.join('; '));

// 2. every tracked entity has a page
const noCommPage = inc.records.filter(r => !r.communitySlug || !fs.existsSync('communities/' + r.communitySlug + '.html')).map(r => r.community);
const noBldrPage = inc.records.filter(r => !r.builderSlug || !fs.existsSync('builders/' + r.builderSlug + '.html')).map(r => r.builder);
ok('Every tracked community has a profile page', noCommPage.length === 0, [...new Set(noCommPage)].join(', '));
ok('Every tracked builder has a profile page', noBldrPage.length === 0, [...new Set(noBldrPage)].join(', '));

// 3. Dispatch median row matches the dataset
function medianAt(i) {
  const v = inc.records.map(r => (r.history[i] ? r.history[i].value : r.advertisedValue)).sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
const n = inc.dates.length;
const k = v => '$' + (Math.round(v / 100) / 10).toFixed(1).replace(/\.0$/, '') + 'k';
const curK = k(medianAt(n - 1)), prevK = k(medianAt(n - 2));
for (const f of ['weekly-dispatch-01-email.html', 'weekly-dispatch-01-email-safe.html', 'weekly-dispatch-01-email.txt']) {
  const t = fs.readFileSync(f, 'utf8');
  const hasRow = t.includes('Median incentive (tracked)');
  const hasVals = t.includes(curK) && t.includes(prevK);
  ok('Issue median row matches dataset (' + f + ')', hasRow && hasVals, 'expected ' + prevK + ' → ' + curK);
}

// 4. verification is earned
const verifiedRows = inc.records.filter(r => r.confidence === 'verified').length;
ok('No unearned Verified rows while sample:true', !(inc.sample && verifiedRows > 0), verifiedRows + ' verified rows on sample data');

// 5. registry sync
const regC = new Set(reg.communities.map(c => c.slug)), regB = new Set(reg.builders.map(b => b.slug));
const missC = [...new Set(inc.records.map(r => r.communitySlug))].filter(s => !regC.has(s));
const missB = [...new Set(inc.records.map(r => r.builderSlug))].filter(s => !regB.has(s));
ok('Registry covers all tracked communities', missC.length === 0, missC.join(', '));
ok('Registry covers all tracked builders', missB.length === 0, missB.join(', '));
ok('Registry updated date matches incentive data', reg.updated === inc.updated, reg.updated + ' vs ' + inc.updated);

console.log('\n' + (fails === 0 ? 'ALL ' + checks + ' CONSISTENCY CHECKS PASSED — safe to deploy.' : fails + ' of ' + checks + ' checks FAILED — do not deploy until fixed.'));
process.exit(fails === 0 ? 0 : 1);
