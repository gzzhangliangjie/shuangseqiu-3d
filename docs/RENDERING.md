# 双色球 3D 摇奖机 · 渲染效果整合与优化文档

> 适用范围：`index.html`（Web 唯一真源）与 `miniprogram/`（由 `build.js` 构建生成，两端共用同一套渲染逻辑）。
> 基线版本：Three.js r0.160（本地 `_vendor/`，http(s) 走本地副本，`file://` 走 CDN）。

---

## 1. 设计基调：移动端优先的渲染基线

整个渲染方案以「能上微信小游戏 / 手机」为第一约束，桌面画质在这个基线上顺带成立：

| 项 | 设置 | 说明 |
|---|---|---|
| 抗锯齿 | `antialias: false` | MSAA 在移动 GPU 过贵；靠 DPR 封顶 2 保证清晰度 |
| 后处理 | **无**（已删 EffectComposer/Bloom/OutputPass） | 全屏多 pass 在手机上不可行，直渲 `renderer.render` |
| 阴影 | `BasicShadowMap`，512²，单光源 | PCFSoft 只在 `full-fx` 分支保留 |
| 色调映射 | ACESFilmic，exposure 0.92 | 高光柔和滚降，避免死白 |
| 色彩空间 | sRGB 输出 + 贴图标 SRGBColorSpace | |
| 分辨率 | DPR 封顶 2 × 动态 resScale（1→0.6） | 见 §6 |

对应高画质原版锚点：tag `pre-mobile-opt` / 分支 `full-fx`（commit `1fd47fc`，含 transmission、UnrealBloom、PCFSoft、2K 阴影），供日后对比或回退。

---

## 2. 场景环境

- **背景**：`0x5b6e84` 纯色 + 雾 `THREE.Fog(0x66788c, 42, 120)`，拉开影棚纵深。
- **环境反射（PBR 质感的关键）**：不用 RoomEnvironment 的白盒子，而是**程序化自制影棚 equirect 贴图**：
  - 512×256 canvas（位图仅 0.5MB），上蓝墙 / 中亮带 / 下深地面渐变 + 三块径向渐变「灯箱」；
  - 灯箱刻意用柔和径向渐变而非硬白矩形——硬边会在玻璃球壳上炸成反光斑；
  - 经 `PMREMGenerator.fromEquirectangular` 生成 cubemap 供全场景反射。
- **影棚围墙**：CylinderGeometry 内贴 CanvasTexture 横幅（「福彩开奖」），配基座裙边、倒角、暖色灯槽与辉光层。

## 3. 光照

| 光源 | 参数 | 作用 |
|---|---|---|
| HemisphereLight | `0xffffff / 0xc3cede, 0.34` | 天空-地面环境底光 |
| DirectionalLight dir1 | 0.95，位置 (7,14,9) | 主光 + 投影，shadow 512²，视锥收窄到场景范围（-11~11 / -3~13 / near2 far42），`bias -0.0005 + normalBias 0.02` 治痤疮影 |
| DirectionalLight dir2 | `0xdfe8ff, 0.2`，(-9,7,-7) | 冷色轮廓补光 |

---

## 4. 材质体系（核心）

### 4.1 玻璃的「移动近似」——为什么放弃 transmission

真·物理透射（`MeshPhysicalMaterial.transmission`）在手机 GPU 上需要把不透明场景额外渲染一遍，直接弃用。替代方案是**半透明 + 菲涅尔边缘光**的组合：

```js
glassMat = MeshPhysicalMaterial({
  color 0xffffff, roughness 0.05, ior 1.49,
  transparent, opacity 0.08,          // 均匀泛白是「雾感」来源，压到很低
  clearcoat 0.3, envMapIntensity 1.3,
  side FrontSide, depthWrite false
})
```

关键认知：**玻璃件的「存在感」不该靠 opacity 泛白，而应交给边缘光**——掠射角处的 fresnel 高光才读得出曲面轮廓，中间越透越好（壳内的球反而更清楚）。

### 4.2 菲涅尔边缘光 `applySurfaceRim(mat, opts)`

通过 `onBeforeCompile` 往 MeshPhysicalMaterial 片元着色器末尾注入：

```glsl
float ndv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
float fres = pow(1.0 - ndv, uRimPower);
gl_FragColor.a = clamp(gl_FragColor.a + fres * uRimStrength, 0.0, 1.0);
```

按部件分档（强度存为相对球壳的比例 `k`，`setGlassRim()` 全局缩放时保住层次）：

