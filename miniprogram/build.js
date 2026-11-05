/* ============================================================
   微信小游戏代码包构建脚本（零第三方依赖，Node 标准库即可）
   用法： node miniprogram/build.js
   ------------------------------------------------------------
   小游戏环境不支持 importmap / 裸模块说明符 / ES module 包加载，
   这里把 Web 端「同一份源码」机械转换成 CommonJS：

     _vendor/three.module.js                    -> libs/three.js
     _vendor/controls/OrbitControls.js          -> libs/OrbitControls.js
     _vendor/environments/RoomEnvironment.js    -> libs/RoomEnvironment.js
     picker/data.js                             -> libs/ssq-data.js
     sim_real.js (去掉 CLI 段)                  -> libs/sim-real.js
     index.html 的 <script type="module">       -> src/game-logic.js
     index.html 尾部的 SimLog classic script   -> src/simlog.js
     picker/index.html 的纯计算段              -> src/analysis.js

   index.html / picker/ / sim_real.js / _vendor/ 是唯一真源；Web 端改完重跑即可同步。
   三处小游戏专属注入（Web 源码不动）：
     1) WebGLRenderer 显式传入上屏 canvas（小游戏无法由 three 自建上屏画布）
     2) 主循环按当前页面决定是否渲 3D（选号/记录页跳过，省 GPU）
     3) 渲染后统一叠加 UI 层
   SimLog 另注入 clear() 与可配置的远程地址，供小游戏 UI 直接调用。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(ROOT, '_vendor');
const LIBS = path.join(__dirname, 'libs');
const SRC = path.join(__dirname, 'src');
[LIBS, SRC].forEach(d => fs.mkdirSync(d, { recursive: true }));

const read = p => fs.readFileSync(p, 'utf8');
const must = (cond, msg) => { if (!cond) throw new Error('[build] ' + msg); };

function write(p, s) {
  fs.writeFileSync(p, s, 'utf8');
  const rel = path.relative(ROOT, p).replace(/\\/g, '/');
  console.log('  ' + rel.padEnd(38) + (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB');
}

const AUTO = '/* 自动生成，请勿手改。真源：_vendor/ + index.html；重新生成：node miniprogram/build.js */\n';

console.log('构建微信小游戏代码包 ...');

/* ---------- 1. three.module.js：末尾单行 export 列表 -> module.exports ---------- */
{
  const s = read(path.join(VENDOR, 'three.module.js'));
  const marker = '\nexport { ';
  const i = s.lastIndexOf(marker);
  must(i > 0, 'three.module.js 末尾 export 列表未找到（three 版本结构变了？）');
  const body = s.slice(0, i);
  const list = s.slice(i + marker.length).replace(/\s*\};\s*$/, '');
  must(list.length > 100, 'export 列表异常短');
  must(!/^\s*import\s/m.test(body), 'three.module.js 出现未预期的 import');
  write(path.join(LIBS, 'three.js'), AUTO + body + '\nmodule.exports = { ' + list + ' };\n');
}

/* ---------- 2. addons：import {..} from 'three' -> require('./three.js') ---------- */
function addon(srcRel, outName, exportName) {
  let s = read(path.join(VENDOR, srcRel));

  const importRe = /^import \{([\s\S]*?)\} from 'three';/m;
  must(importRe.test(s), srcRel + ' 的 import 块未匹配');
  s = s.replace(importRe, (_, names) => `const {${names}} = require('./three.js');`);

  const exportRe = new RegExp('^export \\{ ' + exportName + ' \\};', 'm');
  must(exportRe.test(s), srcRel + ' 的 export 语句未匹配');
  s = s.replace(exportRe, `module.exports = { ${exportName} };`);

  must(!/^\s*(import|export)\s/m.test(s), srcRel + ' 仍有残留 import/export');
  write(path.join(LIBS, outName), AUTO + s);
}
addon('controls/OrbitControls.js', 'OrbitControls.js', 'OrbitControls');
addon('environments/RoomEnvironment.js', 'RoomEnvironment.js', 'RoomEnvironment');

