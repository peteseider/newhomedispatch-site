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


// ============ EDUCATION SET: THE DEAL COMES LAST (evergreen) ============
const edu1 = page(`
${mast(`The Dispatch Rule<br><b>Buyer Education</b>`)}
<div class="eyebrow">The most important thing we can tell you about deals</div>
<div class="h-serif" style="font-size:84px;margin-top:40px;max-width:14ch;">The deal <em>comes last</em>.</div>
<div class="body" style="font-size:26px;margin-top:26px;max-width:40ch;">The incentive is the final lever in a negotiation. It is not the first filter for choosing a home. A discount is not a compass.</div>
<div style="margin-top:56px;font-family:'IBM Plex Mono',monospace;font-size:24px;letter-spacing:.04em;color:#9DBBFF;line-height:2.1;">GOALS &rarr; AREA &rarr; COMMUNITY &rarr; BUILDER<br><span style="color:#41C98A;font-weight:700;">&rarr; THEN THE DEAL</span></div>
<div style="flex:1"></div>${orient('The order of operations for buying new construction well.','Choose the home for the right reasons first. Negotiate the deal on the home you already want.','We track every advertised offer so you can time the negotiation, not be led by it.')}
${foot(`The Dispatch Rule · newhomedispatch.com/deal-comes-last`)}`);

const edu2 = page(`
${mast(`The Right Order<br><b>Buyer Education</b>`)}
<div class="eyebrow">Five steps, in order</div>
<div class="h-serif" style="font-size:48px;margin-top:20px;max-width:20ch;">Narrow from life to lot, <em>then</em> talk numbers.</div>
<div style="margin-top:28px;">
<div class="credit"><span class="v" style="font-size:34px;">1</span><span class="n">Set your goals<small>payment you can hold, commute, timeline, schools, space</small></span></div>
<div class="credit"><span class="v" style="font-size:34px;">2</span><span class="n">Narrow to an area<small>no incentive fixes a location that does not work</small></span></div>
<div class="credit"><span class="v" style="font-size:34px;">3</span><span class="n">Narrow to communities<small>lot types, taxes, HOA, what is built next door</small></span></div>
<div class="credit"><span class="v" style="font-size:34px;">4</span><span class="n">Narrow to builders<small>quality, warranty, how they treat you after closing</small></span></div>
<div class="credit"><span class="v" style="font-size:34px;">5</span><span class="n">Now reverse engineer the numbers<small>same plan, same lot, compare the delivered price</small></span></div></div>
<div style="flex:1"></div>${orient('The path from your life to the right home, in the right order.','Do not open a deal sheet until step five.','Each step has a Dispatch tool built for it, sharpened with every sweep.')}
${foot(`The Dispatch Rule · newhomedispatch.com/deal-comes-last`)}`);

const edu3 = page(`
${mast(`The Trap<br><b>Buyer Education</b>`)}
<div class="eyebrow warn">Why the deal cannot lead</div>
<div class="h-serif" style="font-size:52px;margin-top:22px;max-width:19ch;">A bigger incentive can just be a <em>bigger markup</em>.</div>
<div class="body" style="font-size:22px;margin-top:16px;max-width:44ch;">Raise the base price, hand the difference back as a headline, and the sign screams savings while the delivered price never moves. If the discount picks your house, the markup picked you.</div>
<div class="edu" style="margin-top:30px;"><div class="el">The number that matters</div><div class="et">The incentive is not the savings. <b>The delivered price is.</b> A small credit on a fair base routinely beats a huge one on an inflated base or a teaser rate that resets after year one.</div></div>
<div style="flex:1"></div>${orient('The illusion of a deal, and why discounts make bad compasses.','Compare delivered prices on the same plan and lot type. Ask if any rate is fixed for the full 30 years.','We track price history so a moved base cannot hide from you.')}
${foot(`The Dispatch Rule · newhomedispatch.com/deal-comes-last`)}`);

const edu4 = page(`
${mast(`What The Tracker Is For<br><b>Buyer Education</b>`)}
<div class="eyebrow">Used correctly, it earns you real money</div>
<div class="h-serif" style="font-size:50px;margin-top:22px;max-width:19ch;">Trend awareness and <em>negotiating windows</em>.</div>
<div class="body" style="font-size:22px;margin-top:16px;max-width:44ch;">We log every advertised offer twice a day and keep the history. So you can see incentives rising, deadlines clustering, and builders under pressure. That is a negotiating window.</div>
<div class="edu" style="margin-top:28px;"><div class="el">The play</div><div class="et">Walk in during a window, on a home you already chose for the right reasons, with the current offer as your <b>opening position</b>. That is how tracking turns into leverage.</div></div>
<div style="flex:1"></div>${orient('How to use the Incentive Tracker and Daily Hot Sheet the right way.','Time the negotiation with the trend. Never let the discount pick the house.','The longer we track, the clearer your windows get. New issue every Monday.')}
${foot(`The Dispatch Rule · newhomedispatch.com/deal-comes-last`)}`);

const cards = { 'deal-1': edu1, 'deal-2': edu2, 'deal-3': edu3, 'deal-4': edu4 };
const OUT = process.env.SOCIAL_OUT || '.';
const RENDER = process.env.SOCIAL_RENDER === '1';

(async () => {
  for (const [name, html] of Object.entries(cards)) {
    fs.writeFileSync(`card-edu-${name}.html`, html);
    const dashes = (html.replace(/data:image[^"]+/g,'').match(/—|–/g) || []).length;
    console.log(`built card-edu-${name}.html · dashes: ${dashes}`);
  }
  if (!RENDER) return;
  const { chromium } = require('playwright');
  const b = await chromium.launch();
  const pg = await b.newPage({ deviceScaleFactor: 2 });
  for (const name of Object.keys(cards)) {
    await pg.goto('file://' + require('path').resolve(`card-edu-${name}.html`));
    await pg.waitForTimeout(1200);
    const el = await pg.$('#card');
    await el.screenshot({ path: `${OUT}/edu-${name}.png` });
    console.log(`rendered ${OUT}/edu-${name}.png`);
  }
  await b.close();
})();
