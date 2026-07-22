/* New Home Dispatch — living-profile module (injected).
   On builder/community profile pages, renders a "Tracked incentives" section computed
   from the shared incentive dataset (window.NHD_INCENTIVES, loaded via incentives-data.js).
   One dataset feeds the tracker, the Dispatch, and every profile — profiles update the
   moment the weekly data does, with zero per-page editing.
   - Skips pages marked <body data-no-entity-intel> (the tracked-entity stubs render
     their offers server-side).
   - Inserts above the injected Dispatch band (this script runs first in source order).
   - All figures carry their source tier; sample flag shown while data.sample is true. */
(function () {
  function ready(fn){ document.readyState !== 'loading' ? fn() : document.addEventListener('DOMContentLoaded', fn); }
  ready(function () {
    var D = window.NHD_INCENTIVES;
    if (!D || !D.records) return;
    if (document.body.hasAttribute('data-no-entity-intel')) return;
    if (document.querySelector('.nhd-entity-intel')) return;
    var m = (location.pathname || '').toLowerCase().match(/\/(communities|builders)\/([a-z0-9-]+)\.html$/);
    if (!m) return;
    var kind = m[1], slug = m[2];
    var key = kind === 'communities' ? 'communitySlug' : 'builderSlug';
    var recs = D.records.filter(function (r) { return r[key] === slug; });
    if (!recs.length) return;
    var footer = document.querySelector('footer');
    if (!footer) return;

    var usd = function (n) { return '$' + Math.round(n).toLocaleString('en-US'); };
    function fmtd(d){ if(!d) return 'Ongoing'; var p=d.split('-'); var mo=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return mo[(+p[1])-1]+' '+(+p[2]); }
    function tax(v){ return parseFloat(v.toFixed(2)) + '%'; }
    var SRC = { verified:'Verified', reported:'Sales-office confirmed', unverified:'Builder-reported' };
    var entityName = kind === 'communities' ? recs[0].community : recs[0].builder;

    var cards = recs.map(function (r) {
      var other = kind === 'communities'
        ? (r.builderSlug ? '<a href="../builders/' + r.builderSlug + '.html" style="color:inherit;">' + r.builder + '</a>' : r.builder)
        : (r.communitySlug ? '<a href="../communities/' + r.communitySlug + '.html" style="color:inherit;">' + r.community + '</a>' : r.community);
      var trend = r.delta > 0 ? '<span style="color:#1F7A3D;font-weight:700;">&#9650; +' + usd(r.delta) + ' this week</span>'
                : r.delta < 0 ? '<span style="color:#B32020;font-weight:700;">&#9660; &minus;' + usd(Math.abs(r.delta)) + ' this week</span>'
                : '<span style="color:#666;font-weight:700;">flat this week</span>';
      return '<div style="border:1px solid #E0E0E0;border-left:3px solid #2B4FE0;border-radius:2px;padding:16px 18px;margin-top:14px;">' +
        '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline;">' +
          '<span style="font-weight:700;">' + other + ' &middot; ' + r.incentiveType + '</span>' +
          '<span style="font-weight:800;font-size:1.15rem;letter-spacing:-.01em;">' + usd(r.advertisedValue) + ' <span style="font-size:.68rem;font-weight:600;color:#666;">advertised</span></span>' +
        '</div>' +
        '<div style="font-size:.85rem;color:#333;margin-top:8px;line-height:1.6;">' +
          r.transferability + ' buyer value &middot; ' + (r.lenderTied ? 'builder&rsquo;s lender required' : 'no lender tie') +
          ' &middot; eff. tax ' + tax(r.taxRate) + (r.taxNote ? ' (' + r.taxNote + ')' : '') +
          ' &middot; ' + (r.expires ? 'ends ' + fmtd(r.expires) : 'ongoing') + ' &middot; ' + trend +
        '</div>' +
        '<div style="font-size:.76rem;color:#666;margin-top:6px;">' + SRC[r.confidence] + ' &middot; observed ' + fmtd(r.lastObserved) + (D.sample ? ' &middot; <em>sample data</em>' : '') + '</div>' +
      '</div>';
    }).join('');

    var sec = document.createElement('section');
    sec.className = 'nhd-entity-intel';
    sec.style.cssText = 'border-top:2px solid #0A0A0A;margin-top:44px;';
    sec.innerHTML =
      '<div style="max-width:1180px;margin:0 auto;padding:30px 28px 34px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;">' +
          '<h2 style="font-size:1.3rem;margin:0;letter-spacing:-.01em;">Tracked incentives ' + (kind === 'communities' ? 'at ' : 'from ') + entityName + '</h2>' +
          '<span style="font-family:\'IBM Plex Mono\',ui-monospace,monospace;font-size:.65rem;letter-spacing:.12em;text-transform:uppercase;color:#666;">From the Incentive Tracker &middot; updated ' + fmtd(D.updated) + '</span>' +
        '</div>' +
        cards +
        '<p style="font-size:.8rem;color:#666;line-height:1.6;margin:14px 0 0;">Field observations labeled by source — not builder-verified facts. Confirm terms in writing before acting.' + (D.sample ? ' Sample data until launch.' : '') + '</p>' +
        '<div style="margin-top:16px;"><a href="../incentive-tracker.html" style="font-family:\'IBM Plex Mono\',ui-monospace,monospace;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:#2B4FE0;text-decoration:underline;">Compare against every tracked offer &rarr;</a></div>' +
      '</div>';
    footer.parentNode.insertBefore(sec, footer);
    if (window.NHD) { try { NHD.trackEvent('entity_intel_view', { kind: kind, slug: slug }); } catch (e) {} }
  });
})();
