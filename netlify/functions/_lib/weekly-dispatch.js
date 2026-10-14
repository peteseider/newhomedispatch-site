/**
 * netlify/functions/_lib/weekly-dispatch.js
 *
 * Pure functions that turn the already-published daily data into the Weekly
 * Dispatch email. No network, no side effects, so it can be tested locally
 * against the real files.
 *
 * INPUTS (all already published on the site by the daily bridge):
 *   feed   reporting/incentive-sweep/publishable-latest.json  (today's verified-live offers)
 *   rate   reporting/rate-benchmark.json                      (daily 30-yr benchmark history)
 *
 * EDITORIAL RULES carried over from the Hot Sheet:
 *   - Offers are builder-advertised and verified on the builder's own site, never field-verified.
 *   - One home's price cut is not a community-wide discount; the copy says so.
 *   - No em or en dashes in buyer-facing copy.
 *   - A number is shown only if it can be computed from the inputs. If a section's
 *     inputs are missing it is dropped, never guessed.
 */

const SITE = 'https://newhomedispatch.com';

const MONTHS = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
function median(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function isoToUTC(iso) { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); }
function addDays(iso, n) { return new Date(isoToUTC(iso) + n * 86400000).toISOString().slice(0, 10); }
function prettyDate(iso) {
  return new Date(isoToUTC(iso) + 12 * 3600000).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
function shortDate(iso) {
  return new Date(isoToUTC(iso) + 12 * 3600000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Conservative deadline reader. Returns an ISO date or null. It only trusts a
 * date that follows an explicit end word, or the end of a "Month d-d, yyyy"
 * range. Anything ambiguous returns null and the offer is simply not listed
 * under "Ending soon".
 */
function parseDeadline(text, todayISO) {
  if (!text || typeof text !== 'string') return null;
  const t = text.replace(/\s+/g, ' ');
  const year0 = Number(todayISO.slice(0, 4));
  const found = [];
  const mk = (mon, day, yr) => {
    const m = MONTHS[String(mon).toLowerCase().replace('.', '')];
    if (m == null) return null;
    let y = yr ? Number(yr) : year0;
    const d = Number(day);
    if (!(d >= 1 && d <= 31)) return null;
    let iso = new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
    // Year not printed: if it lands in the past, assume next year only when clearly far behind.
    return iso;
  };
  // "through October 15", "end November 1", "ends Nov 1", "on or before October 31, 2026"
  const re1 = /(?:through|until|ends?|on or before|by)\s+([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/gi;
  let m;
  while ((m = re1.exec(t))) { const v = mk(m[1], m[2], m[3]); if (v) found.push(v); }
  // "Oct 1-31, 2026" window: the end of the range
  const re2 = /([A-Za-z]{3,9})\.?\s+\d{1,2}\s*(?:-|to)\s*(\d{1,2}),?\s+(\d{4})/gi;
  while ((m = re2.exec(t))) { const v = mk(m[1], m[2], m[3]); if (v) found.push(v); }
  // "11/30/2026"
  const re3 = /(?:close by|ends?|through|until|on or before|by)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/gi;
  while ((m = re3.exec(t))) { found.push(new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]))).toISOString().slice(0, 10)); }
  if (!found.length) return null;
  // Earliest explicit date that has not passed yet.
  const upcoming = found.filter((d) => d >= todayISO).sort();
  return upcoming.length ? upcoming[0] : null;
}

const ASK_THIS = [
  { q: 'Can you put this incentive in writing, with the dollar amount, the conditions, and the date it expires?', why: 'A number on a banner is an advertisement. The same number in your contract is a commitment. Ask for it on paper before you pay for anything.' },
  { q: 'If I use my own lender instead of yours, what exactly do I give up?', why: 'Many of the biggest incentives require the builder’s preferred lender. Knowing the price of saying no lets you compare the real cost of each path.' },
  { q: 'Is this price and incentive for this specific home, or for any home in the community?', why: 'A single quick-move-in home’s reduction is not a community-wide discount. Ask which homes qualify before you plan around the headline figure.' },
  { q: 'Is the rate you quoted a permanent rate, or does it adjust or step up later?', why: 'Temporary buydowns and adjustable-rate offers can look identical to a permanent low rate in an ad. The payment in year six can be very different.' },
  { q: 'What are the HOA dues, the total tax rate, and does the community have a MUD or PID?', why: 'These recurring costs change the monthly payment as much as a rate does, and they are rarely in the headline offer.' },
  { q: 'When does the incentive end, and does it depend on when I sign or when I close?', why: 'Some deadlines are contract dates and some are closing dates. Mixing them up is one of the most common ways buyers lose an incentive.' },
  { q: 'What does your standard warranty cover, and for how long, on structure and on systems?', why: 'Warranty terms vary by builder. The coverage you get is part of what you are comparing, even though it never appears in an offer.' },
  { q: 'Can I see the price history of this home or plan?', why: 'A home that has been on the market for months with several reductions tells you something about how much room there is to negotiate.' },
];

function pickAsk(todayISO) {
  const week = Math.floor(isoToUTC(todayISO) / (7 * 86400000));
  return ASK_THIS[week % ASK_THIS.length];
}

function closest_unused(points, targetISO) {
  // The index point on or before the target date; falls back to the nearest earlier one.
  let best = null;
  for (const p of points || []) {
    const d = (p.t || '').slice(0, 10);
    if (d && d <= targetISO && (!best || p.t > best.t)) best = p;
  }
  return best;
}

function analyze(feed, rate, todayISO) {
  const offers = (feed && Array.isArray(feed.incentives)) ? feed.incentives.filter((i) => i && i.expired !== true) : [];
  const valued = offers.filter((i) => typeof i.advertisedValue === 'number' && i.advertisedValue > 0);
  const builders = new Set(offers.map((i) => i.builderSlug || i.builder));
  const med = median(valued.map((i) => i.advertisedValue));

  // Best offer per builder, then top by value.
  const byBuilder = new Map();
  for (const i of valued) {
    const k = i.builderSlug || i.builder;
    if (!byBuilder.has(k) || i.advertisedValue > byBuilder.get(k).advertisedValue) byBuilder.set(k, i);
  }
  const biggest = Array.from(byBuilder.values()).sort((a, b) => b.advertisedValue - a.advertisedValue).slice(0, 8);

  // Ending soon: next 14 days, one row per builder (earliest deadline).
  const soonMap = new Map();
  for (const i of offers) {
    const d = parseDeadline(i.deadline, todayISO);
    if (!d) continue;
    const days = Math.round((isoToUTC(d) - isoToUTC(todayISO)) / 86400000);
    if (days < 0 || days > 14) continue;
    const k = i.builderSlug || i.builder;
    if (!soonMap.has(k) || d < soonMap.get(k).date) soonMap.set(k, { date: d, days, offer: i });
  }
  const ending = Array.from(soonMap.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);

  // Rates (daily benchmark history).
  const weekAgo = addDays(todayISO, -7);
  let rates = null;
  if (rate && Array.isArray(rate.history) && rate.history.length) {
    const hist = rate.history.filter((h) => h && typeof h.rate === 'number');
    const now = hist.filter((h) => h.date <= todayISO).slice(-1)[0];
    const then = hist.filter((h) => h.date <= weekAgo).slice(-1)[0];
    if (now) rates = { now, then: then || null, source: rate.source || 'Mortgage News Daily' };
  }

  return { offers, valued, builders: builders.size, med, biggest, ending, rates, benchmark: feed && feed.benchmarkRate };
}

function stat(label, value) {
  return '<td width="25%" align="center" style="padding:14px 6px;border-right:1px solid #e5e8ee;">'
    + '<div style="font:800 24px/1.1 Arial,Helvetica,sans-serif;color:#2B4FE0;">' + esc(value) + '</div>'
    + '<div style="font:11px/1.3 Arial,Helvetica,sans-serif;color:#5c6672;text-transform:uppercase;letter-spacing:.05em;margin-top:5px;">' + esc(label) + '</div></td>';
}
function h2(t) { return '<h2 style="font:700 19px/1.25 Arial,Helvetica,sans-serif;color:#0E1116;margin:0 0 6px;">' + esc(t) + '</h2>'; }
function sub(t) { return '<p style="font:13px/1.5 Arial,Helvetica,sans-serif;color:#5c6672;margin:0 0 12px;">' + t + '</p>'; }

function delta(now, then, fmt) {
  if (then == null || now == null) return '';
  const d = now - then;
  if (d === 0) return ' (unchanged from ' + fmt(then) + ')';
  return ' (' + (d > 0 ? 'up' : 'down') + ' from ' + fmt(then) + ')';
}

function build(a, todayISO) {
  const hasData = a.offers.length > 0 && a.valued.length > 0;
  const ask = pickAsk(todayISO);

  const headlineBits = [];
  headlineBits.push(a.valued.length + ' dollar-valued offers from ' + a.builders + ' builders');
  if (a.med != null) headlineBits.push('median ' + money(a.med));
  if (a.rates) headlineBits.push('30-year benchmark ' + a.rates.now.rate.toFixed(2) + '%');
  const subject = 'The Weekly Dispatch, ' + shortDate(todayISO) + ': ' + headlineBits.join(', ');
  const preheader = 'Your Friday read on Austin-area builder incentives: what is live, what ends soon, and what to ask before you sign.';

  const rows = [];
  rows.push('<tr><td style="padding:0;">');

  // Masthead
  rows.push('<div style="background:#0E1116;padding:22px 26px;">'
    + '<div style="font:12px/1 Arial,Helvetica,sans-serif;letter-spacing:.3em;text-transform:uppercase;color:#aeb8c7;">New Home Dispatch</div>'
    + '<div style="font:700 26px/1.2 Arial,Helvetica,sans-serif;color:#ffffff;margin-top:8px;">The Weekly Dispatch</div>'
    + '<div style="font:italic 700 14px/1.4 Arial,Helvetica,sans-serif;color:#7C97FF;margin-top:4px;">Look Closer.</div></div>');
  rows.push('<div style="background:#2B4FE0;color:#ffffff;padding:9px 26px;font:13px/1.4 Arial,Helvetica,sans-serif;">' + esc(prettyDate(todayISO)) + ' &middot; Austin and Central Texas</div>');

  // Snapshot
  rows.push('<div style="padding:22px 26px 8px;">' + h2('This week at a glance')
    + sub('Builder-advertised offers, verified on each builder’s own site this morning. Not field-verified.')
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e8ee;border-right:0;"><tr>'
    + stat('Builders with a dollar offer', String(a.builders))
    + stat('Dollar-valued offers', String(a.valued.length))
    + stat('Median dollar offer', a.med != null ? money(a.med) : 'n/a')
    + stat('Largest single offer', a.biggest[0] ? money(a.biggest[0].advertisedValue) : 'n/a')
    + '</tr></table>');
  rows.push('</div>');

  // Rates
  if (a.rates) {
    const r = a.rates;
    let line = 'The 30-year fixed benchmark (' + esc(r.source) + ') is <b>' + r.now.rate.toFixed(2) + '%</b> as of ' + esc(shortDate(r.now.date)) + '.';
    if (r.then) {
      const d = Math.round((r.now.rate - r.then.rate) * 100) / 100;
      line += ' A week earlier (' + esc(shortDate(r.then.date)) + ') it was ' + r.then.rate.toFixed(2) + '%, '
        + (d === 0 ? 'so it is unchanged.' : (d > 0 ? 'up ' : 'down ') + Math.abs(d).toFixed(2) + ' points.');
    }
    rows.push('<div style="padding:14px 26px 8px;">' + h2('Mortgage rates')
      + '<p style="font:14px/1.6 Arial,Helvetica,sans-serif;color:#0E1116;margin:0;">' + line + ' Builder rate promotions are worth comparing against this number, but check whether the rate is permanent, adjustable, or tied to a preferred lender.</p></div>');
  }

  // Ending soon
  if (a.ending.length) {
    let t = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font:13.5px/1.45 Arial,Helvetica,sans-serif;color:#0E1116;border-collapse:collapse;">'
      + '<tr><th align="left" style="padding:8px;border-bottom:2px solid #e5e8ee;font-size:11px;color:#5c6672;text-transform:uppercase;">Deadline</th><th align="left" style="padding:8px;border-bottom:2px solid #e5e8ee;font-size:11px;color:#5c6672;text-transform:uppercase;">Builder and offer</th></tr>';
    for (const e of a.ending) {
      const o = e.offer;
      const where = [o.community, o.city].filter(Boolean).join(', ');
      t += '<tr><td valign="top" style="padding:10px 8px;border-bottom:1px solid #e5e8ee;white-space:nowrap;"><b>' + esc(shortDate(e.date)) + '</b><br><span style="color:#5c6672;">' + (e.days === 0 ? 'today' : e.days === 1 ? '1 day' : e.days + ' days') + '</span></td>'
        + '<td valign="top" style="padding:10px 8px;border-bottom:1px solid #e5e8ee;"><b>' + esc(o.builder) + '</b>' + (where ? ' <span style="color:#5c6672;">(' + esc(where) + ')</span>' : '') + '<br>' + esc(clip(o.offerText || '', 170))
        + (o.sourceUrl ? ' <a href="' + esc(o.sourceUrl) + '" style="color:#2B4FE0;">source</a>' : '') + '</td></tr>';
    }
    t += '</table>';
    rows.push('<div style="padding:14px 26px 8px;">' + h2('Ending in the next two weeks') + sub('Deadlines as printed by the builder. Confirm whether the date applies to signing or to closing.') + t + '</div>');
  }

  // Biggest offers
  if (a.biggest.length) {
    let t = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font:13.5px/1.45 Arial,Helvetica,sans-serif;color:#0E1116;border-collapse:collapse;">'
      + '<tr><th align="left" style="padding:8px;border-bottom:2px solid #e5e8ee;font-size:11px;color:#5c6672;text-transform:uppercase;">Amount</th><th align="left" style="padding:8px;border-bottom:2px solid #e5e8ee;font-size:11px;color:#5c6672;text-transform:uppercase;">Builder, type, and what to check</th></tr>';
    for (const o of a.biggest) {
      const where = [o.community, o.city].filter(Boolean).join(', ');
      const tied = o.lenderTied === true ? 'Requires a preferred lender.' : (o.lenderTied === false ? 'No lender requirement stated.' : 'Lender requirement not stated.');
      const kind = o.incentiveType === 'price-cut' ? 'Price reduction on specific homes, not a community-wide discount.' : 'Program maximum; your amount depends on the home and terms.';
      t += '<tr><td valign="top" style="padding:10px 8px;border-bottom:1px solid #e5e8ee;white-space:nowrap;"><b>' + esc(money(o.advertisedValue)) + '</b></td>'
        + '<td valign="top" style="padding:10px 8px;border-bottom:1px solid #e5e8ee;"><b>' + esc(o.builder) + '</b>' + (where ? ' <span style="color:#5c6672;">(' + esc(where) + ')</span>' : '')
        + '<br><span style="color:#5c6672;">' + esc(kind) + ' ' + esc(tied) + '</span>'
        + (o.sourceUrl ? ' <a href="' + esc(o.sourceUrl) + '" style="color:#2B4FE0;">source</a>' : '') + '</td></tr>';
    }
    t += '</table>';
    rows.push('<div style="padding:14px 26px 8px;">' + h2('Largest advertised offers') + sub('One entry per builder, largest dollar figure first. These are advertised maximums, not what every buyer receives.') + t + '</div>');
  }

  // Ask this
  rows.push('<div style="padding:14px 26px 8px;"><div style="background:#f3f5fb;border:1px solid #dbe1f4;border-radius:6px;padding:16px 18px;">'
    + '<div style="font:700 11px/1 Arial,Helvetica,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#2B4FE0;margin-bottom:8px;">Ask this at the sales office</div>'
    + '<div style="font:700 16px/1.45 Arial,Helvetica,sans-serif;color:#0E1116;">“' + esc(ask.q) + '”</div>'
    + '<div style="font:14px/1.6 Arial,Helvetica,sans-serif;color:#0E1116;margin-top:8px;">' + esc(ask.why) + '</div></div></div>');

  // Daily link
  rows.push('<div style="padding:14px 26px 8px;"><p style="font:14px/1.6 Arial,Helvetica,sans-serif;color:#0E1116;margin:0;">The full tracker is updated every morning: <a href="' + SITE + '/daily-hot-sheet?utm_source=weekly-email&utm_medium=email&utm_campaign=weekly" style="color:#2B4FE0;">open today’s Daily Hot Sheet</a>.</p></div>');

  // Pete CTA
  rows.push('<div style="padding:18px 26px 22px;border-top:8px solid #f7f8fb;margin-top:12px;">'
    + '<h2 style="font:700 19px/1.25 Arial,Helvetica,sans-serif;color:#0E1116;margin:0 0 6px;">Looking at one of these builders? Reply and I’ll run the real numbers.</h2>'
    + '<p style="font:15px/1.6 Arial,Helvetica,sans-serif;color:#0E1116;margin:0;">I’m Pete Seider. I publish this sweep every morning and I represent buyers in new construction across Central Texas. Reply with the community and the offer you were quoted, and I’ll tell you what it is worth against today’s rates, what to compare it to, and what to ask for before you sign. No cost, no obligation.</p>'
    + '<p style="margin:12px 0 0;"><a href="https://calendly.com/pete-seider/phone-call?utm_source=weekly-email&utm_medium=email&utm_campaign=weekly" style="display:inline-block;background:#2B4FE0;color:#ffffff;text-decoration:none;font:700 14px/1 Arial,Helvetica,sans-serif;padding:12px 18px;border-radius:4px;">Book a 15-minute call</a> '
    + '<a href="' + SITE + '/buyer-strategy-call?utm_source=weekly-email&utm_medium=email&utm_campaign=weekly" style="font:600 14px/1 Arial,Helvetica,sans-serif;color:#2B4FE0;margin-left:10px;">or send me what you’re comparing &rarr;</a></p>'
    + '<p style="font:12px/1.6 Arial,Helvetica,sans-serif;color:#5c6672;margin:14px 0 0;">Buyer representation is provided through Seider Realty Team powered by The Ascend Group at LPT Realty, separate from New Home Dispatch’s editorial operation. Nothing about a call changes how any builder is reported here. <a href="' + SITE + '/iabs.html" style="color:#2B4FE0;">Texas brokerage disclosure</a>.</p></div>');

  // Footer
  rows.push('<div style="padding:16px 26px 26px;font:12px/1.6 Arial,Helvetica,sans-serif;color:#5c6672;">'
    + 'You’re receiving this because you asked for the Weekly Dispatch at newhomedispatch.com. <a href="{$unsubscribe}" style="color:#2B4FE0;">Unsubscribe</a> in one click. '
    + 'New Home Dispatch is an independent consumer publication; no builder pays to appear. Offers are builder-advertised claims, verified on the builder’s own site and not independently field-verified. Rates, amounts, deadlines, and eligibility can change without notice, and most rate offers require a builder-affiliated lender. Confirm all terms with the builder before relying on them. '
    + '<a href="' + SITE + '/methodology" style="color:#2B4FE0;">Methodology</a>.</div>');

  rows.push('</td></tr>');

  const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(subject) + '</title></head>'
    + '<body style="margin:0;padding:0;background:#f7f8fb;">'
    + '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">' + esc(preheader) + '</div>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f8fb;"><tr><td align="center" style="padding:14px 8px;">'
    + '<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:#ffffff;">'
    + rows.join('') + '</table></td></tr></table></body></html>';

  return { subject, html, hasData };
}

function clip(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '...' : s; }

module.exports = { analyze, build, parseDeadline, prettyDate, median };
