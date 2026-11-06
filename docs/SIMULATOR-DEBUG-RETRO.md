# 微信小游戏模拟器调试复盘 · 双色球 3D 摇奖（shuangseqiu-3d-sim）

> **状态**：2026-11-06 已闭环，用户亲手验收（「完美了，3D 效果没问题，音效都有了」）。
> **一句话结论**：模拟器黑屏 / 点不动 / 3D 不显示 / 红字 `__name__`，**真根因只有一个**——
> `adapter.js` 的 `putGlobal()` 无条件覆盖了基础库 3.17+ 已有的全局，导致运行时挂起；
> 其余全是这条链的伴生现象或被证伪的弯路。

---

## 0. TL;DR

| 项 | 结论 |
|---|---|
| 真根因 | `putGlobal()` 无条件覆盖基础库全局（`window`/`self`/`performance`/`rAF`/`AudioContext`…）→ 入口同步代码跑完后不再调度任何定时器/rAF → 静态首帧、按钮无反馈、红字 `__name__` |
| 修复 | `putGlobal` 开头 `if (k !== 'document' && k in GameGlobal && GameGlobal[k] != null) return;`（`document` 例外放行，保留 DOM 垫片） |
| 3D 不显示（修复副作用） | 停覆盖 `window` 后，`Platform.getViewport()` 小游戏分支读占位 `window.innerWidth(=1)` → 画布 3×3。改成读 `info.screenWidth/screenHeight/pixelRatio` |
| 已被证伪 | 换基础库版本、给本机 `.wxvpkg` 打补丁、往事件层加四套通道、甩锅工具/MAIN 进程/热重载竞态 |
| 验收 | 运行时恢复（主循环在跑、按钮可点）、3D 摇奖画面正常、音效齐备、红字随根因消除消失 |
| 方法论 | **`_boot_smoke.js` / `_afx_smoke.js` 全绿 ≠ 模拟器能跑**（Node mock 假绿）；一切结论必须有同步文件日志或用户可见画面支撑 |

---

## 1. 背景

### 1.1 项目与工程结构
- 标准小游戏结构：`game.js` / `game.json` / `project.config.json` / `project.private.config.json` + `src/`、`libs/`、`hud.js`、`pages.js`、`adapter.js`、`build.js`。
- **真源是 `index.html`**：`build.js` 把 `index.html` 里的内联模块（`AudioFX`、`game-logic`、`Platform` 等）抽取 + 注入构建成 `miniprogram/` 下的产物（`src/game-logic.js`、`libs/three.js` 等）。
  - ⚠️ **改真源后必须 `node miniprogram/build.js` 同步产物**，否则 `preflight.js` 报「产物比真源旧」。这是踩过的硬规则。
- 小游戏没有 `app.json`（那是小程序才有），诊断时塞 `app.json` 会让 IDE 误判工程类型，已删除。

### 1.2 工具链版本（本机环境）
- 微信开发者工具 `2.02.2609240`。
- 基础库 `3.17.6`（本机 `WeappVendor` 唯一装上的版本；重装/改签名会被工具按 172 字符签名校验重下原包覆盖）。
- 真机历史上画面一直正常，音效才是原始目标。

### 1.3 目标与验收
1. 模拟器里能看画面（选号页完整、3D 摇奖显示）。
2. 按钮可点、有反馈。
3. 真机音效齐备。
4. 红字 `__name__` 不再复现。

---

## 2. 调试时间线（判断 → 实证 → 结论）

> 这一节如实记录「当时以为是什么、实测发现了什么、最后定性是什么」。所有「已证伪」的归因都在 §4 汇总。

