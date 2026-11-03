/* 批量物理摇奖：复用 sim_real.js 的物理，跑 N 次，统计 33 红球 / 16 蓝球出现次数
   用法: node _sim_batch.js <次数>    输出: JSON {n, red:[33], blue:[16]} */
const { execFileSync } = require('child_process');
const N = parseInt(process.argv[2] || '100', 10);
const RE = /dbg=\[num,x,y,z,\|v\|\]=\[\[(.*?)\]\]/g;

const red = Array(34).fill(0), blue = Array(17).fill(0);
let ok = 0, fail = 0;
const t0 = Date.now();

for (let i = 0; i < N; i++) {
  let out;
  try {
    out = execFileSync(process.execPath, [require('path').join(__dirname, 'sim_real.js')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { fail++; continue; }
  const hits = [];
  let m; RE.lastIndex = 0;
  while ((m = RE.exec(out)) !== null) hits.push(m[1]);
  if (hits.length < 2) { fail++; continue; }
  const nums = s => s.split('],[').map(p => parseInt(p.split(',')[0].replace(/[^\d-]/g, ''), 10));
  const r = nums(hits[0]), b = nums(hits[1]);
  if (r.length !== 6 || b.length !== 1 || r.some(v => !(v >= 1 && v <= 33)) || !(b[0] >= 1 && b[0] <= 16)) { fail++; continue; }
  if (new Set(r).size !== 6) { fail++; continue; }
  r.forEach(v => red[v]++); blue[b[0]]++; ok++;
  if ((i + 1) % 50 === 0) process.stderr.write(`  ${i + 1}/${N}  ok=${ok} fail=${fail}  ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
}

console.log(JSON.stringify({ n: ok, fail, sec: +((Date.now() - t0) / 1000).toFixed(1),
  red: red.slice(1, 34), blue: blue.slice(1, 17) }));