| 部件 | 强度 | power | 备注 |
|---|---|---|---|
| 玻璃球壳 glassMat | 1.00× | 3.2 | tint 偏冷蓝 (0.54,0.68,0.94) |
| 滑槽 railMat | 0.95× | 2.6 | 槽壁矮、法线几乎朝相机，掠射角极小，不提强等于没加 |
| 预览管/封口/顶盖托板 clearEdgeMat | 0.45× | 3.6 | 0.75 时管两侧边光糊成白管像磨砂塑料 |
| 搅拌盘/拨块/挡圈 rotorMat | 0.35× | 3.4 | 转动件强度一高闪成花；与 clearEdgeMat 同参数 → 共用 program |
| 顶盖 makeCoverMat | 0.32× | 3.4 | 满色板上 0.5 会读成霓虹条而非染色亚克力 |

**两个已踩实的坑**：
1. `material.clone()` **不复制实例上的 `onBeforeCompile`**——clone 出的 shellMat 必须重新 `applySurfaceRim`，否则上屏的壳没有边缘光；
2. 顶盖这类**实心挤出体**不能用薄玻璃件的 `DoubleSide + depthWrite:false`，会双面全画叠出「两层板」错觉，必须 `FrontSide + depthWrite:true`。

调参接口：`window.setGlassRim(strength, power)` 直接改已编译 uniform，不触发重编译。

### 4.3 同色对齐：复用材质实例而非「填同一个色号」

顶盖 / 赤道圈 / 底座三处要读成同一颜色时，赤道圈直接**复用底座的 baseMat 实例**（颜色、粗糙度、金属度、清漆、envMapIntensity 全部同源，不存在渲染漂移）；顶盖因必须独立材质（半透 + 不同粗糙度），只保证 hex 一致，并把 opacity 0.62→0.8 压住天空透色。剩余的明暗差来自光照本身，属正常，不追色号。

### 4.4 出球孔轮廓

纯 alphaTest 硬切 + 薄面玻璃会让孔口读成黑洞。补两件纯视觉几何：孔口 Torus（法线全径向 = 掠射 → 边缘光自动点亮成玻璃切边）+ 2.5cm 开口短筒做孔内壁。内径大于球半径，不挡物理。

### 4.5 号码球

- **几何**：49 球共用一份 `BALL_GEO = SphereGeometry(R_BALL, 18, 18)`（原先每球 new 一份 = 49 份显存）。
- **贴图**：单张 256×128 CanvasTexture 直接绘制（无中间位图）：等距圆柱投影映射球面，6 个数字分两条纬带（±33°）、经度错 60°，横向按 `1/cos(lat)` 补偿消畸变；**6/9 按位加下划线**（`measureText` 逐字符定位，只给含 6/9 那一位画线，防旋转歧义）。

---

## 5. 贴图策略：全程序化 CanvasTexture

所有贴图运行时 canvas 生成——**零图片下载、离线可用**，且用 `ctx.scale()` 缩 backing store 而保持绘制坐标不变：

| 贴图 | 尺寸（优化前 → 后） |
|---|---|
| 影棚横幅背景墙 | 4160×600 → **2048×295**（避开部分手机 4096 上限） |
| 影棚环境 equirect | 1024×512 → **512×256** |
| 地板 | 512² → **256²**（MeshPhysicalMaterial：clearcoat 0.7 + envMap，已删 Reflector 镜面反射） |
| 球壳 alphaMap | 1024² → **512²** |
| 号码球贴图 | 512×256 中间位图 → **256×128 直绘** |

离屏 canvas 从 98 个减到 49 个，**CPU 位图内存 52.7MB → 12.0MB（-77%）**。两台机器共用一张 LOGO 纹理。

---

## 6. 分辨率与多宽高比适配（Web/小游戏共用）

- **`applySize()`**：`renderer.setPixelRatio(min(dpr, 2) * resScale)` + `setSize` + 更新 `camera.aspect`。尺寸来源由 `Platform` 适配器抽象（Web: window/visualViewport；wx: getSystemInfoSync/onWindowResize）。
- **动态分辨率 `adaptResolution(dt)`**：每 ~1s 按实测 FPS 降档/回升 resScale（1→0.6 步进 0.1，FPS<50 降、>58 升，带冷却）；**启动预热 2.5s 不评估**——PMREM/建纹理/建模集中在首帧，避免误判掉帧。
- **多宽高比 `fitFov(aspect)`**：竖屏不改机位只改 fov——`fov = min(70, max(30, 2·atan(HORIZ_TAN/aspect)))`，保证水平半视野 ≥5.4（双机全入画）。宽屏 fov 恒 30 → 桌面构图与原版一致；9:16 → 52.4°、9:19.5 → 61.9°，特写机位自动适配无需分支。投影矩阵写入点全项目仅 `applySize()` 一处。
- **镜头**：开场/红机/蓝机/全景四个机位，`camTween` 补间（easeInOutCubic，`controls.enabled=false` 防打架）；`minDistance=5` 必须小于特写距离，否则 OrbitControls 强拉回造成「飞过去又重置」。

---

## 7. 物理渲染与主循环