| 阶段 | 当时判断 | 实证 / 转折 | 最终定性 |
|---|---|---|---|
| **真机音效修复**（链路起点） | 真机全程无声，以为是音量/音色 | 三条只有真机才暴露的行为：`connect()` 返回 `undefined` 导致旧代码 `dead=true` 永久静音；一次性源不被 JS 持有被 GC；iOS `resume()` 须在手势里 | 真机专属，已修（详见 `AUDIO-DESIGN.md`） |
| **模拟器黑屏/画面不全** | 基础库 3.17.6 只读全局导致 adapter 崩 | `putGlobal()` 三级兜底；three 导数补丁（WebGL1 无 `OES_standard_derivatives`）；HUD 离屏画布 `SRGBColorSpace` 上传失败 | 并入 2D 合成架构解决 |
| **2D 合成架构**（突破） | 放弃「主画布 WebGL + UI 纹理二次 render / 原生 blit」 | 改成上屏 2D + 离屏 WebGL，每帧 `drawImage` 合成 | **用户确认「巨大的进步」**，选号页完整显示 |
| **页面正常但点击无反馈** | 以为是主循环停摆 | `regions=0`（`__ui` 赋值在 `open('tool')` 之后）；触摸形状兼容；280ms 兜底；`flashTap` | 根因是 **运行时挂起**（见 §3），此阶段只补了可见反馈 |
| **红字 `__name__`（15:28 起）** | 以为是工具 + 3.17.6 组合 bug / `patchCanvas` 吞注册 | 解包 4 个版本 `WAGame.js`，句 `"game"===i.__name__` 一字不差 | **错**，是项目代码触发，见 §3 |
| **切基础库 3.15.3（15:56）** | 换版本能消红字 | 用户重启后红字依旧 | **无效**，作废 |
| **打本机 `.wxvpkg` 补丁（16:00）** | 本地改 `WAGame.js` 判空 | 工具启动校验失败重下原包覆盖（172 字符签名伪造不了） | **无效**，作废 |
| **加 wx.onMouse* + DOM 兜底（16:16）** | 零事件 = 缺通道 | 实测零事件的根因是运行时挂起，不是通道缺失 | 通道保留但非根因 |
| **方向纠正（16:23）** | 甩锅工具 | 用户反问「全中国这么多人做小游戏，他们怎么模拟的」成立 | 是我们这边的工程/调试方式问题 |
| **首次运行期数据（16:33–16:48）** | 多轮凭基础库臆测加通道 | `nativeAdd=true`（推翻「Canvas 无原生 addEventListener」）；`tick=0/frames=0` 但 `errors=[]` | 方法论错了：全靠 Node mock 自证 |
| **刷盘时机排除（17:06–17:12）** | 以为是 storage 刷盘延迟假象 | 同步文件日志只有 3 行，`interval registered` 后再无一行 | 运行时确实不再调度异步任务 |
| **跳过二分定位（17:15–17:38）** | —— | 跳过 `adapter.js` 心跳恢复 → 跳过事件段仍挂 → 跳过全局垫片恢复 → `putGlobal` 即罪魁 | **真根因锁定**（§3） |
| **3D 不显示回归（17:35）** | 停覆盖 `window` 后 3D 黑 | 日志 `winW=1 winH=1 glc=3x3` | `getViewport()` 读占位 `window`（§3.4） |
| **用户验收（17:50）** | —— | 「完美了，3D 效果没问题，音效都有了」 | 闭环 |

---

## 3. 真根因（重点）

### 3.1 现象
- 模拟器：编译无报错、界面能显示，但**点按钮没反应**；启动时弹红字
  `Cannot read properties of undefined (reading '__name__')`，栈全在 `WAGame.js` / `WAGameSubContext.js` 的 `publish → subscribeHandler`，**没有一行项目代码**。
- 主循环零帧（`tick=0`、`frames=0`），`errors=[]`，`onError/frameErr` 为空。
- 停覆盖 `window` 后 3D 画布被设成 3×3 → 3D 全黑。

### 3.2 定位手法（这次真正有效，可复用）
1. **同步文件日志**（最可靠，无刷盘延迟）：`game.js` 用 `wx.getFileSystemManager().writeFileSync/appendFileSync` 写到
   `wx.env.USER_DATA_PATH`(=`http://usr`) 下的 `ssq-runtime.log`。
   判据：`BOOT + entry + interval registered` 之后若没有任何 `interval#` / `beat#` 行，就是运行时不再调度异步任务。
