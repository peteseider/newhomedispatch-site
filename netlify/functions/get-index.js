// Serves the Concession Index time series for the Incentive Tracker chart.
// Reads the "concession-index" Netlify Blobs store (written by update-index.js
// from the twice-daily sweep). Falls back to the embedded seed so the chart
// always renders even before the first sweep POST or if Blobs is unavailable.
const { getStore } = require('@netlify/blobs');

const SEED = {
  schema: 'nhd-concession-index-v1',
  metric: 'Median advertised cash incentive across verified tracked offers',
  unit: 'USD', timezone: 'America/Chicago',
  lastUpdated: '2026-07-20T17:05:00-05:00',
  lastUpdatedLabel: 'Jul 20, 2026 · 5:05 PM CT',
  points: [{ t: '2026-07-20T17:05:00-05:00', label: 'Jul 20', index: 20000, offers: 9, builders: 8, expired: 11 }]
};

exports.handler = async () => {
  let series = SEED;
  try {
    const store = getStore('concession-index');
    const stored = await store.get('series', { type: 'json' });
    if (stored && Array.isArray(stored.points) && stored.points.length) series = stored;
  } catch (e) { /* fall back to seed */ }
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=120' },
    body: JSON.stringify(series)
  };
};
