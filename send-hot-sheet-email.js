/**
 * netlify/functions/send-hot-sheet-email.js
 *
 * Scheduled function: emails the Daily Builder Incentive Hot Sheet to the
 * MailerLite "Daily Hot Sheet" group every morning, after the sweep has
 * published. This is the delivery mechanism the site has promised since July
 * ("get the morning read by email") and never had.
 *
 * SCHEDULE: netlify.toml [functions."send-hot-sheet-email"] schedule. Netlify
 * cron is UTC. The daily bridge publishes team/hot-sheet-digest.html at about
 * 12:00 UTC year-round (it is keyed to a fixed 11:45 UTC wake, not local
 * time), so 12:30 UTC is the send. send-hot-sheet-email-retry.js runs the
 * same handler at 13:30 UTC in case the digest was late; the Blobs dedupe
 * below guarantees at most one send per day.
 *
 * WHAT IT DOES
 *   1. Fetches https://newhomedispatch.com/team/hot-sheet-digest.html.
 *   2. Confirms the digest is TODAY's (America/Chicago). If not, skips.
 *   3. Confirms it has not already sent today (Netlify Blobs store
 *      "hot-sheet-email", key "last-sent"). If it has, skips.
 *   4. Wraps the digest in an email shell (preheader, header, Pete's sign-off
 *      with a reply prompt and the strategy-call link, MailerLite unsubscribe
 *      merge tag) and creates a MailerLite campaign to the Daily Hot Sheet
 *      group, then schedules it for instant delivery.
 *   5. Records the send date in Blobs.
 *
 * SAFETY GOVERNOR: HOTSHEET_EMAIL_LIVE
 *   Unless the Netlify env var HOTSHEET_EMAIL_LIVE is exactly "true", this
 *   runs every step except campaign creation and logs what it WOULD send
 *   (recipient group, subject, sender, content length, freshness result).
 *   Same pattern as TWILIO_LIVE_SEND. Flip it in the Netlify dashboard to go
 *   live; flip it back to pause with no code change.
 *
 * ENV (all in Netlify; nothing new is required beyond the flag):
 *   MAILERLITE_API_TOKEN   already set (used by mailerlite-subscribe.js)
 *   HOTSHEET_EMAIL_LIVE    "true" to send
 *   HOTSHEET_FROM_EMAIL    optional; a verified MailerLite sender. If unset,
 *                          the function reuses the sender of the most recent
 *                          sent campaign, else hello@newhomedispatch.com.
 *   HOTSHEET_FROM_NAME     optional, default "New Home Dispatch"
 */

const { getStore } = require('@netlify/blobs');

const ML = 'https://connect.mailerlite.com/api';
const DAILY_GROUP_ID = '193542652911682577'; // "Daily Hot Sheet" group (see mailerlite-subscribe.js)
const SITE = 'https://newhomedispatch.com';
const DIGEST_URL = SITE + '/team/hot-sheet-digest.html';

function todayCT() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function prettyDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

async function ml(token, path, opts) {
  const res = await fetch(ML + path, Object.assign({}, opts, {
    headers: Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' }, (opts && opts.headers) || {}),
  }));
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch (e) { body = text; }
  return { ok: res.ok, status: res.status, body };
}

