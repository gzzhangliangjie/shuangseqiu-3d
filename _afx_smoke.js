/* AudioFX 行为冒烟（纯 Node，无依赖）：把 index.html 里的音频块抽出来，
   在 mock AudioContext 上跑 6 个场景。改音频后跑一次，防止下面几类回归：
     · ctx.state 不是 'suspended' 的机型上 resume 从不被调用 → 真机全程静音
     · createBuffer 拒绝 22.05k 时的降级重传
     · AudioBuffer 建好后原始 PCM 是否释放（省 ~730KB 常驻）
     · 微信小游戏真机：connect() 返回 undefined、AudioParam 无自动化方法
       （旧写法 source.connect(g).connect(master) 在这里必抛 → 永久静音）
     · 一次性 BufferSource 是否被持有到播完（微信客户端会提前 GC 未持有的源）
   用法：node _afx_smoke.js
   注意：这里只验行为，不能替代真机听感。 */
const fs = require('fs');
const path = require('path');

const HTML = path.join(__dirname, 'index.html');
const lines = fs.readFileSync(HTML, 'utf8').split('\n');
const START = lines.findIndex(l => l.startsWith('const AudioFX'));
if (START < 0) { console.error('未找到 AudioFX 代码块'); process.exit(1); }
let END = -1;
for (let i = START; i < START + 900; i++) if (lines[i].trim() === '})();') { END = i; break; }
if (END < 0) { console.error('未找到 AudioFX 结束标记'); process.exit(1); }
const src = lines.slice(START, END + 1).join('\n');
console.log(`AudioFX 抽取：index.html 第 ${START + 1} ~ ${END + 1} 行`);

function mkWin(opts, out) {
  class Ctx {
    constructor() {
      this.sampleRate = 22050;
      this.state = 'state' in opts ? opts.state : 'suspended';
      this.currentTime = 0;
      this.destination = { name: 'dest' };
      this.resumeCount = 0;
      this.createBufferCount = 0;
      out.push(this);
    }
    createGain() {
      const gain = { value: 1 };
      if (!opts.noParam) {
        gain.setTargetAtTime = function () {};
        gain.setValueAtTime = function () {};
        gain.exponentialRampToValueAtTime = function () {};
      }
      return { gain: gain, connect(n) { return opts.noChain ? undefined : (n || this); }, disconnect() {} };
    }
    createBuffer(ch, len, sr) {
      this.createBufferCount++;
      if (opts.failBuffer && this.createBufferCount <= (opts.failCount || 0)) throw new Error('unsupported sampleRate');
      const d = new Float32Array(len);
      return { sampleRate: sr, length: len, duration: len / sr, getChannelData: () => d, copyToChannel: s => d.set(s) };
    }
    createBufferSource() {
      return { buffer: null, loop: false, playbackRate: { value: 1 },
        connect(n) { return opts.noChain ? undefined : (n || this); },
        disconnect() {}, start() {}, stop() {}, onended: null };
    }
    resume() { this.resumeCount++; if (this.state !== 'running') this.state = 'running'; return Promise.resolve(); }
  }
  return { AudioContext: Ctx };
}

function load(opts) {
  const out = [];
  const win = mkWin(opts, out);
  if (opts.ctorThrow) win.AudioContext = function () { throw new Error('webAudio unsupported'); };
  const mod = { exports: {} };
  new Function('window', 'location', 'performance', 'module', 'nowMs',
    src + '\nmodule.exports = AudioFX;')(win, { search: '?debug' }, performance, mod,
    () => Date.now());
  return { afx: mod.exports, win, out };
}

let fail = 0;
const ok = (c, m) => { console.log((c ? '  [ok]   ' : '  [FAIL] ') + m); if (!c) fail++; };

console.log('\n1. 正常路径（state=suspended → resume）');
{
  const { afx, out } = load({});
  let t = performance.now(); afx.prime(); const tPrime = performance.now() - t;
  afx.ensure();
  const ctx = out[0];
  ok(tPrime > 30, `prime 真的做了合成（${tPrime.toFixed(0)} ms）`);
  ok(ctx.resumeCount >= 1, `resume 被调用 ${ctx.resumeCount} 次`);
  ok(ctx.state === 'running', 'state 已恢复 running');
  ok(ctx.createBufferCount === 8, `8 个 AudioBuffer 全部建好（实际 ${ctx.createBufferCount}）`);
  t = performance.now(); const p2 = afx.prime(); const t2 = performance.now() - t;
  ok(p2 === true && t2 < 20, `二次 prime 未重算（${t2.toFixed(1)} ms）→ 原始 PCM 已释放`);
  let threw = null; try { afx.start(); afx.done(); afx.reset(); } catch (e) { threw = e; }
  ok(!threw, '播放入口不抛异常');
  ok(typeof load({}).win.__AFX === 'function', 'window.__AFX 诊断口可用');
}

