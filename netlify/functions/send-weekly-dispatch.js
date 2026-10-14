/**
 * netlify/functions/send-weekly-dispatch.js
 *
 * Scheduled function: emails the Weekly Dispatch to the MailerLite "Weekly
 * Dispatch" group every Friday morning. The issue is built automatically from
 * data the daily bridge has already published (see _lib/weekly-dispatch.js), so
 * no one has to write it.
 *
 * SCHEDULE: netlify.toml, Fridays 12:30 UTC (7:30 AM CDT / 6:30 AM CST), retry 13:30 UTC.
 *
 * SAFETY
 *   - Same governor as the daily email: sends only if HOTSHEET_EMAIL_LIVE is exactly "true".
 *   - Skips unless the published feed is dated TODAY (America/Chicago). A stale
 *     issue never goes out.
 *   - Skips if a MailerLite campaign named "Weekly Dispatch <date>" already exists,
 *     so the retry slot cannot double-send.
 *   - Skips if the data produced no live offers (something is wrong upstream).
 *
 * ENV: MAILERLITE_API_TOKEN, HOTSHEET_EMAIL_LIVE, HOTSHEET_FROM_EMAIL (all already set).
 */

const { analyze, build } = require('./_lib/weekly-dispatch.js');

const ML = 'https://connect.mailerlite.com/api';
const WEEKLY_GROUP_ID = '193524324269819638'; // "Weekly Dispatch" group (see mailerlite-subscribe.js)
const SITE = 'https://newhomedispatch.com';

function todayCT() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function ml(token, path, opts) {
  const res = await fetch(ML + path, Object.assign({}, opts, {
    headers: Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' }, (opts && opts.headers) || {}),
  }));
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch (e) { body = text; }
  return { ok: res.ok, status: res.status, body };
}

async function getJSON(path) {
  const r = await fetch(SITE + path + '?x=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
  if (!r.ok) throw new Error(path + ' HTTP ' + r.status);
  return r.json();
}

exports.handler = async function () {
  const log = [];
  const say = (m) => { log.push(m); console.log('send-weekly-dispatch: ' + m); };
  const token = process.env.MAILERLITE_API_TOKEN;
  const live = process.env.HOTSHEET_EMAIL_LIVE === 'true';
  const today = todayCT();
  say('run ' + new Date().toISOString() + ' todayCT=' + today + ' mode=' + (live ? 'LIVE' : 'DRY-RUN'));
  if (!token) { say('ABORT: MAILERLITE_API_TOKEN is not set'); return { statusCode: 500, body: log.join('\n') }; }

  let feed, rate = null;
  try { feed = await getJSON('/reporting/incentive-sweep/publishable-latest.json'); }
  catch (e) { say('ABORT: could not fetch feed: ' + e.message); return { statusCode: 200, body: log.join('\n') }; }
  try { rate = await getJSON('/reporting/rate-benchmark.json'); } catch (e) { say('note: rate benchmark unavailable (' + e.message + '); rates section omitted'); }

  say('feed asOf=' + (feed && feed.asOf) + ' offers=' + (feed && feed.incentives && feed.incentives.length));
  if (!feed || feed.asOf !== today) { say('SKIP: feed is not today’s (' + (feed && feed.asOf) + ' vs ' + today + ')'); return { statusCode: 200, body: log.join('\n') }; }

  const a = analyze(feed, rate, today);
  const email = build(a, today);
  say('built: builders=' + a.builders + ' offers=' + a.offers.length + ' valued=' + a.valued.length + ' ending=' + a.ending.length + ' biggest=' + a.biggest.length + ' rates=' + (a.rates ? 'yes' : 'no'));
  if (!email.hasData) { say('SKIP: no live dollar-valued offers in today’s feed; not sending an empty issue'); return { statusCode: 200, body: log.join('\n') }; }

  const name = 'Weekly Dispatch ' + today;
  const recent = await ml(token, '/campaigns?limit=25');
  if (recent.ok && recent.body && Array.isArray(recent.body.data)) {
    const dupe = recent.body.data.find((c) => c && c.name === name);
    if (dupe) { say('SKIP: campaign already exists for this week (id ' + dupe.id + ', status ' + dupe.status + ')'); return { statusCode: 200, body: log.join('\n') }; }
  } else if (live) { say('ABORT: could not check existing campaigns (' + recent.status + '); not sending without a duplicate check'); return { statusCode: 200, body: log.join('\n') }; }

  const grp = await ml(token, '/groups/' + WEEKLY_GROUP_ID);
  if (!grp.ok) { say('ABORT: group lookup failed ' + grp.status + ' ' + JSON.stringify(grp.body).slice(0, 300)); return { statusCode: 200, body: log.join('\n') }; }
  const activeCount = grp.body && grp.body.data && grp.body.data.active_count;
  say('group ok: "' + (grp.body.data && grp.body.data.name) + '" active=' + activeCount);

  const fromEmail = process.env.HOTSHEET_FROM_EMAIL || 'hello@newhomedispatch.com';
  const fromName = process.env.HOTSHEET_FROM_NAME || 'New Home Dispatch';
  say('subject="' + email.subject + '" from=' + fromName + ' <' + fromEmail + '> html=' + email.html.length + ' bytes');

  if (!live) { say('DRY-RUN complete: would create + send campaign to group ' + WEEKLY_GROUP_ID + ' (' + activeCount + ' active).'); return { statusCode: 200, body: log.join('\n') }; }

  const create = await ml(token, '/campaigns', { method: 'POST', body: JSON.stringify({
    name, type: 'regular',
    emails: [{ subject: email.subject.slice(0, 250), from_name: fromName, from: fromEmail, content: email.html }],
    groups: [WEEKLY_GROUP_ID],
  }) });
  if (!create.ok) { say('FAIL: campaign create ' + create.status + ' ' + JSON.stringify(create.body).slice(0, 600)); return { statusCode: 200, body: log.join('\n') }; }
  const id = create.body && create.body.data && create.body.data.id;
  say('campaign created id=' + id);
  const sched = await ml(token, '/campaigns/' + id + '/schedule', { method: 'POST', body: JSON.stringify({ delivery: 'instant' }) });
  if (!sched.ok) { say('FAIL: schedule ' + sched.status + ' ' + JSON.stringify(sched.body).slice(0, 600)); return { statusCode: 200, body: log.join('\n') }; }
  say('SENT: campaign ' + id + ' scheduled for instant delivery');
  return { statusCode: 200, body: log.join('\n') };
};
