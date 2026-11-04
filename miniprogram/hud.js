/* ============================================================
   UI 表面：一张离屏 2D 画布 + 一张 CanvasTexture + 一个全屏正交 quad
   ------------------------------------------------------------
   开奖页画 HUD；选号页 / 记录页由 pages.js 通过 __ui.renderPage 画在
   **同一张**画布上。页面切换不新增纹理、不新增全屏 blit，只有状态
   变化时才 redraw + needsUpdate，平时零上传。
   伪 DOM 元素由 adapter.js 提供，Web 端 HUD 逻辑一行不改。
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

  let W = 0, H = 0, S = 1, safeTop = 0, safeBottom = 0;
  let dirty = true;
  const buttons = [];
  const M = {};                       // 布局参数，供 pages.js 复用

  function relayout() {
    const info = wx.getSystemInfoSync();
    W = info.screenWidth;
    H = info.screenHeight;
    S = Math.min(info.pixelRatio || 1, 2);
    const sa = info.safeArea || { top: info.statusBarHeight || 0, bottom: H };
    safeTop = sa.top || 0;
    safeBottom = Math.max(0, H - (sa.bottom || H));

    cv.width = Math.round(W * S);
    cv.height = Math.round(H * S);

    const slotR = Math.max(13, Math.min(22, W / 18));
    const gap = slotR * 0.5;
    const totalW = slotR * 2 * 7 + gap * 6;
    const bottom = safeBottom + 12;
    const btnH = 42;
    const btnY = H - bottom - btnH;
    const slotY = btnY - 20 - slotR;
    const pad = 16, bGap = 8;
    const bw = (W - pad * 2 - bGap * 2) / 3;

    buttons.length = 0;
    buttons.push({ id: 'start',  x: pad,                    y: btnY, w: bw, h: btnH, el: startBtn,  label: '开始摇奖' });
    buttons.push({ id: 'reset',  x: pad + bw + bGap,        y: btnY, w: bw, h: btnH, el: resetBtn,  label: '重置' });
    buttons.push({ id: 'picker', x: pad + (bw + bGap) * 2,  y: btnY, w: bw, h: btnH, el: null,      label: '选号' });

    Object.assign(M, { W, H, S, safeTop, safeBottom, slotR, gap, totalW, slotY, btnH, btnY, pad, bGap, bw });
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
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(18,32,54,.9)';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('双色球 · 3D 摇奖', 16, safeTop + 14);
    ctx.fillStyle = 'rgba(70,95,130,.8)';
    ctx.font = '12px sans-serif';
    ctx.fillText('拖动旋转视角 · 点击下方按钮开奖', 16, safeTop + 39);

    const slots = resultsEl.children;
    const x0 = (W - M.totalW) / 2;
    for (let i = 0; i < 7; i++) {
      const el = slots[i];
      const filled = !!(el && el.classList && el.classList.contains('filled'));
      const isBlue = (i === 6);
      const x = x0 + i * (M.slotR * 2 + M.gap) + M.slotR;
      ctx.beginPath();
      ctx.arc(x, M.slotY, M.slotR, 0, Math.PI * 2);
      ctx.fillStyle = filled ? (isBlue ? '#2878d0' : '#d8382f') : 'rgba(255,255,255,.6)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = filled ? 'rgba(255,255,255,.95)' : 'rgba(80,105,140,.5)';
      ctx.stroke();
      if (el && el.textContent) {
        ctx.fillStyle = filled ? '#ffffff' : 'rgba(40,60,90,.65)';
        ctx.font = 'bold ' + Math.round(M.slotR * 0.92) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(el.textContent), x, M.slotY + 1);
      }
    }

    if (phaseEl && phaseEl.textContent && phaseEl.classList.contains('active')) {
      ctx.fillStyle = 'rgba(190,60,40,.92)';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(phaseEl.textContent), W / 2, M.slotY + M.slotR + 16);
    }

    for (const b of buttons) {
      roundRect(b.x, b.y, b.w, b.h, 12);
      const dis = b.el && b.el.disabled;
      ctx.fillStyle = dis ? 'rgba(150,165,185,.35)' :
        (b.id === 'picker' ? 'rgba(37,53,77,.85)' : 'rgba(28,68,128,.92)');
      ctx.fill();
      ctx.fillStyle = dis ? 'rgba(255,255,255,.7)' : '#ffffff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
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

  function draw(renderer) {
    if (dirty) redraw();
    const prev = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(scene, camera);
    renderer.autoClear = prev;
  }

  function hitTest(x, y) {
    for (const b of buttons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        if (b.id === 'picker') {
          if (GameGlobal.__ui) GameGlobal.__ui.open('picker');
        } else if (!b.el.disabled) b.el.click();
        return true;
      }
    }
    return false;
  }

  relayout();
  wx.onWindowResize && wx.onWindowResize(relayout);

  GameGlobal.__hud = {
    markDirty() { dirty = true; },
    draw,
    hitTest,
    relayout,
    surface: { cv, ctx, tex, scene, camera },
    metrics: M
  };
})();
