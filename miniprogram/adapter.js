/* ============================================================
   微信小游戏 DOM / Canvas 适配层（自实现，零第三方依赖）
   ------------------------------------------------------------
   目标：让 Web 版 index.html 的 3D 主逻辑「一行不改」跑在小游戏里。
   只 shim three / OrbitControls / 主逻辑实际用到的浏览器 API，
   不引入整套 weapp-adapter，也不做无用的 DOM 模拟。
   必须在 require('three') 之前加载（见 game.js）。
   ============================================================ */
(function () {
  'use strict';

  if (typeof wx === 'undefined' || typeof wx.createCanvas !== 'function') {
    throw new Error('[adapter] 仅可在微信小游戏环境运行');
  }

  const info = wx.getSystemInfoSync();
  const W = info.screenWidth;
  const H = info.screenHeight;
  const DPR = info.pixelRatio || 1;
  const safe = info.safeArea || {
    top: info.statusBarHeight || 0, bottom: H, left: 0, right: W, width: W, height: H
  };

  /* 基础库 3.17+ 把 document / window / performance 等做成了 own 且
     configurable:false 的只读 getter；canvas 的 clientWidth 也是 getter-only。
     严格模式下直接赋值会抛 TypeError → adapter 崩在第一行 → 整个游戏黑屏。
     统一走 putGlobal：能赋值就赋值；不行就 defineProperty；属性连配置都不让改时
     （document 正是这种），把字段逐个合并进它已经指向的那个对象。 */
  function putGlobal(k, v) {
    /* 诊断开关：基础库已有的全局一律不覆盖，测完决定是否作为正式修复 */
    /* 基础库 3.17+ 自带 window / self / navigator / location / performance /
       requestAnimationFrame / AudioContext 等全局，它们与基础库自己的帧循环、
       定时器与事件派发共用内部状态。以前无条件覆盖，模拟器会在入口同步代码
       跑完后不再调度任何定时器与 rAF —— 画面停在静态首帧、按钮全无反馈。
       除 document（我们的 DOM 垫片；基础库自带的没有 getElementById /
       createElement）外，已有全局一律不覆盖；基础库没有的才补上。 */
    if (k !== 'document') {
      try { if (k in GameGlobal && GameGlobal[k] != null) return; } catch (e0) {}
    }
    try {
      GameGlobal[k] = v;
      if (GameGlobal[k] === v) return;
    } catch (e) {}
    try { Object.defineProperty(GameGlobal, k, { value: v, writable: true, configurable: true }); return; }
    catch (e2) {}
    try {
      const cur = GameGlobal[k];
      if (!cur || typeof cur !== 'object' || cur === v || !v || typeof v !== 'object') return;
      for (const p in v) {
        if (!Object.prototype.hasOwnProperty.call(v, p)) continue;
        try { cur[p] = v[p]; }
        catch (e3) {
          try { Object.defineProperty(cur, p, { value: v[p], writable: true, configurable: true }); }
          catch (e4) {}
        }
      }
    } catch (e5) {}
  }

  /* ---------- 画布布局 ----------
     微信小游戏只有第一次 createCanvas() 返回的是上屏画布。这里让上屏画布取
     2D context，3D 渲染到第二块「离屏 WebGL 画布」，每帧用 2D drawImage 合成：
       · 不依赖 WebGL1 的二次 render / CanvasTexture 上传。开发者工具基础库
         3.17.6 缺 OES_standard_derivatives 与 EXT_sRGB，这两条路径实测都不出图，
         表现为「3D 正常、整层 2D UI 消失」。
       · 真机同样适用，还省掉每帧一次全屏纹理上传。
     上屏画布取过 2D context 后不能再取 WebGL，两块画布的创建顺序不可调换。 */
  const mainCanvas = wx.createCanvas();
  mainCanvas.width = Math.round(W * DPR);
  mainCanvas.height = Math.round(H * DPR);
  const mainCtx = mainCanvas.getContext('2d');
  const glCanvas = wx.createCanvas();       /* 离屏 WebGL 画布，交给 three */
  const listeners = Object.create(null);
  /* 上屏画布若有原生 addEventListener，保留并透传，别吞掉基础库自己的注册。
     实测 nativeAdd=true：基础库确实提供该方法，原生通道与文件末尾的
     wx.onTouch* / wx.onMouse* / DOM 通道一起注册，靠 gestureOpen 去重。
     曾经把 `Cannot read properties of undefined (reading '__name__')` 判成
     工具自身缺陷 —— 错。真因在 putGlobal 无条件覆盖基础库全局（见上），
     修复后运行时恢复、红字与「按钮无反馈」一起消失。 */
  let nativeCanvasAdd = null;

  function patchCanvas(cv) {
    cv.style = cv.style || {};
    /* 新基础库里 clientWidth/clientHeight 是 getter-only：直接写会抛 TypeError。
       用自有属性遮蔽；万一盖不住也不致命，尺寸走下面的 getBoundingClientRect()。 */
    ['clientWidth', 'clientHeight'].forEach(function (k, i) {
      const v = i ? H : W;
      try { Object.defineProperty(cv, k, { configurable: true, get: function () { return v; } }); }
      catch (e) { try { cv[k] = v; } catch (e2) {} }
    });
    if (typeof cv.addEventListener === 'function') {
      nativeCanvasAdd = cv.addEventListener.bind(cv);
    }
    const nativeRemove = (typeof cv.removeEventListener === 'function')
      ? cv.removeEventListener.bind(cv) : null;
    cv.addEventListener = function (type, fn) {
      (listeners[type] || (listeners[type] = [])).push(fn);
      /* 关键：继续交给原生，别把基础库自己的注册吞掉 */
      if (nativeCanvasAdd) { try { nativeCanvasAdd(type, fn); } catch (e) {} }
    };
    cv.removeEventListener = function (type, fn) {
      const a = listeners[type];
      if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
      if (nativeRemove) { try { nativeRemove(type, fn); } catch (e) {} }
    };
    cv.setPointerCapture = function () {};
    cv.releasePointerCapture = function () {};
    cv.focus = function () {};
    cv.setAttribute = function () {};
    cv.getBoundingClientRect = function () {
      return { left: 0, top: 0, x: 0, y: 0, width: W, height: H, right: W, bottom: H };
    };
    return cv;
  }
  patchCanvas(mainCanvas);

  /* 离屏 WebGL 画布也要有 clientWidth/clientHeight（three 会读），但不能复用
     patchCanvas —— 那会把触摸监听注册到两块画布上，一次触摸被分发两遍。 */
  glCanvas.style = {};
  ['clientWidth', 'clientHeight'].forEach(function (k, i) {
    const v = i ? H : W;
    try { Object.defineProperty(glCanvas, k, { configurable: true, get: function () { return v; } }); }
    catch (e) { try { glCanvas[k] = v; } catch (e2) {} }
  });
  glCanvas.setAttribute = function () {};
  /* three 的 WebGLRenderer 构造时会给 canvas 注册 contextlost/restored 监听，
     离屏画布也得有这两个方法，否则 renderer 一构造就抛 TypeError。 */
  glCanvas.addEventListener = function () {};
  glCanvas.removeEventListener = function () {};
  GameGlobal.__glCanvas = glCanvas;
  GameGlobal.__mainCtx = mainCtx;

  putGlobal('canvas', mainCanvas);
  /* 3.17+ 里 GameGlobal.canvas 是只读 getter，上面那句可能根本没写进去。
     自定义属性一定可写：主画布从这里传给 WebGLRenderer，绝不能让 three 自己
     新建一个离屏 canvas（渲染照跑，但屏幕全黑）。见 build.js 的注入。 */
  GameGlobal.__mainCanvas = mainCanvas;
  GameGlobal.__wxInfo = info;
  GameGlobal.__safeArea = safe;

  /* ---------- 离屏 canvas：号码贴图 / 环境图 / 地板纹理等 ---------- */
  function newCanvas() {
    const cv = wx.createCanvas();
    cv.style = {};
    cv.addEventListener = function () {};
    cv.removeEventListener = function () {};
    cv.setAttribute = function () {};
    return cv;
  }

  /* ---------- 伪 DOM 元素：HUD 只用到这些属性 ---------- */
  function FakeEl(tag, id) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.id = id || '';
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.parentNode = null;
    this._text = '';
    this._html = '';
    this._cls = '';
    this._disabled = false;
    this._listeners = Object.create(null);

    const self = this;
    const dirty = () => { if (GameGlobal.__hud) GameGlobal.__hud.markDirty(); };

    Object.defineProperty(this, 'textContent', {
      get() { return self._text; },
      set(v) { self._text = String(v == null ? '' : v); dirty(); },
      configurable: true
    });
    Object.defineProperty(this, 'innerHTML', {
      get() { return self._html; },
      set(v) { self._html = String(v == null ? '' : v); dirty(); },
      configurable: true
    });
    Object.defineProperty(this, 'className', {
      get() { return self._cls; },
      set(v) { self._cls = String(v == null ? '' : v); dirty(); },
      configurable: true
    });
    Object.defineProperty(this, 'disabled', {
      get() { return self._disabled; },
      set(v) { self._disabled = !!v; dirty(); },
      configurable: true
    });

    this.classList = {
      add() {
        const a = self._cls.split(/\s+/).filter(Boolean);
        for (const c of arguments) if (c && a.indexOf(c) < 0) a.push(c);
        self._cls = a.join(' '); dirty();
      },
      remove() {
        const rm = Array.prototype.slice.call(arguments);
        self._cls = self._cls.split(/\s+/).filter(c => c && rm.indexOf(c) < 0).join(' ');
        dirty();
      },
      contains(c) { return self._cls.split(/\s+/).indexOf(c) >= 0; },
      toggle(c) { this.contains(c) ? this.remove(c) : this.add(c); }
    };
  }
  FakeEl.prototype.appendChild = function (c) {
    this.children.push(c);
    /* 基础库 3.17+ 的上屏 canvas 是 [object Element]，parentNode 是只读 getter。
       这里只是模拟 DOM 关系，写不进去完全无所谓；旧写法直接赋值会抛 TypeError，
       把 game-logic.js 的 document.body.appendChild 打断 → 模拟器整屏黑。 */
    try { c.parentNode = this; }
    catch (e) {
      try { Object.defineProperty(c, 'parentNode', { value: this, writable: true, configurable: true }); }
      catch (e2) {}
    }
    if (GameGlobal.__hud) GameGlobal.__hud.markDirty();
    return c;
  };
  FakeEl.prototype.removeChild = function (c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    return c;
  };
  FakeEl.prototype.addEventListener = function (type, fn) {
    (this._listeners[type] || (this._listeners[type] = [])).push(fn);
  };
  FakeEl.prototype.removeEventListener = function (type, fn) {
    const a = this._listeners[type];
    if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  };
  FakeEl.prototype.click = function () {
    (this._listeners.click || []).slice().forEach(fn => {
      try { fn({ type: 'click', target: this, preventDefault() {} }); }
      catch (e) { console.error('[adapter] click handler', e); }
    });
  };
  FakeEl.prototype.setAttribute = function (k, v) { this[k] = v; };
  FakeEl.prototype.getAttribute = function (k) { return this[k]; };
  FakeEl.prototype.querySelector = function () { return null; };
  FakeEl.prototype.querySelectorAll = function () { return []; };
  FakeEl.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, x: 0, y: 0, width: W, height: H, right: W, bottom: H };
  };
  Object.defineProperty(FakeEl.prototype, 'onclick', {
    get() { return this._onclick || null; },
    set(fn) { this._onclick = fn; if (fn) this.addEventListener('click', fn); },
    configurable: true
  });

  /* ---------- document ---------- */
  const elements = Object.create(null);
  function byId(id) { return elements[id] || (elements[id] = new FakeEl('div', id)); }

  putGlobal('document', {
    body: new FakeEl('body', 'body'),
    documentElement: new FakeEl('html', 'html'),
    createElement(tag) {
      return (tag === 'canvas') ? newCanvas() : new FakeEl(tag);
    },
    createElementNS(ns, name) {
      return (name === 'canvas') ? newCanvas() : new FakeEl(name);
    },
    getElementById: byId,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createTextNode(t) { return { textContent: t }; },
    addEventListener() {},
    removeEventListener() {}
  });

  /* ---------- window / 全局环境 ---------- */
  putGlobal('window', GameGlobal);
  putGlobal('self', GameGlobal);
  putGlobal('innerWidth', W);
  putGlobal('innerHeight', H);
  putGlobal('devicePixelRatio', DPR);
  putGlobal('navigator', { userAgent: 'Mozilla/5.0 (WeChat MiniGame)', platform: 'minigame' });
  putGlobal('location', { protocol: 'https:', href: '', search: '', port: '', hostname: '' });
  /* 真持久化：SimLog 的开奖记录、选号页保存的注子都落 wx storage，
     与 Web 版 localStorage 语义一致（Web 改不动、小游戏不丢数据）。 */
  putGlobal('localStorage', {
    getItem(k) {
      try { const v = wx.getStorageSync(k); return (v === '' || v == null) ? null : v; }
      catch (e) { return null; }
    },
    setItem(k, v) { try { wx.setStorageSync(k, String(v)); } catch (e) {} },
    removeItem(k) { try { wx.removeStorageSync(k); } catch (e) {} },
    clear() { try { wx.clearStorageSync(); } catch (e) {} }
  });
  putGlobal('addEventListener', function () {});
  putGlobal('removeEventListener', function () {});

  /* fetch -> wx.request：可选桥接 PC 上的 picker/sim_server.js（局域网地址可在
     game.js 里改 GameGlobal.__SIM_BASE）。服务没开 / 域名未配白名单时静默失败，
     本地数据与全部功能不受影响。 */
  GameGlobal.__SIM_BASE = 'http://127.0.0.1:8731';
  GameGlobal.__SIM_REMOTE = false;         // 默认纯本地；要连 PC 服务时在 game.js 置 true
  putGlobal('fetch', function (url, opt) {
    opt = opt || {};
    /* 关闭时返回「无数据」而不是 reject：避免 SimLog 的 remoteLoad 产生
       unhandled rejection，也避免每次开奖都向不可达地址发请求。 */
    if (!GameGlobal.__SIM_REMOTE) {
      return Promise.resolve({ ok: false, status: 0,
        json() { return Promise.resolve(null); }, text() { return Promise.resolve(''); } });
    }
    return new Promise(function (resolve, reject) {
      if (typeof wx.request !== 'function') { reject(new Error('wx.request unavailable')); return; }
      wx.request({
        url: String(url),
        method: opt.method || 'GET',
        data: opt.body ? String(opt.body) : undefined,
        header: opt.headers || {},
        timeout: 3000,
        success(res) {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json() { return Promise.resolve(res.data); },
            text() { return Promise.resolve(typeof res.data === 'string' ? res.data : JSON.stringify(res.data)); }
          });
        },
        fail(e) { reject(new Error((e && e.errMsg) || 'request failed')); }
      });
    });
  });
  /* 伪 DOM 上不会触发 confirm；小游戏页面用自己的确认交互 */
  putGlobal('confirm', function () { return false; });

  /* 时间基统一：performance.now() 与 rAF 回调时间戳必须同源，否则首帧 dt 异常。
     保留原生 rAF 做 vsync 调度，只把回调参数替换成 weixin performance 时基。 */
  const perf = (typeof wx.getPerformance === 'function') ? wx.getPerformance() : null;
  const now = (perf && typeof perf.now === 'function') ? () => perf.now() : () => Date.now();
  putGlobal('performance', { now });
  const nativeRAF = GameGlobal.requestAnimationFrame;
  putGlobal('requestAnimationFrame', function (cb) {
    if (typeof nativeRAF === 'function') return nativeRAF(function () { cb(now()); });
    return setTimeout(function () { cb(now()); }, 16);
  });
  putGlobal('cancelAnimationFrame', GameGlobal.cancelAnimationFrame || function (id) { clearTimeout(id); });

  /* 程序化音效：微信小游戏的 WebAudio 兼容上下文 */
  GameGlobal.__wxWebAudio = (typeof wx.createWebAudioContext === 'function');
  if (GameGlobal.__wxWebAudio) {
    // new AudioContext() 会以「构造函数返回对象」的形式拿到 wx 的 WebAudioContext
    putGlobal('AudioContext', function () { return wx.createWebAudioContext(); });
    putGlobal('webkitAudioContext', GameGlobal.AudioContext);
  }
  /* iOS 真机上系统静音键会让声音全程消失（画面正常、零报错）。微信这个播放选项
     对 InnerAudioContext 确定生效，部分客户端的 WebAudio 也遵循；顺手打开。
     若真机仍无声，先确认手机没拨静音、媒体音量不是 0。 */
  if (typeof wx.setInnerAudioOption === 'function') {
    try { wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: true }); } catch (e) {}
  }

  /* ---------- 触摸 -> pointer 事件（供 OrbitControls 使用） ---------- */
  function emit(type, t) {
    if (!t) return;
    const up = (type === 'pointerup' || type === 'pointercancel');
    const ev = {
      type: type,
      pointerId: t.identifier || 0,
      clientX: t.clientX, clientY: t.clientY,
      pageX: t.clientX, pageY: t.clientY,
      screenX: t.clientX, screenY: t.clientY,
      button: 0, buttons: up ? 0 : 1,
      isPrimary: true, pointerType: 'touch',
      deltaY: 0,
      preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}
    };
    (listeners[type] || []).slice().forEach(fn => {
      try { fn(ev); }
      catch (e) { console.error('[adapter] ' + type + ' handler', e); }
    });
  }
  /* 统一由 __ui 分发：开奖页命中 HUD 按钮才拦截，其余给相机；
     选号/记录页是全屏 UI，所有触摸交给页面，相机完全不响应。 */
  function drawPage() { return !GameGlobal.__ui || GameGlobal.__ui.isDrawPage(); }
  function uiTouch(type, t) {
    if (!t || !GameGlobal.__ui) return false;
    try { return !!GameGlobal.__ui.touch(type, t.clientX, t.clientY); }
    catch (e) { console.error('[adapter] uiTouch ' + type, e); return false; }
  }

  /* 开发者工具模拟器把鼠标点击合成 touch 时，事件对象形状并不统一：
       · touchend 可能只有 touches，没有 changedTouches
       · 极端情况 end 事件里一个触点都不带
       · 个别实现直接把 touch 对象本身当事件传进来
     以前只认 e.changedTouches[0] / e.touches[0]，任何一种偏差都会让
     touchend 直接 return —— 表现就是「页面画得好好的，点哪儿都没反应」。
     统一归一化，并用 lastStart 作为最后的坐标兜底（tap 本来也不依赖 end 坐标）。 */
  function num(v, fallback) {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return (typeof n === 'number' && isFinite(n)) ? n : fallback;
  }
  function normTouch(t) {
    if (!t) return null;
    const x = num(t.clientX, num(t.pageX, num(t.x, 0)));
    const y = num(t.clientY, num(t.pageY, num(t.y, 0)));
    return { identifier: t.identifier || 0,
             clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y };
  }
  function pickTouch(e) {
    if (!e) return null;
    const a = (e.changedTouches && e.changedTouches.length) ? e.changedTouches
            : ((e.touches && e.touches.length) ? e.touches : null);
    if (a) return normTouch(a[0]);
    if (Array.isArray(e) && e.length) return normTouch(e[0]);
    if (typeof e.clientX === 'number' || typeof e.x === 'number') return normTouch(e);
    return null;
  }

  /* 一次手势只认一套分发目标：start 时决定，end/cancel 沿用。
     以前 end 里重新判断 isDrawPage()，而 HUD 的「返回选号」在 start 就切了页，
     end 会被误判成 3D 页转给相机，UI 的收尾（tap / 滚动）就此丢失。 */
  let gestureToUI = false;
  let lastStart = null;
  let tapTimer = null;
  /* 两套触摸来源（canvas 原生 + wx.onTouch*）会同时派发同一次手势。
     用「手势是否还开着」去重：第一个 start 打开，第一个 end 关闭，
     期间另一条通道的重复事件一律忽略。不用时间窗口，连续快速点击也不会被吞。 */
  let gestureOpen = false;
  let moveChannel = null;

  /* 运行期自检：开发者工具不把游戏 console 落盘，但会把 storage 落到
     WeappLocalData。把「哪条通道真的收到事件、坐标是多少」写进去，
     编译后不用截图就能读到真实运行时状态。纯诊断，不参与任何业务逻辑。 */
  const diag = {
    W: W, H: H, DPR: DPR,
    nativeAdd: !!nativeCanvasAdd,
    apis: {}, start: 0, move: 0, end: 0, cancel: 0,
    byChannel: {}, last: null, regions: -1, t: Date.now()
  };
  GameGlobal.__ssqDiag = diag;
  function diagWrite() {
    try {
      const ui = GameGlobal.__ui;
      if (ui && typeof ui.regions === 'function') diag.regions = ui.regions().length;
      diag.t = Date.now();
      if (typeof wx.setStorageSync === 'function') {
        wx.setStorageSync('__ssq_diag', JSON.stringify(diag));
      }
    } catch (e) {}
  }
  ['onTouchStart', 'onTouchMove', 'onTouchEnd', 'onTouchCancel',
   'onMouseDown', 'onMouseMove', 'onMouseUp', 'onMouseCancel'].forEach(function (k) {
    diag.apis[k] = (typeof wx[k] === 'function');
  });

  function clearTap() {
    if (tapTimer !== null) { try { clearTimeout(tapTimer); } catch (e) {} tapTimer = null; }
  }
  /* 兜底：模拟器里鼠标点击偶尔只派发 touchstart，压根不派发 touchend。
     280ms 内没收到 end/cancel、也没明显拖动，就补一次 end 让点击落地。
     正常手势里 end 一定先到并 clearTap()，不会重复触发；滚动时 move 会取消。 */
  function armTap(t) {
    clearTap();
    const tt = t;
    tapTimer = setTimeout(function () {
      tapTimer = null;
      gestureOpen = false;                 /* 手势收尾，否则下一次点击会被挡 */
      moveChannel = null;
      gestureToUI = false;
      uiTouch('end', tt);
    }, 280);
  }

  function handleTouch(type, e, channel) {
    try {
      diag[type] = (diag[type] || 0) + 1;
      diag.byChannel[channel] = (diag.byChannel[channel] || 0) + 1;
      if (type === 'start') {
        const t0 = pickTouch(e);
        diag.last = {
          keys: (e && typeof e === 'object') ? Object.keys(e).slice(0, 8) : [],
          x: t0 ? t0.clientX : null, y: t0 ? t0.clientY : null,
          touches: (e && e.touches) ? e.touches.length : -1,
          changed: (e && e.changedTouches) ? e.changedTouches.length : -1
        };
      }
      if (type !== 'move') diagWrite();
    } catch (eDiag) {}
    if (type === 'start') {
      if (gestureOpen) return;             // 另一通道对同一手势的重复 start
      const t = pickTouch(e);
      if (!t) return;
      gestureOpen = true;
      moveChannel = null;
      /* 音频上下文必须在真实用户手势里恢复：预热阶段建的 ctx 在 iOS 真机上可能
         一直是 suspended（表现是「画面正常、一点声音都没有」）。ensure 内部幂等。 */
      if (GameGlobal.__audioUnlock) { try { GameGlobal.__audioUnlock(); } catch (e2) {} }
      lastStart = t;
      gestureToUI = false;
      if (drawPage()) {
        const hit = uiTouch('start', t);   // 开奖页：命中 HUD 按钮即消费
        gestureToUI = hit;
        if (!hit) emit('pointerdown', t);
      } else {
        uiTouch('start', t);
        gestureToUI = true;
      }
      if (gestureToUI) armTap(t);
      /* 点击位置的即时可视反馈：主循环停摆时它是唯一能确认「事件到了」的通道 */
      if (GameGlobal.__hud && GameGlobal.__hud.flashTap) {
        try { GameGlobal.__hud.flashTap(t.clientX, t.clientY); } catch (e3) {}
      }
      return;
    }
    if (type === 'move') {
      if (!gestureOpen) return;
      /* 滚动只认一条通道，否则两套事件叠加会让页面滚两倍速 */
      if (moveChannel === null) moveChannel = channel;
      else if (moveChannel !== channel) return;
      const t = pickTouch(e) || lastStart;
      if (!t) return;
      if (gestureToUI) {
        if (lastStart && Math.abs(t.clientY - lastStart.clientY) > 6) clearTap();
        uiTouch('move', t);
      } else emit('pointermove', t);
      return;
    }
    /* end / cancel */
    if (!gestureOpen) return;             // 另一通道的重复结束事件
    gestureOpen = false;
    moveChannel = null;
    const t = pickTouch(e) || lastStart;
    clearTap();
    if (t) {
      if (gestureToUI) uiTouch(type, t);
      else emit(type === 'cancel' ? 'pointercancel' : 'pointerup', t);
    }
    gestureToUI = false;
  }

  /* 事件通道，全部共用 gestureOpen 去重（一次点击只落地一次 tap）。
     实测上屏 canvas 带原生 addEventListener（nativeAdd=true），
     因此原生 touch/mouse/pointer、wx.onTouch*、wx.onMouse*、DOM 层一并注册，
     谁先到谁生效；一次手势只落地一次 tap。 */
  if (nativeCanvasAdd) {
    [['touchstart', 'start'], ['touchmove', 'move'],
     ['touchend', 'end'], ['touchcancel', 'cancel'],
     ['mousedown', 'start'], ['mousemove', 'move'], ['mouseup', 'end'],
     ['pointerdown', 'start'], ['pointermove', 'move'],
     ['pointerup', 'end'], ['pointercancel', 'cancel']].forEach(function (pair) {
      try { nativeCanvasAdd(pair[0], function (e) { handleTouch(pair[1], e, 'native'); }); }
      catch (e2) {}
    });
  }
  /* 1) 官方触摸 API：真机唯一可靠通路，不能砍。 */
  if (typeof wx.onTouchStart === 'function') {
    try {
      wx.onTouchStart(function (e) { handleTouch('start', e, 'wx'); });
      wx.onTouchMove(function (e) { handleTouch('move', e, 'wx'); });
      wx.onTouchEnd(function (e) { handleTouch('end', e, 'wx'); });
      wx.onTouchCancel(function (e) { handleTouch('cancel', e, 'wx'); });
    } catch (eWx) {}
  }
  /* 2) 基础库 3.x 的 PC 鼠标 API（JSAPI 编号 179~184），与 touch 不是同一套事件。
        开发者工具是用鼠标点屏幕的，这条通道可能才是模拟器里真正有事件的那条。 */
  if (typeof wx.onMouseDown === 'function') {
    try {
      wx.onMouseDown(function (e) { handleTouch('start', e, 'wxmouse'); });
      if (typeof wx.onMouseMove === 'function')
        wx.onMouseMove(function (e) { handleTouch('move', e, 'wxmouse'); });
      if (typeof wx.onMouseUp === 'function')
        wx.onMouseUp(function (e) { handleTouch('end', e, 'wxmouse'); });
    } catch (eMouse) {}
  }
  /* 3) 模拟器 webview 若存在真实 document/window，再挂一层 DOM 鼠标监听。
        小游戏 Canvas 不是 DOM 元素，点击不一定落到它身上，但会冒泡到 document。
        只挂 mouse，不挂 pointer/touch —— adapter 自己的 emit() 会派发
        pointer*，挂上去会和手势分发互相触发。 */
  const domTargets = [];
  [GameGlobal.document, GameGlobal.window,
   (typeof globalThis !== 'undefined' ? globalThis.document : null),
   (typeof globalThis !== 'undefined' ? globalThis.window : null)].forEach(function (o) {
    if (!o || o === mainCanvas || typeof o.addEventListener !== 'function') return;
    if (domTargets.indexOf(o) < 0) domTargets.push(o);
  });
  diag.domTargets = domTargets.length;
  domTargets.forEach(function (o, idx) {
    const tag = 'dom' + idx;
    function onDom(type, ev) {
      let x = num(ev.clientX, num(ev.pageX, 0));
      let y = num(ev.clientY, num(ev.pageY, 0));
      const vw = (typeof o.innerWidth === 'number' && o.innerWidth > 0) ? o.innerWidth : W;
      const vh = (typeof o.innerHeight === 'number' && o.innerHeight > 0) ? o.innerHeight : H;
      if (vw !== W || vh !== H) { x = x * W / vw; y = y * H / vh; }
      const pt = { clientX: x, clientY: y, identifier: 0 };
      handleTouch(type, { touches: [pt], changedTouches: [pt] }, tag);
    }
    [['mousedown', 'start'], ['mousemove', 'move'], ['mouseup', 'end']].forEach(function (pair) {
      try { o.addEventListener(pair[0], function (ev) { onDom(pair[1], ev); }); }
      catch (eDom) {}
    });
  });

  diagWrite();                              /* 编译后即可读到启动期环境 */
  try { setTimeout(diagWrite, 3000); } catch (eT) {}
  console.log('[adapter] ready ' + W + 'x' + H + ' dpr=' + DPR);
})();
