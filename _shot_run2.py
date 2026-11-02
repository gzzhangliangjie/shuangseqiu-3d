# -*- coding: utf-8 -*-
"""跑起来后按指定视角连拍：python _shot_run2.py 等待秒数 输出前缀"""
import json, time, base64, urllib.request, sys
import websocket

CDP = "http://127.0.0.1:9333"
URL = "file:///E:/shuangseqiu-3d-sim/index.html"
WAIT = float(sys.argv[1]) if len(sys.argv) > 1 else 45.0
PREFIX = sys.argv[2] if len(sys.argv) > 2 else "_r"

def http(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())

tab = http("/json/new?url=" + urllib.parse.quote(URL, safe=""), "PUT") if False else http("/json/new?" + URL.replace(":", "%3A").replace("/", "%2F"), "PUT")
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=240)
_id = [0]

def send(method, params=None):
    _id[0] += 1
    ws.send(json.dumps({"id": _id[0], "method": method, "params": params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == _id[0]:
            return msg.get("result", {})

send("Page.enable")
send("Runtime.enable")
send("Page.bringToFront")
time.sleep(4)
send("Runtime.evaluate", {"expression": "document.getElementById('startBtn').click()"})
time.sleep(WAIT)

VIEWS = [
    ("_rail", (-3.8 + 1.5, 2.20, 2.35), (-3.8, 1.95, 0.50)),   # 滑道侧视
    ("_rail2", (-3.8 - 0.2, 2.60, 2.05), (-3.8, 2.02, 0.55)),   # 滑道俯侧
    ("_hole", (-3.8, 2.50, 1.85), (-3.8, 2.78, 0.80)),          # 出球孔特写
]
for name, cam, tgt in VIEWS:
    send("Runtime.evaluate", {"expression": f"""
      camera.position.set({cam[0]},{cam[1]},{cam[2]});
      controls.target.set({tgt[0]},{tgt[1]},{tgt[2]});
      controls.update(); renderer.render(scene, camera);
    """, "returnByValue": True})
    time.sleep(0.6)
    d = send("Page.captureScreenshot", {"format": "png"})
    fn = PREFIX + name + ".png"
    open(fn, "wb").write(base64.b64decode(d["data"]))
    print("截图:", fn)
