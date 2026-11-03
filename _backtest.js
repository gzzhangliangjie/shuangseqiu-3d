/* M4 · walk-forward 回测：只用第 i 期之前的数据生成号码，与第 i 期真实开奖判奖；
   对照组为完全均匀的纯机选，两组共用同一段真实开奖序列（配对比较）。
   用法: node _backtest.js [起始期索引] [候选规模] [步长]
   直接复用 picker/index.html 里的选号算法（vm 加载页面源码），避免两份实现漂移。
*/
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const START = +(process.argv[2] || 600);
const CAND = +(process.argv[3] || 20000);
const STEP = +(process.argv[4] || 1);

/* ---------- 载入历史数据 ---------- */
const dctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'picker', 'data.js'), 'utf8'), dctx);
const ROWS = dctx.window.SSQ_DATA.slice().sort((a, b) => a[0] - b[0]);
const TOT = ROWS.length;

/* ---------- 用 vm 加载页面里的选号引擎 ---------- */
const html = fs.readFileSync(path.join(__dirname, 'picker', 'index.html'), 'utf8');
let src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];

src = src
  .replace(/^\s*\(function\(\)\{/, '')
  .replace(/\}\)\(\);\s*$/, '')
  .replace(/if\(!D\.length\)\{[\s\S]*?return;\s*\}/, '')
  .replace(/buildDist\(\);\s*renderOverview\(\);[\s\S]*?doGen\(false\);/, '')
  .replace(/checkSim\(\);/g, '');

const el = () => ({
  value: '80', textContent: '', innerHTML: '', checked: true, dataset: {}, children: [], style: {},
  classList: { add() {}, remove() {}, contains() { return false; } },
  addEventListener() {}, appendChild() {}, removeChild() {}, closest() { return null; },
  getContext() { return new Proxy({}, { get: () => () => {} }); },
  getBoundingClientRect() { return { width: 300, height: 200 }; }
});
const ctx = {
  window: { SSQ_DATA: ROWS }, console, Math, Date, Set, Map, Array, Object, JSON, Number, String,
  isNaN, parseInt, parseFloat, performance: { now: () => Date.now() },
  fetch: () => Promise.reject(new Error('no net')),
  document: { getElementById: () => el(), createElement: () => el(), body: { appendChild() {}, insertBefore() {}, removeChild() {} } },
  requestAnimationFrame: () => 0,
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const { generate, buildDist, feat, pass } = ctx;

/* ---------- 默认约束（与页面默认勾选一致） ---------- */
const CFG = {
  hSum: true, sumLo: 80, sumHi: 130, hOdd: true, hBig: true, hZone: true,
  hRep: true, repMax: 3, hCon: true, conMax: 2, hTail: true, tailMin: 4,
  hAc: true, acMin: 5, hSpan: true
};
const AWARD = { 1: 5000000, 2: 150000, 3: 3000, 4: 200, 5: 10, 6: 5, 0: 0 };
function prizeOf(pick, reds, blue) {
  let r = 0; pick.red.forEach(x => { if (reds.includes(x)) r++; });
  const b = pick.blue === blue ? 1 : 0;
  if (r === 6 && b) return 1; if (r === 6) return 2; if (r === 5 && b) return 3;
  if (r === 5 || (r === 4 && b)) return 4; if (r === 4 || (r === 3 && b)) return 5;
  if (b) return 6; return 0;
}
function quickPicks(k) {
  const out = [];
  for (let i = 0; i < k; i++) {
    const pool = Array.from({ length: 33 }, (_, j) => j + 1);
    const r = [];
    for (let j = 0; j < 6; j++) r.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
    out.push({ red: r.sort((a, b) => a - b), blue: 1 + ((Math.random() * 16) | 0) });
  }
  return out;
}

/* ---------- 回测 ---------- */
const A = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }, B = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
let winA = 0, winB = 0, bets = 0, n = 0;
let redHitA = 0, redHitB = 0, blueHitA = 0, blueHitB = 0;
let realPass = 0, randPass = 0, randTried = 0;
const t0 = Date.now();

