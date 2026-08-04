/**
 * netlify/functions/ingest-incentive-feed.js
 *
 * Webhook ingest endpoint for the daily builder-incentive sweep. Replaces
 * the git-push pipeline described in the sweep prompt's STEP 9b, which
 * required GitHub write credentials inside the sweep's Cowork scheduled-
 * task environment — a mechanism that turned out not to be obtainable
 * through that environment's settings. This sidesteps that category of
 * problem entirely: it's a plain authenticated HTTP POST, mirroring the
 * existing twilio-inbound-webhook.js pattern in this same repo (see that
 * file's header comment). The sweep's cloud sandbox can already make
 * outbound HTTPS calls on its own — it does so every run, against every
 * builder website it checks — so no new access grant is needed on the
 * writing side, ever, once this is deployed.
 *
 * SETUP (one-time):
 *   1. This file is deployed automatically as part of the repo (Netlify
 *      picks up anything in netlify/functions/ per netlify.toml).
 *   2. In Netlify's dashboard: Site settings -> Environment variables ->
 *      add INGEST_API_KEY (a long random secret). Redeploy after adding it
 *      — Netlify functions only pick up new env vars on the next deploy.
 *   3. Give the sweep task's prompt (STEP 9b) the same INGEST_API_KEY so it
 *      can send it as the x-api-key header on every run.
 *
 * REQUEST CONTRACT
 *   POST /.netlify/functions/ingest-incentive-feed
 *   Headers: x-api-key: <INGEST_API_KEY>, content-type: application/json
 *   Query string: ?kind=incentives (default, nhd-publishable-incentives-v2
 *                 shape) or ?kind=buyer-news (nhd-buyer-news-v1 shape)
 *   Body: the JSON payload itself.
 *
 * STORAGE
 *   Netlify Blobs, store "nhd-incentive-sweep":
 *     key "latest-incentives.json"  <- overwritten every run, current feed
 *     key "latest-buyer-news.json"  <- overwritten every run, current news
 *     key "history/incentives-<asOf>-<run>.json"  <- append-only archive
 *     key "history/buyer-news-<reviewedAt>.json"  <- append-only archive
 *   get-incentive-feed.js (sibling function) serves the "latest-*" keys
 *   back out over plain HTTP so the site's build/render layer can consume
 *   them without needing Blobs access itself.
 */

const { getStore } = require('@netlify/blobs');

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB safety cap

// Constant-time string comparison so the secret can't be inferred via
// response-timing differences.
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  const expectedKey = process.env.INGEST_API_KEY;
  if (!expectedKey) {
    // Fail closed: refuse writes rather than silently accepting them if the
    // secret isn't configured server-side yet.
    return json(500, { error: 'server_not_configured' });
  }

  const headers = event.headers || {};
  const apiKey = headers['x-api-key'] || headers['X-Api-Key'] || headers['X-API-KEY'];
  if (!apiKey || !timingSafeEqual(apiKey, expectedKey)) {
    return json(401, { error: 'unauthorized' });
  }

  const params = event.queryStringParameters || {};
  const kind = params.kind || 'incentives';
  if (kind !== 'incentives' && kind !== 'buyer-news') {
    return json(400, { error: 'invalid_kind', detail: 'kind must be "incentives" or "buyer-news"' });
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return json(413, { error: 'payload_too_large' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    return json(400, { error: 'invalid_json', detail: String(err && err.message) });
  }

  // Minimal shape validation so a malformed run can't quietly corrupt the
  // live feed. The sweep's own guardrails own the deeper validation; this
  // is just a sanity gate.
  if (kind === 'incentives') {
    if (!payload || !Array.isArray(payload.incentives)) {
      return json(400, { error: 'invalid_payload', detail: 'expected an object with an "incentives" array' });
    }
  } else {
    if (!payload || typeof payload.primary !== 'object' || payload.primary === null) {
      return json(400, { error: 'invalid_payload', detail: 'expected an object with a "primary" story' });
    }
  }

  const store = getStore('nhd-incentive-sweep');
  const nowIso = new Date().toISOString();
  const stamped = Object.assign({}, payload, { _ingestedAt: nowIso });

  try {
    if (kind === 'incentives') {
      await store.setJSON('latest-incentives.json', stamped);
      const asOf = payload.asOf || nowIso.slice(0, 10);
      const run = payload.run || 'UNKNOWN';
      await store.setJSON(`history/incentives-${asOf}-${run}.json`, stamped);
    } else {
      await store.setJSON('latest-buyer-news.json', stamped);
      const reviewedAt = (payload.primary && payload.primary.reviewedAt) || nowIso.slice(0, 10);
      await store.setJSON(`history/buyer-news-${reviewedAt}.json`, stamped);
    }
  } catch (err) {
    console.error('ingest-incentive-feed: storage write failed', err);
    return json(502, { error: 'storage_write_failed', detail: String(err && err.message) });
  }

  return json(200, { ok: true, kind, ingestedAt: nowIso });
};