2. **逐模块跳过二分**：在 `game.js` 加 `__ssqSkip`（跳过指定模块），用文件日志有没有持续心跳做判据：

| 实验 | 结果 |
|---|---|
| 跳过全部 6 个业务模块 | 心跳全活 → 不是工具/环境 |
| 只加载 `adapter.js` | 仍挂 → 罪魁在 adapter |
| adapter 跳过事件注册段 | 仍挂 → 不在事件层 |
| adapter 跳过全局垫片段 | 心跳全活 → 罪魁在 `putGlobal` |
| `putGlobal` 加「已有全局不覆盖」 | 心跳恢复，但 `document` 被跳过 → `getElementById is not a function` |
| **`document` 例外放行** | 全绿 |

### 3.3 根因
`putGlobal(k, v)` 无条件 `GameGlobal[k] = v`，覆盖了基础库 3.17+ 已有的全局：
`window` / `self` / `innerWidth` / `innerHeight` / `navigator` / `location` /
`addEventListener` / `removeEventListener` / `performance` / `requestAnimationFrame` /
`cancelAnimationFrame` / `AudioContext`。

这些全局与基础库的**帧循环、定时器、事件派发共用内部状态**；覆盖后入口同步代码正常跑完，
之后不再调度任何 `setTimeout/setInterval/rAF` → 静态首帧、按钮无反馈。
红字 `__name__` 是这条链的**伴生现象**（运行时挂起导致 App 销毁流程卡住，触发基础库事件桥的空引用），不是独立的工具缺陷。

> 用户「理论上设备能跑的代码模拟器也可以、现状非常反常」的判断是对的；之前甩锅给工具/基础库版本/MAIN 进程全错。

### 3.4 修复
`adapter.js` 的 `putGlobal` 开头加：
```js
if (k !== 'document' && k in GameGlobal && GameGlobal[k] != null) return;
```
- 基础库没有的（`canvas` / `devicePixelRatio` / `localStorage` / `fetch` / `confirm`）仍由垫片补上。
- `document` 必须保留我们的 DOM 垫片（基础库自带的缺 `getElementById` / `createElement`）。

**修复后立刻暴露的 3D 回归**（同一处修复的副作用，必须一起改）：
不再覆盖 `window` 后，`Platform.getViewport()` 的小游戏分支读 `window.innerWidth/innerHeight`——
基础库 `window` 是占位对象、恒为 **1** → `renderer.setSize(1,1)` → `__glCanvas` 仅 **3×3** → 3D 全黑。
改成直接返回 `info.screenWidth / screenHeight / pixelRatio`；**`index.html` 真源与 `miniprogram/src/game-logic.js` 产物同步改**，并重跑 `node miniprogram/build.js`。

修复后实测：`errors=[]`、`alive` 五档全跑、`tick/beat` 持续、`frames` 持续递增、`uiRegions=58`、
`hud=true`、`glc=1462x3165`、`renderer.info.render.calls=271`（每帧 271 次 3D 绘制，铁证 3D 在画）。

---

## 4. 已证伪清单（别再试，省时间）

