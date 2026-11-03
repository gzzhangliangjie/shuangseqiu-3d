/* L4 偏置反推：扫描「球体半径公差」档位，看仿真能否复现真实数据的过度离散（σ 比值 1.37）
   用法: node _sim_bias.js <档位逗号分隔> <每档期数>
   例:   node _sim_bias.js 0,0.04,0.08,0.15 250
   输出: JSON 到 stdout，进度到 stderr
*/
const { execFileSync } = require('child_process');
const path = require('path');

const levels = (process.argv[2] || '0,0.04,0.08,0.15').split(',').map(Number);
const N = +(process.argv[3] || 250);
const SIM = path.join(__dirname, 'sim_real.js');
const RE = /dbg=\[num,x,y,z,\|v\|\]=\[\[(.*?)\]\]/g;
const P = 6 / 33;

function parseDraw(out) {
  RE.lastIndex = 0;
  const hits = []; let m;
  while ((m = RE.exec(out)) !== null) hits.push(m[1]);
  if (hits.length < 1) return null;
  const nums = s => s.split('],[').map(p => parseInt(p.split(',')[0].replace(/[^\d-]/g, ''), 10));
  const r = nums(hits[0]);
  if (r.length !== 6 || new Set(r).size !== 6 || r.some(v => !(v >= 1 && v <= 33))) return null;
  return r;
}

/* 蒙特卡洛零分布：N 期均匀随机 33 选 6，σ 比值的分位数 */
function nullQuantiles(n, T) {
  const vals = [];
  for (let t = 0; t < T; t++) {
    const c = Array(34).fill(0);
    for (let i = 0; i < n; i++) {
      const pool = Array.from({ length: 33 }, (_, k) => k + 1);
      for (let j = 0; j < 6; j++) c[pool.splice(Math.floor(Math.random() * pool.length), 1)[0]]++;
    }
    vals.push(sigmaRatio(c, n));
  }
  vals.sort((a, b) => a - b);
  const q = p => vals[Math.min(vals.length - 1, Math.floor(vals.length * p))];
  return { med: q(0.5), p95: q(0.95), p99: q(0.99), p999: q(0.999) };
}
function sigmaRatio(c, n) {
  const exp = n * P, th = Math.sqrt(n * P * (1 - P));
  let ss = 0;
  for (let i = 1; i <= 33; i++) ss += (c[i] - exp) ** 2;
  return Math.sqrt(ss / 32) / th;
}
function chi2(c, n) {
  const exp = n * P; let s = 0;
  for (let i = 1; i <= 33; i++) s += (c[i] - exp) ** 2 / exp;
  return s;
}

const out = [];
for (const lv of levels) {
  const c = Array(34).fill(0);
  let ok = 0, fail = 0;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    let r = null;
    try {
      const stdout = execFileSync(process.execPath, [SIM],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, SSQ_BIAS: String(lv) }, maxBuffer: 1 << 24 });
      r = parseDraw(stdout);
    } catch (e) { /* 视为失败 */ }
    if (r) { r.forEach(v => c[v]++); ok++; } else fail++;
    if ((i + 1) % 25 === 0) process.stderr.write(`  [BIAS=${lv}] ${i + 1}/${N} ok=${ok} fail=${fail} ${((Date.now() - t0) / 1000) | 0}s\n`);
  }
  const nq = nullQuantiles(ok, 800);
  const sr = sigmaRatio(c, ok);
  out.push({ bias: lv, n: ok, fail, sigmaRatio: +sr.toFixed(3), chi2: +chi2(c, ok).toFixed(1),
    nullMed: +nq.med.toFixed(3), null95: +nq.p95.toFixed(3), null99: +nq.p99.toFixed(3),
    exceed99: sr > nq.p99, red: c.slice(1, 34) });
  process.stderr.write(`== BIAS=${lv}  n=${ok}  σ比值=${sr.toFixed(3)}  χ²=${chi2(c, ok).toFixed(1)}  ` +
    `零分布[中位${nq.med.toFixed(2)} 95%${nq.p95.toFixed(2)} 99%${nq.p99.toFixed(2)}] ${sr > nq.p99 ? '★超出99%' : ''}\n`);
}
console.log(JSON.stringify({ N, levels, real: { sigmaRatio: 1.37, chi2: 50.9, n: 2083 }, results: out }));
