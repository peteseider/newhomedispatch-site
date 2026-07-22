/* Dispatch Assistant launcher — floating button on every page + one-time teaser.
   Pure client-side; remembers teaser dismissal on this device. */
(function(){
  function ready(f){document.readyState!=='loading'?f():document.addEventListener('DOMContentLoaded',f);}
  ready(function(){
    if(/assistant\.html$/.test(location.pathname)) return;               // not on the assistant itself
    if(document.getElementById('nhd-asst-launch')) return;
    // resolve site root relative to current page depth
    var depth=(location.pathname.replace(/\/[^\/]*$/,'').match(/\//g)||[]).length-1;
    var prefix=''; try{
      var probe=document.querySelector('script[src$="assistant-launcher.js"]');
      if(probe){ prefix=probe.getAttribute('src').replace('assistant-launcher.js',''); }
    }catch(e){}
    var href=prefix+'assistant.html';
    var wrap=document.createElement('div');
    wrap.id='nhd-asst-launch';
    wrap.style.cssText='position:fixed;right:18px;bottom:18px;z-index:9000;display:flex;flex-direction:column;align-items:flex-end;gap:10px;font-family:Inter,-apple-system,sans-serif;opacity:1;transition:opacity .25s ease;';
    var KEY='nhd_asst_teaser_v1';
    var seen=false; try{ seen=!!localStorage.getItem(KEY); }catch(e){}
    var teaser=document.createElement('div');
    teaser.style.cssText='display:none;max-width:230px;background:#fff;border:1px solid #E0E0E0;border-left:3px solid #2B4FE0;border-radius:2px;box-shadow:0 6px 24px rgba(0,0,0,.14);padding:12px 14px;font-size:.82rem;line-height:1.5;color:#0A0A0A;';
    teaser.innerHTML='<b>Questions?</b> Ask Dot — our data assistant: prices, taxes, incentives, payments. Free, instant, nothing leaves your device. <a href="'+href+'" style="color:#2B4FE0;font-weight:700;">Open the Assistant &rarr;</a><button type="button" aria-label="Dismiss" style="float:right;margin:-6px -8px 0 6px;background:none;border:none;color:#666;font-size:1rem;cursor:pointer;">&times;</button>';
    teaser.querySelector('button').addEventListener('click',function(ev){ ev.stopPropagation(); teaser.style.display='none'; try{localStorage.setItem(KEY,'1');}catch(e){} });
    var btn=document.createElement('a');
    btn.href=href; btn.setAttribute('aria-label','Open the Dispatch Assistant');
    btn.style.cssText='display:flex;align-items:center;gap:9px;background:#0F2942;color:#fff;border:1px solid #0F2942;border-radius:2px;padding:12px 16px;font-weight:800;font-size:.82rem;text-decoration:none;box-shadow:0 6px 20px rgba(15,41,66,.35);';
    btn.innerHTML='<span style="width:9px;height:9px;border-radius:50%;background:#4E7AFF;display:inline-block;"></span>Ask Dot';
    btn.addEventListener('click',function(){ if(window.NHD) try{ NHD.trackEvent('assistant_open',{context:'launcher'}); }catch(e){} });
    wrap.appendChild(teaser); wrap.appendChild(btn);
    document.body.appendChild(wrap);
    if(!seen){ setTimeout(function(){ teaser.style.display='block'; try{localStorage.setItem(KEY,'1');}catch(e){} },3500); }

    // Fade the launcher out a couple seconds after the page stops scrolling, so it
    // doesn't sit on top of content near the bottom of the screen (mostly a mobile
    // issue — small viewport, fixed-position button). Reappears instantly on the
    // next scroll or tap. Never fades while the one-time teaser bubble is open, or
    // while the button itself has keyboard focus.
    var hideTimer=null, HIDE_DELAY=2000;
    function show(){
      wrap.style.opacity='1';
      wrap.style.pointerEvents='auto';
    }
    function scheduleHide(){
      clearTimeout(hideTimer);
      hideTimer=setTimeout(function(){
        if(teaser.style.display==='block') return;      // don't hide an open teaser
        if(document.activeElement===btn) return;         // don't hide while focused
        wrap.style.opacity='0';
        wrap.style.pointerEvents='none';
      },HIDE_DELAY);
    }
    window.addEventListener('scroll',function(){ show(); scheduleHide(); },{passive:true});
    wrap.addEventListener('touchstart',function(){ show(); clearTimeout(hideTimer); },{passive:true});
    btn.addEventListener('focus',function(){ show(); clearTimeout(hideTimer); });
    btn.addEventListener('blur',function(){ scheduleHide(); });
  });
})();
