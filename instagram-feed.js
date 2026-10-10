/* New Home Dispatch, Instagram strip (homepage).
   Reads data/instagram-feed.json. If feedUrl is set (Behold.so JSON feed for @newhomedispatch),
   renders the latest posts. If not, falls back to today's auto-rendered share cards in /share/
   (re-rendered daily by .github/workflows/social-render.yml) so the strip is never empty or stale. */
(function(){
  var host=document.getElementById('ig-grid'); if(!host) return;
  var FALLBACK=['share/hot-sheet-read.png','share/hot-sheet-move.png','share/hot-sheet-rate.png','share/hot-sheet-explained.png','share/hot-sheet-illusion.png','share/mud-pid-atlas-portrait.png'];
  function esc(s){return String(s||'').replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function card(href,img,alt,cap){
    return '<a class="ig-card" href="'+esc(href)+'" target="_blank" rel="noopener">'+
      '<img loading="lazy" src="'+esc(img)+'" alt="'+esc(alt)+'">'+
      (cap?'<span class="ig-cap">'+esc(cap)+'</span>':'')+'</a>';
  }
  function fallback(cfg){
    var v='?v='+new Date().toISOString().slice(0,10);
    host.innerHTML=FALLBACK.map(function(p){return card(cfg.profileUrl,p+v,'New Home Dispatch card','');}).join('');
    var n=document.getElementById('ig-note'); if(n) n.textContent='Today’s cards, rendered from this morning’s sweep. The daily post goes up on '+cfg.handle+'.';
  }
  fetch('data/instagram-feed.json',{cache:'no-store'}).then(function(r){return r.json();}).then(function(cfg){
    cfg=cfg||{}; cfg.profileUrl=cfg.profileUrl||'https://www.instagram.com/newhomedispatch/'; cfg.handle=cfg.handle||'@newhomedispatch';
    if(!cfg.feedUrl){ fallback(cfg); return; }
    return fetch(cfg.feedUrl).then(function(r){return r.json();}).then(function(d){
      var posts=(d&&(d.posts||d.data))||(Array.isArray(d)?d:[]);
      posts=posts.filter(function(p){return p&&(p.permalink||p.link);}).slice(0,cfg.limit||6);
      if(!posts.length){ fallback(cfg); return; }
      host.innerHTML=posts.map(function(p){
        var img=(p.sizes&&p.sizes.medium&&p.sizes.medium.mediaUrl)||p.thumbnailUrl||p.mediaUrl||p.media_url||p.thumbnail_url||'';
        var cap=(p.caption||'').split('\n')[0].slice(0,80);
        return card(p.permalink||p.link,img,cap||'Instagram post',cap);
      }).join('');
      var n=document.getElementById('ig-note'); if(n) n.textContent='Latest from '+cfg.handle+'. Updates automatically.';
      if(window.NHD&&NHD.trackEvent) NHD.trackEvent('instagram_strip_view',{posts:posts.length});
    }).catch(function(){ fallback(cfg); });
  }).catch(function(){ fallback({profileUrl:'https://www.instagram.com/newhomedispatch/',handle:'@newhomedispatch'}); });
})();