for (let i = START; i < TOT; i += STEP) {
  /* walk-forward：引擎只看到前 i 期 */
  ctx.D = ROWS.slice(0, i);
  ctx.N = i;
  ctx.LAST = ctx.D[i - 1];
  buildDist();

  const drawRed = ROWS[i][1], drawBlue = ROWS[i][2];

  /* 覆盖率检验：真实开奖号本身是否通过硬约束 */
  const rf = feat(drawRed.slice(), drawBlue); rf._red = drawRed;
  if (pass(rf, CFG, null, null)) realPass++;
  for (let t = 0; t < 40; t++) {
    const q = quickPicks(1)[0];
    const qf = feat(q.red, q.blue); qf._red = q.red;
    if (pass(qf, CFG, null, null)) randPass++;
    randTried++;
  }

  /* A 组：推荐；B 组：纯机选 —— 同期同开奖 */
  const res = generate({ alpha: 0.35, win: 600, cand: CAND, k: 5, maxOv: 3, cap: 2, cfg: CFG, dan: null, kill: null });
  const picksA = res.picks.length ? res.picks : quickPicks(5);
  const picksB = quickPicks(picksA.length);
  for (const p of picksA) {
    const lv = prizeOf(p, drawRed, drawBlue); A[lv]++; winA += AWARD[lv];
    redHitA += p.red.filter(x => drawRed.includes(x)).length; if (p.blue === drawBlue) blueHitA++;
  }
  for (const p of picksB) {
    const lv = prizeOf(p, drawRed, drawBlue); B[lv]++; winB += AWARD[lv];
    redHitB += p.red.filter(x => drawRed.includes(x)).length; if (p.blue === drawBlue) blueHitB++;
  }
  bets += picksA.length; n++;
  if (n % 100 === 0) process.stderr.write(`  ${n}/${Math.ceil((TOT - START) / STEP)} 期  ${((Date.now() - t0) / 1000) | 0}s\n`);
}

const sec = ((Date.now() - t0) / 1000).toFixed(0);
const roi = w => (bets ? (w / (bets * 2) * 100).toFixed(1) : '0.0');
const pct = (a, b) => (b ? (a / b * 100).toFixed(2) : '0.00');

console.log('\n===== M4 walk-forward 回测 =====');
console.log(`检验期数 ${n}（第 ${START} 期起，每期只用之前的数据训练，候选 ${CAND} 注/期，用时 ${sec}s）`);
console.log(`投注注数 每组 ${bets} 注，成本 每组 ¥${bets * 2}`);
console.log('\n奖级        推荐组 α=0.35    纯机选组');
[6, 5, 4, 3, 2, 1].forEach(l => console.log(`${['', '一等', '二等', '三等', '四等', '五等', '六等'][l]}        ${String(A[l]).padStart(8)}${String(B[l]).padStart(14)}`));
console.log(`中奖合计    ${String(bets - A[0]).padStart(8)}${String(bets - B[0]).padStart(14)}`);
console.log(`返还        ¥${winA.toLocaleString().padStart(8)}   ¥${winB.toLocaleString().padStart(11)}`);
console.log(`返奖率      ${roi(winA).padStart(8)}%   ${roi(winB).padStart(11)}%`);
console.log(`\n红球命中    A 平均 ${(redHitA / bets).toFixed(4)} 个/注   B 平均 ${(redHitB / bets).toFixed(4)} 个/注   理论 ${(6 * 6 / 33).toFixed(4)}`);
console.log(`蓝球命中率  A ${pct(blueHitA, bets)}%   B ${pct(blueHitB, bets)}%   理论 6.25%`);
console.log(`\n【硬约束覆盖率】真实开奖通过率 ${pct(realPass, n)}%（${realPass}/${n}）`);
console.log(`              随机组合通过率 ${pct(randPass, randTried)}%（${randPass}/${randTried}）`);
console.log(`              → 若两者相等，说明硬约束只是削减数量，未切掉有效区间；`);
console.log(`                若真实显著更高，说明约束捕捉到了真实机器的形态偏置。`);
console.log(JSON.stringify({ A, B, winA, winB, bets, n, realPass, randPass, randTried,
  redHitA, redHitB, blueHitA, blueHitB }));
