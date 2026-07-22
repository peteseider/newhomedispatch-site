/**
 * netlify/functions/twilio-inbound-webhook.js
 *
 * Receives inbound SMS replies from reps. Configured once, by hand, on the
 * Twilio phone number: Phone Numbers -> Manage -> Active Numbers -> (the
 * number) -> Messaging -> "A message comes in" -> Webhook ->
 *   https://newhomedispatch.com/.netlify/functions/twilio-inbound-webhook
 * -> HTTP POST.
 *
 * WHAT IT DOES
 *   1. Parses the inbound Twilio webhook (form-encoded: From, Body, ...).
 *   2. Matches the sending phone number to a rep in the "rep-contacts"
 *      store (normalized to E.164 digits-only comparison).
 *   3. Writes a new observation into the "field-observations" store —
 *      same shape as a field-visit entry (schema nhd-field-observations-v1)
 *      so it flows into the exact same review/routing pipeline described in
 *      tools/field-observations-database-runbook.md. source:'rep-phone',
 *      confidence:'builder-claimed' — this is the RAW-CAPTURE tag (same
 *      internal vocabulary field-visit-summary.html already uses:
 *      verified/builder-claimed/needs-verification/untagged), not the
 *      public tracker's tier. When this row later gets routed/published
 *      into incentives.json, IT PUBLISHES AT confidence:'reported'
 *      ("Sales-office confirmed" — see incentive-tracker.html's real
 *      3-tier taxonomy: verified/reported/unverified) since it's in
 *      writing from the sales office — never auto-set to 'verified'
 *      without independent corroboration. See the routing rule in
 *      tools/field-observations-database-runbook.md.
 *   4. Updates the rep's lastContacted / lastContactChannel / lastResponseDate
 *      / lastResponseSummary so the outreach cadence knows they just checked in
 *      (a reply resets the clock same as an outbound send would).
 *   5. Replies with empty TwiML so Twilio does not auto-reply anything back
 *      to the rep — Pete reviews and responds himself if a reply is needed.
 *
 * An unmatched phone number (someone texting the Twilio number who isn't in
 * rep-contacts) is still logged, tagged unmatchedPhone:true, so nothing is
 * silently dropped — Pete can triage and add them as a new rep if it's a
 * real contact.
 */

const { readAllReps, writeRep, appendObservation } = require('./_lib/blob-store');

function normalizePhone(p) {
  return (p || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1'); // strip leading US country code for comparison
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function parseFormBody(body) {
  const params = new URLSearchParams(body);
  const out = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const fields = parseFormBody(event.body || '');
  const from = fields.From || '';
  const text = fields.Body || '';
  const messageSid = fields.MessageSid || '';

  if (!from || !text) {
    console.warn('twilio-inbound-webhook: missing From/Body on inbound webhook', fields);
    return twimlEmptyResponse();
  }

  let reps = [];
  try {
    reps = await readAllReps();
  } catch (err) {
    console.error('twilio-inbound-webhook: could not read rep-contacts store', err);
  }

  const fromNorm = normalizePhone(from);
  const rep = reps.find((r) => normalizePhone(r.phone) === fromNorm);

  const obsId = `rep-sms-${messageSid || Date.now()}`;
  const observation = {
    id: obsId,
    schema: 'nhd-field-observations-v1',
    loggedAt: new Date().toISOString(),
    source: 'rep-phone',
    channel: 'sms-inbound',
    repId: rep ? rep.repId : null,
    repName: rep ? rep.name : null,
    builder: rep ? rep.builder : null,
    community: rep ? rep.community || null : null,
    phone: from,
    unmatchedPhone: !rep,
    confidence: 'builder-claimed',
    rawText: text,
    quotable: false,          // default false — set true only after explicit rep consent, see runbook
    attributionApproved: false,
    routedStatus: { CP: false, BP: false, IT: false, WD: false, EXP: false, social: false },
    reviewed: false,
  };

  try {
    await appendObservation(observation);
  } catch (err) {
    console.error('twilio-inbound-webhook: failed to write observation', err);
  }

  if (rep) {
    try {
      rep.lastContacted = todayISO();
      rep.lastContactChannel = 'text-inbound';
      rep.lastResponseDate = todayISO();
      rep.lastResponseSummary = text.slice(0, 280);
      await writeRep(rep);
    } catch (err) {
      console.error('twilio-inbound-webhook: failed to update rep record', err);
    }
  } else {
    console.warn(`twilio-inbound-webhook: inbound text from unmatched number ${from} — logged as unmatchedPhone, not linked to a rep.`);
  }

  return twimlEmptyResponse();
};

function twimlEmptyResponse() {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml' },
    body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
  };
}
