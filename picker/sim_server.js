/* 物理摇奖桥接服务：把 sim_real.js（勿忘草真机比例物理仿真）包装成 HTTP 接口，
   供 picker/index.html 用作「无预设真随机源」与闭环验证。
   纯 Node 标准库，无依赖。

   用法:  node picker/sim_server.js [--port 8731] [--keep 120]
   启动后浏览器打开 http://127.0.0.1:8731/index.html

   接口:
     GET /api/status            → {queue, drawn, running, secEach}
     GET /api/draw              → 取 1 期（队列优先，队列空则现摇）
     GET /api/draw?n=20         → 取 n 期
     GET /api/bench?n=200       → 只统计不出号（零假设基准用），返回 freq
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = __dirname;
const SIM = path.join(ROOT, '..', 'sim_real.js');
/* 3D 摇奖结果持久化文件：放在用户主目录（项目目录之外）。
   不能放项目里——预览面板监视项目文件，每次开奖写文件都会触发整页刷新。 */
const os = require('os');
const S3D_DIR = path.join(os.homedir(), '.ssq3d');
const S3D_LEGACY = path.join(ROOT, '..', 'sim3d_results.json');
const S3D = path.join(S3D_DIR, 'sim3d_results.json');
try {
  if (!fs.existsSync(S3D_DIR)) fs.mkdirSync(S3D_DIR, { recursive: true });
  /* 兼容旧版：项目根目录里已有结果文件则迁移过来 */
  if (fs.existsSync(S3D_LEGACY) && !fs.existsSync(S3D)) {
    fs.renameSync(S3D_LEGACY, S3D);
    console.log(`已迁移历史结果文件 → ${S3D}`);
  } else if (fs.existsSync(S3D_LEGACY)) {
    /* 两处都有：合并进主文件后删掉项目内的旧文件，避免预览监视再触发刷新 */
    try {
      const oldArr = JSON.parse(fs.readFileSync(S3D_LEGACY, 'utf8'));
      const newArr = JSON.parse(fs.readFileSync(S3D, 'utf8'));
      const seen = new Set(newArr.map(x => (x.t || 0) + '|' + (x.b || 0) + '|' + (x.r || []).join(',')));
      const merged = newArr.concat(oldArr.filter(x => !seen.has((x.t || 0) + '|' + (x.b || 0) + '|' + (x.r || []).join(','))));
      fs.writeFileSync(S3D, JSON.stringify(merged));
      fs.unlinkSync(S3D_LEGACY);
      console.log(`已合并项目内旧结果文件（共 ${merged.length} 条）→ ${S3D}`);
    } catch (e) { console.warn('合并旧结果文件失败（保留原文件）:', e.message); }
  }
} catch (e) { console.warn('结果文件目录初始化失败:', e.message); }
const PORT = +(argv('--port') || 8731);
const KEEP = +(argv('--keep') || 120);      // 预摇奖队列上限

function argv(k) { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; }

const RE = /dbg=\[num,x,y,z,\|v\|\]=\[\[(.*?)\]\]/g;
const queue = [];
let drawn = 0, running = false, secEach = 0;

function parseDraw(out) {
  RE.lastIndex = 0;
  const hits = []; let m;
  while ((m = RE.exec(out)) !== null) hits.push(m[1]);
  if (hits.length < 2) return null;
  const nums = s => s.split('],[').map(p => parseInt(p.split(',')[0].replace(/[^\d-]/g, ''), 10));
  const r = nums(hits[0]), b = nums(hits[1]);
  if (r.length !== 6 || new Set(r).size !== 6 || r.some(v => !(v >= 1 && v <= 33))) return null;
  if (b.length !== 1 || !(b[0] >= 1 && b[0] <= 16)) return null;
  return { red: r.slice().sort((a, c) => a - c), blue: b[0], src: 'physics' };
}

function shakeOnce(extraEnv) {
  return new Promise(res => {
    const t0 = Date.now();
    const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
    execFile(process.execPath, [SIM], { encoding: 'utf8', maxBuffer: 1 << 24, env },
      (err, stdout) => {
        const d = err ? null : parseDraw(stdout || '');
        const dt = (Date.now() - t0) / 1000;
        if (d) { secEach = secEach ? secEach * 0.8 + dt * 0.2 : dt; d.sec = +dt.toFixed(2); }
        res(d);
      });
  });
}

/* 后台持续摇奖，把队列填满；满了就歇 500ms 再看 */
async function worker() {
  if (running) return;
  running = true;
  while (queue.length < KEEP) {
    const d = await shakeOnce();
    if (d) { queue.push(d); drawn++; }
    else await new Promise(r => setTimeout(r, 200));
    await new Promise(r => setTimeout(r, 30));
  }
  running = false;
  setTimeout(() => { if (queue.length < KEEP) worker(); }, 800);
}

async function take(n) {
  if (queue.length < n) worker();
  while (queue.length < n) await new Promise(r => setTimeout(r, 60));
  return queue.splice(0, n);
}

