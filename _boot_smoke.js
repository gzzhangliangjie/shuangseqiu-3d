/* 小游戏启动链路冒烟（纯 Node，无依赖）
   用 mock 的 wx / GameGlobal 逐个 require game.js 前半段，
   定位「黑屏且控制台无任何输出」时到底断在哪个模块。
   不 require src/game-logic.js（需要真实 WebGL 上下文）。
   用法：node _boot_smoke.js
          node _boot_smoke.js --wx-only   模拟「canvas 没有原生 addEventListener」的旧基础库
*/
'use strict';
const path = require('path');
const WX_ONLY = process.argv.includes('--wx-only');

function fakeCtx2d() {
  const store = {};
  return new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'getImageData') return (x, y, w, h) => ({
        data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)),
        width: w | 0, height: h | 0
      });
      if (k === 'createLinearGradient' || k === 'createRadialGradient')
        return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'canvas') return t.__canvas;
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

function fakeCanvas() {
  const c2d = fakeCtx2d();
  c2d.__canvas = null;
  /* 记录「原生」注册：adapter 的 patchCanvas 必须把注册透传回来，
     否则基础库自己的 touch 处理器会被吞掉（subscribeHandler 报 undefined.__name__）。 */
  const handlers = Object.create(null);
  const cv = {
    width: 375, height: 667, style: {},
    getContext(type) { return type === '2d' ? c2d : null; },
    __handlers: handlers,
    toDataURL() { return 'data:,'; }
  };
  if (!WX_ONLY) {
    cv.addEventListener = function (type, fn) {
      (handlers[type] || (handlers[type] = [])).push(fn);
    };
    cv.removeEventListener = function (type, fn) {
      const a = handlers[type];
      if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
    };
  }
  c2d.__canvas = cv;
  return cv;
}

const storage = {};
/* 捕获 adapter 注册的触摸回调：以前是空函数，触摸分发这一层从没被测过 */
const touchHandlers = Object.create(null);
/* 基础库 3.x 的 PC 鼠标 API（JSAPI 179~184）。真实小游戏 Canvas 没有原生
   addEventListener，模拟器里这条通道才是关键，必须单独捕获并跑通。 */
const mouseHandlers = Object.create(null);
global.wx = {
  createCanvas: fakeCanvas,
  getSystemInfoSync: () => ({
    screenWidth: 375, screenHeight: 667, windowWidth: 375, windowHeight: 667,
    pixelRatio: 2, statusBarHeight: 20, platform: 'devtools',
    safeArea: { top: 20, bottom: 667, left: 0, right: 375, width: 375, height: 647 }
  }),
  getStorageSync: k => (k in storage ? storage[k] : ''),
  setStorageSync: (k, v) => { storage[k] = v; },
  removeStorageSync: k => { delete storage[k]; },
  clearStorageSync: () => { for (const k in storage) delete storage[k]; },
  onTouchStart(fn) { touchHandlers.start = fn; },
  onTouchMove(fn) { touchHandlers.move = fn; },
  onTouchEnd(fn) { touchHandlers.end = fn; },
  onTouchCancel(fn) { touchHandlers.cancel = fn; },
  onMouseDown(fn) { mouseHandlers.start = fn; },
  onMouseMove(fn) { mouseHandlers.move = fn; },
  onMouseUp(fn) { mouseHandlers.end = fn; },
  onWindowResize() {},
  setInnerAudioOption() {},
  createWebAudioContext() { return null; },
  getPerformance() { return { now: () => Date.now() }; },
  request() {},
  showToast() {}, showModal() {}
};
global.GameGlobal = global;
global.window = global;
global.self = global;

const chain = [
  './miniprogram/adapter.js',
  './miniprogram/libs/ssq-data.js',
  './miniprogram/src/simlog.js',
  './miniprogram/hud.js',
  './miniprogram/pages.js'
];

