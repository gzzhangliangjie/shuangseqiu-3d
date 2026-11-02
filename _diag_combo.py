# -*- coding: utf-8 -*-
import json, time, base64, urllib.request
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
ev("camera.position.set(-1.6,2.6,2.6); controls.target.set(-3.9,2.25,0.55); controls.update();")
# 每 4s 检查一次：一旦 rail 球 >= 2，截图+转储
for i in range(40):
    time.sleep(4)
    n = ev("window.machines[0].balls.filter(b=>b.state==='rail').length")
    if n is None: continue
    print(f"[{(i+1)*4}s] rail balls = {n}", flush=True)
    if n >= 2:
        dump = ev("""JSON.stringify(window.machines[0].balls.filter(b=>b.state==='rail').map(b=>({
          num:b.num, rel:[+(b.p.x-window.machines[0].cx).toFixed(3),+b.p.y.toFixed(3),+(b.p.z-window.machines[0].cz).toFixed(3)],
          placed:!!b.placed})))""")
        print("转储:", dump, flush=True)
        d = send("Page.captureScreenshot", {"format": "png"})
        open("E:/shuangseqiu-3d-sim/_combo.png", "wb").write(base64.b64decode(d["data"]))
        print("已截图 _combo.png", flush=True)
        break
try:
    urllib.request.urlopen(urllib.request.Request(CDP + "/json/close/" + tab["id"]), timeout=5).read()
except Exception: pass
ws.close()
