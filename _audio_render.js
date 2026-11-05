// 离线渲染 index.html 里的全部音效采样，导出裸 Float32 供频谱分析（不依赖浏览器）
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const a = src.indexOf('  /* ================= 合成核心');
const b = src.indexOf('  /* ================= 播放（运行时');
if (a < 0 || b < 0) throw new Error('anchor not found');
const code = src.slice(a, b);

const SR = 22050;
const mkCtx = () => ({
  createBuffer(ch, len, sr) {
    const d = new Float32Array(len);
    return { getChannelData: () => d, length: len, sampleRate: sr };
  }
});
const ctx = mkCtx();
const head = 'const TAU = 6.2832;\nlet fallBuf=null, stirBuf=null, hitBuf=null, clunkBuf=null,'
  + ' slideBuf=null, outBuf=null, chimeBuf=null, tickBuf=null;\n';
const run = new Function('ctx', 'SR',
  head + code + '\nbuildSamples(SR);\nreturn { fall: fallBuf, stir: stirBuf, hit: hitBuf,'
  + ' clunk: clunkBuf, slide: slideBuf, out: outBuf, chime: chimeBuf, tick: tickBuf };');
const out = run(ctx, SR);

let total = 0;
for (const [name, buf] of Object.entries(out)) {
  const d = buf.getChannelData(0);
  fs.writeFileSync(`_${name}.raw`, Buffer.from(d.buffer, d.byteOffset, d.byteLength));
  let pk = 0, sum = 0;
  for (let i = 0; i < d.length; i++) { const v = d[i]; sum += v * v; const a2 = v < 0 ? -v : v; if (a2 > pk) pk = a2; }
  total += d.length;
  console.log(`${name.padEnd(6)} ${(d.length / SR).toFixed(2)}s  peak=${pk.toFixed(3)} rms=${Math.sqrt(sum / d.length).toFixed(4)}`);
}
console.log(`合计 ${(total * 4 / 1048576).toFixed(2)} MB / ${(total / SR).toFixed(2)}s`);
fs.writeFileSync('_sr.txt', String(SR));
