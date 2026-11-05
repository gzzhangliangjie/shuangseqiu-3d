/* ============================================================
   上传前自检（零依赖，Node 标准库）
   用法： node miniprogram/preflight.js
   ------------------------------------------------------------
   在微信开发者工具点「上传」之前跑一遍，提前暴露这些坑：
     1) 产物是否比真源旧（改了 index.html 忘了 build）
     2) 主包体积是否超 4MB（小游戏硬限制）
     3) 语法错误（node --check 全量）
     4) 微信禁止的运行时动态代码（eval / new Function）
     5) 上传白名单之外的文件类型（会被静默丢弃，真机才报错）
     6) 工程配置（appid 是否还是占位、compileType 是否 game、竖屏）
     7) 运行期网络依赖（体验版自用无需配合法域名，但要知道有没有）
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MP = __dirname;
const ROOT = path.resolve(MP, '..');

let fail = 0, warn = 0;
const ok = m => console.log('  [ok]   ' + m);
const bad = m => { fail++; console.log('  [FAIL] ' + m); };
const wrn = m => { warn++; console.log('  [warn] ' + m); };
const head = m => console.log('\n' + m);

const read = p => fs.readFileSync(p, 'utf8');
const size = p => fs.statSync(p).size;
const kb = n => (n / 1024).toFixed(0) + ' KB';

/* ---------- 1. 必备文件 ---------- */
head('1. 工程结构');
const REQUIRED = [
  'game.js', 'game.json', 'project.config.json', 'adapter.js', 'hud.js', 'pages.js',
  'libs/three.js', 'libs/OrbitControls.js', 'libs/RoomEnvironment.js',
  'libs/ssq-data.js', 'libs/sim-real.js',
  'src/game-logic.js', 'src/simlog.js', 'src/analysis.js'
];
const missing = REQUIRED.filter(f => !fs.existsSync(path.join(MP, f)));
missing.length ? bad('缺少文件: ' + missing.join(', ')) : ok(REQUIRED.length + ' 个必备文件齐全');

/* ---------- 2. 产物新鲜度 ---------- */
head('2. 产物新鲜度（改 Web 真源后必须重跑 build.js）');
const FRESH = [
  ['libs/three.js', '_vendor/three.module.js'],
  ['libs/OrbitControls.js', '_vendor/controls/OrbitControls.js'],
  ['libs/RoomEnvironment.js', '_vendor/environments/RoomEnvironment.js'],
  ['libs/ssq-data.js', 'picker/data.js'],
  ['libs/sim-real.js', 'sim_real.js'],
  ['src/game-logic.js', 'index.html'],
  ['src/simlog.js', 'index.html'],
  ['src/analysis.js', 'picker/index.html']
];
let stale = 0;
for (const [out, src] of FRESH) {
  const po = path.join(MP, out), ps = path.join(ROOT, src);
  if (!fs.existsSync(po) || !fs.existsSync(ps)) { bad('对比失败: ' + out); continue; }
  if (fs.statSync(po).mtimeMs + 1000 < fs.statSync(ps).mtimeMs) {
    stale++; bad(out + ' 比真源 ' + src + ' 旧 → 运行 node miniprogram/build.js');
  }
}
if (!stale) ok('8 个产物均不早于真源');

/* ---------- 3. 体积 ---------- */
head('3. 主包体积（小游戏：主包 ≤ 4MB，主包+分包 ≤ 30MB）');
let total = 0;
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else { const s = size(p); total += s; files.push([path.relative(MP, p).replace(/\\/g, '/'), s]); }
  }
})(MP);
files.sort((a, b) => b[1] - a[1]);
const LIMIT = 4 * 1024 * 1024;
console.log('  合计 ' + kb(total) + ' / ' + kb(LIMIT) + '（占用 ' + (total / LIMIT * 100).toFixed(1) + '%）');
console.log('  最大的 5 个：');
files.slice(0, 5).forEach(([f, s]) => console.log('    ' + f.padEnd(34) + kb(s)));
total > LIMIT ? bad('主包超出 4MB 上限，必须分包') : ok('体积在限制内，无需分包');