/* ---------- 3. index.html 的 module 主体 -> src/game-logic.js ---------- */
{
  const html = read(path.join(ROOT, 'index.html'));
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  must(m, 'index.html 里未找到 <script type="module">');
  let s = m[1];

  const imports = [
    [/^import \* as THREE from 'three';/m,
      "const THREE = require('../libs/three.js');"],
    [/^import \{ OrbitControls \} from 'three\/addons\/controls\/OrbitControls\.js';/m,
      "const { OrbitControls } = require('../libs/OrbitControls.js');"],
    [/^import \{ RoomEnvironment \} from 'three\/addons\/environments\/RoomEnvironment\.js';/m,
      "const { RoomEnvironment } = require('../libs/RoomEnvironment.js');"]
  ];
  for (const [re, to] of imports) {
    must(re.test(s), 'module import 未匹配: ' + re);
    s = s.replace(re, to);
  }
  must(!/^\s*import\s/m.test(s), 'module 主体仍有残留 import');

  /* 注入 1：小游戏必须显式传上屏 canvas */
  const rendererLine = 'const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });';
  must(s.includes(rendererLine), 'WebGLRenderer 构造语句未匹配（index.html 改过？同步 build.js）');
  s = s.replace(rendererLine,
    'const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, canvas: GameGlobal.canvas });');

  /* 注入 2：3D 只在开奖页渲染（选号/记录页是全屏 UI，跳过 3D 省 GPU），
     之后统一交给 __ui 叠加 UI 层。按「行」匹配，避免 CRLF 对不上。 */
  const renderRe = /^([ \t]*)renderer\.render\(scene, camera\);([ \t\r]*)$/m;
  must(renderRe.test(s), '主循环 renderer.render 未匹配');
  s = s.replace(renderRe, (line, indent, trail) =>
    indent + "if (!GameGlobal.__ui || GameGlobal.__ui.isDrawPage()) {" + trail + '\n' +
    indent + '  renderer.render(scene, camera);' + trail + '\n' +
    indent + '}' + trail + '\n' +
    indent + 'if (GameGlobal.__ui) GameGlobal.__ui.draw(renderer);');

  write(path.join(SRC, 'game-logic.js'), AUTO + s);
}

/* ---------- 4. 历史开奖数据 -> CommonJS（Web / 小游戏同一份 2083 期） ---------- */
{
  const s = read(path.join(ROOT, 'picker/data.js'));
  const m = s.match(/window\.SSQ_DATA\s*=\s*(\[[\s\S]*?\])\s*;/);
  must(m, 'picker/data.js 的 window.SSQ_DATA 数组未匹配');
  let rows;
  try { rows = JSON.parse(m[1]); } catch (e) { must(false, 'data.js 不是合法数组: ' + e.message); }
  must(rows.length > 1000, 'data.js 期数异常: ' + rows.length);
  write(path.join(LIBS, 'ssq-data.js'),
    AUTO + 'const DATA = ' + m[1] + ';\n' +
    "if (typeof window !== 'undefined') window.SSQ_DATA = DATA;\n" +
    "if (typeof GameGlobal !== 'undefined') GameGlobal.SSQ_DATA = DATA;\n" +
    'module.exports = DATA;\n');
  console.log('  (历史开奖 ' + rows.length + ' 期，与 Web 同源)');
}

/* ---------- 5. 物理内核 sim_real.js -> CommonJS（去掉 CLI 段） ---------- */
{
  let s = read(path.join(ROOT, 'sim_real.js'));
  const cli = s.indexOf('/* ---------- CLI');
  must(cli > 0, 'sim_real.js 的 CLI 段标记未找到');
  s = s.slice(0, cli);
  must(/module\.exports\s*=\s*SSQ/.test(s), 'sim_real.js 的 module.exports 未找到');
  write(path.join(LIBS, 'sim-real.js'), AUTO + s);
}

