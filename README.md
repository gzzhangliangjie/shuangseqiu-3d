# 双色球 3D 物理摇奖机

用 Three.js 复刻中国福利彩票双色球真实摇奖机（法国 RYO CATTEAU **Myosotis**），
**全程自己写的物理引擎**，没有预设号码或动画作弊：哪颗球被摇出，完全由物理决定。

单文件网页，无需构建：双击 `index.html` 即可（此方式走 CDN）；推荐用本地 http 服务打开，
可走内置的 `_vendor/` 本地 Three.js，秒开且离线可用（见文末「Three.js 加载源」）。

## 结构对齐真机

依据中国福彩网 / 贵州福彩网公开资料，Myosotis 的结构为：

官方参数：整机高 2.02m × 宽 0.75m，**底座 0.77m / 搅拌室 0.83m / 预览架 0.42m**，
本版按此比例建模（1 单位 ≈ 0.296m），外观对照中国福彩网官方照片复刻。

| 部件 | 本项目实现 |
|---|---|
| 号码球预览架（0.42m） | 单排弧形透明管束立在搅拌室正上方（子午线金属环支撑），球停管内（红机 8 管×4+中心 1=33；蓝机 8 管×2=16），顶部入口导流锥 |
| 落球动作 | 预览架挡板滑开，球从竖管落入搅拌室顶部大开口 |
| 球状搅拌室（Ø70cm） | 两个半球 + 赤道接缝环，三个玻璃纬度带拼出顶部开口 + 下前方出球口 |
| 底部蓝座圈 | 玻璃球坐在深蓝圆台底座的座圈里（对照官方照片） |
| 两个双向旋转搅拌盘（专利 US6145836） | 左盘 3 杆 / 右盘 8 杆径向拨杆，反向旋转，切向拖带 + 盘面弹跳 |
| 出球口档杆 | 外凸金属短管 + 翻板阀，**开一颗、过一颗、立即关阀** |
| 出球轨道 | 底座侧透明 U 形滑槽（金色上沿、支撑柱），球滚下进入显示通道排队 |
| 底座（0.77m） | 深蓝圆台 + 福彩标志牌；出球时其余球持续搅拌（真机防堵原理） |

摇奖球真实尺寸为 Ø50mm（搅拌室的 1/14），为保证号码可读，3D 中取 Ø 视觉放大值。

## 流程

```
预览架挡板开 → 落球入搅拌室 → 双盘逆向搅拌 3s → 出球口档杆开
→ 球落到出球轨道 → 滚入显示通道排队 → 结果栏记录 → 重新搅拌 → 下一颗
```

红球机连开 6 颗，之后蓝球机开 1 颗，和真实开奖顺序一致。

## 物理引擎

- 固定步长 `1/120s`，重力 + 球球弹性碰撞（位置修正 + 冲量）+ 球面容器壁约束
- 搅拌 = 双盘反向切向力场 + 盘面随机弹跳（对应真机两个搅拌底盘）
- 出球 = 档杆开洞 + 向出口的导流力场，球被物理"带"出洞口
- 出球轨道 / 显示通道：沿斜面滚行 + 微坡排队，球挨球自然停靠

## 本地仿真验证

`sim/sim_real.js` 是网页物理逻辑的镜像实现，用于在不打开浏览器的情况下验证整条流程：

```bash
node sim/sim_real.js
```

实测结果：红球机 6/6 全部出球并入位（全程约 35s，接近真实直播节奏），蓝球机 1/1。

## 操作

- 「开始摇奖」：完整开奖流程
- 「重置」：球回到预览架
- 「选号工具」：打开历史分布分析页（需先启动 `node picker/sim_server.js` 获得完整功能）
- 左键拖拽旋转视角（滚轮缩放、右键平移已移除，避免移动端误操作）

## 技术栈

Three.js 0.160（importmap）+ 自写物理引擎 + CanvasTexture 号码球 + PMREM 自制影棚环境反射。

## 移动端 / 小游戏适配现状

渲染基线按手机真机设定，桌面端观感保持一致：

- 画质：关 MSAA、DPR 封顶 2、Basic 阴影 512²、玻璃壳半透明近似（不用 `transmission`）、
  球纹理 256×128、球用 `MeshStandardMaterial` + 18 段几何；不启用 Bloom 后处理。
- 分辨率：`Platform` 适配层统一取视口（Web 用 `window`/`visualViewport`，小游戏用
  `wx.getSystemInfoSync()` / `wx.onWindowResize`），`applySize()` 平台无关、两端同一套逻辑；
  `resScale` 按实时帧率在 1 → 0.6 之间动态降档。
