/* ============================================================
   UI 表面：一张离屏 2D 画布，每帧由 composite() 叠到上屏 2D 画布
   ------------------------------------------------------------
   开奖页画 HUD；选号页 / 记录页由 pages.js 通过 __ui.renderPage 画在
   **同一张**画布上。页面切换不新增任何资源，只有状态变化时才 redraw。
   3D 画在 adapter 创建的离屏 WebGL 画布上，合成顺序 3D → UI；
   UI 画布在舞台区域透明，3D 正好透出来，舞台外是不透明底色。
   这样完全不依赖 WebGL 纹理上传，模拟器 WebGL1 与真机行为一致。
   伪 DOM 元素由 adapter.js 提供，Web 端 HUD 逻辑一行不改。

   方向策略（重要）
   ----------------
   微信小游戏的 deviceOrientation 是 game.json 里**启动即固定**的，
   运行中没有切换屏幕方向的 API（setDeviceOrientation 是小程序的能力，
   小游戏里不存在）。所以「首页竖屏、3D 横屏」只能力用一个折中：
   全局竖屏，3D 页在竖屏里开一条**横向舞台**（STAGE）——
   3D 的 viewport / scissor / 相机 aspect 全部按舞台计算（见 index.html
   的 applySize），舞台外由这张画布填 UI 底色，舞台内 clearRect 挖空
   让 3D 透出来。视觉上就是一块横屏取景框，首页则始终是正常竖屏。
   ============================================================ */
