# -*- coding: utf-8 -*-
import json, time, base64, urllib.request, sys
import websocket
CDP = "http://127.0.0.1:9333"
def http(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())
tab = http("/json/new?" + sys.argv[1].replace(":", "%3A").replace("/", "%2F"), "PUT")
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
time.sleep(5)
send("Runtime.evaluate", {"expression": """
  camera.position.set(-1.9, 3.35, 3.6);
  controls.target.set(-3.8, 2.72, 0.75);
  controls.update();
""", "returnByValue": True})
time.sleep(0.8)
d = send("Page.captureScreenshot", {"format": "png"})
open(sys.argv[2], "wb").write(base64.b64decode(d["data"]))
print("截图:", sys.argv[2])
ws.close()