/* ---------- 6. picker 选号算法 -> src/analysis.js ----------
   抽取 picker/index.html 的纯计算段（统计/权重/采样/特征/约束/评分/生成），
   包成 createAnalysis(D)。Web 源码不动，两端共用同一套算法。 */
{
  const p = read(path.join(ROOT, 'picker/index.html'));
  const A = '/* ---------- 统计 ---------- */';
  const B = '/* ---------- 渲染：走势图 ---------- */';
  const ia = p.indexOf(A), ib = p.indexOf(B);
  must(ia > 0 && ib > ia, 'picker 纯计算段边界未匹配');
  let calc = p.slice(ia, ib);
  /* cfg() 读 DOM 控件，小游戏没有；generate 只用 opt.cfg，这里留空实现 */
  calc = calc.replace(/\nfunction cfg\(\)\{[\s\S]*?\n\}/, '\nfunction cfg(){ return {}; }');
  must(!/getElementById/.test(calc), '纯计算段仍残留 DOM 依赖（cfg 替换失败？）');

  const pm = p.match(/var AWARD=\{[\s\S]*?\nfunction prizeOf\(pick,d\)\{[\s\S]*?\n\}/);
  must(pm, 'prizeOf / AWARD / LVN 段未匹配');

  const body =
    "'use strict';\n" +
    'function createAnalysis(input) {\n' +
    '  var D = input.slice().sort(function(a,b){return a[0]-b[0];});\n' +
    '  var N = D.length, LAST = D[N-1];\n' +
    calc + '\n' + pm[0] + '\n' +
    '  buildDist();   /* Web 版在 IIFE 末尾调用，这里打包时补上 */\n' +
    '  return { D:D, N:N, LAST:LAST, freqR:freqR, freqB:freqB, missR:missR, missB:missB,\n' +
    '    dist:dist, buildWeights:buildWeights, sampleRed:sampleRed, sampleBlue:sampleBlue,\n' +
    '    feat:feat, pass:pass, score:score, generate:generate, prizeOf:prizeOf,\n' +
    '    AWARD:AWARD, LVN:LVN, consecGroups:consecGroups, acValue:acValue, P:P };\n' +
    '}\nmodule.exports = { createAnalysis: createAnalysis };\n';
  write(path.join(SRC, 'analysis.js'), AUTO + body);
}

/* ---------- 7. SimLog（3D 开奖记录 + 8 项形态评估）-> src/simlog.js ----------
   index.html 尾部 classic script，自带 window.SimLog / snapshot / 持久化。
   小游戏里靠 adapter 的伪 DOM + wx storage，逻辑与 Web 完全一致。 */
{
  const html = read(path.join(ROOT, 'index.html'));
  const at = html.indexOf("var KEY = 'ssq3d_sim_results_v1'");
  must(at > 0, 'SimLog 标记未找到');
  const st = html.lastIndexOf('<script>', at);
  const en = html.indexOf('</script>', at);
  must(st > 0 && en > st, 'SimLog script 边界未匹配');
  let body = html.slice(st + '<script>'.length, en);
  must(/window\.SimLog\s*=/.test(body), 'SimLog 公开 API 未找到');
  /* 构建期注入：Web 版清空靠 DOM 按钮 + confirm，小游戏 UI 需要直接调用。
     Web 源码不变，只在小游戏产物里多一个 clear()。 */
  const snap = '    snapshot: function () { return list; }';
  must(body.includes(snap), 'SimLog.snapshot 未找到（无法注入 clear）');
  body = body.replace(snap,
    snap + ',\n    clear: function () { list = []; render(); save(); remoteSave(); }');
  /* 远程地址改成可配置（adapter 的 __SIM_BASE），便于连局域网 PC 服务 */
  const apiRe = /var API = [^\r\n]+/;
  must(apiRe.test(body), 'SimLog API 常量未找到');
  body = body.replace(apiRe,
    "var API = (typeof GameGlobal !== 'undefined' && GameGlobal.__SIM_BASE ? GameGlobal.__SIM_BASE : 'http://127.0.0.1:8731') + '/api/sim3d';");
  write(path.join(SRC, 'simlog.js'), AUTO + body);
}

console.log('完成。产物：miniprogram/libs/、miniprogram/src/');