/* 双色球奖级判定 */
function prize(pick, draw) {
  const r = pick.red.filter(x => draw.red.includes(x)).length;
  const b = pick.blue === draw.blue ? 1 : 0;
  if (r === 6 && b) return { lv: 1, name: '一等奖' };
  if (r === 6) return { lv: 2, name: '二等奖' };
  if (r === 5 && b) return { lv: 3, name: '三等奖' };
  if (r === 5 || (r === 4 && b)) return { lv: 4, name: '四等奖' };
  if (r === 4 || (r === 3 && b)) return { lv: 5, name: '五等奖' };
  if (b) return { lv: 6, name: '六等奖' };
  return { lv: 0, name: '未中奖' };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  try {
    if (p === '/api/status') {
      return json(res, { queue: queue.length, drawn, running, secEach: +secEach.toFixed(2), sim: fs.existsSync(SIM) });
    }
    if (p === '/api/draw') {
      const n = Math.min(Math.max(1, +(u.searchParams.get('n') || 1)), 50);
      return json(res, { ok: true, draws: await take(n), pending: queue.length });
    }
    if (p === '/api/prize') {                       // POST {picks:[{red,blue}], n}
      let body = '';
      for await (const c of req) body += c;
      const q = JSON.parse(body || '{}');
      const picks = (q.picks || []).filter(x => x && x.red && x.red.length === 6);
      const n = Math.min(Math.max(1, +(q.n || 100)), 2000);
      const draws = await take(n);
      const tally = picks.map(() => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 0: 0 }));
      let cost = 0, win = 0;
      const award = { 1: 5000000, 2: 150000, 3: 3000, 4: 200, 5: 10, 6: 5, 0: 0 };
      for (const d of draws) {
        picks.forEach((pk, i) => {
          const pr = prize(pk, d);
          tally[i][pr.lv]++; win += award[pr.lv];
        });
        cost += 2 * picks.length;
      }
      return json(res, { ok: true, periods: draws.length, picks: picks.length,
        cost, win, roi: cost ? +(win / cost * 100).toFixed(1) : 0, tally, draws: draws.slice(0, 20) });
    }
    if (p === '/api/bench') {                       // 零假设基准：只出频次，不出号
      const n = Math.min(Math.max(1, +(u.searchParams.get('n') || 100)), 2000);
      const bias = u.searchParams.get('bias');      // 可选：带球体半径公差（L4 偏置反推）
      const fixed = u.searchParams.get('fixed') === '1';
      const red = Array(34).fill(0), blue = Array(17).fill(0);
      let got = [];
      if (bias || fixed) {                          // 带注入 → 现摇，不经预摇队列
        const env = {};
        if (bias) env.SSQ_BIAS = bias;
        if (fixed) env.SSQ_FIXED = '1';
        for (let i = 0; i < n; i++) { const d = await shakeOnce(env); if (d) got.push(d); }
      } else {
        got = await take(n);
      }
      for (const d of got) { d.red.forEach(v => red[v]++); blue[d.blue]++; }
      return json(res, { ok: true, n: got.length, bias: bias || 0, fixed,
        red: red.slice(1, 34), blue: blue.slice(1, 17) });
    }
    if (p === '/api/sim3d' && req.method === 'OPTIONS') {   // 跨源 POST 预检
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
      });
      return res.end();
    }
    if (p === '/api/sim3d') {                       // 3D 摇奖结果文件（两页共享）
      if (req.method === 'POST') {                  // 全量覆盖写，原子替换
        let body = '';
        for await (const c of req) body += c;
        let arr;
        try { arr = JSON.parse(body || '[]'); } catch (e) { return json(res, { ok: false, err: 'bad json' }, 400); }
        if (!Array.isArray(arr)) return json(res, { ok: false, err: 'need array' }, 400);
        arr = arr.slice(-500).map(x => ({            // 归一化字段，最多留 500 期
          r: (x.r || x.red || []).slice(0, 6), b: +(x.b != null ? x.b : x.blue) || 0,
          t: +(x.t != null ? x.t : x.time) || 0, e: x.e || x.ev || null
        }));
        const tmp = S3D + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(arr));
        fs.renameSync(tmp, S3D);
        return json(res, { ok: true, n: arr.length });
      }
      let results = [];
      try { results = JSON.parse(fs.readFileSync(S3D, 'utf8')); } catch (e) {}
      return json(res, { ok: true, file: S3D, results: Array.isArray(results) ? results : [] });
    }
    // 静态文件：/machine = 上级的 3D 摇奖机页面；/picker/xxx 归一化到本目录
    let f;
    if (p === '/machine' || p === '/machine.html' || p === '/3d') f = path.join(ROOT, '..', 'index.html');
    else if (p === '/sim_real.js') f = path.join(ROOT, '..', 'sim_real.js');   // 物理内核也在上级目录
    else {
      const rel = p.replace(/^\/picker\//, '/');
      f = path.join(ROOT, rel === '/' ? 'index.html' : decodeURIComponent(rel).replace(/^\/+/, ''));
      if (!f.startsWith(ROOT)) return json(res, { ok: false, err: 'forbidden' }, 403);
    }
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory())
      return json(res, { ok: false, err: 'not found' }, 404);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  } catch (e) { json(res, { ok: false, err: String(e && e.message || e) }, 500); }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`物理摇奖桥接服务已启动  http://127.0.0.1:${PORT}/index.html`);
  console.log(`仿真脚本: ${SIM} ${fs.existsSync(SIM) ? '✓' : '✗ 缺失'}`);
  console.log(`预摇奖队列上限 ${KEEP}，接口: /api/status /api/draw /api/prize /api/bench /api/sim3d`);
  worker();
});

function json(res, o, code) {
  res.writeHead(code || 200, { 'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(o));
}
