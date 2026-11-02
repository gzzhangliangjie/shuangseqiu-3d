# -*- coding: utf-8 -*-
"""近景视觉验证：拉近红球机盘面，搅拌期截图 + 径向散点"""
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

def close_cam():
    ev("""(() => {
      camera.position.set(-2.6, 4.1, 2.2);
      controls.target.set(-3.8, 2.95, 0);
      controls.update();
    })()""")

send("Runtime.evaluate", {"expression": "document.getElementById('startBtn').click()"})
print("已点击开始, t=0")
t0 = time.time()
mark = set()
while time.time() - t0 < 40:
    el = time.time() - t0
    if 7 < el < 8.5 and "a" not in mark:
        mark.add("a"); close_cam(); shot("_close_stir1.png")
        print("散点:", ev("""JSON.stringify(window.machines[0].balls.filter(b=>b.state==='in').map(b=>+(Math.hypot(b.p.x-window.machines[0].cx,b.p.z-window.machines[0].cz)).toFixed(2)).sort((a,b)=>a-b))"""))
    if 22 < el < 23.5 and "b" not in mark:
        mark.add("b"); shot("_close_stir2.png")
        print("散点:", ev("""JSON.stringify(window.machines[0].balls.filter(b=>b.state==='in').map(b=>+(Math.hypot(b.p.x-window.machines[0].cx,b.p.z-window.machines[0].cz)).toFixed(2)).sort((a,b)=>a-b))"""))
    time.sleep(0.5)
print("完成")
ws.close()
