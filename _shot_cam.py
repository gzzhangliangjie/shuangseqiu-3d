# -*- coding: utf-8 -*-
import json, time, base64, urllib.request, sys
import websocket
CDP = "http://127.0.0.1:9333"
def http(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())
url, out = sys.argv[1], sys.argv[2]
cx, cy, cz, tx, ty, tz = map(float, sys.argv[3:9])
tab = http("/json/new?" + url.replace(":", "%3A").replace("/", "%2F"), "PUT")
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
send("Runtime.evaluate", {"expression": f"""
  camera.position.set({cx}, {cy}, {cz});
  controls.target.set({tx}, {ty}, {tz});
  controls.update();
""", "returnByValue": True})
time.sleep(0.8)
d = send("Page.captureScreenshot", {"format": "png"})
open(out, "wb").write(base64.b64decode(d["data"]))
print("截图:", out)
http("/json/close/" + tab["id"])
ws.close()
