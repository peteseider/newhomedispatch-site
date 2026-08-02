/**
 * netlify/functions/nc-listings.js
 *
 * STAGED, NOT YET LINKED FROM ANY LIVE PAGE. Built 2026-08-02 as the data
 * layer for showing live new construction IDX listings on Community and
 * Builder Profile pages, once Pete confirms with his MLS/IDX vendor that
 * newhomedispatch.com is an authorized display domain under the Seider
 * Realty Team's ACTRIS/Unlock MLS IDX agreement. peteseider.com is the
 * confirmed domain today. A second display domain is often a named-URL
 * addition to the same agreement rather than a separate license, but that
 * has not been confirmed in writing yet. Do not link this function's
 * output into site navigation, sitemap.xml, or any indexed page until
 * that confirmation lands. See production/idx-listings-architecture.md
 * in the project for the standing decision log.
 *
 * This function does not talk to MLS Grid directly and does not need its
 * own MLSGRID_TOKEN. It proxies the already configured, already verified
 * live peteseider.com mls-search endpoint (confirmed configured true,
 * returning real Unlock MLS ACTRIS listings as of 2026-08-02) and
 * filters and reshapes the result for NHD's use:
 *   - keeps only newConstruction true listings. NHD's whole positioning
 *     is new construction, this is never a general resale search
 *   - optional city filter via ?city=
 *   - optional loose community match via ?community=, checked against
 *     city and address text. MLS Grid's IDX feed carries no NHD community
 *     ID, so this is a heuristic match, not a real join
 *   - passes the MLS attribution string straight through unmodified,
 *     since IDX display rules require it verbatim wherever a listing
 *     actually renders
 *
 * Response shape matches the upstream endpoint:
 *   { configured, ok, count, attribution, listings: [...] }
 */

const UPSTREAM_URL = 'https://peteseider.com/.netlify/functions/mls-search';

const EMPTY_RESPONSE = (extra) => ({
    configured: false,
    ok: false,
    count: 0,
    attribution: '',
    listings: [],
    ...extra,
});

exports.handler = async (event) => {
    const qs = event.queryStringParameters || {};
    const cityFilter = (qs.city || '').trim().toLowerCase();
    const communityFilter = (qs.community || '').trim().toLowerCase();

    let upstream;
    try {
          const resp = await fetch(UPSTREAM_URL);
          if (!resp.ok) {
                  console.error(`nc-listings: upstream mls-search returned ${resp.status}`);
                  return {
                            statusCode: 200,
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(EMPTY_RESPONSE({ error: `upstream ${resp.status}` })),
                  };
          }
          upstream = await resp.json();
    } catch (err) {
          console.error('nc-listings: request to upstream mls-search failed', err);
          return {
                  statusCode: 200,
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(EMPTY_RESPONSE({ error: 'upstream request failed' })),
          };
    }

    if (!upstream || upstream.configured !== true || !Array.isArray(upstream.listings)) {
          return {
                  statusCode: 200,
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(EMPTY_RESPONSE({ attribution: (upstream && upstream.attribution) || '' })),
          };
    }

    let listings = upstream.listings.filter((l) => l && l.newConstruction === true);

    if (cityFilter) {
          listings = listings.filter((l) => (l.city || '').trim().toLowerCase() === cityFilter);
    }
    if (communityFilter) {
          listings = listings.filter((l) => {
                  const hay = `${l.address || ''} ${l.city || ''}`.toLowerCase();
                  return hay.includes(communityFilter);
          });
    }

    return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
                  configured: true,
                  ok: true,
                  count: listings.length,
                  attribution: upstream.attribution,
                  debugUpstreamCount: upstream.listings.length,
                    debugUpstreamNewConstructionCount: upstream.listings.filter((l) => l && l.newConstruction === true).length,
                    listings,
          }),
    };
};