/* ---------- 4. 上传白名单 ---------- */
head('4. 上传文件类型白名单');
const ALLOW = new Set(('png jpg jpeg gif svg js json cer obj dae fbx mtl stl 3ds mp3 pvr wav plist ttf fnt gz ccz m4a mp4 bmp atlas swf ani part proto bin sk mipmaps txt zip tt map ogg silk dbbin dbmv etc lmat lm ls lh lani lav lsani ltc aac astc br csv cur dat dds glb gltf ico ktx lmani lml pkm prefab scene skel wasm xml').split(' '));
const illegal = files.map(([f]) => f).filter(f => !ALLOW.has(f.split('.').pop().toLowerCase()));
illegal.length ? bad('白名单外文件（上传时会被丢弃）: ' + illegal.join(', ')) : ok('全部 ' + files.length + ' 个文件后缀均在上传白名单内');

/* ---------- 5. 语法 ---------- */
head('5. 语法检查（node --check）');
const jsFiles = files.map(([f]) => f).filter(f => f.endsWith('.js'));
let syntaxBad = 0;
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ['--check', path.join(MP, f)], { stdio: 'pipe' }); }
  catch (e) { syntaxBad++; bad(f + ' 语法错误: ' + String(e.stderr || e.message).split('\n')[0]); }
}
if (!syntaxBad) ok(jsFiles.length + ' 个 js 文件语法通过');

