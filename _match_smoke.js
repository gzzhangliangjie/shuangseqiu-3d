/* 选号页 ↔ 3D 摇奖「带注回填」回路的离线冒烟测试（纯 Node，无依赖）
   跑法：node _match_smoke.js
   覆盖：无注不误判 / 全中一等奖 / 4 红未中蓝 → 五等奖 / pending 清空 / 选号页渲染不抛错 */
'use strict';

global.GameGlobal = global;
GameGlobal.localStorage = {
  _v: {},
  getItem(k) { return this._v[k] === undefined ? null : this._v[k]; },
  setItem(k, v) { this._v[k] = String(v); }
};

/* ---- hud 桩：pages.js 只用到 markDirty / metrics ---- */
let dirtyCount = 0;
GameGlobal.__hud = {
  markDirty() { dirtyCount++; },
  metrics: { W: 375, H: 812, pad: 16, safeTop: 44, safeBottom: 34 },
  draw() {}, hitTest() { return false; }
};

/* ---- SimLog 桩：真源 index.html 的 onDrawComplete 已支持第 3 个参数 pick ---- */
let rows = [];
GameGlobal.SimLog = {
  snapshot() { return rows; },
  clear() { rows = []; },
  onDrawComplete(red, blue, pick) {
    const rec = { red: red.slice().sort((a, b) => a - b), blue, time: Date.now(), ev: {} };
    if (pick && pick.red && pick.red.length === 6) rec.pick = { red: pick.red.slice(), blue: pick.blue };
    rows.push(rec);
  }
};

/* ---- 2D ctx 桩：随便怎么调都不炸，measureText 给个宽度；顺带记录画了哪些字 ---- */
const grad = { addColorStop() {} };
const texts = [];
const ctx = new Proxy({}, {
  get(t, k) {
    if (k === 'measureText') return () => ({ width: 60 });
    if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
    if (k === 'fillText') return (s) => { texts.push(String(s)); };
    if (k === 'canvas') return { width: 375, height: 812 };
    if (k in t) return t[k];
    return function () {};
  },
  set(t, k, v) { t[k] = v; return true; }
});

require('./miniprogram/pages.js');
const ui = GameGlobal.__ui;
const MATCH = GameGlobal.__match;
const M = GameGlobal.__hud.metrics;
let fail = 0;
function check(name, cond, extra) {
  if (cond) console.log('  [ok]   ' + name + (extra ? '  ' + extra : ''));
  else { console.log('  [FAIL] ' + name + (extra ? '  ' + extra : '')); fail++; }
}
function step(t) { console.log('\n' + t); }

/* ========== 0. 启动落地页 ========== */
step('0. 启动落地页');
check('启动即选号页（不是 3D）', ui.current() === 'tool', ui.current());

/* ========== 1. 普通摇奖（没有带注）不该产生对照 ========== */
step('1. 无注摇奖');
GameGlobal.SimLog.onDrawComplete([3, 8, 12, 18, 25, 31], 7, null);
ui.open('tool');
check('MATCH.result 保持 null', MATCH.result === null, String(MATCH.result));

/* ========== 2. 带注摇奖，完全命中 → 一等奖 ========== */
step('2. 带注摇奖 · 全中');
const win = { red: [3, 8, 12, 18, 25, 31], blue: 7 };
GameGlobal.SimLog.onDrawComplete(win.red, win.blue, win);
ui.open('tool');
const r2 = MATCH.result;
check('对照已生成', !!r2);
check('红中 6', r2 && r2.redHit === 6, r2 && String(r2.redHit));
check('蓝中', r2 && r2.blueHit === 1);
check('一等奖（level 1）', r2 && r2.level === 1, r2 && String(r2.level));
check('pending 已清空', MATCH.pending === null && GameGlobal.__PENDING_PICK === null);

/* ========== 3. 4 红 + 未中蓝 → 五等奖 ========== */
step('3. 带注摇奖 · 4 红未中蓝');
const p3 = { red: [3, 8, 12, 18, 21, 29], blue: 9 };
GameGlobal.SimLog.onDrawComplete([3, 8, 12, 18, 25, 31], 7, p3);
ui.open('tool');
const r3 = MATCH.result;
check('红中 4', r3 && r3.redHit === 4, r3 && String(r3.redHit));
check('蓝未中', r3 && r3.blueHit === 0);
check('五等奖（level 5）', r3 && r3.level === 5, r3 && String(r3.level));

/* ========== 4. 选号页渲染（含对照卡 + 带注按钮）不抛错 ========== */
step('4. 选号页渲染');
let threw = null;
try {
  ui.renderPage(ctx, M.W, M.H, M);
  /* 点第二个 tab（选号）：tab 栏 y = safeTop+8+48，按钮从 x 起两倍宽 */
  const ty = M.safeTop + 8 + 48;
  const tw = (M.W - M.pad * 2 - 12) / 3;
  const tx = M.pad + (tw + 6);
  ui.touch('start', tx + tw / 2, ty + 17);
  ui.touch('end', tx + tw / 2, ty + 17);
  ui.renderPage(ctx, M.W, M.H, M);          /* 走 drawPick 分支 */
} catch (e) { threw = e; }
check('renderPage 不抛错', !threw, threw && threw.message);
check('对照卡已绘制', texts.indexOf('上次摇奖对照') >= 0);
check('带注主按钮已绘制', texts.indexOf('带这注去 3D 摇奖') >= 0);

/* ========== 5. 机选 → 带这注去 3D → pending 交接 ========== */
step('5. 带注跳转');
const regs = ui.regions();
check('点击区数量符合预期（58）', regs.length === 58, String(regs.length));
function tap(r) { ui.touch('start', r.x + 2, r.y + 2); ui.touch('end', r.x + 2, r.y + 2); }
tap(regs[5]);                               /* 机选一注 */
check('机选后 pending 仍为空', GameGlobal.__PENDING_PICK === null);
tap(regs[regs.length - 2]);                 /* 带这注去 3D 摇奖 */
const pend = GameGlobal.__PENDING_PICK;
check('pending 已写入', !!pend, pend && pend.red.join(' ') + ' + ' + pend.blue);
check('红球 6 个且升序', !!pend && pend.red.length === 6 &&
  pend.red.every((v, i, a) => i === 0 || a[i - 1] < v), pend && pend.red.join(' '));
check('已切到 3D 页', ui.isDrawPage() === true);

/* ========== 6. 同一期不重复结算 ========== */
step('6. 幂等 / 离场清 pending');
const before = JSON.stringify(MATCH.result);
ui.open('tool');
check('重复 open 结果不变', JSON.stringify(MATCH.result) === before);
check('离开 3D 后 pending 已清', GameGlobal.__PENDING_PICK === null);
check('hud 每次都收到重绘通知', dirtyCount > 0, dirtyCount + ' 次');

console.log('\n' + (fail ? '失败 ' + fail + ' 项' : '全部通过'));
process.exit(fail ? 1 : 0);
