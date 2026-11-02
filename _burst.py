# -*- coding: utf-8 -*-
import json, time, base64, urllib.request
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
send("Runtime.enable"); send("Page.bringToFront")
time.sleep(5)
ev("camera.position.set(-1.9,2.75,2.35); controls.target.set(-3.75,2.2,0.6); controls.update();")
ev("document.getElementById('startBtn').click()")
# 等到第一次有球滚向上轨右端（x_rel>0.6），开始连拍
for i in range(200):
    time.sleep(0.25)
    s = ev("JSON.stringify(window.machines[0].balls.filter(b=>b.state==='rail').map(b=>[b.num,+(b.p.x-window.machines[0].cx).toFixed(2),+b.p.y.toFixed(2),!!b.placed]))")
    try: arr = json.loads(s)
    except Exception: continue
    moving = [a for a in arr if not a[3] and a[1] > 0.25]
    if moving:
        print("触发连拍:", s)
        for k in range(8):
            d = send("Page.captureScreenshot", {"format": "png"})
            open(f"E:/shuangseqiu-3d-sim/_burst{k}.png", "wb").write(base64.b64decode(d["data"]))
            time.sleep(0.12)
        break
try:
    urllib.request.urlopen(urllib.request.Request(CDP + "/json/close/" + tab["id"]), timeout=5).read()
except Exception: pass
ws.close()
