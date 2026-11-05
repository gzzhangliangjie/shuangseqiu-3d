/* 真 hud.js + 真 pages.js 的点击链路冒烟：验证「3D 页点开始摇奖」能否触发 click
   不涉及 three.js 渲染，只用真实的按钮布局与命中判定。 */
global.GameGlobal = global;
global.window = global;

/* ---------- 2D ctx 桩 ---------- */
const grad = { addColorStop() {} };
function makeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'measureText') return () => ({ width: 60 });
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
      if (k === 'canvas') return { width: 1170, height: 2532 };
      if (k in t) return t[k];
      return function () {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

/* ---------- 伪元素 ---------- */
function FakeEl(id) {
  this.id = id; this.textContent = ''; this.disabled = false;
  this.children = []; this.style = {}; this._cls = ''; this._l = {};
  this.classList = {
    add: (c) => { if (!this._cls.split(/\s+/).includes(c)) this._cls = (this._cls + ' ' + c).trim(); },
    remove: (c) => { this._cls = this._cls.split(/\s+/).filter(x => x && x !== c).join(' '); },
    contains: (c) => this._cls.split(/\s+/).includes(c),
    toggle: (c) => { this.classList.contains(c) ? this.classList.remove(c) : this.classList.add(c); }
  };
}
FakeEl.prototype.addEventListener = function (t, fn) { (this._l[t] || (this._l[t] = [])).push(fn); };
FakeEl.prototype.click = function () {
  const a = this._l.click || [];
  for (const fn of a) fn({ type: 'click', target: this, preventDefault() {} });
  return a.length;
};
FakeEl.prototype.appendChild = function (c) { this.children.push(c); return c; };
FakeEl.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: 390, height: 844 }; };

const els = Object.create(null);
const byId = (id) => els[id] || (els[id] = new FakeEl(id));

global.document = {
  body: new FakeEl('body'),
  getElementById: byId,
  createElement: (t) => new FakeEl(t),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {}
};
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };
global.location = { search: '', hash: '', protocol: 'https:' };
global.navigator = { userAgent: 'node' };
global.performance = global.performance || { now: () => Date.now() };
global.requestAnimationFrame = () => 0;
global.addEventListener = () => {};

/* ---------- wx 桩 ---------- */
const LAND = process.argv.includes('--landscape');
const INFO = LAND
  /* 横屏 + 左右刘海（iPhone 横屏 safeArea.left/right 不为 0） */
  ? { screenWidth: 844, screenHeight: 390, windowWidth: 844, windowHeight: 390,
      pixelRatio: 3, statusBarHeight: 0,
      safeArea: { top: 0, bottom: 390, left: 44, right: 800, width: 756, height: 390 } }
  : { screenWidth: 390, screenHeight: 844, windowWidth: 390, windowHeight: 844,
      pixelRatio: 3, statusBarHeight: 47,
      safeArea: { top: 47, bottom: 810, left: 0, right: 390, width: 390, height: 763 } };
global.wx = {
  getSystemInfoSync: () => INFO,
  createCanvas: () => ({ width: 390, height: 844, getContext: makeCtx }),
  onWindowResize() {}, onTouchStart() {}, onTouchMove() {}, onTouchEnd() {}, onTouchCancel() {},
  getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {}, clearStorageSync() {},
  createWebAudioContext: undefined            /* 模拟「没有 WebAudio」的最坏情况 */
};

/* ---------- 加载真模块 ---------- */
require('./miniprogram/hud.js');
require('./miniprogram/pages.js');
const hud = GameGlobal.__hud;
const ui = GameGlobal.__ui;
const M = hud.metrics;

let pass = 0, fail = 0;
function check(name, ok, extra) {
  console.log((ok ? '  [ok] ' : '  [FAIL] ') + name + (extra ? '  ' + extra : ''));
  ok ? pass++ : fail++;
}
const p2 = (n) => (n < 10 ? '0' : '') + n;

console.log('\n1. 启动落地页');
check('current = tool', ui.current() === 'tool', ui.current());
check('isDrawPage = false', ui.isDrawPage() === false);

console.log('\n2. 切到 3D 页');
ui.open('draw');
check('isDrawPage = true', ui.isDrawPage() === true);

console.log('\n3. 按钮布局');
console.log('     M =', JSON.stringify({ W: M.W, H: M.H, btnY: M.btnY, btnH: M.btnH, bw: M.bw, pad: M.pad, safeBottom: M.safeBottom }));
check('btnY + btnH 在屏内', M.btnY + M.btnH <= M.H - M.safeBottom + 1, (M.btnY + M.btnH) + ' vs ' + (M.H - M.safeBottom));
check('三个按钮等宽且够点', M.bw >= 100 && Math.abs(M.bw * 3 + M.bGap * 2 - (M.W - M.pad * 2)) < 1, 'bw=' + M.bw.toFixed(1));
check('按钮互不重叠', M.pad + M.bw <= M.pad + M.bw + M.bGap, '');

