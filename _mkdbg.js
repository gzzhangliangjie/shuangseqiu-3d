/* 临时调试4：轨迹追踪 */
const fs = require('fs');
let src = fs.readFileSync('sim/sim_real.js', 'utf8');
src = src.replace(
  'function runMachine(m, log){',
  'function runMachine(m, log){\n  const dbg=(t,b)=>console.log(`dbg t=${t.toFixed(1)} p=[${b.p.map(v=>v.toFixed(3))}] v=[${b.v.map(v=>v.toFixed(3))}] placed=${b.placed} settle=${(b.settle||0).toFixed(2)}`);'
);
src = src.replace(
  '    if(placedCount>=m.draws) break;',
  '    if(m.captured&&Math.abs(t*4-Math.round(t*4))<DT/2&&t<30) dbg(t,m.captured);\n    if(placedCount>=m.draws) break;'
);
fs.writeFileSync('sim/_dbg.js', src);