| 试过 | 结论 / 为什么错 |
|---|---|
| 换基础库 3.15.3 / 3.8.12 / 2.33.0 | 无效。`WAGame.js` 的 `subContextReady` 里 `"game"===i.__name__` 未判空，四个版本一字不差 |
| 给本机 `.wxvpkg` 打判空补丁 | 无效。`cfg.json` 的 md5 是 **172 字符签名**，工具启动校验失败就重下原包覆盖 |
| CLI `agent tool`（screenshot/console/refresh） | 不通。硬读 `app.json`（小游戏没有）→ 后报 `agent compile mode is disabled`（微信后台按 appid 灰度，本地开不了）。补的文件已删除 |
| `useApiHook` 开关 | 实测无效（保留 false，仅少一层 hook 干扰） |
| 把 `__name__` 归因到 `patchCanvas` 吞掉注册 | 错。栈里没有一行项目代码 |
| 「小游戏 Canvas 没有原生 addEventListener，11 个 mouse/pointer 通道是死代码」 | **错**。实测 `nativeAdd = true`，`_boot_smoke.js` 的 mock 与真实环境不一致（假绿） |
| 「反复热重载造成 subContextReady 竞态」 | 证据不足，每次编译都 `waiting for previous app to dispose`，是工具常态 |
| 「`tick=0` 只是 storage 刷盘延迟造成的假象」 | **错**。同步文件日志里连 100ms 定时器行都没有，运行时确实不再调度 |
| 往事件层加 native mouse/pointer/DOM/wx.onMouse 四套通道 | 无效。零事件的原因是运行时挂起，不是通道缺失 |
| 把红字/挂起归因于「工具 2.02 + 基础库 3.17.6 自身缺陷」或「4 个 MAIN 进程残留」 | **错**。跳过 `adapter.js` 后运行时立刻恢复，证明是项目代码；换基础库、清进程都没用 |

---

## 5. 有效修复清单（别回退，用户已确认）

| 改动 | 位置 | 解决什么 | 确认 |
|---|---|---|---|
| `putGlobal` 不覆盖基础库已有全局、仅 `document` 例外 | `miniprogram/adapter.js` | 运行时挂起 / 主循环零帧 / 按钮无反馈 / 红字伴生 | ✅ 验收 |
| `Platform.getViewport()` 小游戏分支用 `info.screenWidth/Height/pixelRatio` | `index.html` 真源 + `miniprogram/src/game-logic.js` | 3D 画布 3×3 全黑 | ✅ 验收（3D 正常） |
| 2D 合成架构（上屏 2D + 离屏 WebGL，每帧 drawImage 合成） | `adapter.js` / `build.js` / `hud.js` | 模拟器选号页完整显示 | ✅ 用户「巨大的进步」 |
| three.js 导数补丁（`geometryRoughness` 替换） | `build.js` 注入 `libs/three.js` | 模拟器 WebGL1 无 derivatives 扩展 → 3D 材质全不绘制 | ✅ 验收 |
| `__ui` 赋值提到 `open('tool')` 之前 | `pages.js` | 首屏 regions 0→58，点击区缺失 | ✅ 验收（按钮可点） |
| 触摸形状兼容 + 280ms 兜底 + `flashTap` | `adapter.js` / `hud.js` | 点击坐标/手势兼容、主循环停摆时仍有可见反馈 | ✅ 验收 |
| 真机音效修复（connect 拆句 / 持有源 / 能力检测 / 异常不置 dead / 解锁） | `index.html` 的 `AudioFX` | 真机全程无声 | ✅ 验收（音效都有了） |
| `wx.onMouse*` 通道 + DOM 层 mouse 兜底 | `adapter.js` | 事件层冗余通道（非根因，但保留无害） | — |

---

## 6. 诊断通道（如何不靠用户截图验证）

微信开发者工具**不把游戏 console 落盘**，Problems 面板也不落盘，CLI 自动化对小游戏不通。
以下两条通道是本次沉淀的「自己读数据」手段：

### 6.1 同步文件日志（最可靠，无刷盘延迟）
`game.js` 常驻 `line()`：`BOOT` / `entry(uid)` / `interval registered` / `interval#n` / `beat#n`
（后者带 `tick`/`frames`/`ui`/`regions`/`hud`/`fatalErr`/`uiErr` 和 diag 摘要，500ms 一次）。

落盘路径：
```
%LOCALAPPDATA%/微信开发者工具/User Data/<uid>/WeappSimulator/WeappFileSystem/<openid>/<appid>/usr/ssq-runtime.log
```
**判据**：`BOOT + entry + interval registered` 之后若没有任何 `interval#` / `beat#` 行，就是运行时不再调度异步任务。

### 6.2 storage 自检（补充）
`wx.setStorageSync('__ssq_boot' / '__ssq_diag', …)` 落到
`.../WeappSimulator/WeappStorage/storage_*.json`，结构 `{"0": {...}, "2": {}}`，
`"0"` 是主域、**一律读 `"0"`**。刷盘约 10s 延迟且只在启动期刷一次，单独看分不清「回调没跑」和「跑了没落盘」，必须与文件日志交叉验证。

