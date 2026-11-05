/* ============================================================
   UI 表面：一张离屏 2D 画布 + 一张 CanvasTexture + 一个全屏正交 quad
   ------------------------------------------------------------
   开奖页画 HUD；选号页 / 记录页由 pages.js 通过 __ui.renderPage 画在
   **同一张**画布上。页面切换不新增纹理、不新增全屏 blit，只有状态
   变化时才 redraw + needsUpdate，平时零上传。
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

  const THREE = require('./libs/three.js');

  const cv = wx.createCanvas();
  const ctx = cv.getContext('2d');
  const resultsEl = GameGlobal.document.getElementById('results');
  const phaseEl = GameGlobal.document.getElementById('phase');
  const startBtn = GameGlobal.document.getElementById('startBtn');
  const resetBtn = GameGlobal.document.getElementById('resetBtn');

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false
    })
  );
  quad.frustumCulled = false;
  scene.add(quad);

  let W = 0, H = 0, S = 1, safeTop = 0, safeBottom = 0, safeL = 0, safeR = 0;
  let dirty = true;
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
    W = info.screenWidth;
    H = info.screenHeight;
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
      const pad0 = 16 + Math.max(safeL, safeR), bGap0 = 8;
      const bw0 = (W - pad0 * 2 - bGap0 * 2) / 3;

      buttons.length = 0;
      buttons.push({ id: 'start', x: pad0, y: btnY0, w: bw0, h: btnH0, el: startBtn, label: '开始摇奖' });
      buttons.push({ id: 'reset', x: pad0 + bw0 + bGap0, y: btnY0, w: bw0, h: btnH0, el: resetBtn, label: '重置' });
      buttons.push({ id: 'picker', x: pad0 + (bw0 + bGap0) * 2, y: btnY0, w: bw0, h: btnH0, el: null, label: '返回选号' });

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

    const pad = 16, bGap = 8;
    const bw = (W - pad * 2 - bGap * 2) / 3;

    buttons.length = 0;
    buttons.push({ id: 'start', x: pad, y: btnY, w: bw, h: btnH, el: startBtn, label: '开始摇奖' });
    buttons.push({ id: 'reset', x: pad + bw + bGap, y: btnY, w: bw, h: btnH, el: resetBtn, label: '重置' });
    buttons.push({ id: 'picker', x: pad + (bw + bGap) * 2, y: btnY, w: bw, h: btnH, el: null, label: '返回选号' });

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
        (b.id === 'picker' ? 'rgba(58,82,116,.9)' : 'rgba(38,84,150,.95)');
      ctx.fill();
      ctx.fillStyle = dis ? 'rgba(255,255,255,.45)' : '#ffffff';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((b.id === 'start' && mt && mt.pending) ? '摇这一注' : b.label,
        b.x + b.w / 2, b.y + b.h / 2 + 1);
    }
  }

  function redraw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(S, 0, 0, S, 0, 0);
    const ui = GameGlobal.__ui;
    if (ui && !ui.isDrawPage()) ui.renderPage(ctx, W, H, M);
    else drawHUD();
    tex.needsUpdate = true;
    dirty = false;
  }

  /* HUD 每一帧都要「先恢复全屏、画完再还原舞台视口」，
     这里复用两个 Vector4 存旧值，避免每帧分配 */
  const _vp = new THREE.Vector4();
  const _sc = new THREE.Vector4();

  function draw(renderer) {
    if (dirty) redraw();
    const prevClear = renderer.autoClear;
    const prevTest = renderer.getScissorTest();
    renderer.getViewport(_vp);
    renderer.getScissor(_sc);
    renderer.autoClear = false;
    /* HUD 是全屏层，必须铺满整块画布，不能被 3D 舞台的 viewport/scissor 裁掉；
       画完原样还原，下一帧 3D 才能继续只在舞台里渲染。 */
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.render(scene, camera);
    renderer.setViewport(_vp.x, _vp.y, _vp.z, _vp.w);
    renderer.setScissor(_sc.x, _sc.y, _sc.z, _sc.w);
    renderer.setScissorTest(prevTest);
    renderer.autoClear = prevClear;
  }

  function hitTest(x, y) {
    for (const b of buttons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        if (b.id === 'picker') {
          if (GameGlobal.__ui) GameGlobal.__ui.open('tool');
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
    markDirty() { dirty = true; },
    draw,
    hitTest,
    relayout,
    surface: { cv, ctx, tex, scene, camera },
    metrics: M
  };
})();
