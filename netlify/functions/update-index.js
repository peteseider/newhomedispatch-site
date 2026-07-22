// Append one Concession Index point. The twice-daily sweep POSTs here.
// Auth: header  x-index-key: <INDEX_WRITE_KEY env var>.  Body: JSON
//   { "t":"2026-07-21T06:05:00-05:00", "label":"Jul 21 AM",
//     "index":20000, "offers":9, "builders":8, "expired":11 }
const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
  const key = (event.headers['x-index-key'] || event.headers['X-Index-Key'] || '').trim();
  if (!process.env.INDEX_WRITE_KEY || key !== process.env.INDEX_WRITE_KEY) {
    return { statusCode: 401, body: 'unauthorized' };
  }
  let p;
  try { p = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, body: 'bad json' }; }
  if (!p || typeof p.index !== 'number' || !p.t) return { statusCode: 400, body: 'need {t, index}' };

  const store = getStore('concession-index');
  let series = await store.get('series', { type: 'json' });
  if (!series || !Array.isArray(series.points)) {
    series = { schema: 'nhd-concession-index-v1',
      metric: 'Median advertised cash incentive across verified tracked offers',
      unit: 'USD', timezone: 'America/Chicago', points: [] };
  }
  series.points = series.points.filter(x => x.t !== p.t); // replace same-timestamp
  series.points.push({ t: p.t, label: p.label || p.t.slice(0,10),
    index: p.index, offers: p.offers ?? null, builders: p.builders ?? null, expired: p.expired ?? null });
  series.points.sort((a, b) => (a.t < b.t ? -1 : 1));
  series.lastUpdated = p.t;
  series.lastUpdatedLabel = p.label || p.t;
  await store.setJSON('series', series);

  return { statusCode: 200, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, points: series.points.length, lastUpdatedLabel: series.lastUpdatedLabel }) };
};
