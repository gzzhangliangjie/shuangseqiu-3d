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
time.sleep(5)
ev("document.getElementById('startBtn').click()")
t0 = time.time()
seen = set()
while time.time() - t0 < 170:
    el = time.time() - t0
    ph = ev("window.machines[1].phase")
    if ph and ph not in seen:
        seen.add(ph); print(f"[{el:5.1f}s] blue phase={ph}", flush=True)
    if ph == 'draw' and int(el * 2) % 10 == 0:
        info = ev("""(() => {
          const m = window.machines[1];
          const near = m.balls.filter(b=>b.state==='in').map(b=>{
            const dx=b.p.x-m.cx, dy=b.p.y-m.cy, dz=b.p.z-m.cz;
            const d=Math.hypot(dx,dy,dz);
            return {d:+d.toFixed(3), dot:+((dy*-0.7314+dz*0.6820)/d).toFixed(3)};
          }).sort((a,b)=>b.d-a.d).slice(0,4);
          const rail = m.balls.filter(b=>b.state==='rail').map(b=>[+(b.p.x-m.cx).toFixed(2),+b.p.y.toFixed(2),+b.p.z.toFixed(2),!!b.placed]);
          return JSON.stringify({holeOpen:m.holeOpen, capt:!!m.capturedBall, agit:+m.agit.toFixed(2), top:near, rail});
        })()""")
        print(f"[{el:5.1f}s] {info}", flush=True)
    if ph == 'done':
        n = ev("[...document.querySelectorAll('.slot.filled')].length"); print(f"[{el:5.1f}s] blue done, filled={n}")
        break
    time.sleep(0.5)
http("/json/close/" + tab["id"])
ws.close()
print("结束")