(function () {
  'use strict';

  /* 纯 2D：不再引入 three。上屏画布由 adapter 取 2D context，3D 画在离屏
     WebGL 画布上，这里只负责画 UI 画布并每帧把两层叠加上去（composite）。 */
  const cv = wx.createCanvas();
  const ctx = cv.getContext('2d');
  const resultsEl = GameGlobal.document.getElementById('results');
  const phaseEl = GameGlobal.document.getElementById('phase');
  const startBtn = GameGlobal.document.getElementById('startBtn');
  const resetBtn = GameGlobal.document.getElementById('resetBtn');
  /* 2D 合成：在上屏画布（2D）上按顺序叠加 3D 层与 UI 层。
     UI 画布在舞台区域是透明的（drawHUD 里 clearRect 挖空），3D 因此能透出来；
     舞台外是不透明深色底，正好盖住离屏 WebGL 画布的空区。
     选号/记录页不渲 3D，此时只画 UI 层，避免把上一帧的 3D 残留带过来。 */
  function composite() {
    const main = GameGlobal.__mainCanvas;
    const mc = GameGlobal.__mainCtx;
    const glc = GameGlobal.__glCanvas;
    if (!main || !mc) return;
    const w = main.width, h = main.height;
    if (!(w > 0 && h > 0)) return;
    mc.setTransform(1, 0, 0, 1, 0, 0);
    mc.clearRect(0, 0, w, h);
    const ui = GameGlobal.__ui;
    if ((!ui || ui.isDrawPage()) && glc && glc.width > 0) {
      try { mc.drawImage(glc, 0, 0, w, h); }
      catch (e) { /* 少数基础库不支持把 WebGL 画布当 drawImage 源 */ }
    }
    if (cv.width > 0) {
      try { mc.drawImage(cv, 0, 0, w, h); } catch (e) {}
    }
    /* 触摸落点提示：主循环停摆时，这是唯一能确认「事件确实派发到了」的通道。
       260ms 后由 draw() 清掉；短按之外几乎看不见，不干扰正常页面。 */
    if (tapFlash && Date.now() < tapFlash.until) {
      const k = (GameGlobal.__wxInfo && GameGlobal.__wxInfo.pixelRatio) || S || 1;
      try {
        mc.beginPath();
        mc.arc(tapFlash.x * k, tapFlash.y * k, 15 * k, 0, Math.PI * 2);
        mc.strokeStyle = 'rgba(255,255,255,.75)';
        mc.lineWidth = 2 * k;
        mc.stroke();
        mc.beginPath();
        mc.arc(tapFlash.x * k, tapFlash.y * k, 3 * k, 0, Math.PI * 2);
        mc.fillStyle = 'rgba(255,208,92,.95)';
        mc.fill();
      } catch (e) {}
    }
    /* 异常时把原因画到屏幕上（小游戏没有控制台面板，开发者工具的 console
       通道也常断）。正常时零开销、不污染画面。 */
    if (GameGlobal.__fatalErr) {
      mc.fillStyle = '#b71c1c';
      mc.fillRect(0, 0, w, 190);
      mc.fillStyle = '#fff';
      mc.font = 'bold 26px sans-serif';
      mc.fillText('运行异常', 12, 40);
      mc.font = '18px sans-serif';
      const lines = String(GameGlobal.__fatalErr).match(/.{1,40}/g) || [];
      lines.slice(0, 5).forEach(function (t, i) { mc.fillText(t, 12, 76 + i * 26); });
    }
  }

  let W = 0, H = 0, S = 1, safeTop = 0, safeBottom = 0, safeL = 0, safeR = 0;
  let dirty = true;
  /* 轻提示（toast）：摇完一期入列后弹一句「已记入开奖记录」——
     Web 版这块是 DOM 的 #simPrompt，小游戏没有 DOM，画在 HUD 上 */
  let toastMsg = null;                /* { text, until } */
  let tapFlash = null;                /* { x, y, until } 触摸落点提示 */
  function toast(text, ms) {
    toastMsg = { text: String(text == null ? '' : text), until: Date.now() + (ms || 2200) };
    dirty = true;
  }
  const buttons = [];
  const M = {};                       // 布局参数，供 pages.js 复用
  /* 3D 舞台：竖屏里的一条横向取景框。w=0 表示不分舞台（横屏/平板仍全屏渲染） */
  const STAGE = { x: 0, y: 0, w: 0, h: 0 };

  /* UI 底色：深色，和 3D 场景的灰蓝天空拉开层次，舞台边界像取景框 */
  function paintBackdrop() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#182640');
    g.addColorStop(0.55, '#111d30');
    g.addColorStop(1, '#0b131f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function relayout() {
    const info = wx.getSystemInfoSync();
    /* 开发者工具的部分基础库会把 screenWidth/screenHeight 给成 0 或 undefined，
       一旦为 0，离屏画布是 0×0、draw() 里 viewport 也是 0×0 —— UI 整层消失
       却不抛任何异常。windowWidth/Height 兜底，再兜底用常见竖屏尺寸。 */
    W = info.screenWidth || info.windowWidth || 375;
    H = info.screenHeight || info.windowHeight || 667;
    /* 与物理像素 1:1：以前封顶 2，在 dpr3 的机器上 HUD 被放大 1.5 倍，
       文字和圆球边缘就是从这里开始糊的 */
    S = Math.min(info.pixelRatio || 1, 3);
    const sa = info.safeArea || { top: info.statusBarHeight || 0, bottom: H };
    safeTop = sa.top || 0;
    safeBottom = Math.max(0, H - (sa.bottom || H));
    /* 横屏时刘海在左右两侧；竖屏下这两个值通常为 0 */
    safeL = sa.left || 0;
    safeR = Math.max(0, W - (sa.right || W));

    cv.width = Math.round(W * S);
    cv.height = Math.round(H * S);

    const portrait = H >= W;

    /* ---------- 横屏 / 平板：3D 全屏铺满（原逻辑） ---------- */
    if (!portrait) {
      STAGE.x = 0; STAGE.y = 0; STAGE.w = 0; STAGE.h = 0;

      const slotR0 = Math.max(13, Math.min(22, W / 18));
      const gap0 = slotR0 * 0.5;
      const total0 = slotR0 * 2 * 7 + gap0 * 6;
      const bottom0 = safeBottom + 12;
      const btnH0 = 42;
      const btnY0 = H - bottom0 - btnH0;
      const slotY0 = btnY0 - 20 - slotR0;
      const pad0 = 16 + Math.max(safeL, safeR), bGap0 = 7;
      const bw0 = (W - pad0 * 2 - bGap0 * 3) / 4;

      buttons.length = 0;
      buttons.push({ id: 'start', x: pad0, y: btnY0, w: bw0, h: btnH0, el: startBtn, label: '开始摇奖' });
      buttons.push({ id: 'reset', x: pad0 + (bw0 + bGap0), y: btnY0, w: bw0, h: btnH0, el: resetBtn, label: '重置' });
      buttons.push({ id: 'log', x: pad0 + (bw0 + bGap0) * 2, y: btnY0, w: bw0, h: btnH0, el: null, label: '记录' });
      buttons.push({ id: 'picker', x: pad0 + (bw0 + bGap0) * 3, y: btnY0, w: bw0, h: btnH0, el: null, label: '返回选号' });

      Object.assign(M, {
        W, H, S, safeTop, safeBottom, safeL, safeR,
        slotR: slotR0, gap: gap0, totalW: total0, slotY: slotY0,
        btnH: btnH0, btnY: btnY0, pad: pad0, bGap: bGap0, bw: bw0,
        portrait: false, stage: STAGE
      });
      dirty = true;
      return;
    }

    /* ---------- 竖屏：上「横向舞台」+ 中「号码槽」+ 下「按钮行」 ---------- */
    const btnH = 52;
    const btnY = H - safeBottom - 16 - btnH;
    const stageY = safeTop + 52;
    /* 1.42:1 是偏横向又不至于把上下压扁的折中；3D 内容（两台机器并排）
       本来就是横向构图，比 1:1 更合适 */
    const roomH = H - stageY - safeBottom - btnH - 62;
    const stageH = Math.max(120, Math.min(Math.round(W / 1.42), Math.round(roomH * 0.72)));
    STAGE.x = 0; STAGE.y = stageY; STAGE.w = W; STAGE.h = stageH;

    const stageB = stageY + stageH;
    const slotR = Math.max(13, Math.min(20, W / 19));
    const gap = slotR * 0.52;
    const totalW = slotR * 2 * 7 + gap * 6;
    /* 号码在舞台与按钮之间取 45% 位置：太靠上贴着舞台，太靠下离按钮太近 */
    const slotY = stageB + (btnY - stageB) * 0.45;

    const pad = 16, bGap = 7;
    const bw = (W - pad * 2 - bGap * 3) / 4;

    buttons.length = 0;
    buttons.push({ id: 'start', x: pad, y: btnY, w: bw, h: btnH, el: startBtn, label: '开始摇奖' });
    buttons.push({ id: 'reset', x: pad + (bw + bGap), y: btnY, w: bw, h: btnH, el: resetBtn, label: '重置' });
    buttons.push({ id: 'log', x: pad + (bw + bGap) * 2, y: btnY, w: bw, h: btnH, el: null, label: '记录' });
    buttons.push({ id: 'picker', x: pad + (bw + bGap) * 3, y: btnY, w: bw, h: btnH, el: null, label: '返回选号' });

    Object.assign(M, {
      W, H, S, safeTop, safeBottom, safeL, safeR,
      slotR, gap, totalW, slotY, btnH, btnY, pad, bGap, bw,
      portrait: true, stage: STAGE, stageBottom: stageB
    });
    dirty = true;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------- 开奖页 HUD ---------- */
  function drawHUD() {
    paintBackdrop();
    /* 舞台内挖空：quad 是全屏的，不挖就把 3D 盖成一片纯色 */
    if (STAGE.w > 0) {
      ctx.clearRect(STAGE.x, STAGE.y, STAGE.w, STAGE.h);
      /* 取景框描边：不描的话 3D 边缘和底色亮度接近，看着像没对齐 */
      ctx.strokeStyle = 'rgba(190,215,245,.16)';
      ctx.lineWidth = 1;
      ctx.strokeRect(STAGE.x + 0.5, STAGE.y + 0.5, STAGE.w - 1, STAGE.h - 1);
    }

    const tx = 16 + safeL;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#e9f1fc';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('双色球 · 3D 摇奖', tx, safeTop + 14);
    ctx.fillStyle = 'rgba(150,178,212,.85)';
    ctx.font = '12px sans-serif';
    ctx.fillText('拖动旋转视角 · 点击下方按钮开奖', tx, safeTop + 39);

    /* 带注提示条：选号页「带这注去 3D 摇奖」进来时显示，摇满 7 球后改成回看引导 */
    const mt = GameGlobal.__match;
    if (mt && mt.pending) {
      const slotsEl = resultsEl.children;
      let filledN = 0;
      for (let i = 0; i < slotsEl.length && i < 7; i++) {
        if (slotsEl[i] && slotsEl[i].classList && slotsEl[i].classList.contains('filled')) filledN++;
      }
      const p = mt.pending, p2 = function (n) { return (n < 10 ? '0' : '') + n; };
      const label = filledN === 7
        ? '本期已摇出 · 点「返回选号」看对照'
        : '本次带注 ' + p.red.map(p2).join(' ') + ' + ' + p2(p.blue);
      ctx.font = '12px sans-serif';
      const tw = ctx.measureText(label).width + 26;
      const tipY = (M.stageBottom || safeTop + 60) + 12;
      roundRect((W - tw) / 2, tipY, tw, 26, 13);
      ctx.fillStyle = filledN === 7 ? 'rgba(31,122,61,.92)' : 'rgba(38,84,150,.92)';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, W / 2, tipY + 14);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }

    const slots = resultsEl.children;
    const x0 = (W - M.totalW) / 2;
    for (let i = 0; i < 7; i++) {
      const el = slots[i];
      const filled = !!(el && el.classList && el.classList.contains('filled'));
      const isBlue = (i === 6);
      const x = x0 + i * (M.slotR * 2 + M.gap) + M.slotR;
      ctx.beginPath();
      ctx.arc(x, M.slotY, M.slotR, 0, Math.PI * 2);
      ctx.fillStyle = filled ? (isBlue ? '#2878d0' : '#d8382f') : 'rgba(255,255,255,.07)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = filled ? 'rgba(255,255,255,.95)' : 'rgba(140,172,210,.42)';
      ctx.stroke();
      if (el && el.textContent) {
        ctx.fillStyle = filled ? '#ffffff' : 'rgba(170,196,226,.75)';
        ctx.font = 'bold ' + Math.round(M.slotR * 0.92) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(el.textContent), x, M.slotY + 1);
      }
    }

    if (phaseEl && phaseEl.textContent && phaseEl.classList.contains('active')) {
      ctx.fillStyle = '#ff9b84';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(phaseEl.textContent), W / 2, M.slotY + M.slotR + 20);
    }

    for (const b of buttons) {
      roundRect(b.x, b.y, b.w, b.h, 12);
      const dis = b.el && b.el.disabled;
      ctx.fillStyle = dis ? 'rgba(120,140,168,.28)' :
        (b.id === 'picker' ? 'rgba(58,82,116,.9)' :
          b.id === 'log' ? 'rgba(46,74,110,.9)' : 'rgba(38,84,150,.95)');
      ctx.fill();
      ctx.fillStyle = dis ? 'rgba(255,255,255,.45)' : '#ffffff';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((b.id === 'start' && mt && mt.pending) ? '摇这一注' : b.label,
        b.x + b.w / 2, b.y + b.h / 2 + 1);
    }

    /* 轻提示：压在按钮行上方，2.2 秒后自己消失（过期判定在 draw 里做，那才会重绘） */
    if (toastMsg) {
      ctx.font = '13px sans-serif';
      const tw = ctx.measureText(toastMsg.text).width + 36;
      const th = 32, tx0 = (W - tw) / 2, ty0 = M.btnY - th - 14;
      roundRect(tx0, ty0, tw, th, th / 2);
      ctx.fillStyle = 'rgba(20,34,52,.92)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(150,200,160,.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#8fe0a8';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('✓', tx0 + 13, ty0 + th / 2 + 1);
      ctx.fillStyle = '#eef6ff';
      ctx.fillText(toastMsg.text, tx0 + 28, ty0 + th / 2 + 1);
    }
  }

  function redraw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(S, 0, 0, S, 0, 0);
    try {
      const ui = GameGlobal.__ui;
      if (ui && !ui.isDrawPage()) ui.renderPage(ctx, W, H, M);
      else drawHUD();
    } catch (e) {
      /* 绘制炸了也不能让整块 UI 消失：铺底色 + 把错误直接写在屏幕上。
         小游戏没有控制台面板，屏幕是唯一一定看得见的通道。 */
      const err = String(e && (e.stack || e.message || e));
      paintBackdrop();
      ctx.fillStyle = '#ff8a80';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('[ui] ' + err.slice(0, 200), 12, 60);
      if (!GameGlobal.__uiErr) { GameGlobal.__uiErr = err; console.error('[ui] redraw', err); }
    }
    dirty = false;                 /* 2D 合成每帧直接读这张画布，无需纹理上传 */
  }

  /* 主循环每帧调用：3D 已经画进离屏 WebGL 画布，这里只做 2D 合成。
     renderer 参数保留是为了兼容注入代码，不再使用。 */
  function draw() {
    /* 帧自检：主循环到底有没有在跑、一帧合成要多久。开发者工具的模拟器
       用软件渲染，全屏 drawImage(WebGL 画布) 可能慢到把 JS 线程占满 ——
       那样界面停在静态首帧、定时器和所有触摸回调都排不上队，表现就是
       「画面完整但点哪儿都没反应」。每 30 帧落一次 storage，开销可忽略。 */
    const B = GameGlobal.__ssqBoot;
    let t0 = 0;
    if (B) { t0 = Date.now(); B.frames = (B.frames || 0) + 1; }
    if (tapFlash && Date.now() > tapFlash.until) tapFlash = null;
    if (toastMsg && Date.now() > toastMsg.until) { toastMsg = null; dirty = true; }
    if (dirty) redraw();
    try { composite(); }
    catch (e) {
      if (!GameGlobal.__uiErr) { GameGlobal.__uiErr = String(e); console.error('[hud] composite', e); }
    }
    if (B && t0) {
      B.lastFrameMs = Date.now() - t0;
      B.frameT = Date.now();
      if (B.frames <= 3 || B.frames % 30 === 0) {
        try { wx.setStorageSync('__ssq_boot', JSON.stringify(B)); } catch (e) {}
      }
    }
  }

  /* adapter 在 touchstart 里调用：立刻合成一帧，不等 rAF。
     开发者工具模拟器主循环可能没跑起来，只打标记的话点了跟没点一样。 */
  function flashTap(x, y) {
    tapFlash = { x: x, y: y, until: Date.now() + 260 };
    try { composite(); } catch (e) {}
  }

  function hitTest(x, y) {
    for (const b of buttons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        if (b.id === 'picker') {
          if (GameGlobal.__ui) GameGlobal.__ui.open('tool');
        } else if (b.id === 'log') {
          /* 记录页：和「返回选号」对称的出口，摇完一期直接看结果/形态评估 */
          if (GameGlobal.__ui) GameGlobal.__ui.open('log');
        } else if (!b.el.disabled) {
          /* 按钮回调里抛异常不能打断触摸链：否则一次异常之后
             整个 HUD 都像「点不动」，且没有任何提示 */
          try { b.el.click(); }
          catch (e) { console.error('[hud] click ' + b.id, e); }
        }
        return true;
      }
    }
    return false;
  }

  relayout();
  wx.onWindowResize && wx.onWindowResize(relayout);

  /* 把舞台几何交给 3D：index.html 的 applySize 读它来设 viewport/scissor/相机比例。
     换页时也要重算——3D 页和 UI 页用同一块画布，但 3D 只该出现在舞台里。 */
  GameGlobal.__stage = STAGE;
  GameGlobal.__applySize = function () {
    if (typeof GameGlobal.__applySizeImpl === 'function') GameGlobal.__applySizeImpl();
  };

  GameGlobal.__hud = {
    markDirty() {
      dirty = true;
      /* 立刻重绘一次，不等下一帧 rAF。开发者工具的模拟器里主循环可能停摆
         （或还没起来），只打 dirty 标记的话，点按钮改了状态却完全没有反馈，
         表现就是「整个页面点不动」。真机上多这一次即时绘制无副作用。 */
      try { redraw(); composite(); }
      catch (e) { if (!GameGlobal.__uiErr) GameGlobal.__uiErr = String(e); }
    },
    draw,
    hitTest,
    relayout,
    toast,
    flashTap,
    surface: { cv, ctx },
    metrics: M
  };
})();
