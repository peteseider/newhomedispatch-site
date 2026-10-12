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
   Current model: Hot Sheet daily each morning; Incentive Tracker data once daily (every morning)
   with a new issue every Monday; key moves roll into Friday's Weekly Dispatch. */
(function () {
  var SCHEDULE = {
    'daily-hot-sheet': 'EVERY MORNING',
    'incentive-tracker': 'MONDAYS',
    'weekly-dispatch': 'FRIDAYS'
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

/* v74: "Talk to Pete" block above the footer on data-heavy pages (hot sheet, tracker,
   builder/community/report pages, calculators). One edit here changes it everywhere.
   Skipped on conversion-owning pages and internal/team pages. */
(function(){
  function ready(fn){ if(document.readyState!=='loading'){fn();} else {document.addEventListener('DOMContentLoaded',fn);} }
  ready(function(){
    var path=(location.pathname||'').toLowerCase();
    var allow=['/daily-hot-sheet','/incentive-tracker','/builders','/communities','/reports','/true-cost-calculator','/incentive-calculator','/free-tools','/affordability','/down-payment-assistance','/mud-pid-atlas','/texas-tax-reality-guide','/tax-reality-guide','/library/','/buyer-guides','/leverage-report','/dare-to-compare','/zero-out-of-pocket','/kyle','/buda','/san-marcos','/south-austin','/areas','/negotiation-window','/deal-comes-last'];
    var skip=['/buyer-strategy-call','/thanks','/team/','/subscribe','/get-guides','/playbook-unlock','/first-time-buyers','/iabs','/share'];
    var ok=false; for(var i=0;i<allow.length;i++){ if(path.indexOf(allow[i])===0){ok=true;break;} }
    if(!ok) return;
    for(var j=0;j<skip.length;j++){ if(path.indexOf(skip[j])!==-1) return; }
    if(document.querySelector('.pete-cta-inject')) return;
    var footer=document.querySelector('footer'); if(!footer) return;
    var prefix=''; var self=document.querySelector('script[src$="nav.js"]'); if(self){ prefix=(self.getAttribute('src')||'').replace(/nav\.js.*$/,''); }
    var sec=document.createElement('section'); sec.className='pete-cta-inject'; sec.setAttribute('aria-label','Talk to Pete');
    sec.style.cssText='background:#fff;border-top:1px solid #E0E0E0;padding:34px 20px;margin:0;';
    sec.innerHTML='<div style="max-width:860px;margin:0 auto;display:flex;align-items:center;gap:18px 24px;flex-wrap:wrap;">'+
      '<img src="'+prefix+'assets/pete-seider-byline.jpg" alt="Pete Seider" style="width:56px;height:70px;object-fit:cover;object-position:top center;border-radius:3px;border:1px solid #D7DBE2;flex:0 0 56px;">'+
      '<div style="flex:1 1 320px;font-family:Inter,-apple-system,sans-serif;font-size:.97rem;line-height:1.55;color:#2B3542;"><strong style="color:#0F2942;">Looking at one of these builders?</strong> I’m Pete Seider. I publish this data every morning and I represent buyers in new construction. Fifteen minutes is enough to tell you what an offer is really worth before you sign. Free, no obligation.</div>'+
      '<div style="display:flex;gap:10px;flex-wrap:wrap;"><a href="https://calendly.com/pete-seider/phone-call" target="_blank" rel="noopener" style="display:inline-block;background:#2B4FE0;color:#fff;font-weight:700;font-size:.9rem;padding:11px 18px;border-radius:2px;text-decoration:none;">Book 15 minutes &rarr;</a>'+
      '<a href="'+prefix+'buyer-strategy-call.html" style="display:inline-block;color:#2B4FE0;font-weight:600;font-size:.9rem;padding:11px 6px;text-decoration:underline;">Send me what you’re comparing</a></div></div>';
    if(window.NHD&&NHD.trackEvent){ Array.prototype.forEach.call(sec.querySelectorAll('a'),function(a){ a.addEventListener('click',function(){ try{ NHD.trackEvent('buyerhelp_click',{from:'pete_block',page:path,target:/calendly/.test(a.href)?'calendly':'form'}); }catch(e){} }); }); }
    var band=document.querySelector('.wd-cta-inject');
    (band||footer).parentNode.insertBefore(sec, band||footer);
  });
})();
