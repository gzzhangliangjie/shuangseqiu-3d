# -*- coding: utf-8 -*-
"""球面多数字特写：搅拌期贴近球壳拍球"""
import json, time, base64, urllib.request
import websocket

CDP = "http://127.0.0.1:9333"
URL = "http://127.0.0.1:8777/index.html"

def http(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())

tab = http("/json/new?" + URL.replace(":", "%3A").replace("/", "%2F"), "PUT")
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=90)
_id = [0]
def send(method, params=None):
    _id[0] += 1
    ws.send(json.dumps({"id": _id[0], "method": method, "params": params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == _id[0]:
            return msg.get("result", {})

send("Runtime.enable")
send("Runtime.evaluate", {"expression": "location.href='" + URL + "'"})
time.sleep(4)

def ev(expr):
    r = send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
    return r.get("result", {}).get("value")

def shot(name):
    d = send("Page.captureScreenshot", {"format": "png"})
    open(name, "wb").write(base64.b64decode(d["data"]))
    print("截图:", name)

send("Runtime.evaluate", {"expression": "document.getElementById('startBtn').click()"})
time.sleep(10)
# 球壳底部搅拌球特写
ev("""(() => { camera.position.set(-3.3, 3.5, 1.15); controls.target.set(-3.85, 3.05, 0.25); controls.update(); })()""")
time.sleep(0.6)
shot("_ball_close.png")
time.sleep(4)
ev("""(() => { camera.position.set(-4.4, 3.5, 1.15); controls.target.set(-3.85, 3.05, 0.25); controls.update(); })()""")
time.sleep(0.6)
shot("_ball_close2.png")
ws.close()
print("完成")
