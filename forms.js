/* New Home Dispatch — form submission enhancement (shared).
   Progressive enhancement over native Netlify Forms:
   - Submits via fetch (AJAX) so the buyer stays in flow; on success we route to the
     form's existing thank-you page (the action attribute).
   - Honeypot guard (bot-field) blocks spam.
   - If the network fails, we never lose the lead: we surface a one-tap, pre-filled
     mailto to hello@newhomedispatch.com with the entered fields.
   - If fetch/FormData/URLSearchParams are unavailable, we do nothing and let the
     native Netlify POST proceed (graceful degradation).
   NOTE: actual email delivery of captured submissions is enabled once in the host
   dashboard (Netlify → Forms → Notifications → Email). This script does not depend
   on that; the mailto fallback works regardless. */
(function () {
  var FALLBACK_EMAIL = 'hello@newhomedispatch.com';
  function ready(fn){ document.readyState !== 'loading' ? fn() : document.addEventListener('DOMContentLoaded', fn); }

  ready(function () {
    if (!window.fetch || !window.FormData || !window.URLSearchParams) return; // native fallback
    var forms = document.querySelectorAll('form[data-netlify]');
    Array.prototype.forEach.call(forms, function (form) {
      form.addEventListener('submit', function (e) {
        var hp = form.querySelector('[name="bot-field"]');
        if (hp && hp.value) { e.preventDefault(); return; } // silent bot drop
        if (!form.checkValidity || form.checkValidity()) {
          e.preventDefault();
          submit(form);
        }
      });
    });
  });

  function submit(form) {
    var btn = form.querySelector('[type="submit"]');
    var original = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = 'Sending&hellip;'; }
    clearFallback(form);

    var body;
    try { body = new URLSearchParams(new FormData(form)).toString(); }
    catch (err) { restore(btn, original); form.submit(); return; }

    var action = form.getAttribute('action') || '/';

    // On the guide unlock, carry first name + email forward so the Weekly Dispatch
    // opt-in on the next screen is one tap (prefilled). No PII is stored server-side here.
    if ((form.getAttribute('name') === 'guide-signup') && action.indexOf('playbook-unlock') !== -1) {
      var fnEl = form.querySelector('[name="first_name"]');
      var emEl = form.querySelector('[name="email"]');
      var qp = [];
      if (fnEl && fnEl.value) qp.push('fn=' + encodeURIComponent(fnEl.value));
      if (emEl && emEl.value) qp.push('email=' + encodeURIComponent(emEl.value));
      if (qp.length) action += (action.indexOf('?') === -1 ? '?' : '&') + qp.join('&');
    }

    fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (window.NHD) NHD.trackEvent('form_submit_success', { form: form.getAttribute('name') || 'form' });
      window.location.href = action;
    }).catch(function () {
      restore(btn, original);
      showFallback(form);
    });
  }

  function restore(btn, original) {
    if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = original; }
  }

  function clearFallback(form) {
    var ex = form.querySelector('.form-fallback');
    if (ex) ex.parentNode.removeChild(ex);
  }

  function showFallback(form) {
    if (form.querySelector('.form-fallback')) return;
    var email = form.getAttribute('data-fallback-email') || FALLBACK_EMAIL;
    var subject = 'New Home Dispatch — ' + (form.getAttribute('name') || 'form');
    var lines = [];
    try {
      new FormData(form).forEach(function (v, k) {
        if (k !== 'bot-field' && k !== 'form-name' && String(v).trim()) lines.push(k.replace(/_/g, ' ') + ': ' + v);
      });
    } catch (e) {}
    var mailto = 'mailto:' + email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(lines.join('\n'));
    var box = document.createElement('div');
    box.className = 'form-fallback';
    box.setAttribute('role', 'alert');
    box.style.cssText = 'margin-top:14px; padding:12px 14px; border:1px solid #E0E0E0; border-left:3px solid #2B4FE0; background:#F4F4F4; border-radius:3px; font-size:0.9rem; line-height:1.45; color:#333;';
    box.innerHTML = 'We couldn’t send that automatically right now. Please <a href="' + mailto + '" style="color:#2B4FE0; text-decoration:underline; font-weight:600;">send it by email instead</a> — it’s already filled in and takes one tap.';
    form.appendChild(box);
  }
})();