### 6.3 判读顺序
先看文件日志有没有持续心跳 → `steps` 断没断在 begin → `errors`/`onError`/`frameErr`
→ `env` → `asyncTimeout`/`rafFired` → `tick`/`frames` → `diag.start/byChannel` → 坐标与 regions。

---

## 7. 方法论教训（最重要）

1. **`_boot_smoke.js` / `_afx_smoke.js` 全绿 ≠ 模拟器能跑。**
   它们是 Node mock 自证，mock 里假定的 `GameGlobal`、canvas、事件 API 多次与真实基础库不符（假绿）。
   任何「修好了」的结论必须有**运行期数据（优先同步文件日志）**或**用户可见画面**支撑。
2. **最有效的定位手法是「同步文件日志 + 逐模块跳过二分」**，比读基础库源码、换版本、猜工具进程有用得多。
3. **别再把「工具坏了」当结论收工。** 跳过 `adapter.js` 后运行时立刻恢复，证明是项目代码；
   用户「设备能跑的代码模拟器也能跑」的判断是正确前提。
4. **覆盖全局时掩盖掉的错误，会在停止覆盖后逐个暴露**；修完一处要继续走查所有依赖这些全局的尺寸/环境读取，别只修一处就收工（3D 3×3 就是例子）。
5. **改真源后必须重跑 `build.js` 同步产物**，否则 `preflight` 报「产物比真源旧」。

---

## 8. 小游戏模拟器工具链特有坑

- **改 `miniprogram/` 里任何文件都会自动触发整包重编译**：日志 `compile onFileChange` → `simulator app compile` → `AppCreated`。诊断时一次改完，然后**别再动文件**，静默观察 ≥20s 再读数据。
- `simulator_refresh` / `cleanAllSimulatorCache` 只重置运行时，**不重编译 JS**；强制重编译要 Ctrl+B 或自动文件监视。
- `cleanAll` 会清空项目文件列表 → 之后要 `project_import` 才能恢复，否则窗口是空壳（纯黑）。
- 工具日志 `.../WeappLog/logs/*.log` 能查 compile/AppCreated/vendor 下载，**不含游戏 console**。
- `wx.showToast`/`showModal` 在模拟器会把画面遮黑，不能当诊断输出。
- **唯一验证过可靠的可见通道**：改 3D `scene.background` 的颜色（左上角会露出色块），用来判断编译是否读到了新文件。
- `automation_evaluate` 跑在**子域上下文**，`GameGlobal` 不是主游戏全局，不能用来诊断主域状态。
- `.wxvpkg` 是标准未加密 **wxapkg**，Python `struct` 可解（`0xBE` 头 → `>III` 索引长/体长 → `0xED` → `>I` 文件数），`/WAGame.js` 明文压缩。但**改它没用**（签名校验重下）。

---

## 9. 最终基线 / 收工状态

**已确认有效的基线（别回退、别再为它动架构/事件通道/基础库版本）**：
- `putGlobal` 不覆盖基础库已有全局、仅 `document` 例外。
- `Platform.getViewport()` 小游戏分支用 `info.screenWidth/Height/pixelRatio`。
- 2D 合成架构 + three 导数补丁 + `__ui` 赋值顺序 + 触摸形状兼容 + 音效真机修复 + mouse/DOM 兜底通道。
- 诊断探针（`__ssq_boot` / `__ssq_diag` / 文件日志 / storage）全部常驻，日后复现问题直接读
  `WeappFileSystem/.../usr/ssq-runtime.log` 和 `WeappStorage/storage_*.json` 的 `"0"` 区即可。

**收工**：模拟器完整流程闭环（运行时恢复、3D 摇奖画面正常、音效齐备、红字随根因消除消失）。
后续新需求从这条已确认的基线继续，不要翻旧账、不要重试 §4 已证伪的路线。