- 3D 构图：`fitFov(aspect)` 按宽高比动态放宽垂直视角，保证两台机器在竖屏下完整入画；
  宽屏恒为 30°（原版构图不变）。
- HUD：`viewport-fit=cover` + `env(safe-area-inset-*)` 避让刘海/Home 条，
  窄屏（≤600px）/ 矮屏（≤480px）有响应式收缩。

## Three.js 加载源

`_vendor/` 内置完整 r160 副本（`three.module.js` + `controls/` + `environments/`）。importmap 按协议分流：

- 通过 **http(s)** 打开（推荐）：走 `_vendor/` 本地副本，秒开、离线可用，也是迁小游戏
  （不支持外部 CDN）的既定路径。
- **双击 `index.html`（file://）/ 预览沙箱**：ES module 无法 fetch 本地 `file://`（CORS），
  自动退回 CDN，**原有直接双击打开的能力不变**。

本地起服务：在项目目录执行 `python3 -m http.server 8000`，浏览器打开 `http://127.0.0.1:8000/index.html`；
若要用选号工具的完整功能，改用 `node picker/sim_server.js`（端口 8731）。

## 微信小游戏（自用，不发布）

`miniprogram/` 是可直接导入「微信开发者工具」的小游戏项目。**自用不需要上架审核**：
开发者工具里用测试号 / 无 AppID 模式打开，点「预览」扫码即可在自己手机微信里运行，
永远不点「上传 + 提交审核」就行。

### 目录与构建

```
miniprogram/
  game.js                 入口（加载顺序：adapter -> hud -> game-logic）
  game.json               竖屏 / 隐藏状态栏
  project.config.json     开发者工具项目配置（appid 占位 touristappid）
  adapter.js              DOM / canvas / 触摸 / 时间 / 音频适配层（自实现，零依赖）
  hud.js                  Canvas HUD（离屏 2D -> CanvasTexture -> 正交 quad）
  build.js                构建脚本：ESM -> CommonJS，零第三方依赖
  libs/                   build.js 生成：three.js / OrbitControls.js / RoomEnvironment.js
  src/game-logic.js       build.js 生成：从 index.html 的 module 主体抽出
```

**`index.html` 与 `_vendor/` 是唯一真源**，Web 端改完执行一次即可同步：

```bash
node miniprogram/build.js
```

小游戏不支持 importmap / 裸模块名 / ES module 包加载，构建脚本把本地 `_vendor/` 的 ESM
转成原生 CommonJS；另外只做两处小游戏专属注入（Web 源码不动）：
`WebGLRenderer` 显式传入上屏 canvas、主循环渲染后叠加 HUD。因此 Web 与小游戏的
3D 场景、物理、开奖流程、分辨率 / 构图适配共用同一份逻辑。

HUD 不依赖 DOM：伪 DOM 元素的 `textContent` / `className` / `disabled` 变化触发
HUD 重绘，仅在状态变化时上传纹理，没有每帧全屏 blit。触摸事件经适配层转成
pointer 事件交给 OrbitControls（保留拖拽旋转）。

### 导入步骤

1. 微信开发者工具 → 导入项目 → 目录选 **`miniprogram/`**（不是仓库根目录）
2. AppID 选「测试号」/「不使用 AppID」（`project.config.json` 里 `touristappid` 是占位，可替换）
3. 编译类型已设为 `game`；点「预览」，手机微信扫码即可运行

`game.json` 默认 `portrait`（竖屏，`fitFov` 已保证两台机器完整入画）；想要横屏改成
`"landscape"` 即可，分辨率与构图逻辑无需改动。

### 范围与已知限制

- **未迁移**：`picker/` 选号工具、历史图表（Chart.js CDN）、`picker/sim_server.js`（Node 服务）、
  `SimLog` 模拟结果面板——这些依赖 DOM 或 Node，小游戏内跑不了，需要时另写页面或走 web-view。
- 程序化音效走 `wx.createWebAudioContext()`（不支持时静默降级，不影响开奖）。
- 主包约 1.6MB（three r160 约 1.24MB），在小游戏主包限额内。
- **真机需验证**：背景墙贴图是 4160×600，超过部分手机 GPU 的 4096 纹理上限，
  若背景墙显示异常需降采样；球纹理每颗会创建 2 个离屏 canvas（共约 98 个），
  低端机若内存紧张，可复用 512×256 的临时画布再缩到 256×128。
- 本仓库的 `main` = 移动优化版 + 小游戏骨架；`full-fx` 分支 / `pre-mobile-opt` tag =
  简化前的完整高画质桌面版，可用 `git checkout full-fx` 回退对比。