function extractHeadline(html) {
  const m = html.match(/<section><h2>([^<]+)<\/h2>/);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

function buildEmail(digestHtml, dateISO) {
  // Keep the digest's own <style> block (Gmail, Apple Mail and most clients honor
  // embedded styles) and its body markup; drop the outer document shell.
  const style = (digestHtml.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
  const bodyInner = (digestHtml.match(/<body>([\s\S]*?)<\/body>/) || [, digestHtml])[1];
  const headline = extractHeadline(digestHtml);
  const preheader = headline || 'Today’s verified Austin builder incentives, read before you talk to a builder.';

  return [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>NHD Daily Hot Sheet, ' + dateISO + '</title>',
    '<style>', style,
    'body{background:#f7f8fb;margin:0;padding:0}.nhd-em-top{max-width:940px;margin:0 auto;padding:14px 18px;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#5c6672}',
    '.nhd-em-top a{color:#2B4FE0}.nhd-pete{max-width:940px;margin:0 auto;background:#fff;border-top:8px solid #f7f8fb;padding:24px 30px;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#0E1116}',
    '.nhd-pete h2{font-size:19px;margin:0 0 6px}.nhd-pete .btn{display:inline-block;background:#2B4FE0;color:#fff!important;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:4px;margin:8px 10px 0 0}',
    '.nhd-pete .alt{display:inline-block;color:#2B4FE0;font-weight:600;margin:8px 0 0}.nhd-em-foot{max-width:940px;margin:0 auto;padding:16px 18px 28px;font:12px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#5c6672}.nhd-em-foot a{color:#2B4FE0}',
    '</style></head><body>',
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">' + preheader + '</div>',
    '<div class="nhd-em-top">The Daily Hot Sheet for ' + prettyDate(dateISO) + '. Verified on builders’ own sites this morning. <a href="' + SITE + '/daily-hot-sheet?utm_source=hotsheet-email&utm_medium=email&utm_campaign=daily">Open the live version</a>.</div>',
    bodyInner,
    '<div class="nhd-pete">',
    '<h2>Looking at one of these builders? Reply and I’ll run the real numbers.</h2>',
    '<p>I’m Pete Seider. I publish this sweep every morning and I represent buyers in new construction across Central Texas. Reply to this email with the community and the offer you were quoted, and I’ll tell you what it’s actually worth against today’s rates, what to compare it to, and what to ask for before you sign. No cost, no obligation.</p>',
    '<a class="btn" href="https://calendly.com/pete-seider/phone-call?utm_source=hotsheet-email&utm_medium=email&utm_campaign=daily">Book a 15-minute call</a> ',
    '<a class="alt" href="' + SITE + '/buyer-strategy-call?utm_source=hotsheet-email&utm_medium=email&utm_campaign=daily">or send me what you’re comparing &rarr;</a>',
    '<p style="font-size:12px;color:#5c6672;margin:14px 0 0">Buyer representation is provided through Seider Realty Team powered by The Ascend Group at LPT Realty, separate from New Home Dispatch’s editorial operation. Nothing about a call changes how any builder is reported here. <a href="' + SITE + '/iabs.html" style="color:#2B4FE0">Texas brokerage disclosure</a>.</p>',
    '</div>',
    '<div class="nhd-em-foot">You’re receiving this because you asked for the Daily Hot Sheet at newhomedispatch.com. <a href="{$unsubscribe}">Unsubscribe</a> in one click. New Home Dispatch is an independent consumer publication; no builder pays to appear. <a href="' + SITE + '/methodology">Methodology</a>.</div>',
    '</body></html>',
  ].join('\n');
}

exports.handler = async function () {
  const log = [];
  const say = (m) => { log.push(m); console.log('send-hot-sheet-email: ' + m); };
  const token = process.env.MAILERLITE_API_TOKEN;
  const live = process.env.HOTSHEET_EMAIL_LIVE === 'true';
  const today = todayCT();
  say('run ' + new Date().toISOString() + ' todayCT=' + today + ' mode=' + (live ? 'LIVE' : 'DRY-RUN'));

  if (!token) { say('ABORT: MAILERLITE_API_TOKEN is not set'); return { statusCode: 500, body: log.join('\n') }; }

  // 1-2. Fetch digest and check freshness.
  let digest;
  try {
    const r = await fetch(DIGEST_URL + '?x=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    digest = await r.text();
  } catch (e) { say('ABORT: could not fetch digest: ' + e.message); return { statusCode: 200, body: log.join('\n') }; }
  const titleDate = (digest.match(/<title>[^<]*?(\d{4}-\d{2}-\d{2})/) || [])[1];
  say('digest title date=' + titleDate + ' bytes=' + digest.length);
  if (titleDate !== today) { say('SKIP: digest is not today’s (' + titleDate + ' vs ' + today + ')'); return { statusCode: 200, body: log.join('\n') }; }

  // 3. Dedupe.
  let store = null, lastSent = null;
  try { store = getStore('hot-sheet-email'); lastSent = await store.get('last-sent', { type: 'json' }); } catch (e) { say('blobs unavailable (' + e.message + '); proceeding without dedupe'); }
  if (lastSent && lastSent.date === today) { say('SKIP: already sent today (campaign ' + lastSent.campaignId + ')'); return { statusCode: 200, body: log.join('\n') }; }

  // 4. Sender + group checks.
  const grp = await ml(token, '/groups/' + DAILY_GROUP_ID);
  if (!grp.ok) { say('ABORT: group lookup failed ' + grp.status + ' ' + JSON.stringify(grp.body).slice(0, 300)); return { statusCode: 200, body: log.join('\n') }; }
  const groupName = grp.body && grp.body.data && grp.body.data.name;
  const activeCount = grp.body && grp.body.data && grp.body.data.active_count;
  say('group ok: "' + groupName + '" active=' + activeCount);

  let fromEmail = process.env.HOTSHEET_FROM_EMAIL || '';
  let fromName = process.env.HOTSHEET_FROM_NAME || 'New Home Dispatch';
  if (!fromEmail) {
    const prev = await ml(token, '/campaigns?filter[status]=sent&limit=1');
    const c = prev.ok && prev.body && prev.body.data && prev.body.data[0];
    const em = c && c.emails && c.emails[0];
    if (em && em.from) { fromEmail = em.from; fromName = em.from_name || fromName; say('sender reused from last sent campaign: ' + fromEmail); }
  }
  if (!fromEmail) { fromEmail = 'hello@newhomedispatch.com'; say('sender default: ' + fromEmail + ' (set HOTSHEET_FROM_EMAIL to override; must be verified in MailerLite)'); }

  const headline = extractHeadline(digest);
  const subject = 'Hot Sheet ' + prettyDate(today).replace(/,\s*\d{4}$/, '') + (headline ? ': ' + headline.replace(/^Today's headline:\s*/i, '') : '');
  const html = buildEmail(digest, today);
  say('subject="' + subject + '" from=' + fromName + ' <' + fromEmail + '> html=' + html.length + ' bytes');

  if (!live) { say('DRY-RUN complete: would create + send campaign to group ' + DAILY_GROUP_ID + ' (' + activeCount + ' active). Set HOTSHEET_EMAIL_LIVE=true to send.'); return { statusCode: 200, body: log.join('\n') }; }

  // 5. Create + send.
  const create = await ml(token, '/campaigns', { method: 'POST', body: JSON.stringify({
    name: 'Daily Hot Sheet ' + today,
    type: 'regular',
    emails: [{ subject: subject.slice(0, 250), from_name: fromName, from: fromEmail, content: html }],
    groups: [DAILY_GROUP_ID],
  }) });
  if (!create.ok) { say('FAIL: campaign create ' + create.status + ' ' + JSON.stringify(create.body).slice(0, 600)); return { statusCode: 200, body: log.join('\n') }; }
  const id = create.body && create.body.data && create.body.data.id;
  say('campaign created id=' + id);
  const sched = await ml(token, '/campaigns/' + id + '/schedule', { method: 'POST', body: JSON.stringify({ delivery: 'instant' }) });
  if (!sched.ok) { say('FAIL: schedule ' + sched.status + ' ' + JSON.stringify(sched.body).slice(0, 600)); return { statusCode: 200, body: log.join('\n') }; }
  say('SENT: campaign ' + id + ' scheduled for instant delivery');
  if (store) { try { await store.setJSON('last-sent', { date: today, campaignId: id, at: new Date().toISOString() }); } catch (e) { say('blobs write failed: ' + e.message); } }
  return { statusCode: 200, body: log.join('\n') };
};