/* ---------- 6. 微信禁止的动态代码 ---------- */
head('6. 运行时动态代码（微信禁止 eval / new Function / 下载 JS 执行）');
const banned = [];
for (const f of jsFiles) {
  const s = read(path.join(MP, f));
  /* three.js 里的 Function( 是内部构造，非动态执行外部代码，单独排除 */
  if (f === 'libs/three.js') continue;
  if (/(^|[^\w$.])eval\s*\(/.test(s)) banned.push(f + ' → eval');
  if (/new\s+Function\s*\(/.test(s)) banned.push(f + ' → new Function');
}
banned.length ? bad('发现动态执行: ' + banned.join('; ')) : ok('未发现 eval / new Function');

/* ---------- 7. 工程配置 ---------- */
head('7. 工程配置');
let cfg = null;
try { cfg = JSON.parse(read(path.join(MP, 'project.config.json'))); }
catch (e) { bad('project.config.json 不是合法 JSON'); }
if (cfg) {
  cfg.compileType === 'game' ? ok('compileType = game') : bad('compileType = ' + cfg.compileType + '，应为 game');
  if (!cfg.appid || cfg.appid === 'touristappid') {
    wrn('appid 仍是占位 "' + cfg.appid + '"：游客模式仅能在开发者工具里跑，上传/真机预览前必须换成真实 AppID');
  } else if (!/^wx[0-9a-f]{16}$/.test(cfg.appid)) {
    wrn('appid "' + cfg.appid + '" 不符合 wx + 16 位十六进制的格式，确认是不是复制漏了');
  } else ok('appid = ' + cfg.appid);
  /* 一个邮箱只能注册一个小程序；AppID 与登录账号不匹配时，开发者工具会提示"无权限" */
  if (cfg.projectname && cfg.projectname.length > 40) wrn('projectname 过长（' + cfg.projectname.length + ' 字符）');
}
let gj = null;
try { gj = JSON.parse(read(path.join(MP, 'game.json'))); }
catch (e) { bad('game.json 不是合法 JSON'); }
if (gj) {
  const ORI = ['portrait', 'landscape', 'landscapeLeft', 'landscapeRight'];
  ORI.indexOf(gj.deviceOrientation) >= 0
    ? ok('deviceOrientation = ' + gj.deviceOrientation)
    : bad('deviceOrientation 非法: ' + gj.deviceOrientation + '（只能是 ' + ORI.join(' / ') + '）');
  if (gj.subpackages) wrn('配置了分包，注意单个独立分包 ≤ 4MB');
}

/* ---------- 8. 运行期网络 ---------- */
head('8. 运行期网络依赖（体验版自用无需配置合法域名）');
const adapter = fs.existsSync(path.join(MP, 'adapter.js')) ? read(path.join(MP, 'adapter.js')) : '';
if (/__SIM_REMOTE\s*=\s*false/.test(adapter)) ok('__SIM_REMOTE = false，默认纯本地，运行期零请求');
else wrn('__SIM_REMOTE 未明确关闭：联网需在后台配置 request 合法域名，否则真机会失败');

/* ---------- 9. 浏览器全局 vs adapter 垫片 ----------
   小游戏没有 DOM/BOM。Web 源码里每用一个浏览器全局，adapter.js 就必须垫一个，
   否则真机直接 ReferenceError（开发者工具里不一定复现得这么明显）。
   重构时最容易漏的就是这类「Web 能跑、小游戏白屏」的差异，所以单独列一项。 */
head('9. 浏览器全局是否都有 adapter 垫片');
const SHIM = fs.existsSync(path.join(MP, 'adapter.js')) ? read(path.join(MP, 'adapter.js')) : '';
const CANDIDATES = [
  'document', 'window', 'localStorage', 'sessionStorage', 'navigator', 'location',
  'requestAnimationFrame', 'requestIdleCallback', 'cancelAnimationFrame',
  'devicePixelRatio', 'innerWidth', 'innerHeight', 'addEventListener', 'matchMedia',
  'AudioContext', 'webkitAudioContext', 'OffscreenCanvas', 'createImageBitmap',
  'URL', 'Blob', 'atob', 'btoa', 'fetch', 'Image', 'XMLHttpRequest', 'FormData',
  'performance', 'visualViewport', 'screen', 'getComputedStyle', 'confirm', 'alert'
];
const unshimmed = [], guarded = [];
for (const f of ['src/game-logic.js', 'hud.js', 'pages.js', 'src/simlog.js']) {
  if (!fs.existsSync(path.join(MP, f))) continue;
  /* 去注释，避免把说明文字里的 API 名误判成真实调用 */
  const src = read(path.join(MP, f))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  for (const g of CANDIDATES) {
    const re = new RegExp('(^|[^\\w.$])' + g + '\\b');
    if (!re.test(src)) continue;
    const shimmed = SHIM.includes('GameGlobal.' + g) || new RegExp('GameGlobal\\[' + JSON.stringify(g)).test(SHIM);
    if (shimmed) continue;
    /* 裸调用但同行做过特性检测（window.xxx）→ 已有兜底分支，不算漏垫 */
    const lines = src.split('\n').filter(l => re.test(l));
    const allGuarded = lines.length > 0 && lines.every(l => new RegExp('window\\.' + g + '\\b').test(l));
    (allGuarded ? guarded : unshimmed).push(g + ' (' + f + ')');
  }
}
if (guarded.length) console.log('  已做特性检测（有兜底分支）: ' + [...new Set(guarded.map(s => s.split(' (')[0]))].join(', '));
if (!unshimmed.length) ok('其余浏览器全局均有垫片');
else {
  wrn('adapter 未垫片且未见保护: ' + [...new Set(unshimmed)].join(', '));
  console.log('         → 未保护的必须在 adapter.js 补垫片，否则真机 ReferenceError');
}

/* ---------- 10. wx API 与最低基础库 ---------- */
head('10. 使用的 wx API（据此设置后台「最低基础库版本」）');
const apiSet = {};
for (const f of jsFiles) {
  if (f.startsWith('libs/')) continue;
  const s = read(path.join(MP, f));
  (s.match(/wx\.[A-Za-z]+/g) || []).forEach(a => { apiSet[a] = 1; });
}
const apis = Object.keys(apiSet).sort();
console.log('  ' + apis.join(', '));
if (apiSet['wx.createWebAudioContext']) console.log('  注：createWebAudioContext 需基础库 ≥ 2.19.0（iOS 低版本可能只有 createInnerAudioContext）');
if (apiSet['wx.getPerformance']) console.log('  注：getPerformance 需基础库 ≥ 2.11.0');
ok(apis.length + ' 个 API，均为基础库 2.19+ 能力，建议后台最低基础库设为 2.19.0 及以上');

/* ---------- 11. 上传压缩（包体省 40%，但工具内置压缩器不认新语法） ---------- */
head('11. 上传压缩（minified）');
/* 被 packOptions.ignore 排除的文件不会进包，后面的语法扫描也要跳过它们
   （否则会把本脚本自己的正则字面量当成"危险语法"报出来） */
const IG = ((cfg && cfg.packOptions && cfg.packOptions.ignore) || []).map(x => (x && x.value) || x);
if (cfg) {
  const st = cfg.setting || {};
  st.minified ? ok('minified = true：上传时自动压缩脚本')
              : wrn('minified = false：上传包会大 40% 左右（本项目实测 1689 → 约 1000 KB）');
  st.uploadWithSourceMap ? ok('uploadWithSourceMap = true：压缩后报错仍能映射回源码行（.map 不计入包体）')
                         : wrn('uploadWithSourceMap 未开：压缩后真机报错只剩混淆位置，难定位');
  /* es6 与 enhance 必须同值，否则同一份代码在不同机器上编出不同结果 */
  const es6 = !!st.es6, en = !!st.enhance;
  es6 === en ? ok('es6 / enhance 同值（' + es6 + '）')
             : bad('es6=' + es6 + ' 与 enhance=' + en + ' 不一致：两个开关是配套的，必须同值');
  const miss = ['build.js', 'preflight.js'].filter(f => IG.indexOf(f) < 0);
  miss.length ? wrn('packOptions.ignore 未排除: ' + miss.join(', ') + '（Node 专用代码不该上传）')
              : ok('构建脚本已排除在上传之外');
}

/* 微信内置压缩器是老版 uglify，认不了 ES2020+ 语法。注释里的不算（压缩前先剥注释），
   所以先剥注释再扫——否则 three.js 注释里那两个 "??" 会误报。 */
const ES2020 = [
  ['可选链 ?.', /[A-Za-z0-9_$)\]]\?\.[A-Za-z_$[(]/],
  ['空值合并 ??', /\?\?[^?]/],
  ['逻辑赋值 ||= &&= ??=', /\|\|=|&&=|\?\?=/],
  ['数字分隔符 1_000', /\b\d+_\d+/],
];
const stripCmt = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const risky = [];
let scanned = 0;
for (const f of jsFiles) {
  if (IG.indexOf(f) >= 0) continue;
  scanned++;
  const s = stripCmt(read(path.join(MP, f)));
  for (const [name, re] of ES2020) if (re.test(s)) risky.push(name + ' @ ' + f);
}
if (!risky.length) ok('包内 ' + scanned + ' 个待上传 js 均未使用压缩器不支持的语法');
else {
  wrn('发现压缩器可能不支持的语法：' + risky.join(' | '));
  console.log('         → 改写法，或把 minified 设回 false（否则上传/预览报 Unexpected token）');
}

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(52));
if (fail) {
  console.log('自检未通过：' + fail + ' 项失败，' + warn + ' 项警告 —— 修完再上传');
  process.exit(1);
}
console.log('自检通过：0 失败，' + warn + ' 项警告' + (warn ? '（警告不影响本地跑，上传前确认一下）' : ''));
console.log('下一步：微信开发者工具导入 miniprogram/ → 预览（真机）→ 上传');
