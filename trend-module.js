    /* WHERE WE STAND trend board */
    Promise.all([j('/reporting/market-trend.json'), j('/reporting/rate-benchmark.json'), j('/concession-index.json')]).then(function (tr) {
      var mt = tr[0], rb = tr[1], ci = tr[2];
      var box = document.getElementById('trend-rows');
      if (!box || !mt) return;
      function money(n){ return '$' + Number(n).toLocaleString('en-US'); }
      function spark(vals, w, hgt) {
        if (!vals || vals.length < 2) return '';
        var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
        if (min === max) { min -= 1; max += 1; }
        var arr = vals.map(function (v, i) {
          return [(i * (w - 6) / (vals.length - 1) + 3), (hgt - 4 - (v - min) / (max - min) * (hgt - 8))];
        });
        var pts = arr.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
        var last = arr[arr.length - 1];
        return '<svg width="' + w + '" height="' + hgt + '" style="display:block;"><polyline points="' + pts + '" fill="none" stroke="#2B4FE0" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3" fill="#2B4FE0"/></svg>';
      }
      function chip(label, delta, fmt, goodWhenDown) {
        if (delta == null) return '<span style="display:inline-block;margin-right:10px;font-size:11px;color:#9a9a9a;">' + label + ' —</span>';
        var up = delta > 0;
        var goodMove = goodWhenDown ? delta < 0 : delta > 0;
        var col = delta === 0 ? '#666666' : (goodMove ? '#1F7A43' : '#B3382C');
        var arrow = delta === 0 ? '▬' : (up ? '▲' : '▼');
        return '<span style="display:inline-block;margin-right:10px;font-size:11.5px;font-weight:700;color:' + col + ';">' + arrow + ' ' + (up ? '+' : '−') + fmt(delta) + ' <span style="font-weight:400;color:#9a9a9a;">' + label + '</span></span>';
      }
      function row(name, sub, valueHtml, chipsHtml, sparkHtml) {
        return '<div style="display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap;">' +
          '<div style="flex:1.4;min-width:150px;"><div style="font-weight:800;font-size:13.5px;">' + name + '</div><div style="font-size:10.5px;color:#9a9a9a;font-family:IBM Plex Mono,monospace;">' + sub + '</div></div>' +
          '<div style="min-width:86px;font-size:19px;font-weight:800;letter-spacing:-.02em;">' + valueHtml + '</div>' +
          '<div style="flex:2;min-width:200px;">' + chipsHtml + '</div>' +
          '<div style="min-width:110px;">' + sparkHtml + '</div></div>';
      }
      var html = '';
      if (rb && rb.rate30yr && mt.rate30yr) {
        var now = rb.rate30yr;
        var A = {}; (mt.rate30yr.anchors || []).forEach(function (a) { A[a.date] = a.rate; });
        var w1 = A['2026-07-16'], y1 = A['2025-07-31'], low = A['2026-02-25'];
        var seen = {};
        var seq = [];
        (mt.rate30yr.anchors || []).forEach(function (a) { if (!seen[a.date]) { seen[a.date] = 1; seq.push([a.date, a.rate]); } });
        (rb.history || []).forEach(function (hh) { if (!seen[hh.date]) { seen[hh.date] = 1; seq.push([hh.date, hh.rate]); } });
        seq.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
        html += row('30 yr fixed rate', 'Mortgage News Daily', now.toFixed(2) + '%',
          chip('1w', w1 != null ? +(now - w1).toFixed(2) : null, function (d) { return Math.abs(d).toFixed(2) + ' pts'; }, true) +
          chip('1yr', y1 != null ? +(now - y1).toFixed(2) : null, function (d) { return Math.abs(d).toFixed(2) + ' pts'; }, true) +
          (low != null ? '<span style="font-size:11px;color:#9a9a9a;">2026 low ' + low.toFixed(2) + '%</span>' : ''),
          spark(seq.map(function (p) { return p[1]; }), 110, 34));
      }
      if (ci && ci.points && ci.points.length) {
        var vals = ci.points.map(function (p) { return p.index; });
        var cur = vals[vals.length - 1], first = vals[0];
        html += row('Concession Index', 'median advertised incentive · our series', money(cur),
          chip('since Jul 20', +(cur - first), function (d) { return money(Math.abs(d)); }, false) +
          '<span style="font-size:11px;color:#9a9a9a;">new series · history accrues with every sweep, four times daily</span>',
          spark(vals, 110, 34));
      }
      if (mt.medianPrice && mt.medianPrice.series && mt.medianPrice.series.length) {
        var S = mt.medianPrice.series;
        var byM = {}; S.forEach(function (p) { byM[p.month] = p.value; });
        var curP = S[S.length - 1].value;
        var mo = byM['2026-05'], yr = byM['2025-06'];
        html += row('Median sold price', 'City of Austin · ABoR MLS · monthly', money(curP),
          chip('1mo', mo != null ? curP - mo : null, function (d) { return money(Math.abs(d)); }, true) +
          chip('1yr', yr != null ? curP - yr : null, function (d) { return money(Math.abs(d)); }, true),
          spark(S.map(function (p) { return p.value; }), 110, 34));
      }
      if (html) box.innerHTML = html;
    });