- 固定子步物理（DT=1/120），`done` 后不立即停——**继续跑到所有球落稳（0.4s）再停**，避免悬空定格。
- 搅拌盘双向旋转，音效层取 `agitMax` 喂给搅拌声强。
- 帧循环内零对象分配热路径；音频在循环里只做 `setTargetAtTime` 门控。

## 8. 音效（程序化合成，零外部文件）

> 详见 11-05 工作日志；此处只记渲染相关的结论。

- **`createOscillator` 数量 = 0**：正弦/锯齿 = 电子音的定义，全部改为「噪声脉冲 + 非谐波模态」物理建模（click + modes + thump + 早期反射）。
- 采样运行前**纯 Float32Array 预合成**（不依赖 AudioContext），首帧后 `requestIdleCallback` 预热 `prime() + ensure()`（`resume()` 的 rejection 必须 catch），**点击后长帧 >60ms 归零**（原 `new AudioContext()` 单独占 186ms）。
- 搅拌声 = 4s 无缝循环采样常驻播放（1 源 + 1 增益）：颗粒均匀随机铺满、RMS 归一后 tanh 软饱和、环形折返回卷接缝；**连续感来自撞击密度（58 颗/秒），不要用噪声床去糊**——噪声床在中高频是「沙」、加低频是「水」。
- 事件声 `playBuf` 挂 `onended → disconnect()`，不靠 GC 回收 AudioNode。

---

## 9. 性能快照与优化账本

**当前场景（桌面 Edge 1920 宽，含阴影）**：

```
Mesh 184（0 InstancedMesh）· 唯一几何体 128 · 材质 81 · 纹理 55 · 三角面 ~79k
draw call 147/帧（阴影 pass 峰值 176）· program 21 · p50 帧间隔 33.3ms（满帧）
```

**已做的优化（按收益排序）**：

| 优化 | 前 → 后 |
|---|---|
| 删 Reflector 镜面地板 | 移动 GPU 全屏反射 pass 消失 |
| 删 EffectComposer/Bloom/颗粒滤镜 | 每帧少 3 个全屏 pass |
| 阴影 2048 → 512 Basic | 阴影 pass 显存与带宽大降 |
| 贴图 backing store 缩容 | CPU 位图 52.7MB → 12.0MB |
| 49 球共享 BALL_GEO、共享 LOGO 纹理 | 几何/纹理去重 |
| DPR 封顶 2 + resScale 动态降档 | 低端机自动兜底 |
| 边缘光注入复用 program（分档但同参数） | programs 稳定 21，无变体膨胀 |
| 音频预合成 + 空闲预热 + onended 释放 | 点击长帧 200ms 级 → 0 |

**明确的未做项**：`InstancedMesh` + 数字贴图图集（184 个独立 mesh 是 draw call 的大头，147/帧；上真机前做）。

---

## 10. 验证工具链（改渲染/音效必跑）

| 工具 | 用途 |
|---|---|
| `_perf_probe.py` / `_perf_scene.py` | draw call / 帧时间 / 堆 / 场景资源清单 |
| `_audio_render.js` | 从 index.html 抽出合成核心，离线渲染全部采样到 `_*.raw/_*.wav` |
| `_audio_spec.py` | 频谱重心 / 分频段能量 / 包络 / 循环接缝 / 谱峰突出度（判「合成味」） |
| `_e2e_*.py` 系列 | 整局冒烟：阶段电平、建节点数、JS 异常、落球时序 |
| `miniprogram/preflight.js` | 小游戏包 9 组检查（体积 / 新鲜度 / eval / appid…） |

**测试方法论教训**：
- 渲染验证必须**真渲染**（headless 截图 / draw call 统计），只读代码看不出 clone 丢 onBeforeCompile 这类问题；
- 帧率对比要**交替独立标签页**——同一标签页热切换开关会触发 shader 重编译，测出的 +100% fps 是 rAF 空转假象；
- 用户报「完全没声音/没变化」时，**先让他 Ctrl+F5 硬刷新**再查代码（缓存旧版至少误判过一整轮）。

---

## 11. 一页速查：改渲染时的红线

1. `clone()` 材质后**必须重挂 `onBeforeCompile`**；
2. 实心体（顶盖/挤出体）不要沿用薄玻璃的 `DoubleSide + depthWrite:false`；
3. 有孔的板上色前验「孔半径 < 孔心距/2」（顶盖月牙孔事故：球径当管距 + 孔径大于孔距，12 孔互吞）；
4. 新增透明件先想清楚归哪一档边缘光，**与既有档同参数可共用 program**；
5. 玻璃感 = 低 opacity + fresnel 边缘光，**不要回头加 transmission**（除非只在 full-fx 线）;
6. 改完 `index.html` 必须 `node miniprogram/build.js` 重新生成小游戏产物，并跑 `preflight.js` 确认新鲜度。
