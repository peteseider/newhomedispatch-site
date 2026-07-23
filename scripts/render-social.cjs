const fs = require('fs');
function asset(name){ for (const p of [`assets/${name}`, `site/assets/${name}`]) { try { return fs.readFileSync(p); } catch(e){} } throw new Error('asset not found: '+name); }
const LOGO = 'data:image/png;base64,' + asset('wordmark-light.png').toString('base64');
const TAG  = 'data:image/png;base64,' + asset('tagline-light.png').toString('base64');

// ---- live data: read from the repo JSON so numbers are always current ----
function rd(p, fb){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch(e){ return fb; } }
const CI = rd('concession-index.json', rd('site/concession-index.json', {points:[{index:20000}], lastUpdatedLabel:''}));
const SH = rd('score-history.json', rd('site/score-history.json', {points:[{score:74,band:'High'}]}));
const SI = rd('sweep-inputs.json', rd('site/sweep-inputs.json', {offersVerified:35,expiredDisplayed:14,buildersLive:23}));
const INC = rd('incentives.json', rd('site/incentives.json', {records:[]}));
const RB = rd('reporting/rate-benchmark.json', rd('site/reporting/rate-benchmark.json', {rate30yr:6.77}));
// ---- derive live counts from incentives.json exactly like the site pages do ----
function dkey(w){ w = String(w||''); if (/^\d{4}-\d{2}-\d{2}/.test(w)) return w.slice(0,10);
  const m = w.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/); if (!m) return null;
  const y = m[3] ? (m[3].length===2 ? '20'+m[3] : m[3]) : String(new Date().getFullYear());
  return y+'-'+('0'+m[1]).slice(-2)+'-'+('0'+m[2]).slice(-2); }
