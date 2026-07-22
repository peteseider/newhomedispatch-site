/**
 * netlify/functions/twilio-checkin-send.js
 *
 * Scheduled function — runs automatically on the cadence set in netlify.toml
 * ([functions."twilio-checkin-send"] schedule = "..."). No human clicks
 * "send" for these; this is the autonomous side of rep outreach Pete asked
 * for (companion to the manual sms:/mailto: console in
 * tools/rep-outreach-console.html, which stays useful for one-off/ad-hoc
 * messages outside the regular cadence).
 *
 * WHAT IT DOES EACH RUN
 *   1. Reads every rep from the "rep-contacts" Blobs store.
 *   2. For each rep with a phone number, optOut !== true, and
 *      (today - lastContacted) >= (cadenceDays || 7): builds a short
 *      check-in text and sends it via the Twilio Messages API.
 *   3. On a successful send, updates lastContacted / lastContactChannel
 *      on that rep's record.
 *   4. Returns a JSON summary (sent / skipped / failed) — visible in the
 *      Netlify function log for each run.
 *
 * SAFETY GOVERNOR — TWILIO_LIVE_SEND
 *   This function will NOT place a real Twilio API call unless the env var
 *   TWILIO_LIVE_SEND is exactly the string "true". Any other value (unset,
 *   "false", empty) runs the full due/not-due logic and logs exactly what
 *   WOULD have been sent to whom, with zero API calls and zero cost/risk.
 *   This exists so Pete can verify the due-list and message copy look right
 *   BEFORE any autonomous message actually leaves — flip one env var in
 *   Netlify to go live, flip it back to pause the whole system instantly
 *   without touching code or waiting for a redeploy. Worth keeping even
 *   once trusted: it's the only kill switch for a system that otherwise
 *   texts real people with no per-message review.
 *
 * REQUIRED ENV VARS (Netlify dashboard -> Site configuration -> Environment
 * variables — typed in by Pete, never by Claude, same rule as
 * MAILERLITE_API_TOKEN):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER   the Twilio number reps' replies come back to
 *                        (also where the inbound webhook gets configured —
 *                        see twilio-inbound-webhook.js)
 *   TWILIO_LIVE_SEND     "true" to actually send; anything else = dry run
 *
 * See dispatch/twilio-autonomous-checkin-integration.md for the full setup
 * checklist (Twilio account, A2P 10DLC registration, cost/timeline).
 */

const { readAllReps, writeRep } = require('./_lib/blob-store');

const DEFAULT_CADENCE_DAYS = 7;
const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

function daysSince(dateStr) {
  if (!dateStr) return Infinity; // never contacted -> always due
  const then = new Date(dateStr + 'T00:00:00Z').getTime();
  const now = Date.now();
  return Math.floor((now - then) / 86400000);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function defaultCheckinMessage(rep) {
  const first = (rep.name || '').split(' ')[0] || 'there';
  const builder = rep.builder ? ` at ${rep.builder}` : '';
  return `Hey ${first}, it's Pete${builder ? ` — checking in on${builder}` : ''}. Anything new this week — promos, price/inventory changes, incentives worth flagging? Appreciate you.`;
}

function isDue(rep) {
  if (!rep.phone) return false;
  if (rep.optOut === true) return false;
  const cadence = Number.isFinite(rep.cadenceDays) ? rep.cadenceDays : DEFAULT_CADENCE_DAYS;
  return daysSince(rep.lastContacted) >= cadence;
}

async function sendTwilioSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    throw new Error('Twilio env vars not fully configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER)');
  }
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  const resp = await fetch(`${TWILIO_API_BASE}/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const msg = (json && json.message) || `Twilio API returned ${resp.status}`;
    throw new Error(msg);
  }
  return json; // includes .sid, .status
}

exports.handler = async () => {
  const live = process.env.TWILIO_LIVE_SEND === 'true';
  let reps;
  try {
    reps = await readAllReps();
  } catch (err) {
    console.error('twilio-checkin-send: could not read rep-contacts store', err);
    return { statusCode: 200, body: JSON.stringify({ error: 'could not read rep-contacts store', detail: String(err) }) };
  }

  const due = reps.filter(isDue);
  const results = { mode: live ? 'LIVE' : 'DRY-RUN', totalReps: reps.length, due: due.length, sent: [], failed: [], skipped: [] };

  for (const rep of due) {
    const msg = rep.checkinMessageOverride || defaultCheckinMessage(rep);
    if (!live) {
      results.sent.push({ repId: rep.repId, name: rep.name, phone: rep.phone, message: msg, note: 'DRY RUN — not actually sent' });
      continue;
    }
    try {
      const twilioResult = await sendTwilioSms(rep.phone, msg);
      rep.lastContacted = todayISO();
      rep.lastContactChannel = 'text-auto';
      await writeRep(rep);
      results.sent.push({ repId: rep.repId, name: rep.name, phone: rep.phone, twilioSid: twilioResult.sid, twilioStatus: twilioResult.status });
      console.log(`twilio-checkin-send: sent to ${rep.name} (${rep.repId}), Twilio sid ${twilioResult.sid}`);
    } catch (err) {
      results.failed.push({ repId: rep.repId, name: rep.name, phone: rep.phone, error: String(err.message || err) });
      console.error(`twilio-checkin-send: FAILED sending to ${rep.name} (${rep.repId})`, err);
    }
  }

  reps.filter((r) => !isDue(r)).forEach((r) => results.skipped.push({ repId: r.repId, name: r.name, reason: r.optOut ? 'opted out' : (r.phone ? 'not due yet' : 'no phone on file') }));

  console.log('twilio-checkin-send summary:', JSON.stringify({ mode: results.mode, totalReps: results.totalReps, due: results.due, sentCount: results.sent.length, failedCount: results.failed.length }));

  return { statusCode: 200, body: JSON.stringify(results, null, 2) };
};
