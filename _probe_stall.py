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
stall_start = None
while time.time() - t0 < 200:
    el = time.time() - t0
    st = ev("""(() => { const m = window.machines[0];
      return JSON.stringify({ph:m.phase, ho:m.holeOpen, capt: m.capturedBall?{num:m.capturedBall.num, placed:!!m.capturedBall.placed, settle:+(m.capturedBall.settle||0).toFixed(2),
        p:[+(m.capturedBall.p.x-m.cx).toFixed(2), +m.capturedBall.p.y.toFixed(2), +(m.capturedBall.p.z-m.cz).toFixed(2)],
        v:[+m.capturedBall.v.x.toFixed(2),+m.capturedBall.v.y.toFixed(2),+m.capturedBall.v.z.toFixed(2)]}:null}); })()""")
    d = json.loads(st)
    key = (d['ph'], d['ho'], bool(d['capt']))
    if d['ph'] == 'draw' and d['capt'] and not d['capt']['placed']:
        if stall_start is None: stall_start = el; print(f"[{el:5.1f}s] 捕获未入位:", st, flush=True)
        elif el - stall_start > 15:
            # 深挖：滑道球全部位置
            rail = ev("""JSON.stringify(window.machines[0].balls.filter(b=>b.state==='rail').map(b=>[b.num, +(b.p.x-window.machines[0].cx).toFixed(2), +b.p.y.toFixed(2), +(b.p.z-window.machines[0].cz).toFixed(2), +b.v.y.toFixed(2), !!b.placed]))""")
            print(f"[{el:5.1f}s] 卡住>15s 滑道球:", rail, flush=True)
            break
    else:
        stall_start = None
        if el < 90 and int(el*2)%20==0: print(f"[{el:5.1f}s] {st}", flush=True)
    if d['ph'] == 'done': print(f"[{el:5.1f}s] red done"); break
    time.sleep(0.5)
http("/json/close/" + tab["id"])
ws.close()
print("结束")