let fail = 0;
for (const rel of chain) {
  try {
    require(path.resolve(__dirname, rel));
    console.log('[ok]   ' + rel);
  } catch (e) {
    fail++;
    console.log('[FAIL] ' + rel + ' :: ' + (e && (e.stack || e.message || e)));
  }
}

const g = global;
console.log('\n--- 启动后全局 ---');
console.log({
  canvas: !!g.canvas, mainCanvas: !!g.__mainCanvas,
  document: !!g.document, hud: !!g.__hud, ui: !!g.__ui,
  stage: !!g.__stage, audioContext: typeof g.AudioContext,
  innerWidth: g.innerWidth, innerHeight: g.innerHeight
});
/* ---------- 触摸分发链路 ----------
   两条通道都要验：canvas 原生 touch（主）与 wx.onTouch*（备）。
   以前只测 __ui.touch，adapter 这一层完全没覆盖，「点得动/点不动」就卡在这里。 */
console.log('\n--- 触摸分发冒烟' + (WX_ONLY ? '（仅 wx 通道）' : '（双通道）') + ' ---');
const TH = touchHandlers;
const nativeH = (g.__mainCanvas && g.__mainCanvas.__handlers) || Object.create(null);
const NH = { start: 'touchstart', move: 'touchmove', end: 'touchend', cancel: 'touchcancel' };
function check(name, ok, extra) {
  console.log((ok ? '  [ok]   ' : '  [FAIL] ') + name + (extra ? '  ' + extra : ''));
  if (!ok) fail++;
}
function fire(type, e, via) {
  if (via === 'native') (nativeH[NH[type]] || []).slice().forEach(fn => fn(e));
  else if (typeof TH[type] === 'function') TH[type](e);
}
/* 模拟器用鼠标点屏幕：基础库 3.17.6 的 touch 桥整个不派发时，
   原生 mouse 事件必须能独立完成一次点击。 */
const MH = { start: 'mousedown', move: 'mousemove', end: 'mouseup' };
function fireMouse(type, x, y) {
  const e = { identifier: 7, clientX: x, clientY: y };
  (nativeH[MH[type]] || []).slice().forEach(fn => fn(e));
}
/* wx.onMouse* 的事件对象是裸鼠标结构（无 touches/changedTouches） */
function fireMouseApi(type, x, y) {
  if (typeof mouseHandlers[type] !== 'function') return;
  mouseHandlers[type]({ clientX: x, clientY: y, button: 0, timeStamp: Date.now() });
}
['start', 'move', 'end', 'cancel'].forEach(k => {
  check('wx.onTouch' + k + ' 已注册', typeof TH[k] === 'function');
});
['start', 'move', 'end'].forEach(k => {
  check('wx.onMouse* ' + k + ' 已注册', typeof mouseHandlers[k] === 'function');
});
/* 防「假绿」：真实小游戏 Canvas 没有原生 addEventListener，--wx-only 必须如实反映 */
if (WX_ONLY) {
  check('真实环境自检：canvas 无原生 addEventListener',
    g.__ssqDiag && g.__ssqDiag.nativeAdd === false);
}
check('运行期自检已写入 storage', typeof storage.__ssq_diag === 'string');
if (!WX_ONLY) {
  ['touchstart', 'touchmove', 'touchend', 'touchcancel',
   'mousedown', 'mousemove', 'mouseup',
   'pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(k => {
    check('canvas 原生 ' + k + ' 已注册', (nativeH[k] || []).length > 0);
  });
  /* 透传验证：patchCanvas 覆盖后再调 addEventListener，原生表里必须也能看到 */
  const probe = function () {};
  g.__mainCanvas.addEventListener('pointerdown', probe);
  check('addEventListener 透传到原生', (nativeH.pointerdown || []).indexOf(probe) >= 0);
}
const ui = g.__ui;
const M = g.__hud && g.__hud.metrics;

function finish() {
  console.log('\n' + (fail ? '❌ ' + fail + ' 项失败' : '✅ 启动链路 + 触摸分发全部通过'));
  process.exit(fail ? 1 : 0);
}

