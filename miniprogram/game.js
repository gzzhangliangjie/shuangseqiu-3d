/* 微信小游戏入口 —— 加载顺序不可调换：
   1) adapter    先造好 document / canvas / 触摸 / 时间 / 音频 / wx storage 环境
   2) ssq-data   2083 期历史开奖（SimLog 形态评估与选号算法的共同数据源）
   3) simlog     3D 开奖记录 + 8 项形态评估（Web 版同一份逻辑）
   4) hud        UI 表面 + 2D 合成 + 开奖页 HUD
   5) pages      选号 / 分布 / 记录页，注册 GameGlobal.__ui
   6) game-logic 由 build.js 从 index.html 抽出的 3D 主逻辑
*/

/* ---------- 启动链路自检（常驻，不参与任何业务逻辑） ----------
   开发者工具不把游戏 console 落盘，但 wx.setStorageSync 的内容会写到
   %LOCALAPPDATA%/微信开发者工具/User Data/<uid>/WeappSimulator/WeappStorage/
   storage_*.json。每一步留一个标记，就能在不截图、不贴报错的前提下判断：
     · 断在哪个模块（steps 最后是 begin 而没有 done）
     · 哪个模块抛了异常（errors 里带堆栈）
     · 事件循环是否还活着（tick 是否持续递增）
     · UI 是否真的挂上（ui / regions）
   全部 try/catch 包裹，诊断失败绝不影响游戏；上传包里保留也无害。 */
var __boot = { steps: [], errors: [], t: Date.now(), tick: 0, frames: 0 };
try { GameGlobal.__ssqBoot = __boot; } catch (e) {}
function bootMark(s) {
  __boot.steps.push(s + '@' + (Date.now() - __boot.t));
  try { wx.setStorageSync('__ssq_boot', JSON.stringify(__boot)); } catch (e) {}
}
function bootLoad(p) {
  bootMark('begin ' + p);
  try {
    require(p);
    bootMark('done  ' + p);
  } catch (e) {
    __boot.errors.push(p + ' :: ' + String(e && (e.stack || e.message || e)));
    try { wx.setStorageSync('__ssq_boot', JSON.stringify(__boot)); } catch (e2) {}
    throw e;
  }
}

/* 运行期异常落盘：开发者工具不把游戏 console 写进日志，但 storage 会落盘。
   主循环第一帧若抛未捕获异常，rAF 链会断、页面停在静态首帧，表现就是
   「界面完整、点哪儿都没反应」。这里把异常留下来，不用截图就能定位。 */
try {
  if (typeof wx.onError === 'function') {
    wx.onError(function (e) {
      __boot.onError = String(e && (e.message || e.stack || e));
      try { wx.setStorageSync('__ssq_boot', JSON.stringify(__boot)); } catch (e2) {}
    });
  }
  if (typeof wx.onUnhandledRejection === 'function') {
    wx.onUnhandledRejection(function (e) {
      __boot.onReject = String(e && (e.reason || e.message || e));
      try { wx.setStorageSync('__ssq_boot', JSON.stringify(__boot)); } catch (e2) {}
    });
  }
} catch (e) { __boot.errHookErr = String(e); }

/* rAF 代理：animate 内部抛异常时先留下堆栈再继续抛，不吞业务异常。 */
try {
  var __nativeRAF = GameGlobal.requestAnimationFrame;
  GameGlobal.requestAnimationFrame = function (cb) {
    return __nativeRAF.call(GameGlobal, function (ts) {
      try { cb(ts); }
      catch (e) {
        __boot.frameErr = String(e && (e.stack || e.message || e));
        try { wx.setStorageSync('__ssq_boot', JSON.stringify(__boot)); } catch (e2) {}
        throw e;
      }
    });
  };
} catch (e) { __boot.rafProxyErr = String(e); }

bootMark('start');
bootLoad('./adapter.js');
bootLoad('./libs/ssq-data.js');
bootLoad('./src/simlog.js');
bootLoad('./hud.js');
bootLoad('./pages.js');
bootMark('all-modules-loaded');

