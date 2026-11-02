# -*- coding: utf-8 -*-
import json, time, base64, urllib.request, sys
import websocket
CDP = "http://127.0.0.1:9333"
def http(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())
url, out = sys.argv[1], sys.argv[2]
wait = float(sys.argv[3]) if len(sys.argv) > 3 else 75
cam = [float(x) for x in sys.argv[4:10]] if len(sys.argv) > 9 else [-1.6, 2.6, 2.6, -3.9, 2.25, 0.55]
tab = http("/json/new?" + url.replace(":", "%3A").replace("/", "%2F"), "PUT")
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=300)
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
send("Runtime.evaluate", {"expression": "document.getElementById('startBtn').click()", "returnByValue": True})
time.sleep(wait)
send("Runtime.evaluate", {"expression": f"camera.position.set({cam[0]},{cam[1]},{cam[2]}); controls.target.set({cam[3]},{cam[4]},{cam[5]}); controls.update();", "returnByValue": True})
time.sleep(0.8)
d = send("Page.captureScreenshot", {"format": "png"})
open(out, "wb").write(base64.b64decode(d["data"]))
print("截图:", out)
try:
    urllib.request.urlopen(urllib.request.Request(CDP + "/json/close/" + tab["id"]), timeout=5).read()
except Exception: pass
ws.close()
