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

  /* ---------- 主画布：首次 createCanvas() 即上屏画布，交给 WebGLRenderer ---------- */
  const mainCanvas = wx.createCanvas();
  const listeners = Object.create(null);

  function patchCanvas(cv) {
    cv.style = cv.style || {};
    cv.clientWidth = W;
    cv.clientHeight = H;
    cv.addEventListener = function (type, fn) {
      (listeners[type] || (listeners[type] = [])).push(fn);
    };
    cv.removeEventListener = function (type, fn) {
      const a = listeners[type];
      if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
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

  GameGlobal.canvas = mainCanvas;
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
    c.parentNode = this;
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

  GameGlobal.document = {
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
  };

  /* ---------- window / 全局环境 ---------- */
  GameGlobal.window = GameGlobal;
  GameGlobal.self = GameGlobal;
  GameGlobal.innerWidth = W;
  GameGlobal.innerHeight = H;
  GameGlobal.devicePixelRatio = DPR;
  GameGlobal.navigator = { userAgent: 'Mozilla/5.0 (WeChat MiniGame)', platform: 'minigame' };
  GameGlobal.location = { protocol: 'https:', href: '', search: '', port: '', hostname: '' };
  GameGlobal.localStorage = {
    getItem() { return null; }, setItem() {}, removeItem() {}, clear() {}
  };
  GameGlobal.addEventListener = function () {};
  GameGlobal.removeEventListener = function () {};

  /* 时间基统一：performance.now() 与 rAF 回调时间戳必须同源，否则首帧 dt 异常。
     保留原生 rAF 做 vsync 调度，只把回调参数替换成 weixin performance 时基。 */
  const perf = (typeof wx.getPerformance === 'function') ? wx.getPerformance() : null;
  const now = (perf && typeof perf.now === 'function') ? () => perf.now() : () => Date.now();
  GameGlobal.performance = { now };
  const nativeRAF = GameGlobal.requestAnimationFrame;
  GameGlobal.requestAnimationFrame = function (cb) {
    if (typeof nativeRAF === 'function') return nativeRAF(function () { cb(now()); });
    return setTimeout(function () { cb(now()); }, 16);
  };
  GameGlobal.cancelAnimationFrame = GameGlobal.cancelAnimationFrame || function (id) { clearTimeout(id); };

  /* 程序化音效：微信小游戏的 WebAudio 兼容上下文 */
  if (typeof wx.createWebAudioContext === 'function') {
    // new AudioContext() 会以「构造函数返回对象」的形式拿到 wx 的 WebAudioContext
    GameGlobal.AudioContext = function () { return wx.createWebAudioContext(); };
    GameGlobal.webkitAudioContext = GameGlobal.AudioContext;
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
  function onHUD(x, y) {
    return !!(GameGlobal.__hud && GameGlobal.__hud.hitTest(x, y));
  }

  wx.onTouchStart(function (e) {
    const t = e.touches && e.touches[0];
    if (!t) return;
    if (onHUD(t.clientX, t.clientY)) return;   // 点在按钮上：不把事件转给相机
    emit('pointerdown', t);
  });
  wx.onTouchMove(function (e) { emit('pointermove', e.touches && e.touches[0]); });
  wx.onTouchEnd(function (e) { emit('pointerup', e.changedTouches && e.changedTouches[0]); });
  wx.onTouchCancel(function (e) { emit('pointercancel', e.changedTouches && e.changedTouches[0]); });

  console.log('[adapter] ready ' + W + 'x' + H + ' dpr=' + DPR);
})();