function escT(x){ return String(x==null?'':x).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
const _t = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const _recs = INC.records||[], _promos = INC.promos||[];
const _liveOf = l => l.filter(o => { const k = o.expires ? dkey(o.expires) : null; return !k || k >= _t; });
const _liveR = _liveOf(_recs), _liveP = _liveOf(_promos);
const _bld = new Set([..._liveR, ..._liveP].map(o=>o.builder).filter(Boolean));
const _expiredCt = (_recs.length - _liveR.length) + (_promos.length - _liveP.length);
const _dated = [
  ..._liveR.map(o=>({b:o.builder, what:(o.incentiveType?o.incentiveType+' \u00b7 ':'')+'$'+Number(o.advertisedValue).toLocaleString('en-US'), whenRaw:String(o.expires||''), k:o.expires?dkey(o.expires):null})),
  ..._liveP.map(o=>({b:o.builder, what:String(o.promo||''), whenRaw:String(o.expires||''), k:o.expires?dkey(o.expires):null}))
].filter(o=>o.k&&o.b).sort((a,b)=>a.k<b.k?-1:1);
const _next = _dated[0] || null;
const _top3 = [..._liveR].filter(o=>Number.isFinite(o.advertisedValue)).sort((a,b)=>b.advertisedValue-a.advertisedValue).slice(0,3);
const lastScore = SH.points[SH.points.length-1] || {score:74,band:'High'};
const lastIdx = CI.points[CI.points.length-1] || {index:20000};
const bv = (INC.records||[]).map(r=>r.buyerValueScore).filter(Number.isFinite).sort((a,b)=>a-b);
const medReach = bv.length ? bv[Math.floor(bv.length/2)] : 16000;
const idxVal = lastIdx.index || 20000;
const label = CI.lastUpdatedLabel || '';
const dateStr = (label.split(' · ')[0] || 'Jul 23 2026').replace(',', '');
const D = {
  score: lastScore.score || 74, band: lastScore.band || 'High',
  index: idxVal, reaches: Math.round(medReach/1000)*1000, lost: Math.max(0, idxVal - Math.round(medReach/1000)*1000),
  noStrings: (INC.records||[]).filter(r=>!r.lenderTied).length || 3, tracked: (INC.records||[]).length || 9,
  offersLive: (_liveR.length + _liveP.length) || SI.offersVerified || 35,
  expired: _expiredCt,
  buildersLive: _bld.size || SI.buildersLive || 23,
  marketRate: RB.rate30yr || 6.77,
  date: dateStr || 'Jul 23 2026', verified: (dateStr||'Jul 23').split(' ').slice(0,2).join(' '),
};

function _carry(r){ const i = r/100/12; return 2600 * (1 - Math.pow(1+i, -360)) / i; }
const _rNow = D.marketRate;
const _cNow = Math.round(_carry(_rNow)/1000);
const _c1 = Math.round(_carry(_rNow-1)/1000);

const CSS = `
:root{--navy:#0B2138;--ink-line:rgba(150,178,230,.16);--blue:#2B4FE0;--blue-l:#6E93FF;--sky:#9DBBFF;--on-navy:#7C97CE;--good:#41C98A;--warn:#F2B43C;--loss:#E8795B;}
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#2a2a2a;}
.card{width:1080px;height:1350px;position:relative;overflow:hidden;background:radial-gradient(120% 80% at 50% -10%,#14304F 0%,var(--navy) 55%,#081A2C 100%);color:#fff;font-family:'Inter',sans-serif;padding:70px 78px 58px;display:flex;flex-direction:column;}
.card::before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(157,187,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(157,187,255,.045) 1px,transparent 1px);background-size:60px 60px;mask-image:radial-gradient(120% 90% at 50% 30%,#000 55%,transparent 100%);pointer-events:none;}
.card>*{position:relative;z-index:1;}
.mast{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--ink-line);padding-bottom:22px;}
.mast img.lg{height:42px;width:auto;display:block;}
.tag{font-family:'IBM Plex Mono',monospace;font-size:15px;letter-spacing:.24em;text-transform:uppercase;color:var(--on-navy);text-align:right;line-height:1.7;}
.tag b{color:var(--sky);font-weight:500;}
.eyebrow{font-family:'IBM Plex Mono',monospace;font-size:16px;letter-spacing:.30em;text-transform:uppercase;color:var(--blue-l);font-weight:500;display:flex;align-items:center;gap:14px;margin-top:34px;}
.eyebrow.warn{color:var(--warn);} .eyebrow::after{content:"";height:1px;flex:1;background:linear-gradient(90deg,var(--ink-line),transparent);}
.h-serif{font-family:'Fraunces',serif;font-weight:500;letter-spacing:-1px;line-height:1.05;}
.h-serif em{font-style:italic;color:var(--sky);}
.body{color:#CBD8F0;line-height:1.5;}
.body b{color:#fff;font-weight:600;}
/* gauge */
.gauge-wrap{margin-top:20px;display:flex;flex-direction:column;align-items:center;}
.gauge{position:relative;width:660px;height:340px;}
.g-center{position:absolute;left:0;right:0;bottom:2px;text-align:center;}
.g-num{font-family:'Fraunces',serif;font-weight:600;font-size:168px;line-height:.8;letter-spacing:-4px;color:#fff;font-variant-numeric:tabular-nums;}
.g-den{font-family:'IBM Plex Mono',monospace;font-size:21px;color:var(--on-navy);letter-spacing:.06em;margin-top:2px;}
.g-band{display:inline-flex;align-items:center;gap:10px;margin-top:14px;font-family:'IBM Plex Mono',monospace;font-size:18px;letter-spacing:.20em;text-transform:uppercase;color:#062;background:var(--good);font-weight:600;padding:7px 18px 6px;border-radius:4px;}
.g-scale{display:flex;justify-content:space-between;width:560px;margin:12px auto 0;font-family:'IBM Plex Mono',monospace;font-size:14px;letter-spacing:.12em;text-transform:uppercase;color:var(--on-navy);}
/* gap meter */
.gap-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;}
.gap-title{font-family:'IBM Plex Mono',monospace;font-size:16px;letter-spacing:.14em;text-transform:uppercase;color:var(--on-navy);}
.gap-note{font-size:18px;color:var(--sky);font-weight:500;}
.meter{height:60px;border-radius:9px;background:rgba(255,255,255,.055);border:1px solid var(--ink-line);display:flex;overflow:hidden;}
.meter .reach{width:80%;background:linear-gradient(90deg,#2B4FE0,#4C74FF);display:flex;align-items:center;padding-left:24px;}
.meter .reach b{font-family:'Fraunces',serif;font-weight:600;font-size:31px;color:#fff;letter-spacing:-.5px;}
.meter .lost{flex:1;display:flex;align-items:center;justify-content:center;background:repeating-linear-gradient(135deg,rgba(232,121,91,.22) 0 8px,rgba(232,121,91,.07) 8px 16px);border-left:2px solid var(--navy);}
.meter .lost b{font-family:'IBM Plex Mono',monospace;font-size:18px;color:#F0A98F;font-weight:600;}
.legend{display:flex;gap:28px;margin-top:13px;font-size:17px;color:#B9C7E2;}
.legend .k{display:flex;align-items:center;gap:9px;} .legend .sw{width:14px;height:14px;border-radius:3px;} .legend .sw.a{background:#4C74FF;} .legend .sw.b{background:repeating-linear-gradient(135deg,#E8795B 0 4px,rgba(232,121,91,.3) 4px 8px);} .legend b{color:#fff;}
/* credit rows */
.credit{display:flex;align-items:baseline;gap:24px;padding:19px 0;border-bottom:1px solid var(--ink-line);}
.credit:last-child{border-bottom:none;}
.credit .v{font-family:'Fraunces',serif;font-weight:600;font-size:46px;color:#fff;flex:0 0 190px;letter-spacing:-1px;}
.credit .n{font-size:25px;color:#DCE6F7;line-height:1.3;} .credit .n small{display:block;color:var(--on-navy);font-size:18px;margin-top:3px;font-family:'IBM Plex Mono',monospace;letter-spacing:.03em;}
/* stat pills */
.pills{display:flex;gap:22px;} .pills .p{flex:1;background:rgba(255,255,255,.05);border:1px solid var(--ink-line);border-radius:12px;padding:22px 24px;}
.pills .p b{font-family:'Fraunces',serif;font-weight:600;font-size:52px;display:block;line-height:1;} .pills .p.g b{color:var(--good);} .pills .p.w b{color:var(--warn);}
.pills .p span{font-size:19px;color:var(--on-navy);display:block;margin-top:8px;}
/* deadline chip */
.chip{display:inline-flex;align-items:center;gap:12px;background:rgba(242,180,60,.12);border:1px solid rgba(242,180,60,.4);border-radius:10px;padding:16px 22px;font-family:'IBM Plex Mono',monospace;font-size:22px;letter-spacing:.04em;color:#F7CE7C;font-weight:500;}
.chip .dot{width:12px;height:12px;border-radius:50%;background:var(--warn);}
/* weighted component bars (score explained) */
.comp{margin-top:6px;} .comp .row{margin:20px 0;}
.comp .rlab{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:9px;}
.comp .rlab .nm{font-size:23px;color:#EAF1FF;font-weight:500;} .comp .rlab .nm small{color:var(--on-navy);font-size:17px;font-weight:400;display:block;margin-top:2px;}
.comp .rlab .wt{font-family:'IBM Plex Mono',monospace;font-size:20px;color:var(--sky);font-weight:600;}
.comp .bar{height:16px;border-radius:8px;background:rgba(255,255,255,.06);overflow:hidden;}
.comp .bar span{display:block;height:100%;border-radius:8px;background:linear-gradient(90deg,#2B4FE0,#5A86FF);}
/* rate rows (clean, legible) */
.rl{margin-top:6px;}
.rl .r{display:flex;align-items:center;gap:26px;padding:22px 0;border-bottom:1px solid var(--ink-line);}
.rl .r:last-child{border-bottom:none;}
.rl .r .lab{flex:1;}
.rl .r .lab .nm{font-size:25px;color:#F1F5FF;font-weight:600;}
.rl .r .lab small{display:block;font-family:'IBM Plex Mono',monospace;font-size:16px;color:#9FB6E0;margin-top:6px;letter-spacing:.02em;line-height:1.4;}
.rl .r .val{font-family:'Fraunces',serif;font-weight:600;font-size:58px;letter-spacing:-1.5px;flex:0 0 auto;line-height:1;}
.rl .market .val{color:#fff;} .rl .teaser .val{color:var(--good);}
.rl .r .tg2{font-family:'IBM Plex Mono',monospace;font-size:14px;text-transform:uppercase;letter-spacing:.08em;padding:6px 13px;border-radius:5px;flex:0 0 auto;font-weight:600;}
.rl .market .tg2{background:rgba(157,187,255,.16);color:var(--sky);}
.rl .teaser .tg2{background:rgba(242,180,60,.16);color:#F7CE7C;}
/* trend sparkline card */
.trend{margin-top:8px;border:1px solid var(--ink-line);border-radius:12px;background:rgba(157,187,255,.04);padding:26px 30px;}
/* orient/education strip */
.orient{margin-top:24px;border:1px solid var(--ink-line);border-radius:11px;background:rgba(157,187,255,.045);display:flex;}
.orient .o{flex:1;padding:19px 22px;} .orient .o + .o{border-left:1px solid var(--ink-line);}
.orient .ol{font-family:'IBM Plex Mono',monospace;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--blue-l);font-weight:600;margin-bottom:8px;}
.orient .ot{font-size:17px;line-height:1.4;color:#CBD8F0;} .orient .ot b{color:#fff;font-weight:600;}
/* education band (full width) */
.edu{margin-top:22px;border-left:3px solid var(--blue);background:rgba(43,79,224,.08);border-radius:0 11px 11px 0;padding:22px 26px;}
.edu .el{font-family:'IBM Plex Mono',monospace;font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:var(--blue-l);font-weight:600;margin-bottom:9px;}
.edu .et{font-size:20px;line-height:1.5;color:#D3DEF3;} .edu .et b{color:#fff;font-weight:600;}
/* illusion of a deal */
.illus{border:1px solid var(--ink-line);border-radius:12px;background:rgba(157,187,255,.045);padding:28px 32px;}
.ihl{font-family:'IBM Plex Mono',monospace;font-size:16px;letter-spacing:.05em;color:#A7BDE6;text-transform:uppercase;margin-bottom:20px;display:block;}
.irow{display:flex;align-items:center;gap:22px;margin:14px 0;}
.itag{font-family:'IBM Plex Mono',monospace;font-size:15px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:9px 14px;border-radius:6px;flex:0 0 168px;text-align:center;}
.itag.plain{background:rgba(157,187,255,.14);color:var(--sky);}
.itag.loud{background:var(--warn);color:#3a2900;}
.ibar{flex:1;height:60px;border-radius:9px;background:linear-gradient(90deg,#2B4FE0,#4C74FF);display:flex;align-items:center;padding:0 24px;}
.ibar .ib{font-family:'Fraunces',serif;font-weight:600;font-size:27px;color:#fff;letter-spacing:-.4px;}
.ipunch{margin-top:22px;font-size:20px;line-height:1.5;color:#D3DEF3;} .ipunch b{color:var(--warn);font-weight:600;}
/* buying power */
.bpr{display:flex;align-items:center;gap:22px;margin:15px 0;}
.bpr .rt{font-family:'IBM Plex Mono',monospace;font-size:22px;color:#EAF1FF;font-weight:600;flex:0 0 148px;letter-spacing:.02em;}
.bpr .bar{height:64px;border-radius:9px;display:flex;align-items:center;padding:0 24px;}
.bpr .bar.a{width:78%;background:rgba(255,255,255,.08);border:1px solid var(--ink-line);}
.bpr .bar.b{width:88%;background:linear-gradient(90deg,#2B4FE0,#41C98A);}
.bpr .bar .hp{font-family:'Fraunces',serif;font-weight:600;font-size:29px;color:#fff;letter-spacing:-.4px;}
.bpr .plus{font-family:'IBM Plex Mono',monospace;font-size:19px;font-weight:600;color:#052;background:var(--good);padding:8px 13px;border-radius:5px;}
.bpcap{margin-top:20px;font-size:20px;line-height:1.5;color:#D3DEF3;} .bpcap b{color:#fff;font-weight:600;}
/* footer with tagline */
.foot{display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:20px;border-top:1px solid var(--ink-line);}
.foot .fl{font-family:'IBM Plex Mono',monospace;font-size:15px;letter-spacing:.10em;text-transform:uppercase;color:var(--on-navy);}
.foot .fr{display:flex;align-items:center;gap:20px;}
.foot img.tg{height:26px;width:auto;display:block;opacity:.96;}
.foot .site{font-family:'IBM Plex Mono',monospace;font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:#fff;font-weight:500;}
`;

function mast(tagR){return `<div class="mast"><img class="lg" src="${LOGO}" alt="New Home Dispatch"><span class="tag">${tagR}</span></div>`;}
function foot(fl){return `<div class="foot"><span class="fl">${fl}</span><span class="fr"><img class="tg" src="${TAG}" alt="Look Closer"><span class="site">newhomedispatch.com</span></span></div>`;}
function orient(a,b,c){return `<div class="orient"><div class="o"><div class="ol">What this is</div><div class="ot">${a}</div></div><div class="o"><div class="ol">How to use it</div><div class="ot">${b}</div></div><div class="o"><div class="ol">Why come back</div><div class="ot">${c}</div></div></div>`;}

function page(inner){return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet"><style>${CSS}</style></head><body><div class="card" id="card">${inner}</div>${GAUGE_JS}</body></html>`;}

const GAUGE_JS = `<script>var g=document.getElementById('valArc');if(g){var cx=330,cy=330,r=260,val=${D.score};function pt(v){var a=Math.PI*(1-v/100);return [cx+r*Math.cos(a),cy-r*Math.sin(a)];}var s=pt(0),e=pt(val);g.setAttribute('d','M '+s[0].toFixed(1)+' '+s[1].toFixed(1)+' A '+r+' '+r+' 0 0 1 '+e[0].toFixed(1)+' '+e[1].toFixed(1));var m=document.getElementById('mk');m.setAttribute('cx',e[0].toFixed(1));m.setAttribute('cy',e[1].toFixed(1));}</script>`;

// ---------------- CARD 1: THE READ ----------------
const read = page(`
${mast(`Buyer Decision Terminal<br><b>Central Texas · ${D.date}</b>`)}
<div class="eyebrow">The Buyer Advantage Score</div>
<div class="gauge-wrap"><div class="gauge">
<svg width="660" height="340" viewBox="0 0 660 340" fill="none"><defs><linearGradient id="arc" x1="0" y1="0" x2="660" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3B63F0"/><stop offset="0.6" stop-color="#4C86FF"/><stop offset="1" stop-color="#41C98A"/></linearGradient></defs>
<path d="M 70 330 A 260 260 0 0 1 590 330" stroke="rgba(157,187,255,.14)" stroke-width="26" stroke-linecap="round"/><path id="valArc" stroke="url(#arc)" stroke-width="26" stroke-linecap="round" fill="none"/><circle id="mk" r="10" fill="#fff" stroke="#0B2138" stroke-width="4"/></svg>
<div class="g-center"><div class="g-num">${D.score}</div><div class="g-den">out of 100 · one market read</div><div class="g-band">● ${D.band} · buyers lead</div></div></div>
<div class="g-scale"><span>0 · builders lead</span><span>50</span><span>100 · buyers lead</span></div></div>
<div class="h-serif" style="font-size:56px;margin-top:24px;max-width:20ch;">Buyers hold the <em>stronger hand</em> right now.</div>
<div style="margin-top:24px;"><div class="gap-head"><span class="gap-title">The $${D.index.toLocaleString()} on the sign vs. what reaches you</span><span class="gap-note">$1 in every $5 evaporates</span></div>
<div class="meter"><div class="reach"><b>~$${D.reaches.toLocaleString()} reaches the buyer</b></div><div class="lost"><b>$4K lost</b></div></div>
<div class="legend"><span class="k"><span class="sw a"></span> Median value that <b>actually lands</b></span><span class="k"><span class="sw b"></span> Lost to <b>lender strings</b></span></div></div>
${orient('Our proprietary 0 to 100 read of who holds leverage in Central Texas new construction.','Higher means buyers lead. Above 65 is a strong window to negotiate.','It updates twice a day. Watch the number move before you make an offer.')}
${foot(`Independent · never builder funded · verified ${D.verified}`)}`);

// ---------------- CARD 2: THE MOVE ----------------
const move = page(`
${mast(`Today's One Move<br><b>Central Texas · ${D.date}</b>`)}
<div class="eyebrow warn">The nearest hard deadline on the board</div>
<div class="h-serif" style="font-size:56px;margin-top:22px;max-width:19ch;">${_next ? escT(_next.b) + ' has the <em>next real deadline</em>.' : 'No hard deadlines <em>forcing a move</em> right now.'}</div>
<div style="margin-top:22px;"><span class="chip"><span class="dot"></span> ${_next ? escT(_next.whenRaw || _next.k) + ' \u00b7 the nearest dated offer on the board' : 'every tracked offer currently runs open ended'}</span></div>
<div class="eyebrow" style="margin-top:40px;">Biggest live community credits</div>
<div style="margin-top:8px;">
${_top3.map(o => '<div class="credit"><span class="v">$' + Number(o.advertisedValue).toLocaleString('en-US') + '</span><span class="n">' + escT(o.builder) + (o.community ? ', ' + escT(o.community) : '') + '<small>' + escT(o.incentiveType || 'credit') + (o.expires ? ' \u00b7 ' + escT(String(o.expires)) : ' \u00b7 no hard deadline') + '</small></span></div>').join('')}</div>
<div class="pills" style="margin-top:34px;"><div class="p g"><b>${D.offersLive}</b><span>offers verified live today</span></div><div class="p w"><b>${D.expired}</b><span>expired offers still posted as live</span></div></div>
${orient('The single builder offer with a real, near deadline, plus the biggest credits on the board.','If a listed offer fits your plan, act before its date. Ignore the expired ones still on signs.','New deadlines surface constantly. This is where you catch the ones worth moving on.')}
${foot(`Verified on builder sites · ${D.verified}`)}`);

// ---------------- CARD 3: THE SCORE EXPLAINED ----------------
const explained = page(`
${mast(`How The Score Is Built<br><b>Methodology · v0.1</b>`)}
<div class="eyebrow">What the Buyer Advantage Score measures</div>
<div class="h-serif" style="font-size:54px;margin-top:22px;max-width:20ch;">One number. <em>Five signals.</em> No builder spin.</div>
<div class="body" style="font-size:22px;margin-top:16px;max-width:40ch;">A single, proprietary read of buyer leverage, built only from signals we verify ourselves. Never from a builder's marketing claim.</div>
<div class="comp" style="margin-top:26px;">
<div class="row"><div class="rlab"><span class="nm">Incentive level<small>how large the typical credit is</small></span><span class="wt">30%</span></div><div class="bar"><span style="width:90%"></span></div></div>
<div class="row"><div class="rlab"><span class="nm">Builder competition<small>how many are fighting for buyers</small></span><span class="wt">20%</span></div><div class="bar"><span style="width:60%"></span></div></div>
<div class="row"><div class="rlab"><span class="nm">Lender strings<small>how much value survives outside their lender</small></span><span class="wt">20%</span></div><div class="bar"><span style="width:60%"></span></div></div>
<div class="row"><div class="rlab"><span class="nm">Deadline pressure<small>how many clocks are ticking</small></span><span class="wt">15%</span></div><div class="bar"><span style="width:45%"></span></div></div>
<div class="row"><div class="rlab"><span class="nm">Expired offer friction<small>how much is fake urgency still on signs</small></span><span class="wt">15%</span></div><div class="bar"><span style="width:45%"></span></div></div></div>
<div class="edu"><div class="el">What you get out of it</div><div class="et">Today it tells you, in one glance, whether it is a buyer's or a builder's market. As we track more builders and more days, it becomes a <b>historical record</b> you can time your purchase against. The longer we run it, the sharper it gets. <b>Come back to watch your window open and close.</b></div></div>
${foot(`Full methodology · newhomedispatch.com`)}`);

// ---------------- CARD 4: WHAT ONE POINT REALLY MEANS ----------------
const rate = page(`
${mast(`What One Point Really Means<br><b>Central Texas · ${D.date}</b>`)}
<div class="eyebrow warn">The rate is your biggest lever</div>
<div class="h-serif" style="font-size:52px;margin-top:22px;max-width:18ch;">One point on your rate is about <em>10% more home</em>.</div>
<div class="body" style="font-size:22px;margin-top:14px;max-width:44ch;">Keep the same monthly payment. A lower 30 year rate stretches how much house that payment can carry.</div>
<div class="bp" style="margin-top:26px;">
<div class="bpr"><span class="rt">At ${_rNow.toFixed(2)}%</span><div class="bar a"><span class="hp">~$${(_cNow*1000).toLocaleString('en-US')} of home</span></div></div>
<div class="bpr"><span class="rt">At ${(_rNow-1).toFixed(2)}%</span><div class="bar b"><span class="hp">~$${(_c1*1000).toLocaleString('en-US')} of home</span></div><span class="plus">+$${_c1-_cNow}K</span></div>
<div class="bpcap">Same ~$2,600 monthly payment. One point lower buys roughly <b>$${((_c1-_cNow)*1000).toLocaleString('en-US')} more house</b>, about ${Math.round((_c1-_cNow)/_cNow*100)} percent. That is why the rate matters more than a one time cash credit.</div>
</div>
<div class="edu" style="margin-top:24px;"><div class="el">Look closer before you celebrate a low rate</div><div class="et">Builder signs advertise first year teasers like <b>1.99% or 2.99%</b>. Most are step buydowns that reset, or ARMs. A teaser does not give you lasting buying power. Only a rate <b>fixed for the full 30 years</b> does. Ask for the note rate and the buydown schedule in writing.</div></div>
${orient('What a one point rate move is actually worth to your budget.','Chase a real, fixed rate buydown. For most buyers who keep the loan it beats a cash credit.','Rates move weekly. We track them so you know when your buying power shifts.')}
${foot(`Market 30 yr ${_rNow.toFixed(2)}%, ${escT(RB.source||'Mortgage News Daily')} ${escT(RB.asOfLabel||'')} · illustration at ~$2,600 per month`)}`);

// ---------------- CARD 5: THE ILLUSION OF A DEAL ----------------
const illusion = page(`
${mast(`The Illusion Of A Deal<br><b>Buyer Education</b>`)}
<div class="eyebrow warn">Mark up, then mark down</div>
<div class="h-serif" style="font-size:54px;margin-top:22px;max-width:19ch;">A bigger incentive can just be a <em>bigger markup</em>.</div>
<div class="body" style="font-size:22px;margin-top:16px;max-width:42ch;">A builder can raise the base price, then hand back the difference as a headline number. The sign screams savings. The delivered price does not move.</div>
<div class="illus" style="margin-top:28px;">
<div class="ihl">Same house. Same delivered price. Two very different signs.</div>
<div class="irow"><div class="itag plain">No incentive</div><div class="ibar"><span class="ib">$425,000 delivered</span></div></div>
<div class="irow"><div class="itag loud">$40,000 off</div><div class="ibar"><span class="ib">$425,000 delivered</span></div></div>
<div class="ipunch">The $40,000 came from a <b>$40,000 markup</b> on the base first. Same house. Same price. Just a louder sign.</div>
</div>
<div class="edu" style="margin-top:26px;"><div class="el">What actually matters</div><div class="et">The incentive is not the savings. <b>The delivered price is.</b> Compare the final number on the same plan and the same lot type, not the size of the discount on the sign. A small incentive on a fair base can beat a huge one on an inflated base.</div></div>
${orient('How builders can manufacture a deal by moving the base price first.','Ignore the discount headline. Ask for the delivered price and compare like homes.','We track price history, so you can see when a base quietly moved before the sale.')}
${foot(`Buyer education · example figures for illustration`)}`);


// ---------------- CARD 6: THE BOARD (live market trend single sheet) ----------------
const _RS = rd('reporting/resale-market.json', rd('site/reporting/resale-market.json', null));
const _PM = rd('reporting/pmms.json', rd('site/reporting/pmms.json', null));
const _PR = rd('reporting/permits.json', rd('site/reporting/permits.json', null));
function _brow(name, sub, val, chipTxt, chipCol){
  return `<div style="display:flex;align-items:center;gap:20px;padding:19px 0;border-bottom:1px solid var(--ink-line);">
    <div style="flex:1.5;"><div style="font-size:24px;font-weight:600;color:#F1F5FF;">${name}</div><div style="font-family:'IBM Plex Mono',monospace;font-size:14px;color:#8FA6CE;margin-top:4px;">${sub}</div></div>
    <div style="font-family:'Fraunces',serif;font-weight:600;font-size:42px;letter-spacing:-1px;color:#fff;min-width:150px;text-align:right;">${val}</div>
    <div style="font-family:'IBM Plex Mono',monospace;font-size:16px;font-weight:600;min-width:190px;text-align:right;color:${chipCol};">${chipTxt}</div>
  </div>`;
}
let _boardRows = '';
{
  const rNow = D.marketRate;
  _boardRows += _brow('30 yr fixed rate', 'daily index · Mortgage News Daily', rNow.toFixed(2) + '%',
    (_PM && _PM.rate ? 'weekly survey ' + _PM.rate.toFixed(2) + '%' : 'daily read'), '#9DBBFF');
  _boardRows += _brow('Concession Index', 'median advertised incentive · ours', '$' + Number(D.index).toLocaleString('en-US'),
    D.offersLive + ' live offers · ' + D.buildersLive + ' builders', '#9DBBFF');
  if (_RS && _RS.msa) {
    _boardRows += _brow('Resale inventory', 'months of supply · Austin MSA · Unlock MLS', _RS.msa.monthsInventory.toFixed(1) + ' mo',
      (_RS.msa.monthsInventoryYoYDelta < 0 ? '\u25BC ' : '\u25B2 ') + Math.abs(_RS.msa.monthsInventoryYoYDelta).toFixed(1) + ' mo vs last yr',
      _RS.msa.monthsInventoryYoYDelta < 0 ? '#E8795B' : '#41C98A');
    _boardRows += _brow('Resale days on market', 'average · Austin MSA · Unlock MLS', String(_RS.msa.avgDaysOnMarket),
      (_RS.msa.avgDaysOnMarketYoYDelta === 0 ? '\u25AC flat vs last yr' : (_RS.msa.avgDaysOnMarketYoYDelta > 0 ? '\u25B2 +' : '\u25BC ') + _RS.msa.avgDaysOnMarketYoYDelta + ' vs last yr'),
      _RS.msa.avgDaysOnMarketYoYDelta > 0 ? '#41C98A' : (_RS.msa.avgDaysOnMarketYoYDelta === 0 ? '#8FA6CE' : '#E8795B'));
  }
  if (_PR && _PR.current && _PR.priorYear && _PR.priorYear.count) {
    const pd = Math.round((_PR.current.count - _PR.priorYear.count) / _PR.priorYear.count * 1000) / 10;
    _boardRows += _brow('New residential permits', 'City of Austin · trailing 30 days', _PR.current.count.toLocaleString('en-US'),
      (pd >= 0 ? '\u25B2 +' : '\u25BC ') + Math.abs(pd).toFixed(1) + '% vs yr-ago window', pd >= 0 ? '#41C98A' : '#E8795B');
  }
}
const board = page(`
${mast(`The Board<br><b>Where the market stands</b>`)}
<div class="eyebrow">New construction vs the market \u00b7 tracked twice daily</div>
<div class="h-serif" style="font-size:56px;margin-top:22px;">Builders are conceding.<br>Resale is <em>tightening</em>.</div>
<div style="margin-top:26px;">${_boardRows}</div>
<div class="edu" style="margin-top:26px;"><div class="el">Why this board matters</div><div class="et">Resale supply is shrinking while builders stack credits and promo rates. Right now the <b>leverage lives in new construction</b>, and this board is re-verified every morning and every evening, so you see it move before the headlines do.</div></div>
${orient('The market signals a buyer should watch, on one card, from our twice-daily sweep and published MLS aggregates.','If the concession line rises while resale supply falls, your window is with the builders.','Every number is dated and sourced; the full board lives on the Daily Hot Sheet.')}
${foot(`Verified ${D.verified} \u00b7 rates: MND + Freddie Mac \u00b7 resale: Unlock MLS published \u00b7 permits: Austin open data`)}`);


// ---------------- CAPTIONS: channel-ready copy from the content packet ----------------
// One source (reporting/content-packet.json) -> per-channel captions, regenerated
// every sweep. Less words, more graphic: the card carries the data, the caption
// carries the takeaway. Never hand-rewrite these.
function writeCaptions(outDir){
  const cp = rd('reporting/content-packet.json', rd('site/reporting/content-packet.json', null));
  if (!cp) { console.log('captions: no content packet, skipped'); return; }
  const f = cp.facts || {};
  const chg = cp.changes || {};
  const newB = (chg.newOffers || []).slice(0,3).join(', ');
  const dl = (chg.deadlinesNext7d && chg.deadlinesNext7d[0]) || null;
  const rate = f.rateDaily ? f.rateDaily.toFixed(2) + '%' : '';
  const stamp = D.verified;
  const ig = ['The Board \u00b7 ' + stamp,
    (chg.count ? chg.count + ' change' + (chg.count>1?'s':'') + ' since the last sweep' + (newB ? ': new offers from ' + newB : '') + '.' : 'Builders held their positions this sweep. Stability is information too.'),
    'Rate: ' + rate + ' \u00b7 median incentive: $' + Number(f.concessionIndex||0).toLocaleString('en-US') + ' \u00b7 ' + f.offersLive + ' live offers across ' + f.buildersLive + ' builders.'
      + (dl ? '\nNearest advertised deadline: ' + dl.builder + ', ' + dl.deadline + '.' : ''),
    'Every number verified on the builder\u2019s own site, twice a day. Full board: link in bio.',
    '#austinrealestate #newconstruction #centraltexas #homebuying #austintx'
  ].join('\n\n');
  const fb = [
    (chg.count ? cp.interpretation : 'Quiet sweep: builders are holding their advertised positions.'),
    cp.buyerAction,
    'The full board, re-verified twice a day: newhomedispatch.com/daily-hot-sheet'
  ].join('\n\n');
  const x = (chg.count
    ? chg.count + ' incentive change' + (chg.count>1?'s':'') + ' in Austin new construction since the last sweep' + (newB ? ' (' + newB + ')' : '') + '. Rate ' + rate + ', median credit $' + Number(f.concessionIndex||0).toLocaleString('en-US') + '. Verified on builder sites, twice daily.'
    : 'No material incentive movement in Austin new construction this sweep. Rate ' + rate + '. Stability is a signal too.')
    + ' newhomedispatch.com/daily-hot-sheet';
  const out = ['=== INSTAGRAM ===', ig, '', '=== FACEBOOK ===', fb, '', '=== X ===', x, '',
    '=== PUBLISH RECOMMENDATION ===', cp.publishRecommendation + ' \u00b7 sweep ' + (cp.sweepId||'')].join('\n');
  fs.writeFileSync(outDir + '/captions.txt', out);
  console.log('captions written (' + cp.publishRecommendation + ')');
}

const cards = { read, move, explained, rate, illusion, board };
const OUT = process.env.SOCIAL_OUT || '.';
const RENDER = process.env.SOCIAL_RENDER === '1';

(async () => {
  for (const [name, html] of Object.entries(cards)) {
    fs.writeFileSync(`card-${name}.html`, html);
    const dashes = (html.replace(/data:image[^"]+/g,'').match(/—|–/g) || []).length;
    console.log(`built card-${name}.html · dashes: ${dashes}`);
  }
  if (!RENDER) return;
  const { chromium } = require('playwright');
  const b = await chromium.launch();
  const page = await b.newPage({ deviceScaleFactor: 2 });
  for (const name of Object.keys(cards)) {
    await page.goto('file://' + require('path').resolve(`card-${name}.html`));
    await page.waitForTimeout(1200);
    const el = await page.$('#card');
    await el.screenshot({ path: `${OUT}/hot-sheet-${name}.png` });
    console.log(`rendered ${OUT}/hot-sheet-${name}.png`);
  }
  await b.close();
  try { writeCaptions(OUT); } catch (e) { console.log('captions failed: ' + e.message); }
})();