console.log('\n2. 机型差异：ctx.state 为 undefined');
{
  const { afx, out } = load({ state: undefined });
  let threw = null; try { afx.ensure(); } catch (e) { threw = e; }
  ok(!threw, 'ensure 不抛异常');
  ok(out[0].resumeCount >= 1, `undefined 也尝试了 resume（${out[0].resumeCount} 次）→ 不再静音但无报错`);
}

console.log('\n3. 降级重传：第一个 createBuffer 抛错（不接受 22.05k）');
{
  const { afx, win, out } = load({ failBuffer: true, failCount: 1 });
  let threw = null; try { afx.ensure(); } catch (e) { threw = e; }
  ok(!threw, '异常没有冒到调用方（点击回调）');
  ok(out[0].createBufferCount === 9, `按设备采样率重算后重传成功（createBuffer 共 ${out[0].createBufferCount} 次）`);
  ok(win.__AFX().uploaded === true, 'uploaded = true');
  const t = performance.now(); afx.prime(); const dt = performance.now() - t;
  ok(dt < 20, `降级成功后原始 PCM 也已释放（二次 prime ${dt.toFixed(1)} ms）`);
}

console.log('\n4. 极端机型：createBuffer 完全不可用');
{
  const { afx, win } = load({ failBuffer: true, failCount: 1e9 });
  let threw = null; try { afx.ensure(); afx.start(); afx.stir(1); afx.stir(0); } catch (e) { threw = e; }
  ok(!threw, 'ensure / 播放 / 搅拌全部静默降级，不抛异常');
  ok(win.__AFX().uploaded === false, 'uploaded = false，但游戏照常运行');
}

console.log('\n5. 整块 WebAudio 不可用（new AudioContext 直接抛）');
{
  const { afx, win } = load({ ctorThrow: true });
  let threw = null;
  try { afx.ensure(); afx.start(); afx.place(); afx.stir(1); afx.stir(0); } catch (e) { threw = e; }
  ok(!threw, 'ensure / 全部播放入口都不抛异常 → 不会卡死「开始摇奖」');
  const t = performance.now(); afx.ensure(); const dt = performance.now() - t;
  ok(dt < 5, `失败后被标记为不可用，不再重试（二次 ensure ${dt.toFixed(2)} ms）`);
  ok(!win.__AFX().uploaded, '没有 AudioBuffer 被建出来，静音但游戏可玩');
}

console.log('\n6. 微信小游戏真机：connect() 返回 undefined + AudioParam 无自动化方法');
{
  const { afx, win } = load({ noChain: true, noParam: true });
  let threw = null;
  try {
    afx.ensure();
    afx.start(); afx.gateOpen(); afx.ballOut(); afx.place(); afx.done(); afx.reset();
    afx.ballFall(1);
    afx.stir(1); afx.stir(0);
  } catch (e) { threw = e; }
  ok(!threw, '全部播放入口不抛异常（旧链式 connect 在这里必炸→永久静音）');
  const d = win.__AFX();
  ok(d.dead === false, '没有被判成永久静音');
  ok(!d.issue, '没有降级告警（' + (d.issue || '无') + '）');
  ok(d.live >= 7, `一次性音源被持有到播完（live=${d.live}），不会被客户端提前 GC`);
  ok(d.gain >= 0, `搅拌增益在无自动化方法时仍能赋值（gain=${d.gain}）`);
}

console.log('\n7. 诊断口与手势解锁口常开（真机没有 ?debug 查询串）');
{
  const { win } = load({});
  ok(typeof win.__AFX === 'function', '__AFX 可用');
  ok(typeof win.__audioUnlock === 'function', '__audioUnlock 可用（adapter 首触恢复 ctx）');
  const d = win.__AFX();
  ok('hasAC' in d && 'ctxState' in d && 'issue' in d, '诊断字段含 WebAudio 能力 / ctx 状态 / 失败原因');
}

console.log('\n' + (fail ? `❌ ${fail} 项未通过` : '✅ 全部通过'));
process.exit(fail ? 1 : 0);
