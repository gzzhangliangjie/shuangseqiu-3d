# -*- coding: utf-8 -*-
import json, time, urllib.request
import websocket
CDP = "http://127.0.0.1:9333"
def http(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())
tab = http("/json/new?" + "file:///E:/shuangseqiu-3d-sim/index.html".replace(":", "%3A").replace("/", "%2F"), "PUT")
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=400)
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
last_draw_start = None
prev_filled = 0
while time.time() - t0 < 260:
    el = time.time() - t0
    filled = ev("[...document.querySelectorAll('.slot.filled')].length")
    ph = ev("window.machines[0].phase")
    if filled >= 6 and ph == 'done':
        print(f"[{el:5.1f}s] red 6/6 done"); break
    if ph == 'draw':
        st = ev("""(() => { const m = window.machines[0];
          const rb = m.balls.filter(b=>b.state==='rail').map(b=>[b.num, +(b.p.x-m.cx).toFixed(2), +b.p.y.toFixed(2), +(b.p.z-m.cz).toFixed(2), +Math.hypot(b.v.x,b.v.y,b.v.z).toFixed(2), !!b.placed]);
          return JSON.stringify({ho:m.holeOpen, stall:+(m.stallT||0).toFixed(1), capt: m.capturedBall?{num:m.capturedBall.num, placed:!!m.capturedBall.placed, railT:+(m.capturedBall.railT||0).toFixed(1), p:[+(m.capturedBall.p.x-m.cx).toFixed(2),+m.capturedBall.p.y.toFixed(2),+(m.capturedBall.p.z-m.cz).toFixed(2)]}:null, rb}); })()""")
        print(f"[{el:5.1f}s] filled={filled} {st}", flush=True)
        time.sleep(2)
    else:
        time.sleep(0.8)
http("/json/close/" + tab["id"])
ws.close()
print("结束")
