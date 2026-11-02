# -*- coding: utf-8 -*-
import json, time, urllib.request
import websocket
CDP = "http://127.0.0.1:9333"
def http(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())
tab = http("/json/new?" + "file:///E:/shuangseqiu-3d-sim/index.html".replace(":", "%3A").replace("/", "%2F"), "PUT")
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=300)
_id = [0]
def send(method, params=None):
    _id[0] += 1
    ws.send(json.dumps({"id": _id[0], "method": method, "params": params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == _id[0]:
            return msg.get("result", {})
def ev(expr):
    r = send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
    return r.get("result", {}).get("value")
send("Runtime.enable")
send("Page.bringToFront")
time.sleep(5)
# 注入逐帧审计：每帧记录滑道球到最近槽轴线的距离（>RAIL_R 即脱离槽体=空中飞）
ev("""(() => {
  window.__audit = [];
  const SEGS = window.RAIL_SEGS, cx = window.machines[0].cx, cz = window.machines[0].cz;
  function minDist(p) {
    let best = 1e9, bi = -1;
    for (let i = 0; i < SEGS.length; i++) {
      const [a, c] = SEGS[i];
      const ax = cx + a[0], ay = a[1], az = cz + a[2];
      const dx = cx + c[0] - ax, dy = c[1] - ay, dz = cz + c[2] - az;
      const L2 = dx*dx + dy*dy + dz*dz;
      let t = ((p.x-ax)*dx + (p.y-ay)*dy + (p.z-az)*dz) / L2;
      t = Math.max(0, Math.min(1, t));
      const qx = ax + dx*t, qy = ay + dy*t, qz = az + dz*t;
      const d = Math.hypot(p.x-qx, p.y-qy, p.z-qz);
      if (d < best) { best = d; bi = i; }
    }
    return [best, bi];
  }
  (function loop() {
    requestAnimationFrame(loop);
    const m = window.machines[0];
    for (const b of m.balls) {
      if (b.state !== 'rail' && b.state !== 'tube') continue;
      const [d, si] = minDist(b.p);
      window.__audit.push({t: +performance.now().toFixed(0), num: b.num, st: b.state,
        p: [+b.p.x.toFixed(3), +b.p.y.toFixed(3), +b.p.z.toFixed(3)], d: +d.toFixed(3), seg: si,
        esc: d > window.RAIL_R + 0.02 ? 1 : 0});
    }
    if (window.__audit.length > 200000) window.__audit.splice(0, 50000);
  })();
})()""")
ev("document.getElementById('startBtn').click()")
time.sleep(70)
out = ev("""(() => {
  const A = window.__audit.filter(a => a.st === 'rail');
  const esc = A.filter(a => a.esc);
  const nums = [...new Set(A.map(a => a.num))];
  let report = [];
  for (const n of nums) {
    const tr = A.filter(a => a.num === n);
    const e = esc.filter(a => a.num === n);
    report.push({num: n, frames: tr.length, escFrames: e.length,
      maxD: Math.max(...tr.map(a => a.d)),
      escPts: e.slice(0, 3).map(a => a.p.concat([a.d, a.seg]))});
  }
  return JSON.stringify(report);
})()""")
print("轨迹审计:", out)
try:
    urllib.request.urlopen(urllib.request.Request(CDP + "/json/close/" + tab["id"]), timeout=5).read()
except Exception: pass
ws.close()
