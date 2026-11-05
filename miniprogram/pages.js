/* ============================================================
   小游戏内「选号工具 / 记录」页面（纯 Canvas，无 DOM、无 Chart.js）
   ------------------------------------------------------------
   与 hud.js 共用同一张离屏画布和 CanvasTexture，页面切换零额外纹理。
   数据来源与 Web 版完全同源：
     - libs/ssq-data.js   2083 期历史开奖（picker/data.js）
     - src/analysis.js    picker 的统计/权重/评分/生成算法
     - src/simlog.js      index.html 的 SimLog（8 项形态评估 + 持久化）
     - libs/sim-real.js   物理内核（本地出号，替代 PC 上的 Node 服务）
   图表全部自绘（柱状/分布），不引入 Chart.js：小游戏里它要整套 DOM
   适配且体积 >200KB，收益不值。
   ============================================================ */
(function () {
  'use strict';

  const DATA = require('./libs/ssq-data.js');
  const { createAnalysis } = require('./src/analysis.js');
  const PHYS = require('./libs/sim-real.js');
  const hud = GameGlobal.__hud;
  const A = createAnalysis(DATA);

  const KEY_PICKS = 'ssq_mini_saved_picks_v1';
  /* 落地页是「选号」而不是 3D：主流程为 选号 → 带这注去 3D 摇奖 → 摇完回选号看对照。
     3D 退化为子页，从选号页顶部「← 3D 开奖」进入（hud.js 的「选号」按钮则反向回这里）。 */
  let current = 'tool';                 // draw | tool
  let tab = 'pick';                     // dist | pick | log
  let scrollY = 0, contentH = 0;
  let regions = [];                     // 本次绘制的可点击区域（屏幕坐标）
  let startY = 0, startRegion = null, moved = false;
  let openedLog = -1;                   // 记录页展开的条目
  let status = '';
  let saved = [];
  let recs = [];                        // 智能推荐结果
  let logRows = [];
  let pick = { red: [], blue: 0 };
  let busy = false;

  /* 跨页状态：选号页写入「带注」，3D 页摇完由 index.html 把注挂到记录上，
     回到选号页再结算成对照结果。hud.js 只读 pending 用于按钮文案/提示条。 */
  const MATCH = GameGlobal.__match = { pending: null, result: null };

  try { saved = JSON.parse(GameGlobal.localStorage.getItem(KEY_PICKS) || '[]') || []; }
  catch (e) { saved = []; }

  const C = {
    bg: '#f2f6fc', card: '#ffffff', ink: '#1c2f4a', sub: '#6b7f99',
    line: '#dbe4f0', red: '#d8382f', blue: '#2878d0',
    accent: '#1c447f', soft: '#eaf1fa', good: '#1f7a3d', warn: '#a36a08'
  };

  function dirty() { hud.markDirty(); }
  function open(page) {
    current = page;
    scrollY = 0; status = '';
    if (page === 'tool') { syncMatch(); refreshLog(); }
    dirty();
  }
  function close() { open('draw'); }
  function isDrawPage() { return current === 'draw'; }

  function refreshLog() {
    const S = GameGlobal.SimLog;
    logRows = (S && S.snapshot) ? S.snapshot().slice().reverse() : [];
  }

  /* 把「上一次带注摇奖」结算成对照结果。
     数据源是 SimLog 最后一条记录：rec.pick 由 index.html 在开奖完成时挂上（仅内存，不落盘）。
     同一期只算一次，避免每次切页都重算/闪烁。 */
  function syncMatch() {
    const S = GameGlobal.SimLog;
    const rows = (S && S.snapshot) ? S.snapshot() : [];
    const last = rows.length ? rows[rows.length - 1] : null;
    /* 用记录对象的引用判「同一期」，不用时间戳：同一毫秒内连摇两期时
       time 会撞车，旧的 `MATCH.result.time === last.time` 会误判成已结算。 */
    if (last && last.pick && !(MATCH.result && MATCH.result.rec === last)) {
      const p = last.pick, d = { red: last.red, blue: last.blue };
      const redHit = p.red.filter(v => d.red.indexOf(v) >= 0).length;
      const blueHit = p.blue === d.blue ? 1 : 0;
      const level = (A.prizeOf ? A.prizeOf(p, d) : 0) || 0;
      MATCH.result = {
        pick: { red: p.red.slice(), blue: p.blue },
        draw: { red: d.red.slice(), blue: d.blue },
        redHit, blueHit, level, time: last.time, rec: last
      };
      dirty();
    }
    /* 离开 3D 页即视为本次「带注」意图已结束：没摇（用户中途返回）也不该留给下一期 */
    clearPending();
  }
  function clearPending() {
    MATCH.pending = null;
    GameGlobal.__PENDING_PICK = null;
  }
  function prizeLabelOf(rec) {
    if (rec && rec.pick && A.prizeOf) return A.LVN[A.prizeOf(rec.pick, { red: rec.red, blue: rec.blue })] || '未中奖';
    return comparePrize(rec);
  }

  /* ---------- 绘制小工具 ---------- */
  function rr(g, x, y, w, h, r, fill, stroke) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); }
  }
  function txt(g, s, x, y, size, color, align, bold) {
    g.fillStyle = color || C.ink;
    g.font = (bold ? 'bold ' : '') + (size || 13) + 'px sans-serif';
    g.textAlign = align || 'left';
    g.textBaseline = 'middle';
    g.fillText(String(s), x, y);
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ball(g, x, y, r, n, blue) {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    const grd = g.createRadialGradient(x - r * .35, y - r * .4, r * .1, x, y, r);
    grd.addColorStop(0, blue ? '#8bb8ff' : '#ff9c92');
    grd.addColorStop(1, blue ? '#1c5fb0' : '#bd2a22');
    g.fillStyle = grd; g.fill();
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1.5; g.stroke();
    txt(g, pad2(n), x, y + 1, Math.round(r * .95), '#fff', 'center', true);
  }
  /* 滚动内容里的点击区：绘制时传「内容坐标」，这里换算成屏幕坐标 */
  function R(x, y, w, h, fn) { regions.push({ x, y: y - scrollY, w, h, fn }); }
  /* 固定区域（标题栏 / tab）不受滚动影响 */
  function F(x, y, w, h, fn) { regions.push({ x, y, w, h, fn }); }
  function btn(g, x, y, w, h, label, fn, opt) {
    opt = opt || {};
    rr(g, x, y, w, h, 9, opt.fill || C.accent, opt.stroke || null);
    txt(g, label, x + w / 2, y + h / 2 + 1, opt.size || 13, opt.color || '#fff', 'center', true);
    R(x, y, w, h, fn);
  }
  function card(g, x, y, w, h) { rr(g, x, y, w, h, 12, C.card, C.line); }

  /* 柱状图：自绘，替代 Chart.js */
  function bars(g, x, y, w, h, vals, maxVal, color, labelEvery) {
    const n = vals.length, bw = w / n;
    g.strokeStyle = C.line; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + w, y + h); g.stroke();
    const mx = maxVal || Math.max.apply(null, vals) || 1;
    for (let i = 0; i < n; i++) {
      const bh = Math.max(2, (vals[i] / mx) * (h - 16));
      g.fillStyle = color;
      rr(g, x + i * bw + 1, y + h - bh, Math.max(2, bw - 2), bh, 2, color);
      if (i % labelEvery === 0) txt(g, i + 1, x + i * bw + bw / 2, y + h + 9, 9, C.sub, 'center');
    }
  }
  function section(g, x, y, w, title, sub) {
    txt(g, title, x, y + 10, 14, C.ink, 'left', true);
    if (sub) txt(g, sub, x + w, y + 10, 11, C.sub, 'right');
    return y + 26;
  }

  /* ================= 分布页 ================= */
  function drawDist(g, W, M, top) {
    const x = M.pad, w = W - M.pad * 2;
    let y = top;

    card(g, x, y, w, 78);
    txt(g, '历史数据', x + 12, y + 18, 12, C.sub);
    txt(g, A.N + ' 期', x + 12, y + 42, 20, C.ink, 'left', true);
    const last = A.LAST;
    txt(g, '最新 ' + last[0] + ' 期', x + w - 12, y + 18, 12, C.sub, 'right');
    const lr = last[1];
    for (let i = 0; i < 6; i++) ball(g, x + w - 20 - (5 - i) * 26, y + 48, 11, lr[i], false);
    ball(g, x + w - 20 + 26, y + 48, 11, last[2], true);
    y += 90;

    const hotR = [], coldR = [];
    for (let n = 1; n <= 33; n++) { hotR.push([n, A.freqR[n]]); coldR.push([n, A.missR[n]]); }
    hotR.sort((a, b) => b[1] - a[1]); coldR.sort((a, b) => b[1] - a[1]);

    card(g, x, y, w, 156);
    y = section(g, x + 12, y + 6, w - 24, '红球出现频次', '共 ' + A.N + ' 期 · 每期 6 球');
    bars(g, x + 12, y, w - 24, 100, A.freqR.slice(1), 0, C.red, 3);
    y += 130;

    card(g, x, y, w, 130);
    y = section(g, x + 12, y + 6, w - 24, '蓝球出现频次', '共 ' + A.N + ' 期 · 每期 1 球');
    bars(g, x + 12, y, w - 24, 76, A.freqB.slice(1), 0, C.blue, 2);
    y += 106;

    /* 和值分布：dist.sum 是「十位桶 -> 次数」，等价于 Web 版 4 张图表之一 */
    const sumKeys = Object.keys(A.dist.sum).map(Number).sort((a, b) => a - b);
    const sumVals = sumKeys.map(k => A.dist.sum[k] || 0);
    card(g, x, y, w, 138);
    y = section(g, x + 12, y + 6, w - 24, '红球和值分布', '按十位分桶');
    bars(g, x + 12, y, w - 24, 82, sumVals, 0, '#5a86c4', 2);
    y += 112;

    card(g, x, y, w, 92);
    txt(g, '最热红球', x + 12, y + 20, 12, C.sub);
    txt(g, hotR.slice(0, 5).map(v => pad2(v[0])).join('  '), x + 12, y + 44, 16, C.red, 'left', true);
    txt(g, '最久未出', x + 12, y + 72, 12, C.sub);
    txt(g, coldR.slice(0, 5).map(v => pad2(v[0]) + '(' + v[1] + ')').join(' '),
      x + 84, y + 72, 12, C.ink);
    y += 104;
    return y - top;
  }

  /* ================= 选号页 ================= */
  function toggleRed(n) {
    const i = pick.red.indexOf(n);
    if (i >= 0) pick.red.splice(i, 1);
    else if (pick.red.length < 6) pick.red.push(n);
    pick.red.sort((a, b) => a - b);
    clearPending();                    /* 改过号就不再是「带进去的那一注」 */
    dirty();
  }
  function quickPick() {
    const pool = []; for (let n = 1; n <= 33; n++) pool.push(n);
    const r = [];
    for (let i = 0; i < 6; i++) r.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    pick = { red: r.sort((a, b) => a - b), blue: 1 + Math.floor(Math.random() * 16) };
    clearPending();
    status = '已机选一注';
    dirty();
  }
  function smartPick() {
    const out = A.generate({
      alpha: 0.6, win: 300, cand: 600, k: 3, maxOv: 4, cap: 99,
      cfg: {}, dan: null, kill: null
    });
    recs = out.picks;
    status = '按历史形态评分生成 ' + recs.length + ' 注（点击载入）';
    dirty();
  }
  /* 带着当前这注切到 3D 页：pending 交给 3D，摇完由 index.html 挂到记录上 */
  function goDraw() {
    if (pick.red.length !== 6 || !pick.blue) {
      status = '请先选满 6 红 + 1 蓝，再去 3D 摇奖'; dirty(); return;
    }
    MATCH.pending = { red: pick.red.slice().sort((a, b) => a - b), blue: pick.blue };
    GameGlobal.__PENDING_PICK = MATCH.pending;
    status = '';
    open('draw');
  }
  function savePick() {
    if (pick.red.length !== 6 || !pick.blue) { status = '请先选满 6 红 + 1 蓝'; dirty(); return; }
    saved.push({ red: pick.red.slice(), blue: pick.blue, time: Date.now() });
    if (saved.length > 50) saved = saved.slice(-50);
    try { GameGlobal.localStorage.setItem(KEY_PICKS, JSON.stringify(saved)); } catch (e) {}
    status = '已保存，记录页可对比中奖';
    dirty();
  }
  function localDraw() {
    if (busy) return;
    busy = true; status = '本地物理仿真中…（约 1~2 秒）'; dirty();
    setTimeout(function () {
      let d = null;
      try { d = PHYS.shakeOnce(); } catch (e) { status = '仿真异常：' + e.message; }
      if (d && d.red && d.red.length === 6) {
        /* 带着当前注摇（选满了才带），摇完立刻结算，不切页也能看到对照 */
        const pk = (pick.red.length === 6 && pick.blue)
          ? { red: pick.red.slice().sort((a, b) => a - b), blue: pick.blue } : null;
        if (GameGlobal.SimLog) GameGlobal.SimLog.onDrawComplete(d.red, d.blue, pk);
        status = '已摇出 ' + d.red.map(pad2).join(' ') + ' + ' + pad2(d.blue) + '（已入记录）';
        refreshLog(); syncMatch();
      } else if (!status || status.indexOf('异常') < 0) status = '本次仿真未出满，请重试';
      busy = false; dirty();
    }, 120);   /* 先让「计算中」这一帧画出来，再跑同步物理仿真 */
  }

  function drawPick(g, W, M, top) {
    const x = M.pad, w = W - M.pad * 2;
    let y = top;

    card(g, x, y, w, 84);
    txt(g, '当前选号', x + 12, y + 18, 12, C.sub);
    const br = 15, gap = 6;
    const bw = br * 2 * 7 + gap * 6;
    const bx = x + (w - bw) / 2 + br;
    for (let i = 0; i < 7; i++) {
      const n = i < 6 ? pick.red[i] : pick.blue;
      const cx = bx + i * (br * 2 + gap);
      if (n) ball(g, cx, y + 52, br, n, i === 6);
      else {
        g.beginPath(); g.arc(cx, y + 52, br, 0, Math.PI * 2);
        g.fillStyle = i === 6 ? 'rgba(40,120,208,.12)' : 'rgba(216,56,47,.10)'; g.fill();
        g.strokeStyle = C.line; g.lineWidth = 1; g.stroke();
        txt(g, '?', cx, y + 52, 13, C.sub, 'center');
      }
    }
    y += 94;

    /* 上一次带注摇奖的对照（只在有结果时出现，不占常态版面） */
    if (MATCH.result) {
      const r = MATCH.result;
      card(g, x, y, w, 82);
      txt(g, '上次摇奖对照', x + 12, y + 16, 12, C.sub);
      txt(g, r.level ? A.LVN[r.level] : '未中奖', x + w - 12, y + 16, 13,
        r.level ? C.red : C.sub, 'right', true);
      for (let k = 0; k < 6; k++) ball(g, x + 22 + k * 24, y + 42, 10, r.draw.red[k], false);
      ball(g, x + 22 + 6 * 24 + 6, y + 42, 10, r.draw.blue, true);
      txt(g, '你的注 ' + r.pick.red.map(pad2).join(' ') + ' + ' + pad2(r.pick.blue),
        x + 12, y + 66, 10, C.sub);
      txt(g, '红中 ' + r.redHit + ' · 蓝' + (r.blueHit ? '中' : '未中'),
        x + w - 12, y + 66, 11, r.redHit || r.blueHit ? C.good : C.sub, 'right', true);
      y += 92;
    }

    const b3 = (w - 16) / 3;
    btn(g, x, y, b3, 40, '智能推荐', smartPick);
    btn(g, x + b3 + 8, y, b3, 40, '机选一注', quickPick, { fill: '#4a6fa5' });
    btn(g, x + (b3 + 8) * 2, y, b3, 40, '保存', savePick, { fill: '#1f7a3d' });
    y += 50;

    /* 手动点号：红 33（7 列 × 5 行） */
    card(g, x, y, w, 236);
    y = section(g, x + 12, y + 6, w - 24, '手动选红球', '最多 6 个');
    const colsR = 7, cw = (w - 24 - (colsR - 1) * 5) / colsR, ch = 34;
    for (let n = 1; n <= 33; n++) {
      const i = n - 1, cx = x + 12 + (i % colsR) * (cw + 5), cy = y + Math.floor(i / colsR) * (ch + 5);
      const on = pick.red.indexOf(n) >= 0;
      rr(g, cx, cy, cw, ch, 7, on ? C.red : C.soft, on ? C.red : C.line);
      txt(g, pad2(n), cx + cw / 2, cy + ch / 2 + 1, 13, on ? '#fff' : C.ink, 'center', true);
      R(cx, cy, cw, ch, (function (v) { return function () { toggleRed(v); }; })(n));
    }
    y += 5 * (ch + 5) + 12;

    /* 蓝球 16（8 列 × 2 行） */
    card(g, x, y, w, 120);
    y = section(g, x + 12, y + 6, w - 24, '选蓝球', '单选');
    const colsB = 8, bw2 = (w - 24 - (colsB - 1) * 5) / colsB;
    for (let n = 1; n <= 16; n++) {
      const i = n - 1, cx = x + 12 + (i % colsB) * (bw2 + 5), cy = y + Math.floor(i / colsB) * (ch + 5);
      const on = pick.blue === n;
      rr(g, cx, cy, bw2, ch, 7, on ? C.blue : C.soft, on ? C.blue : C.line);
      txt(g, pad2(n), cx + bw2 / 2, cy + ch / 2 + 1, 13, on ? '#fff' : C.ink, 'center', true);
      R(cx, cy, bw2, ch, (function (v) {
        return function () { pick.blue = v; dirty(); };
      })(n));
    }
    y += 2 * (ch + 5) + 14;

    if (recs.length) {
      card(g, x, y, w, 30 + recs.length * 40);
      txt(g, '推荐结果（点击载入）', x + 12, y + 18, 12, C.sub);
      for (let i = 0; i < recs.length; i++) {
        const ry = y + 30 + i * 40, p = recs[i];
        rr(g, x + 10, ry, w - 20, 36, 8, C.soft);
        for (let k = 0; k < 6; k++) ball(g, x + 28 + k * 26, ry + 18, 11, p.red[k], false);
        ball(g, x + 28 + 6 * 26 + 8, ry + 18, 11, p.blue, true);
        R(x + 10, ry, w - 20, 36, (function (q) {
          return function () { pick = { red: q.red.slice(), blue: q.blue }; clearPending(); status = '已载入推荐注'; dirty(); };
        })(p));
      }
      y += 30 + recs.length * 40 + 10;
    }

    /* 主路径：带这注去 3D 摇，摇完自动回填对照；次路径：本地快摇不等动画 */
    btn(g, x, y, w, 46, '带这注去 3D 摇奖', goDraw, { fill: C.accent, size: 15 });
    y += 54;
    btn(g, x, y, w, 38, '本地快摇一期（不等动画）', localDraw, { fill: '#6b4c93', size: 12 });
    y += 48;
    return y - top;
  }

  /* ================= 记录页 ================= */
  function comparePrize(rec) {
    if (!saved.length || !A.prizeOf) return '';
    let best = 0;
    for (let i = 0; i < saved.length; i++) {
      const lv = A.prizeOf(saved[i], { red: rec.red, blue: rec.blue });
      if (lv && (best === 0 || lv < best)) best = lv;
    }
    return best ? A.LVN[best] : '未中奖';
  }
  function clearLog() {
    if (GameGlobal.SimLog && GameGlobal.SimLog.clear) GameGlobal.SimLog.clear();
    refreshLog(); openedLog = -1; status = '记录已清空'; dirty();
  }
  function drawLog(g, W, M, top) {
    const x = M.pad, w = W - M.pad * 2;
    let y = top;

    card(g, x, y, w, 56);
    txt(g, '开奖记录 ' + logRows.length + ' 期', x + 12, y + 20, 14, C.ink, 'left', true);
    txt(g, '已保存选号 ' + saved.length + ' 注', x + 12, y + 40, 11, C.sub);
    btn(g, x + w - 82, y + 10, 70, 36, '清空', clearLog, { fill: '#a33a32', size: 12 });
    y += 66;

    if (!logRows.length) {
      card(g, x, y, w, 86);
      txt(g, '还没有开奖记录', x + w / 2, y + 32, 14, C.sub, 'center', true);
      txt(g, '回到 3D 开奖，或在选号页点「本地物理摇一期」', x + w / 2, y + 58, 11, C.sub, 'center');
      y += 96;
      return y - top;
    }

    for (let i = 0; i < logRows.length; i++) {
      const rec = logRows[i], ev = rec.ev || {};
      const open = openedLog === i;
      const h = open ? 96 + (ev.items ? ev.items.length * 22 : 0) : 86;
      card(g, x, y, w, h);
      txt(g, '#' + (logRows.length - i), x + 12, y + 18, 12, C.sub);
      const d = new Date(rec.time || Date.now());
      txt(g, (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()),
        x + w - 12, y + 18, 11, C.sub, 'right');
      const br = 12;
      for (let k = 0; k < 6; k++) ball(g, x + 24 + k * 27, y + 44, br, rec.red[k], false);
      ball(g, x + 24 + 6 * 27 + 6, y + 44, br, rec.blue, true);
      const lv = prizeLabelOf(rec);
      txt(g, (ev.verdict || '') + ' ' + (ev.pass || 0) + '/8', x + 12, y + 70, 12,
        ev.level === 'good' ? C.good : (ev.level === 'bad' ? C.warn : C.ink));
      if (lv) txt(g, lv, x + w - 12, y + 70, 12, lv === '未中奖' ? C.sub : C.red, 'right', true);
      if (open && ev.items) {
        for (let k = 0; k < ev.items.length; k++) {
          const it = ev.items[k];
          txt(g, it.k + ' ' + it.v, x + 12, y + 94 + k * 22, 11, it.ok ? C.good : C.warn);
          txt(g, it.note || '', x + 108, y + 94 + k * 22, 10, C.sub);
        }
      }
      R(x, y, w, h, (function (idx) {
        return function () { openedLog = openedLog === idx ? -1 : idx; dirty(); };
      })(i));
      y += h + 8;
    }
    return y - top;
  }

  /* ================= 页面框架 ================= */
  function renderPage(g, W, H, M) {
    regions = [];
    /* 不透明背景：盖住上一帧 3D 画面（非 draw 页不渲染 3D） */
    g.fillStyle = C.bg; g.fillRect(0, 0, W, H);

    const x = M.pad, w = W - M.pad * 2;
    const y0 = M.safeTop + 8;
    F(x, y0, 84, 38, function () { close(); });
    rr(g, x, y0, 84, 38, 9, C.accent);
    txt(g, '← 3D 开奖', x + 42, y0 + 20, 12, '#fff', 'center', true);
    txt(g, '双色球 · 选号工具', W / 2, y0 + 19, 16, C.ink, 'center', true);

    const tabs = [['dist', '分布'], ['pick', '选号'], ['log', '记录']];
    const ty = y0 + 48, tw = (w - 12) / 3;
    for (let i = 0; i < 3; i++) {
      const tx = x + i * (tw + 6), on = tab === tabs[i][0];
      rr(g, tx, ty, tw, 34, 9, on ? C.accent : C.card, on ? null : C.line);
      txt(g, tabs[i][1], tx + tw / 2, ty + 18, 13, on ? '#fff' : C.sub, 'center', true);
      F(tx, ty, tw, 34, (function (k) { return function () { tab = k; scrollY = 0; if (k === 'log') refreshLog(); dirty(); }; })(tabs[i][0]));
    }

    const top = ty + 44, bottom = H - M.safeBottom - 10;
    contentH = (tab === 'dist') ? drawDistPrep(g, W, M, top, bottom)
      : (tab === 'pick') ? drawPickPrep(g, W, M, top, bottom)
        : drawLogPrep(g, W, M, top, bottom);

    /* 状态条 */
    if (status) {
      rr(g, x, bottom - 30, w, 28, 8, 'rgba(28,68,128,.9)');
      txt(g, status, x + w / 2, bottom - 16, 11, '#fff', 'center');
    }
  }

  /* 三个 tab 统一做「裁剪 + 滚动」包装，页面函数只管按内容坐标画 */
  function wrap(g, W, M, top, bottom, fn) {
    g.save();
    g.beginPath(); g.rect(0, top, W, bottom - top); g.clip();
    g.translate(0, -scrollY);
    const h = fn(g, W, M, top);
    g.restore();
    return h;
  }
  function drawDistPrep(g, W, M, top, bottom) { return wrap(g, W, M, top, bottom, drawDist); }
  function drawPickPrep(g, W, M, top, bottom) { return wrap(g, W, M, top, bottom, drawPick); }
  function drawLogPrep(g, W, M, top, bottom) { return wrap(g, W, M, top, bottom, drawLog); }

  /* ================= 触摸 ================= */
  function touch(type, x, y) {
    if (current === 'draw') {
      if (type === 'start') return hud.hitTest(x, y);
      return false;
    }
    if (type === 'start') {
      startY = y; moved = false; startRegion = null;
      for (let i = regions.length - 1; i >= 0; i--) {
        const r = regions[i];
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) { startRegion = r; break; }
      }
      return true;
    }
    if (type === 'move') {
      const dy = y - startY;
      if (Math.abs(dy) > 4) { moved = true; startRegion = null; }
      const M = hud.metrics;
      const viewH = M.H - M.safeBottom - 10 - (M.safeTop + 8 + 48 + 44);
      const maxY = Math.max(0, contentH - viewH);
      const nv = Math.max(0, Math.min(maxY, scrollY - dy * 0.35));
      if (nv !== scrollY) { scrollY = nv; startY = y; dirty(); }
      return true;
    }
    if (type === 'end' || type === 'cancel') {
      if (startRegion && !moved && type === 'end') {
        try { startRegion.fn(); } catch (e) { console.error('[pages] tap', e); }
      }
      startRegion = null;
      return true;
    }
    return true;
  }

  /* 启动即落地选号页：open('tool') 会顺带做一次记录同步与「带注」结算，
     免得首屏切到选号 tab 时 logRows / MATCH.result 还是空的。 */
  open('tool');

  GameGlobal.__ui = {
    current: function () { return current; },
    isDrawPage,
    open,
    close,
    renderPage,
    touch,
    /* 画布 UI 没有 DOM 可查，留一个点击区的只读快照便于排查（也供离线冒烟测试） */
    regions() { return regions.slice(); },
    draw(renderer) { hud.draw(renderer); }
  };

  console.log('[pages] ready · 历史 ' + A.N + ' 期 · 选号/记录页已挂载');
})();
