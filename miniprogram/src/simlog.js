/* 自动生成，请勿手改。真源：_vendor/ + index.html；重新生成：node miniprogram/build.js */

/* ===== 3D 模拟结果列表 + 形态评估 =====
   摇完一期由主模块调用 SimLog.onDrawComplete(red, blue)。
   评估基线从 2083 期真实开奖实时算出（分位数 / 各形态出现率），不是拍脑袋的常量。 */
(function () {
  'use strict';

  var list = [], base = null;
  var KEY = 'ssq3d_sim_results_v1';
  /* 只留最近 MAX_KEEP 期。每条带 8 项形态评估，实测约 724B；不设上限的话
     storage 单 key 1MB 只够约 1450 条，且每次开奖都要同步重写整包。
     裁剪放在 render/save 里做，任何写入路径（本地摇奖 / 远程合并 / 载入）都覆盖到。 */
  var MAX_KEEP = 10;
  function capList() { if (list.length > MAX_KEEP) list = list.slice(list.length - MAX_KEEP); }

  /* ---------- 历史基线 ---------- */
  function bump(o, k) { o[k] = (o[k] || 0) + 1; }
  function consOf(r) {
    var g = 0, c = 1;
    for (var i = 1; i < 6; i++) { if (r[i] === r[i - 1] + 1) c++; else { if (c >= 2) g++; c = 1; } }
    if (c >= 2) g++;
    return g;
  }
  function tailsOf(r) {
    var t = {};
    for (var i = 0; i < 6; i++) t[r[i] % 10] = 1;
    return Object.keys(t).length;
  }
  function qv(sorted, p) {
    var i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.min(lo + 1, sorted.length - 1);
    return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo));
  }
  function pctOf(sorted, v) {
    var lo = 0, hi = sorted.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m + 1; else hi = m; }
    return lo / sorted.length;
  }
  function buildBase() {
    if (base) return base;
    var D = window.SSQ_DATA;
    if (!D || !D.length) return null;
    var sums = [], spans = [], odd = {}, big = {}, zone = {}, cons = {}, tail = {}, rep = {};
    for (var i = 0; i < D.length; i++) {
      var r = D[i][1], s = 0, o = 0, bg = 0, z = [0, 0, 0];
      for (var j = 0; j < 6; j++) {
        var x = r[j]; s += x;
        if (x % 2) o++;
        if (x >= 17) bg++;
        z[x <= 11 ? 0 : (x <= 22 ? 1 : 2)]++;
      }
      sums.push(s); spans.push(r[5] - r[0]);
      bump(odd, o); bump(big, bg); bump(zone, z.join(':')); bump(cons, consOf(r)); bump(tail, tailsOf(r));
      if (i > 0) {
        var p = D[i - 1][1], m = 0;
        for (j = 0; j < 6; j++) if (p.indexOf(r[j]) >= 0) m++;
        bump(rep, m);
      }
    }
    sums.sort(function (a, b) { return a - b; });
    spans.sort(function (a, b) { return a - b; });
    base = { n: D.length, sums: sums, spans: spans, odd: odd, big: big,
             zone: zone, cons: cons, tail: tail, rep: rep };
    return base;
  }

  /* ---------- 单期评估 ---------- */
  function evaluate(red, blue, prevRed) {
    var b = buildBase();
    var s = 0, odd = 0, big = 0, z = [0, 0, 0];
    for (var i = 0; i < 6; i++) {
      var x = red[i]; s += x;
      if (x % 2) odd++;
      if (x >= 17) big++;
      z[x <= 11 ? 0 : (x <= 22 ? 1 : 2)]++;
    }
    var span = red[5] - red[0], cons = consOf(red), tail = tailsOf(red);
    var items = [];
    if (!b) {   /* 无历史数据：只给形态描述，不做判定 */
      items.push({ k: '和值', v: s, ok: true, note: '无历史基线' });
      items.push({ k: '跨度', v: span, ok: true, note: '无历史基线' });
      items.push({ k: '奇偶', v: odd + ':' + (6 - odd), ok: true, note: '' });
      items.push({ k: '大小', v: big + ':' + (6 - big), ok: true, note: '' });
      items.push({ k: '三区', v: z.join(':'), ok: true, note: '' });
      items.push({ k: '连号', v: cons ? cons + ' 组' : '无', ok: true, note: '' });
      items.push({ k: '尾数', v: tail + ' 个', ok: true, note: '' });
      items.push({ k: '重号', v: prevRed ? red.filter(function (x) { return prevRed.indexOf(x) >= 0; }).length + ' 个' : '—', ok: true, note: '' });
      return { items: items, pass: items.length, verdict: '未加载历史数据，仅描述形态', level: 'mid', sum: s, span: span };
    }
    var p5s = qv(b.sums, 0.05), p95s = qv(b.sums, 0.95), p50s = qv(b.sums, 0.5);
    var p5p = qv(b.spans, 0.05), p95p = qv(b.spans, 0.95);
    items.push({ k: '和值', v: s, ok: s >= p5s && s <= p95s, note: '历史 90% 落在 ' + p5s + '~' + p95s + '（中位 ' + p50s + '）' });
    items.push({ k: '跨度', v: span, ok: span >= p5p && span <= p95p, note: '历史 90% 落在 ' + p5p + '~' + p95p });

    function rate(map, k) { return (map[k] || 0) / b.n; }
    var ro = rate(b.odd, odd), rb = rate(b.big, big), rz = rate(b.zone, z.join(':'));
    var rc = rate(b.cons, cons), rt = rate(b.tail, tail);
    items.push({ k: '奇偶', v: odd + ':' + (6 - odd), ok: ro >= 0.1, note: '该比例历史占 ' + (ro * 100).toFixed(1) + '%' });
    items.push({ k: '大小', v: big + ':' + (6 - big), ok: rb >= 0.1, note: '该比例历史占 ' + (rb * 100).toFixed(1) + '%' });
    items.push({ k: '三区', v: z.join(':'), ok: rz >= 0.05, note: '该分布历史占 ' + (rz * 100).toFixed(1) + '%' });
    items.push({ k: '连号', v: cons ? cons + ' 组' : '无', ok: rc >= 0.15, note: '该情况历史占 ' + (rc * 100).toFixed(1) + '%' });
    items.push({ k: '尾数', v: tail + ' 个', ok: rt >= 0.1, note: '该情况历史占 ' + (rt * 100).toFixed(1) + '%' });
    if (prevRed) {
      var rn = 0;
      for (i = 0; i < 6; i++) if (prevRed.indexOf(red[i]) >= 0) rn++;
      var rr = rate(b.rep, rn);
      items.push({ k: '重号', v: rn + ' 个', ok: rr >= 0.1, note: '与上一期相比，该情况历史占 ' + (rr * 100).toFixed(1) + '%' });
    } else {
      items.push({ k: '重号', v: '—', ok: true, note: '无参照期' });
    }
    var pass = items.filter(function (x) { return x.ok; }).length;
    var level = pass >= 7 ? 'good' : (pass >= 5 ? 'mid' : 'bad');
    var verdict = pass >= 7 ? '典型形态' : (pass >= 5 ? '基本正常' : '偏冷门');
    return { items: items, pass: pass, verdict: verdict, level: level, sum: s, span: span };
  }

  /* ---------- 渲染 ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ballsHTML(red, blue, small) {
    var h = '', i;
    if (small) {
      for (i = 0; i < red.length; i++) h += '<span class="b r">' + pad(red[i]) + '</span>';
      h += '<span class="b bl">' + pad(blue) + '</span>';
    } else {
      for (i = 0; i < red.length; i++) h += '<span class="sim-ball r">' + pad(red[i]) + '</span>';
      h += '<span class="sim-ball b">' + pad(blue) + '</span>';
    }
    return h;
  }
  function render() {
    capList();                         /* 与 save 同步裁剪，界面条数和存储不会打架 */
    var box = document.getElementById('simList');
    var emp = document.getElementById('simEmpty');
    document.getElementById('simCount').textContent = list.length;
    emp.style.display = list.length ? 'none' : 'block';
    var h = '';
    for (var i = list.length - 1; i >= 0; i--) {
      var it = list[i], e = it.ev;
      h += '<div class="sim-item" data-i="' + i + '">' +
             '<div class="sim-row1"><span class="sim-idx">#' + (i + 1) + '</span>' +
             '<span class="sim-badge ' + e.level + '">' + e.verdict + ' ' + e.pass + '/8</span></div>' +
             '<div class="sim-balls-sm">' + ballsHTML(it.red, it.blue, true) + '</div>' +
             '<div class="sim-sum">和值 ' + e.sum + ' · 跨度 ' + e.span +
             ' · 奇偶 ' + countOdd(it.red) + ':' + (6 - countOdd(it.red)) + '</div>' +
             '<table class="sim-tb">';
      for (var j = 0; j < e.items.length; j++) {
        var x = e.items[j];
        h += '<tr><td>' + x.k + '</td><td class="' + (x.ok ? 'ok' : 'no') + '">' + x.v +
             '</td><td>' + x.note + '</td></tr>';
      }
      h += '</table></div>';
    }
    box.innerHTML = h;
  }
  function countOdd(r) { var c = 0; for (var i = 0; i < 6; i++) if (r[i] % 2) c++; return c; }

  /* ---------- 持久化 ----------
     权威存储是结果文件 sim3d_results.json，由本地服务（node picker/sim_server.js）读写；
     没启动服务时下面的远程调用静默失败，页面照常工作（数据留在 localStorage / 内存）。 */
  var API = (typeof GameGlobal !== 'undefined' && GameGlobal.__SIM_BASE ? GameGlobal.__SIM_BASE : 'http://127.0.0.1:8731') + '/api/sim3d';
  function pack() {
    return list.map(function (x) { return { r: x.red, b: x.blue, t: x.time, e: x.ev }; });
  }
  function remoteSave() {
    try {
      /* text/plain 触发不了 CORS 预检，跨源（file://、预览面板）也能直接 POST */
      fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(pack()) }).catch(function () {});
    } catch (e) {}
  }
  function remoteLoad(then) {
    try {
      fetch(API, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var arr = (j && j.results) || [], seen = {}, i, added = 0;
          for (i = 0; i < list.length; i++)
            seen[list[i].time + '|' + list[i].blue + '|' + list[i].red.join(',')] = 1;
          for (i = 0; i < arr.length; i++) {
            var x = arr[i];
            var red = (x.r || []).slice().sort(function (a, b) { return a - b; });
            var blue = +x.b || 0;
            if (red.length !== 6 || blue < 1 || blue > 16) continue;
            var k = (+x.t || 0) + '|' + blue + '|' + red.join(',');
            if (seen[k]) continue;
            seen[k] = 1;
            list.push({ red: red, blue: blue, time: +x.t || 0, ev: x.e || null });
            added++;
          }
          if (added) {
            list.sort(function (a, b) { return a.time - b.time; });
            reevaluate();
            render(); save();
          }
          if (then) then(added);
        }).catch(function () { if (then) then(0); });
    } catch (e) { if (then) then(0); }
  }
  /* 按时间序统一重算全部评估（重号参照 = 列表中上一条，首条参照真实最新开奖） */
  function reevaluate() {
    var D = window.SSQ_DATA;
    var prev = (D && D.length)
      ? D[D.length - 1][1].slice().sort(function (a, b) { return a - b; }) : null;
    for (var i = 0; i < list.length; i++) {
      list[i].ev = evaluate(list[i].red, list[i].blue, prev);
      prev = list[i].red;
    }
  }
  function save() {
    try {
      capList();                       /* 落盘前裁剪：storage 里永远只有最近 10 期 */
      /* 连评估结果一起落盘，选号工具读取后无需重算历史基线 */
      localStorage.setItem(KEY, JSON.stringify(pack()));
    } catch (e) {}
  }
  function load() {
    try {
      var s = localStorage.getItem(KEY);
      if (!s) return;
      var arr = JSON.parse(s), i;
      for (i = 0; i < arr.length; i++) {
        var red = (arr[i].r || []).slice().sort(function (a, b) { return a - b; });
        if (red.length !== 6) continue;
        list.push({ red: red, blue: arr[i].b, time: arr[i].t, ev: arr[i].e || null });
      }
      list.sort(function (a, b) { return a.time - b.time; });
      reevaluate();        /* 兼容旧数据缺评估：统一重算后 save 回写 */
      save();
    } catch (e) { list = []; }
  }

  /* ---------- 交互：摇完自动入列 + 右上角轻提示（5 秒后淡出，不突然消失） ---------- */
  var noticeTimer = null, fadeTimer = null;
  function showNotice(rec, idx) {
    document.getElementById('simPromptTitle').textContent = '已加入模拟结果 #' + (idx + 1);
    document.getElementById('simPromptBalls').innerHTML = ballsHTML(rec.red, rec.blue, false);
    document.getElementById('simPromptEval').innerHTML =
      '<b>' + rec.ev.verdict + ' ' + rec.ev.pass + '/8</b> · 和值 ' + rec.ev.sum +
      ' · 跨度 ' + rec.ev.span + '<br><span class="hint">点此展开列表查看 8 项形态评估</span>';
    clearTimeout(noticeTimer); clearTimeout(fadeTimer);
    var el = document.getElementById('simPrompt');
    el.classList.remove('out');
    el.classList.add('on');
    noticeTimer = setTimeout(hideNotice, 5000);
  }
  function hideNotice() {
    var el = document.getElementById('simPrompt');
    if (!el.classList.contains('on')) return;
    el.classList.add('out');
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(function () { el.classList.remove('on', 'out'); }, 480);
  }

  window.SimLog = {
    /* 摇完一期直接入列并评估，不再询问。
       pick 可选：带注摇奖时传入，只留在内存（pack 不落盘），供选号页回填对照。 */
    onDrawComplete: function (red, blue, pick) {
      var r = red.slice().sort(function (a, b) { return a - b; });
      var prev = list.length ? list[list.length - 1].red
        : (window.SSQ_DATA ? window.SSQ_DATA[window.SSQ_DATA.length - 1][1] : null);
      var rec = { red: r, blue: blue, time: Date.now(), ev: evaluate(r, blue, prev) };
      if (pick && pick.red && pick.red.length === 6) rec.pick = { red: pick.red.slice(), blue: pick.blue };
      list.push(rec);
      render(); save(); remoteSave();
      showNotice(rec, list.length - 1);
    },
    /* 供跳转选号工具时取内存数据（预览沙箱下 localStorage 可能不可用，数据只在内存里） */
    snapshot: function () { return list; },
    clear: function () { list = []; render(); save(); remoteSave(); }
  };

  document.getElementById('simPrompt').onclick = function (e) {
    if (e.target.id === 'simPromptX') return;      /* × 自己处理 */
    hideNotice();
    document.getElementById('simPanel').classList.remove('collapsed');
  };
  document.getElementById('simPromptX').onclick = hideNotice;
  /* 开始下一期时自动收起上一期的提示，避免挡住摇奖画面 */
  document.getElementById('startBtn').addEventListener('click', hideNotice);

  document.getElementById('simToggle').onclick = function () {
    document.getElementById('simPanel').classList.toggle('collapsed');
  };
  document.getElementById('simClear').onclick = function () {
    if (!list.length) return;
    if (!confirm('清空全部 ' + list.length + ' 条模拟结果？')) return;
    list = []; render(); save(); remoteSave();
  };
  document.getElementById('simList').addEventListener('click', function (e) {
    var it = e.target.closest('.sim-item');
    if (it) it.classList.toggle('open');
  });

  load();
  render();
  buildBase();          /* 预热基线，避免第一次入列时卡顿 */
  remoteLoad();         /* 有本地服务时，把结果文件里的历史记录合并进来 */
})();
