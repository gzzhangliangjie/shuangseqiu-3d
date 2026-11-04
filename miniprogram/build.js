/* ============================================================
   微信小游戏代码包构建脚本（零第三方依赖，Node 标准库即可）
   用法： node miniprogram/build.js
   ------------------------------------------------------------
   小游戏环境不支持 importmap / 裸模块说明符 / ES module 包加载，
   这里把 Web 端「同一份源码」机械转换成 CommonJS：

     _vendor/three.module.js                    -> libs/three.js
     _vendor/controls/OrbitControls.js          -> libs/OrbitControls.js
     _vendor/environments/RoomEnvironment.js    -> libs/RoomEnvironment.js
     index.html 的 <script type="module">       -> src/game-logic.js

   index.html 与 _vendor/ 是唯一真源；Web 端改完重跑本脚本即可同步。
   两处小游戏专属注入（Web 源码不动）：
     1) WebGLRenderer 显式传入上屏 canvas（小游戏无法由 three 自建上屏画布）
     2) 主循环渲染后叠加 HUD 正交层
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
  const rendererLine = 'const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });';
  must(s.includes(rendererLine), 'WebGLRenderer 构造语句未匹配（index.html 改过？同步 build.js）');
  s = s.replace(rendererLine,
    'const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, canvas: GameGlobal.canvas });');

  /* 注入 2：每帧 3D 渲染后叠加 HUD
     按「行」匹配，避免 index.html 用 CRLF 时 \n} 对不上。 */
  const renderRe = /^([ \t]*)renderer\.render\(scene, camera\);([ \t\r]*)$/m;
  must(renderRe.test(s), '主循环 renderer.render 未匹配');
  s = s.replace(renderRe, (line, indent, trail) =>
    indent + 'renderer.render(scene, camera);' + trail + '\n' +
    indent + "if (typeof GameGlobal !== 'undefined' && GameGlobal.__hud) GameGlobal.__hud.draw(renderer);");

  write(path.join(SRC, 'game-logic.js'), AUTO + s);
}

console.log('完成。产物：miniprogram/libs/、miniprogram/src/');
