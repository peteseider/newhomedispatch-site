/**
 * netlify/functions/get-incentive-feed.js
 *
 * Read-side companion to ingest-incentive-feed.js (see that file's header
 * comment for the full pipeline this replaces). Serves the current sweep
 * feed / buyer-news back out as plain JSON so the site's build step, an
 * on-demand-builder page, or client-side fetch can consume it without
 * needing Netlify Blobs access itself.
 *
 *   GET /.netlify/functions/get-incentive-feed                (incentives)
 *   GET /.netlify/functions/get-incentive-feed?kind=buyer-news
 *
 * No auth required — this mirrors the current static incentives.json,
 * which is already public site data. Add the same x-api-key check as the
 * ingest function if this ever needs to be gated.
 */

const { getStore } = require('@netlify/blobs');

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {}),
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'method_not_allowed' });
  }

  const params = event.queryStringParameters || {};
  const kind = params.kind || 'incentives';
  if (kind !== 'incentives' && kind !== 'buyer-news') {
    return json(400, { error: 'invalid_kind', detail: 'kind must be "incentives" or "buyer-news"' });
  }

  const store = getStore('nhd-incentive-sweep');
  const key = kind === 'incentives' ? 'latest-incentives.json' : 'latest-buyer-news.json';

  let data;
  try {
    data = await store.get(key, { type: 'json' });
  } catch (err) {
    console.error('get-incentive-feed: storage read failed', err);
    return json(502, { error: 'storage_read_failed', detail: String(err && err.message) });
  }

  if (!data) {
    return json(404, { error: 'not_found', detail: `no ${kind} feed has been ingested yet` });
  }

  // Short cache: the feed updates at most twice a day, but this keeps a
  // stale page load from serving hours-old data mid-rebuild.
  return json(200, data, { 'Cache-Control': 'public, max-age=60, s-maxage=300' });
};
