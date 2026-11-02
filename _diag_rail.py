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
# 等 85s 让红机出 1-2 球
time.sleep(85)
out = ev("""(() => {
  const m = window.machines[0];
  return JSON.stringify({
    cx: m.cx, cz: m.cz,
    upper: window.UPPER_PTS, lower: window.LOWER_PTS, intro: window.INTRO_PTS,
    railBalls: m.balls.filter(b=>b.state==='rail').map(b=>({
      num:b.num, p:[+b.p.x.toFixed(3),+b.p.y.toFixed(3),+b.p.z.toFixed(3)],
      rel:[+(b.p.x-m.cx).toFixed(3),+b.p.y.toFixed(3),+(b.p.z-m.cz).toFixed(3)],
      v:[+b.v.x.toFixed(2),+b.v.y.toFixed(2),+b.v.z.toFixed(2)], placed:!!b.placed})),
  });
})()""")
print(out)
try:
    urllib.request.urlopen(urllib.request.Request(CDP + "/json/close/" + tab["id"]), timeout=5).read()
except Exception: pass
ws.close()