/* 可选：连局域网 PC 上的 node picker/sim_server.js 同步开奖结果。
   需在微信开发者工具里关闭「不校验合法域名」，并把地址改成 PC 的局域网 IP。
   默认 false = 纯本地，不依赖任何服务。
   GameGlobal.__SIM_REMOTE = true;
   GameGlobal.__SIM_BASE = 'http://192.168.1.10:8731'; */

bootLoad('./src/game-logic.js');
bootMark('entry-finished');

/* 启动期全局状态快照（纯诊断）：模拟器里触摸回调能收到事件，
   但 adapter 在点击那一刻读到的 __ui.regions 是 -1。把入口跑完后
   GameGlobal 上的实际挂载记下来，判断是「没挂上」还是「挂到别的对象上」。 */
try {
  __boot.uiType = typeof GameGlobal.__ui;
  __boot.hudType = typeof GameGlobal.__hud;
  __boot.uiRegions = (GameGlobal.__ui && typeof GameGlobal.__ui.regions === 'function')
    ? GameGlobal.__ui.regions().length : -1;
  __boot.ggIsGlobal = (typeof globalThis !== 'undefined') ? (globalThis === GameGlobal) : null;
  __boot.winIsGG = (typeof window !== 'undefined') ? (window === GameGlobal) : null;
  __boot.ggKeys = Object.keys(GameGlobal).filter(function (k) {
    return k.indexOf('__') === 0;
  }).slice(0, 40);
  try { wx.setStorageSync('__ssq_boot', JSON.stringify(__boot)); } catch (e2) {}
} catch (e) { __boot.uiProbeErr = String(e); }

/* 异步探针：把「事件循环不跑」与「API 根本不存在」分开。
   入口同步阶段写完立即注册，只要回调被调度就会写回 storage。 */
__boot.env = {
  raf: typeof requestAnimationFrame,
  si: typeof setInterval,
  st: typeof setTimeout,
  nativeRAF: typeof GameGlobal.requestAnimationFrame
};
try {
  setTimeout(function () {
    __boot.asyncTimeout = true;
    try { wx.setStorageSync('__ssq_boot', JSON.stringify(__boot)); } catch (e) {}
  }, 0);
} catch (e) { __boot.envErr = 'setTimeout: ' + String(e); }
try {
  requestAnimationFrame(function () {
    __boot.rafFired = true;
    try { wx.setStorageSync('__ssq_boot', JSON.stringify(__boot)); } catch (e) {}
  });
} catch (e) { __boot.envErr = (__boot.envErr || '') + ' rAF: ' + String(e); }
try { wx.setStorageSync('__ssq_boot', JSON.stringify(__boot)); } catch (e) {}

/* 心跳：tick 持续递增 = JS 运行时活着；卡住 = 运行时被冻结/销毁，
   此时屏幕上看到的是最后一帧静态画面，任何事件通道都不会有回调。 */
try {
  setInterval(function () {
    __boot.tick++;
    if (typeof GameGlobal !== 'undefined') {
      var ui = GameGlobal.__ui;
      __boot.ui = !!ui;
      __boot.regions = (ui && typeof ui.regions === 'function') ? ui.regions().length : -1;
      __boot.hud = !!GameGlobal.__hud;
      __boot.fatalErr = GameGlobal.__fatalErr || '';
      __boot.uiErr = GameGlobal.__uiErr || '';
    }
    try { wx.setStorageSync('__ssq_boot', JSON.stringify(__boot)); } catch (e) {}
  }, 1000);
} catch (e) {}

/* 阶梯存活探针 + setTimeout 递归心跳（纯诊断）。
   目的：把「运行时挂起」和「只有 setInterval 不调度」分开。
   之前只靠 setInterval 一个信号，storage 又有约 10s 刷盘延迟，
   tick=0 究竟是没跑还是没刷盘一直分不清。alive 里带相对毫秒数，
   能直接读出这个 App 在入口跑完之后还活了多久。 */