if (ui && M) {
  const primary = WX_ONLY ? 'wx' : 'native';
  const regionN = ui.regions ? ui.regions().length : 0;
  check('启动后首屏已建立点击区', regionN > 0, 'regions=' + regionN
    + '  current=' + ui.current() + '  isDrawPage=' + ui.isDrawPage());

  const bx = M.pad + 42, by = M.safeTop + 8 + 19;   // 「← 3D 开奖」按钮中心
  function tap(x, y, endShape, via, fresh) {
    if (!fresh) ui.open('tool');
    const t = { identifier: 1, clientX: x, clientY: y };
    fire('start', { touches: [t] }, via);
    if (endShape === 'changed') fire('end', { changedTouches: [t] }, via);
    else if (endShape === 'touches') fire('end', { touches: [t] }, via);
    else if (endShape === 'empty') fire('end', {}, via);
    /* 'missing' = 故意不派发 end，留给兜底定时器 */
    return ui.current();
  }
  [['changed', '标准 changedTouches', primary, false],
   ['touches', 'end 只有 touches（部分基础库）', primary, false],
   ['empty', 'end 无任何触点（鼠标模拟常见）', primary, false],
   ['changed', '启动后直接点击（未再触发 open）', primary, true]]
    .concat(WX_ONLY ? [] : [['changed', '备用 wx.onTouch* 通道', 'wx', false]])
    .forEach(([shape, label, via, fresh]) => {
      check(label + ' [' + via + ']', tap(bx, by, shape, via, fresh) === 'draw');
    });

  /* 真实环境：canvas 无原生事件、touch 桥也不派发，只靠 wx.onMouse*
     必须独立完成一次点击（这是模拟器里最可能生效的通路）。 */
  ui.open('tool');
  fireMouseApi('start', bx, by);
  fireMouseApi('end', bx, by);
  check('仅 wx.onMouse* 通道点击（touch 与原生事件全缺失）',
    ui.current() === 'draw', ui.current());

  /* 只有 mouse / pointer 被投递（touch 桥整条断掉）时也要能点动 */
  if (!WX_ONLY) {
    ui.open('tool');
    fireMouse('start', bx, by);
    fireMouse('end', bx, by);
    check('纯鼠标点击（touch 完全缺失）', ui.current() === 'draw', ui.current());
  }

  /* 三通道同时派发整段手势：end 只应落到 UI 一次，不能触发两次 tap */
  if (!WX_ONLY) {
    const origTouch = ui.touch;
    let endN = 0;
    ui.touch = function (type, x, y) {
      if (type === 'end') endN++;
      return origTouch(type, x, y);
    };
    ui.open('tool');
    const t0 = { identifier: 3, clientX: bx, clientY: by };
    fire('start', { touches: [t0] }, 'native');
    fire('start', { touches: [t0] }, 'wx');
    fireMouse('start', t0.clientX, t0.clientY);
    fire('move', { touches: [t0] }, 'native');
    fire('move', { touches: [t0] }, 'wx');
    fireMouse('move', t0.clientX, t0.clientY);
    fire('end', { changedTouches: [t0] }, 'native');
    fire('end', { changedTouches: [t0] }, 'wx');
    fireMouse('end', t0.clientX, t0.clientY);
    ui.touch = origTouch;
    check('三通道去重：UI 只收到一次 end', endN === 1, 'endN=' + endN);
    check('三通道去重后点击仍生效', ui.current() === 'draw', ui.current());
  }

  /* 兜底：两套通道的 end 全都不派发。280ms 后应由 adapter 补一次 end。 */
  ui.open('tool');
  fire('start', { touches: [{ identifier: 2, clientX: bx, clientY: by }] }, primary);
  setTimeout(function () {
    check('end 完全缺失时兜底补发', ui.current() === 'draw', 'current=' + ui.current());
    finish();
  }, 360);
} else {
  check('__ui / __hud.metrics 已挂载', false);
  finish();
}
