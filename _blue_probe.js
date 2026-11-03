/* 蓝球专项检验：回测里出现「推荐组六等奖 466 vs 机选组 414」的差异，
   判断它是真信号还是噪声。做法同上 walk-forward，但只看蓝球，且重复 T 次取分布。
   用法: node _blue_probe.js [重复次数]
*/
const fs = require('fs'), vm = require('vm'), path = require('path');

const dctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'picker', 'data.js'), 'utf8'), dctx);
const ROWS = dctx.window.SSQ_DATA.slice().sort((a, b) => a[0] - b[0]);
const TOT = ROWS.length, START = 600;

const html = fs.readFileSync(path.join(__dirname, 'picker', 'index.html'), 'utf8');
let src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
src = src.replace(/^\s*\(function\(\)\{/, '').replace(/\}\)\(\);\s*$/, '')
  .replace(/if\(!D\.length\)\{[\s\S]*?return;\s*\}/, '')
  .replace(/buildDist\(\);\s*renderOverview\(\);[\s\S]*?doGen\(false\);/, '')
  .replace(/checkSim\(\);/g, '');
const el = () => ({ value: '80', textContent: '', innerHTML: '', checked: true, dataset: {}, children: [], style: {},
  classList: { add() {}, remove() {} }, addEventListener() {}, appendChild() {}, closest() { return null; } });
const ctx = { window: { SSQ_DATA: ROWS }, console, Math, Date, Set, Map, Array, Object, JSON, Number, String,
  isNaN, parseInt, parseFloat, performance: { now: () => Date.now() },
  fetch: () => Promise.reject(new Error('x')),
  document: { getElementById: () => el(), createElement: () => el(), body: { appendChild() {} } } };
vm.createContext(ctx); vm.runInContext(src, ctx);

const T = +(process.argv[2] || 200), K = 5;
function sample(pB) {
  const r = Math.random(); let acc = 0, tot = 0;
  for (let n = 1; n <= 16; n++) tot += pB[n];
  for (let n = 1; n <= 16; n++) { acc += pB[n] / tot; if (r <= acc) return n; }
  return 16;
}

const diffs = [], hitW = [], hitU = [];
for (let t = 0; t < T; t++) {
  let hw = 0, hu = 0, bets = 0;
  for (let i = START; i < TOT; i++) {
    ctx.D = ROWS.slice(0, i); ctx.N = i; ctx.LAST = ctx.D[i - 1];
    const W = ctx.buildWeights(0.35, 600);
    const blue = ROWS[i][2];
    for (let k = 0; k < K; k++) {
      if (sample(W.pB) === blue) hw++;
      if (1 + ((Math.random() * 16) | 0) === blue) hu++;
      bets++;
    }
  }
  hitW.push(hw); hitU.push(hu); diffs.push(hw - hu);
  if ((t + 1) % 20 === 0) process.stderr.write(`  ${t + 1}/${T}\n`);
}
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const bets = (TOT - START) * K;
const exp = bets / 16;
console.log(`\n===== 蓝球专项检验（${T} 次独立重复，每次 ${bets} 注）=====`);
console.log(`理论期望命中 ${exp.toFixed(1)} 次（1/16），理论标准差 ${Math.sqrt(bets * (1 / 16) * (15 / 16)).toFixed(1)}`);
console.log(`加权选蓝(α=0.35) 平均 ${mean(hitW).toFixed(1)}  sd ${sd(hitW).toFixed(1)}  命中率 ${(mean(hitW) / bets * 100).toFixed(3)}%`);
console.log(`均匀随机选蓝   平均 ${mean(hitU).toFixed(1)}  sd ${sd(hitU).toFixed(1)}  命中率 ${(mean(hitU) / bets * 100).toFixed(3)}%`);
const md = mean(diffs), sdd = sd(diffs);
console.log(`差值(A−B) 平均 ${md.toFixed(1)}  sd ${sdd.toFixed(1)}  → z = ${(md / (sdd / Math.sqrt(T))).toFixed(2)}`);
console.log(`差值 95% 区间 [${(md - 1.96 * sdd).toFixed(0)}, ${(md + 1.96 * sdd).toFixed(0)}]`);
console.log(`单次实验的差值标准差 ${sdd.toFixed(1)} → 回测里观察到的 +52 落在这个尺度内即属噪声`);
