"""运行时性能探针：注入 WebGL/音频统计后跑完整一局，量 draw call、三角数、帧时间、堆增长。"""
import json, urllib.request, websocket, time

CDP = "http://127.0.0.1:9333"
URL = "http://127.0.0.1:8777/index.html"

INJECT = r"""
(() => {
  window.__P = { calls: 0, tris: 0, frames: 0, t: [], last: 0 };
  const P = window.__P;
  const hook = (proto, name, tri) => {
    if (!proto || !proto[name]) return;
    const orig = proto[name];
    proto[name] = function (...a) {
      P.calls++;
      if (tri) P.tris += a[1] / 3 | 0;
      return orig.apply(this, a);
    };
  };
  for (const p of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!p) continue;
    hook(p.prototype, 'drawElements', true);
    hook(p.prototype, 'drawArrays', true);
    hook(p.prototype, 'drawElementsInstanced', true);
  }
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return raf(function (ts) {
      P.frames++;
      if (P.last) P.t.push(ts - P.last);
      P.last = ts;
      return cb(ts);
    });
  };
  // 音频节点计数
  window.__A = { src: 0, nodes: 0 };
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    const cb = AC.prototype.createBufferSource;
    AC.prototype.createBufferSource = function () { window.__A.src++; return cb.apply(this, arguments); };
    const cg = AC.prototype.createGain;
    AC.prototype.createGain = function () { window.__A.nodes++; return cg.apply(this, arguments); };
  }
})();
"""


def req(path, method="GET"):
    r = urllib.request.Request(CDP + path, method=method)
    return json.loads(urllib.request.urlopen(r, timeout=10).read())


tab = req("/json/new?about:blank", "PUT")
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=120)
_id = [0]


def send(m, p=None):
    _id[0] += 1
    ws.send(json.dumps({"id": _id[0], "method": m, "params": p or {}}))
    while True:
        r = json.loads(ws.recv())
        if r.get("id") == _id[0]:
            return r.get("result", {})


def ev(e):
    r = send("Runtime.evaluate", {"expression": e, "returnByValue": True, "awaitPromise": False})
    return r.get("result", {}).get("value")


send("Page.enable")
send("Runtime.enable")
send("Performance.enable")
send("Page.addScriptToEvaluateOnNewDocument", {"source": INJECT})
send("Page.navigate", {"url": URL})
time.sleep(9)

print("页面:", ev("document.title"))
print("阶段:", ev("document.getElementById('phase').textContent"))
m0 = {x["name"]: x["value"] for x in send("Performance.getMetrics")["metrics"]}

ev("document.getElementById('startBtn').click()")
base = ev("({calls: __P.calls, tris: __P.tris, frames: __P.frames})")
time.sleep(3)
t0 = ev("__P.frames")
print("摇奖中采样（每 3s 一次）:")
for i in range(6):
    time.sleep(3)
    d = ev("({calls: __P.calls, tris: __P.tris, frames: __P.frames, "
           "tlen: __P.t.length, nodes: __A.nodes, src: __A.src})")
    print(f"  t={i*3+3:2d}s  frames={d['frames']:5d}  drawCalls={d['calls']:6d}  tris={d['tris']:9d}  "
          f"audioGain={d['nodes']:3d} audioSrc={d['src']:3d}")

time.sleep(6)
m1 = {x["name"]: x["value"] for x in send("Performance.getMetrics")["metrics"]}
info = ev("({calls: __P.calls, tris: __P.tris, frames: __P.frames, "
          "avg: __P.t.reduce((a,b)=>a+b,0)/Math.max(1,__P.t.length), "
          "max: Math.max.apply(null,__P.t), "
          "over25: __P.t.filter(v=>v>25).length})")
print("\n总计:")
print(f"  帧数={info['frames']}  平均帧间隔={info['avg']:.1f}ms  最差={info['max']:.1f}ms  >25ms 帧数={info['over25']}")
print(f"  draw call 总数={info['calls']}  三角面总数={info['tris']}")
if info["frames"]:
    print(f"  每帧 draw call ≈ {info['calls']/info['frames']:.1f}   每帧三角面 ≈ {info['tris']/info['frames']:.0f}")
for k in ["JSHeapUsedSize", "JSHeapTotalSize", "Nodes", "Documents", "TaskDuration"]:
    if k in m0 and k in m1:
        d = m1[k] - m0[k]
        unit = "MB" if "Heap" in k else ("s" if k == "TaskDuration" else "")
        if "Heap" in k:
            print(f"  {k}: {m0[k]/1048576:.1f} → {m1[k]/1048576:.1f} MB  ({d/1048576:+.2f} MB)")
        else:
            print(f"  {k}: {m0[k]:.0f} → {m1[k]:.0f}")

ws.close()
urllib.request.urlopen(CDP + "/json/close/" + tab["id"], timeout=5).read()
