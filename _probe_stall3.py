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
draw_seen = {}
while time.time() - t0 < 400:
    el = time.time() - t0
    filled = ev("[...document.querySelectorAll('.slot.filled')].length")
    if filled is None: time.sleep(1); continue
    st = ev("""(() => { const m = window.machines[0];
      const rb = m.balls.filter(b=>b.state==='rail').map(b=>[b.num, +(b.p.x-m.cx).toFixed(2), +b.p.y.toFixed(2), +(b.p.z-m.cz).toFixed(2), +Math.hypot(b.v.x,b.v.y,b.v.z).toFixed(2), !!b.placed]);
      const top = m.balls.filter(b=>b.state==='in'&&!b.tube).map(b=>({d:+Math.hypot(b.p.x-m.cx,b.p.y-m.cy,b.p.z-m.cz).toFixed(2), y:+(b.p.y).toFixed(2), z:+(b.p.z-m.cz).toFixed(2)})).sort((a,b)=>b.d-a.d).slice(0,3);
      return JSON.stringify({ph:m.ph||m.phase, ho:m.holeOpen, stall:+(m.stallT||0).toFixed(1), agit:+m.agit.toFixed(2),
        capt: m.capturedBall?{num:m.capturedBall.num, placed:!!m.capturedBall.placed, railT:+(m.capturedBall.railT||0).toFixed(1)}:null, rb, top}); })()""")
    d = json.loads(st)
    key = (filled, d['ho'], d['capt'] is not None)
    draw_seen.setdefault(key, []).append(el)
    # 卡滞判定：同一 (filled, ho, capt) 组合持续 > 18s
    if len(draw_seen[key]) > 1 and el - draw_seen[key][0] > 18:
        print(f"\n!!!!! 卡滞复现 [{el:5.1f}s] filled={filled} 持续{el-draw_seen[key][0]:.0f}s", flush=True)
        print("状态:", st, flush=True)
        break
    if int(el) % 12 < 0.6:
        print(f"[{el:5.1f}s] filled={filled} ho={d['ho']} capt={d['capt'] is not None} stall={d['stall']} rb={len(d['rb'])}", flush=True)
    time.sleep(0.5)
time.sleep(0.2)
try:
    urllib.request.urlopen(urllib.request.Request(CDP + "/json/close/" + tab["id"]), timeout=5).read()
except Exception: pass
ws.close()
print("结束")
