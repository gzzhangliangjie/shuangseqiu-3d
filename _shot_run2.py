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
    ("_rail", (-2.6, 2.85, 2.45), (-3.3, 2.45, 0.65)),   # 两层滑道+落球洞侧视
    ("_rail2", (-4.9, 2.75, 1.95), (-3.3, 2.45, 0.62)),  # 左侧视
    ("_hole", (-3.8, 2.75, 2.0), (-3.8, 2.6, 0.75)),     # 洞区正面特写
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
