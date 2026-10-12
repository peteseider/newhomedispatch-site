/* New Home Dispatch — shared Weekly Dispatch call-to-action (injected).
   Places ONE consistent Weekly Dispatch signup band just above the <footer> on
   content pages, so the flagship email capture appears at every warm reading exit
   without duplicating markup across ~40 files.

   Design notes:
   - Link-style (routes to subscribe-dispatch.html). No inline form → no per-page
     Netlify form wiring and no duplicate form-detection.
   - Fully self-contained inline styles (brand navy #0F2942 + blueprint accent) so it
     renders identically regardless of the host page's CSS.
   - Path-aware: derives its link prefix from its own <script src>, so it works from
     the site root and from /library, /builders, /communities subfolders.
   - Self-suppresses on pages where it would be redundant (homepage strip, the Dispatch
     issue/subscribe/thanks pages, the guide gate + unlock, the buyer-call page).
   - Opt out on any single page with <body data-no-dispatch-cta>. */
(function () {
  function ready(fn){ document.readyState !== 'loading' ? fn() : document.addEventListener('DOMContentLoaded', fn); }

  ready(function () {
    var path = (location.pathname || '').toLowerCase();
    var file = path.split('/').pop();

    // Homepage (root or index.html) already has a Dispatch strip.
    if (file === '' || file === 'index.html') return;

    // Redundant / conversion-owning pages: skip.
    var skip = ['subscribe-dispatch', 'thanks', 'weekly-dispatch',
                'get-guides', 'playbook-unlock', 'buyer-strategy-call'];
    for (var i = 0; i < skip.length; i++) { if (file.indexOf(skip[i]) !== -1) return; }

    if (document.querySelector('.wd-cta-inject')) return;                 // once only
    if (document.body && document.body.hasAttribute('data-no-dispatch-cta')) return; // per-page opt-out
    var footer = document.querySelector('footer');
    if (!footer) return;

    // Derive link prefix from our own script src ("" at root, "../" in a subfolder).
    var prefix = '';
    var self = document.querySelector('script[src$="dispatch-cta.js"]');
    if (self) { prefix = (self.getAttribute('src') || '').replace(/dispatch-cta\.js.*$/, ''); }

    var subscribe = prefix + 'subscribe-dispatch.html';
    var latest = prefix + 'daily-hot-sheet.html';

    var sec = document.createElement('section');
    sec.className = 'wd-cta-inject';
    sec.setAttribute('aria-labelledby', 'wd-cta-inject-title');
    sec.style.cssText = 'background:#0F2942;color:#fff;padding:56px 20px;margin:0;';

    sec.innerHTML =
      '<div style="max-width:760px;margin:0 auto;text-align:center;">' +
        '<div style="font-family:\'IBM Plex Mono\',ui-monospace,Menlo,monospace;font-size:0.68rem;letter-spacing:0.16em;text-transform:uppercase;color:#8FB0FF;">The Daily Hot Sheet &middot; By email, every morning</div>' +
        '<h2 id="wd-cta-inject-title" style="font-family:\'Archivo Expanded\',Arial,sans-serif;font-weight:700;font-size:clamp(1.4rem,3vw,1.9rem);line-height:1.18;color:#fff;margin:12px 0 12px;">One email a morning. Every Austin builder incentive, verified before you read it.</h2>' +
        '<p style="font-size:1rem;line-height:1.6;color:rgba(255,255,255,.80);max-width:56ch;margin:0 auto 24px;">What moved overnight, the deadlines that are real, and the expired offers still on builder websites. Five minutes, sourced to the builder&rsquo;s own page, free.</p>' +
        '<div style="display:flex;flex-wrap:wrap;gap:14px 22px;align-items:center;justify-content:center;">' +
          '<a href="' + subscribe + '" style="display:inline-block;background:#fff;color:#0A0A0A;font-weight:700;font-size:0.95rem;padding:13px 26px;border-radius:2px;text-decoration:none;">Get the morning Hot Sheet &rarr;</a>' +
          '<a href="' + latest + '" style="font-family:\'IBM Plex Mono\',ui-monospace,Menlo,monospace;font-size:0.72rem;letter-spacing:0.08em;text-transform:uppercase;color:#fff;text-decoration:underline;">Read today&rsquo;s first &rarr;</a>' +
        '</div>' +
      '</div>';

    // Track clicks if analytics present.
    if (window.NHD) {
      var links = sec.querySelectorAll('a');
      Array.prototype.forEach.call(links, function (a) {
        a.addEventListener('click', function () {
          try { NHD.trackEvent('weekly_dispatch_cta_click', { context: 'content_footer', file: file }); } catch (e) {}
        });
      });
    }

    // Insert without yanking the page out from under a reader who is already
    // near the bottom: if the insertion point is at/above the current viewport,
    // compensate the scroll position by the band's height so nothing visually moves.
    var footerTop = footer.getBoundingClientRect().top;
    footer.parentNode.insertBefore(sec, footer);
    if (footerTop < window.innerHeight && (window.scrollY || window.pageYOffset) > 0) {
      window.scrollBy(0, sec.offsetHeight);
    }
  });
})();