[100, 500, 1500, 3000, 8000].forEach(function (ms) {
  try {
    setTimeout(function () {
      if (!__boot.alive) __boot.alive = [];
      __boot.alive.push(ms + '@' + (Date.now() - __boot.t));
      try { wx.setStorageSync('__ssq_boot', JSON.stringify(__boot)); } catch (e) {}
    }, ms);
  } catch (e) {}
});
function bootBeat() {
  __boot.beat = (__boot.beat || 0) + 1;
  try { wx.setStorageSync('__ssq_boot', JSON.stringify(__boot)); } catch (e) {}
  try { setTimeout(bootBeat, 1000); } catch (e) {}
}
try { setTimeout(bootBeat, 1000); } catch (e) {}
try { wx.setStorageSync('__ssq_boot', JSON.stringify(__boot)); } catch (e) {}

/* 同步文件日志（纯诊断，最终判据）。
   storage 有约 10s 刷盘延迟且看起来只在启动期刷一次，无法区分
   「回调根本没跑」和「跑了但没落盘」。USER_DATA_PATH 是同步真实文件，
   每次 append 立即落盘，可以直接读，把刷盘机制这个干扰彻底排除。 */
(function () {
  var fs = null, path = '';
  try {
    if (typeof wx.getFileSystemManager === 'function' && wx.env && wx.env.USER_DATA_PATH) {
      fs = wx.getFileSystemManager();
      path = wx.env.USER_DATA_PATH + '/ssq-runtime.log';
      fs.writeFileSync(path, 'BOOT t=' + __boot.t + ' path=' + path + '\n', 'utf8');
    }
  } catch (e) { fs = null; }
  function line(s) {
    if (!fs) return;
    try { fs.appendFileSync(path, (Date.now() - __boot.t) + ' ' + s + '\n', 'utf8'); } catch (e) {}
  }
  line('entry uid=' + Math.random().toString(36).slice(2, 8));
  /* 双定时器对照：setTimeout 递归链 + setInterval，各自独立写行。
     只要有任何一行持续出现，就说明运行时活着、之前 storage 的 tick=0
     只是刷盘假象；两类都不出现才是运行时在入口后被挂起。 */
  var m = 0;
  try {
    setInterval(function () {
      m++;
      line('interval#' + m + ' tick=' + __boot.tick + ' frames=' + __boot.frames);
    }, 500);
    line('interval registered');
  } catch (e) { line('intervalErr ' + String(e)); }
  var n = 0;
  function beat() {
    n++;
    var diag = '';
    try { diag = String(wx.getStorageSync('__ssq_diag') || '').slice(0, 240); } catch (e) {}
    var ui = GameGlobal.__ui;
    var glc = GameGlobal.__glCanvas;
    var mainC = GameGlobal.__mainCanvas;
    var st = GameGlobal.__stage;
    line('beat#' + n +
         ' tick=' + __boot.tick + ' frames=' + __boot.frames +
         ' ui=' + !!ui +
         ' regions=' + ((ui && typeof ui.regions === 'function') ? ui.regions().length : -1) +
         ' hud=' + !!GameGlobal.__hud +
         ' cur=' + ((ui && typeof ui.current === 'function') ? ui.current() : 'na') +
         ' draw=' + ((ui && typeof ui.isDrawPage === 'function') ? ui.isDrawPage() : 'na') +
         ' winW=' + (typeof window !== 'undefined' ? window.innerWidth : 'na') +
         ' winH=' + (typeof window !== 'undefined' ? window.innerHeight : 'na') +
         ' dpr=' + (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 'na') +
         ' glc=' + (glc ? glc.width + 'x' + glc.height : 'na') +
         ' main=' + (mainC ? mainC.width + 'x' + mainC.height : 'na') +
         ' stage=' + (st ? [st.x, st.y, st.w, st.h].map(Math.round).join(',') : 'na') +
         ' fatal=' + String(GameGlobal.__fatalErr || '').slice(0, 120) +
         ' uiErr=' + String(GameGlobal.__uiErr || '').slice(0, 120) +
         ' rdr=' + (function () { try { var r = GameGlobal.__renderer; return r && r.info && r.info.render ? r.info.render.calls : 'na'; } catch (e) { return 'err'; } })() +
         ' diag=' + diag);
    try { setTimeout(beat, 500); } catch (e) {}
  }
  try { setTimeout(beat, 100); } catch (e) {}
})();
