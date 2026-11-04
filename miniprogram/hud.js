/* ============================================================
   Canvas HUD：把 Web 版 DOM HUD 复刻成一张离屏 2D 纹理
   ------------------------------------------------------------
   小游戏只有一个上屏画布，且已交给 WebGL。这里用正交相机 + 全屏 quad
   把 HUD 叠在 3D 画面之上：
     - 不做每帧全屏 drawImage blit（省一次纹理拷贝）
     - 只在伪 DOM 元素状态变化时重绘并 needsUpdate，平时零上传
   伪 DOM 元素由 adapter.js 提供，HUD 直接读它们的 textContent / className /
   disabled，所以 Web 端的 HUD 逻辑完全不用改。
   ============================================================ */
(function () {
  'use strict';

  const THREE = require('./libs/three.js');

  const cv = wx.createCanvas();                 // 离屏 2D 画布
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
  let L = null;
  let dirty = true;
  const buttons = [];

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
    const btnW = Math.min(140, (W - 48) / 2 - 8);

    buttons.length = 0;
    buttons.push({ x: W / 2 - btnW - 8, y: btnY, w: btnW, h: btnH, el: startBtn, label: '开始摇奖' });
    buttons.push({ x: W / 2 + 8, y: btnY, w: btnW, h: btnH, el: resetBtn, label: '重置' });

    L = { slotR, gap, totalW, slotY, btnH, titleY: safeTop + 14 };
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

  function redraw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(S, 0, 0, S, 0, 0);

    /* 标题 */
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(18,32,54,.9)';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('双色球 · 3D 摇奖', 16, L.titleY);
    ctx.fillStyle = 'rgba(70,95,130,.8)';
    ctx.font = '12px sans-serif';
    ctx.fillText('拖动旋转视角 · 点击下方按钮开奖', 16, L.titleY + 25);

    /* 7 个球槽（6 红 + 1 蓝） */
    const slots = resultsEl.children;
    const x0 = (W - L.totalW) / 2;
    for (let i = 0; i < 7; i++) {
      const el = slots[i];
      const filled = !!(el && el.classList && el.classList.contains('filled'));
      const isBlue = (i === 6);
      const x = x0 + i * (L.slotR * 2 + L.gap) + L.slotR;
      ctx.beginPath();
      ctx.arc(x, L.slotY, L.slotR, 0, Math.PI * 2);
      ctx.fillStyle = filled ? (isBlue ? '#2878d0' : '#d8382f') : 'rgba(255,255,255,.6)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = filled ? 'rgba(255,255,255,.95)' : 'rgba(80,105,140,.5)';
      ctx.stroke();
      if (el && el.textContent) {
        ctx.fillStyle = filled ? '#ffffff' : 'rgba(40,60,90,.65)';
        ctx.font = 'bold ' + Math.round(L.slotR * 0.92) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(el.textContent), x, L.slotY + 1);
      }
    }

    /* 状态文字（原 Web 版已弱化，这里只作错误提示） */
    if (phaseEl && phaseEl.textContent && phaseEl.classList.contains('active')) {
      ctx.fillStyle = 'rgba(190,60,40,.92)';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(phaseEl.textContent), W / 2, L.slotY + L.slotR + 16);
    }

    /* 按钮 */
    for (const b of buttons) {
      roundRect(b.x, b.y, b.w, b.h, 12);
      ctx.fillStyle = b.el.disabled ? 'rgba(150,165,185,.35)' : 'rgba(28,68,128,.92)';
      ctx.fill();
      ctx.fillStyle = b.el.disabled ? 'rgba(255,255,255,.7)' : '#ffffff';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    }

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
        if (!b.el.disabled) b.el.click();
        return true;
      }
    }
    return false;
  }

  relayout();
  wx.onWindowResize && wx.onWindowResize(relayout);

  GameGlobal.__hud = {
    markDirty() { dirty = true; },
    draw: draw,
    hitTest: hitTest,
    relayout: relayout
  };
})();