console.log('\n3.5 竖屏舞台（3D 横向取景框）几何');
const ST = M.stage;
console.log('     STAGE =', JSON.stringify(ST), ' slotY =', Math.round(M.slotY), ' stageBottom =', Math.round(M.stageBottom));
check('竖屏才开舞台', !!ST && ST.w > 0, ST && ST.w);
check('舞台铺满可用宽度', ST && Math.abs(ST.w - (M.W - M.safeL - M.safeR)) < 1, ST && ST.w);
check('舞台高 ≥ 200（够看横向场景）', ST && ST.h >= 200, ST && ST.h);
check('舞台是横向比例（w/h > 1.2）', ST && ST.w / ST.h > 1.2, ST && (ST.w / ST.h).toFixed(2));
check('舞台顶在标题之下', ST && ST.y >= M.safeTop + 40, ST && ST.y);
check('舞台底 + 提示条 不压号码', M.stageBottom + 38 <= M.slotY - M.slotR,
  (M.stageBottom + 38) + ' vs ' + (M.slotY - M.slotR));
check('号码槽整排在屏内', M.slotY - M.slotR >= 0 && M.slotY + M.slotR <= M.H, Math.round(M.slotY));
check('号码 + 相位 不压按钮', M.slotY + M.slotR + 30 <= M.btnY, (M.slotY + M.slotR + 30) + ' vs ' + M.btnY);

console.log('\n4. 点「开始摇奖」中心 → 是否触发 click');
let clicked = 0;
byId('startBtn').addEventListener('click', () => { clicked++; });
const cx = M.pad + M.bw / 2;
const cy = M.btnY + M.btnH / 2;
const consumed = ui.touch('start', cx, cy);
check('touch(start) 被 HUD 消费', consumed === true, 'return=' + consumed);
check('startBtn 的 click 触发', clicked === 1, 'clicked=' + clicked);

console.log('\n5. 点空白区域 → 不吞事件（要留给相机拖拽）');
const blank = ui.touch('start', 10, M.slotY - 60);
check('空白处不消费', blank === false, 'return=' + blank);

console.log('\n6. 「返回选号」按钮 → 回 tool');
const px = M.pad + (M.bw + M.bGap) * 2 + M.bw / 2;
ui.touch('start', px, cy);
check('回到选号页', ui.current() === 'tool', ui.current());

console.log('\n7. 按钮 disabled 时不触发（真机滚动中表现）');
ui.open('draw');
let c2 = 0;
byId('startBtn').addEventListener('click', () => { c2++; });
byId('startBtn').disabled = true;
const r2 = ui.touch('start', cx, cy);
check('disabled 时仍被消费但无 click', r2 === true && c2 === 0, 'consumed=' + r2 + ' clicked=' + c2);
byId('startBtn').disabled = false;

console.log('\n8. 安全区与页面坐标映射');
const sl = M.safeL || 0, sr = M.safeR || 0;
check('按钮行左右都收进安全区', M.pad >= sl && (M.pad + 3 * M.bw + 2 * M.bGap) <= M.W - sr,
  'pad=' + M.pad + ' right=' + (M.pad + 3 * M.bw + 2 * M.bGap) + ' / W-sr=' + (M.W - sr));

let renderThrew = null;
try {
  ui.open('tool');
  ui.renderPage(makeCtx(), M.W, M.H, M);
} catch (e) { renderThrew = e; }
check('选号页能画出来', !renderThrew, renderThrew && renderThrew.message);

/* 页面内容被居中收窄平移过，触摸坐标要能反算回内容坐标 */
ui.open('tool');
const _avail = Math.max(240, M.W - sl - sr);
const _cw = Math.min(_avail, 620);
const _ox = sl + (_avail - _cw) / 2;
const backX = _ox + M.pad + 42;
ui.touch('start', backX, M.safeTop + 8 + 19);
ui.touch('end', backX, M.safeTop + 8 + 19);
check('点「← 3D 开奖」能回到 3D 页（坐标反算正确）', ui.current() === 'draw', ui.current());

console.log('\n' + (fail ? '✗ ' + fail + ' 项失败 / ' : '✅ ') + pass + ' 项通过'
  + '   [' + (LAND ? '横屏 844x390 · 刘海 44' : '竖屏 390x844') + ']');
process.exit(fail ? 1 : 0);
