/* New Home Dispatch — shared analytics event layer.
 *
 * No analytics provider is installed yet. This file defines the event names
 * and firing points the site needs (playbook_download, chapter_read, etc.)
 * so that wiring a real provider later (GA4, Plausible, Fathom) is a one-line
 * change in trackEvent() below — not a re-instrumentation of every page.
 *
 * Until a provider exists, calls are safe no-ops. Add ?nhd_debug=1 to any URL
 * to see events logged to the console instead.
 */
window.NHD = window.NHD || {};

/* Google Analytics 4 — property "New Home Dispatch" · stream newhomedispatch.com
 * (Measurement ID G-120VH1FFY7, created 2026-07-23). Bootstrapped here so every
 * page that already loads analytics.js is instrumented from this one file, and
 * so trackEvent() below routes all custom events (terminal_view, watchlist_*,
 * subscription_*, buyerhelp_click, etc.) straight into GA4 with no per-page work. */
(function () {
  var GA_ID = 'G-120VH1FFY7';
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID);
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  (document.head || document.documentElement).appendChild(s);
})();

NHD.trackEvent = function (name, params) {
  params = params || {};
  try {
    if (typeof window.gtag === 'function') {
      window.gtag('event', name, params);
      return;
    }
    if (typeof window.plausible === 'function') {
      window.plausible(name, { props: params });
      return;
    }
    if (window.fathom && typeof window.fathom.trackEvent === 'function') {
      window.fathom.trackEvent(name);
      return;
    }
    if (window.location.search.indexOf('nhd_debug') !== -1) {
      console.log('[NHD event \u2014 no provider installed]', name, params);
    }
  } catch (e) {
    /* Tracking must never break the page. */
  }
};

/* Baseline auto-instrumentation: covers every page via link-pattern matching,
 * so chapter/community/builder/report pages get tracking without per-page wiring.
 * Explorer-specific events (comparison_started, comparison_completed, community_view
 * via the panel, email_subscribe) are fired directly from index.html's own JS,
 * since those are state changes, not link clicks. */
document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('a');
  if (!a) return;
  var href = a.getAttribute('href') || '';

  if (href.endsWith('.pdf')) {
    var name = 'download';
    if (href.indexOf('central-texas-new-home-playbook') !== -1) name = 'playbook_download';
    else if (href.indexOf('pamphlet-') !== -1) name = 'pamphlet_download';
    else if (href.indexOf('dare-to-compare-workbook') !== -1) name = 'compare_workbook_download';
    else if (/\/ch\d\d-/.test(href)) name = 'chapter_pdf_download';
    NHD.trackEvent(name, { href: href });
  } else if (href.indexOf('/library/') !== -1 && href.endsWith('.html')) {
    NHD.trackEvent('chapter_read', { href: href });
  } else if (href.indexOf('/communities/') !== -1 && href.endsWith('.html')) {
    NHD.trackEvent('community_view', { href: href });
  } else if (href.indexOf('/builders/') !== -1 && href.endsWith('.html')) {
    NHD.trackEvent('builder_view', { href: href });
  } else if (href.indexOf('/reports/') !== -1 && href.endsWith('.html')) {
    NHD.trackEvent('report_read', { href: href });
  } else if (href.indexOf('mailto:') === 0) {
    NHD.trackEvent('consultation_cta_click', { href: href });
  }
});
