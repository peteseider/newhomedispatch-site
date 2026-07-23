/* New Home Dispatch — grouped nav enhancements (shared).
   The mobile drawer opens via an inline onclick that toggles body.nav-open, so it works
   even if this file fails to load. This script only ADDS niceties.
   v73: dropdowns now also open on click/tap (they were hover-only, which left
   touch input and missed hovers with no way to open the menus). */
(function () {
  function ready(fn){ if(document.readyState!=='loading'){fn();} else {document.addEventListener('DOMContentLoaded',fn);} }
  ready(function () {
    var body = document.body;
    var toggle = document.querySelector('.menu-toggle');
    var mobile = document.querySelector('.nav-mobile');

    function closeDrawer(refocus) {
      body.classList.remove('nav-open');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      // Undo the position:fixed scroll-lock (see the toggle's inline onclick —
      // plain overflow:hidden on <body> does not stop background scroll on iOS
      // Safari, so opening the drawer pins the body in place and this restores
      // the exact scroll position on close).
      var y = parseInt(body.dataset.scrollY || '0', 10);
      body.style.position = '';
      body.style.top = '';
      body.style.width = '';
      body.style.overflow = '';
      // behavior:'instant' — the site sets html{scroll-behavior:smooth} globally,
      // which would otherwise turn this restore into a slow animated scroll and
      // leave it short if anything reads the position before it finishes.
      window.scrollTo({ top: y, left: 0, behavior: 'instant' });
      if (refocus && toggle) toggle.focus();
    }
    if (mobile) {
      mobile.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function () { closeDrawer(false); });
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && body.classList.contains('nav-open')) closeDrawer(true);
    });

    // Desktop dropdown groups: CSS :hover still opens on pointer hover;
    // aria-expanded adds a second, input-agnostic open path (click, tap, keyboard).
    var groups = [];
    function closeAllGroups(except) {
      groups.forEach(function (g) { if (g.btn !== except) g.btn.setAttribute('aria-expanded', 'false'); });
    }
    document.querySelectorAll('.nav-grp').forEach(function (grp) {
      var btn = grp.querySelector('.nav-grp-btn');
      if (!btn) return;
      groups.push({ grp: grp, btn: btn });
      function set(open) { btn.setAttribute('aria-expanded', open ? 'true' : 'false'); }
      set(false);
      grp.addEventListener('mouseenter', function () { set(true); });
      grp.addEventListener('mouseleave', function () { set(false); });
      grp.addEventListener('focusin', function () { set(true); });
      grp.addEventListener('focusout', function () { if (!grp.contains(document.activeElement)) set(false); });
      grp.addEventListener('keydown', function (e) { if (e.key === 'Escape') { set(false); btn.focus(); } });

      // Click/tap toggle. On touch, the tap sequence fires mouseenter (set true)
      // BEFORE click — so we snapshot the state at pointerdown to know the user's
      // intent, instead of reading the already-mutated aria value.
      var wasOpen = false;
      btn.addEventListener('pointerdown', function () {
        wasOpen = btn.getAttribute('aria-expanded') === 'true';
      });
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        closeAllGroups(btn);
        set(!wasOpen);
        wasOpen = !wasOpen;
      });
    });
    // Tap/click outside closes any click-opened menu.
    document.addEventListener('click', function () { closeAllGroups(null); });
  });
})();


/* v118: single-source publication-schedule badges. Change the cadence HERE once
   and every page's nav badges update at load (static HTML remains the fallback).
   Current model: Hot Sheet daily each morning; Incentive Tracker data twice daily
   with a new issue every Monday; key moves roll into Friday's Weekly Dispatch. */
(function () {
  var SCHEDULE = {
    'daily-hot-sheet': 'EVERY MORNING',
    'incentive-tracker': 'MONDAYS',
    'weekly-dispatch': 'FREE · FRIDAY'
  };
  function apply() {
    Object.keys(SCHEDULE).forEach(function (key) {
      var links = document.querySelectorAll('a[href$="' + key + '.html"], a[href$="' + key + '"]');
      Array.prototype.forEach.call(links, function (a) {
        var spans = a.querySelectorAll('span');
        Array.prototype.forEach.call(spans, function (sp) {
          var t = (sp.textContent || '').trim();
          if (t.length && t.length <= 16 && t === t.toUpperCase() && /[A-Z]/.test(t)) {
            sp.textContent = SCHEDULE[key];
          }
        });
      });
    });
  }
  if (document.readyState !== 'loading') { apply(); }
  else { document.addEventListener('DOMContentLoaded', apply); }
  window.NHD_SCHEDULE = SCHEDULE;
})();
