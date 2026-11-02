# -*- coding: utf-8 -*-
import json, time, urllib.request
import websocket
CDP = "http://127.0.0.1:9333"
def http(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())
tab = http("/json/new?" + "file:///E:/shuangseqiu-3d-sim/index.html".replace(":", "%3A").replace("/", "%2F"), "PUT")
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=600)
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
time.sleep(5)
ev("document.getElementById('startBtn').click()")
t0 = time.time()
last_progress = time.time()
last_filled = -1
dumped = False
while time.time() - t0 < 400:
    el = time.time() - t0
    filled = ev("[...document.querySelectorAll('.slot.filled')].length")
    ph = ev("window.machines[0].phase + '|' + window.machines[1].phase")
    if filled != last_filled:
        last_filled = filled; last_progress = time.time()
    if time.time() - last_progress > 25 and not dumped:
        dumped = True
        print(f"\n!!!!! 卡滞 [{el:5.1f}s] filled={filled} phases={ph}", flush=True)
        dump = ev("""(() => {
          const out = {};
          for (let mi = 0; mi < 2; mi++) {
            const m = window.machines[mi];
            out['m'+mi] = {
              ph: m.phase, ho: m.holeOpen, agit: +m.agit.toFixed(2), timer: +m.timer.toFixed(1),
              stall: +(m.stallT||0).toFixed(1), drawsLeft: m.drawsLeft,
              capt: m.capturedBall ? {num:m.capturedBall.num, placed:!!m.capturedBall.placed, railT:+(m.capturedBall.railT||0).toFixed(1),
                p:[+(m.capturedBall.p.x-m.cx).toFixed(2),+m.capturedBall.p.y.toFixed(2),+(m.capturedBall.p.z-m.cz).toFixed(2)],
                v:[+m.capturedBall.v.x.toFixed(2),+m.capturedBall.v.y.toFixed(2),+m.capturedBall.v.z.toFixed(2)]} : null,
              rb: m.balls.filter(b=>b.state==='rail').map(b=>[b.num, +(b.p.x-m.cx).toFixed(2), +b.p.y.toFixed(2), +(b.p.z-m.cz).toFixed(2), +Math.hypot(b.v.x,b.v.y,b.v.z).toFixed(2), !!b.placed, +(b.railT||0).toFixed(1)]),
              states: m.balls.reduce((a,b)=>{a[b.state]=(a[b.state]||0)+1; return a;}, {}),
              acc: +(m.acc||0).toFixed(4)
            };
          }
          return JSON.stringify(out);
        })()""")
        print(dump, flush=True)
        break
    time.sleep(1)
try:
    urllib.request.urlopen(urllib.request.Request(CDP + "/json/close/" + tab["id"]), timeout=5).read()
except Exception: pass
ws.close()
print("结束")
