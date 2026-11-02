# -*- coding: utf-8 -*-
"""渲染验证：原始机位截预览架 + 搅拌近景截台面"""
import json, time, base64, urllib.request
import websocket

CDP = "http://127.0.0.1:9333"
URL = "http://127.0.0.1:8777/index.html"

def http(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())

tab = http("/json/new?" + URL.replace(":", "%3A").replace("/", "%2F"), "PUT")
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=120)
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

# 1) 原始机位：预览架半透明状态
shot("_rack_default.png")

# 2) 起摇后台面近景
send("Runtime.evaluate", {"expression": "document.getElementById('startBtn').click()"})
time.sleep(8)
ev("""(() => { camera.position.set(-2.6, 4.1, 2.2); controls.target.set(-3.8, 2.95, 0); controls.update(); })()""")
time.sleep(0.5)
shot("_tray_close.png")
ws.close()
print("完成")
