#!/usr/bin/env node
/*
 * New Home Dispatch — Qualifying Tax Card generator (B2B product, data in hand TODAY)
 * -----------------------------------------------------------------------------------
 * Buyer: loan officers, processors, builder sales offices. The pain it kills:
 * mis-estimated MUD/PID taxes bust DTI at underwriting and kill deals late.
 * The worse alternative: guessing from portals or stale title sheets.
 *
 * From tax_district_master (the verified Atlas dataset), generates:
 *   data/derived/b2b/tax-cards.json   the licensable pack: per community, the
 *     district type, current verified rate, tax year, confidence, and the
 *     monthly district cost at 350k/500k/750k, with verification language.
 * Rule: only rows with confidence Verified ship in the sellable pack; Partial
 * rows are included in a clearly separated needs-verification appendix, priced
 * at zero, because selling unverified numbers to lenders would be suicide.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const p = (rel) => ROOT + rel;
const ensure = (f) => { const d = dirname(f); if (!existsSync(d)) mkdirSync(d, { recursive: true }); };

// district data ships with the site (atlas pipeline); accept either location
const src = ['atlas_districts.json', 'data/atlas_districts.json'].map(p).find(existsSync);
if (!src) { console.error('[taxcards] atlas_districts.json not found'); process.exit(1); }
const districts = JSON.parse(readFileSync(src, 'utf8'));

const monthly = (rate, price) => rate == null ? null : Math.round((price * rate / 100) / 12);
const card = (d) => ({
  community: d.community, city: d.city, county: d.county,
  districtType: d.district_type, districtName: d.district_name,
  ratePer100: d.rate_per_100 ?? null, pidAnnual: d.pid_annual ?? null,
  taxYear: d.tax_year || null, confidence: d.confidence,
  monthlyDistrictCost: d.rate_per_100 != null
    ? { at350k: monthly(d.rate_per_100, 350000), at500k: monthly(d.rate_per_100, 500000), at750k: monthly(d.rate_per_100, 750000) }
    : (d.pid_annual ? { pidMonthly: Math.round(d.pid_annual / 12) } : null),
  source: d.source_url || null, notes: d.notes || null
});

const verified = districts.filter(d => (d.confidence || '').toLowerCase() === 'verified').map(card);
const partial = districts.filter(d => (d.confidence || '').toLowerCase() !== 'verified').map(card);

const out = {
  schema: 'nhd-qualifying-tax-cards-v1',
  product: 'NHD Qualifying Tax Cards (per-community special-district rates for underwriting estimates)',
  disclosure: 'Verified rows are confirmed against county appraisal district or district records for the stated tax year. Rates change annually; confirm at the appraisal district before final underwriting. Illustrative, not tax or lending advice. New Home Dispatch is independent; no builder or lender influences coverage.',
  generated: new Date().toISOString(),
  counts: { verified: verified.length, needsVerification: partial.length },
  verifiedCards: verified.sort((a, b) => (b.ratePer100 ?? 0) - (a.ratePer100 ?? 0)),
  needsVerificationAppendix: { note: 'NOT for underwriting use until promoted to Verified. Ships free as a coverage map.', cards: partial }
};
ensure(p('data/derived/b2b/tax-cards.json'));
writeFileSync(p('data/derived/b2b/tax-cards.json'), JSON.stringify(out, null, 2));
console.log(`[taxcards] ${verified.length} verified sellable cards, ${partial.length} in the free needs-verification appendix`);
