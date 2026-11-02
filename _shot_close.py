# -*- coding: utf-8 -*-
"""近景截图：python _shot_close.py cx cy cz tx ty tz fov out"""
import json, time, base64, urllib.request, sys
import websocket
CDP = "http://127.0.0.1:9333"
URL = "file:///E:/shuangseqiu-3d-sim/index.html?v=" + str(int(time.time()))
def http(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())
cx, cy, cz, tx, ty, tz, fov = map(float, sys.argv[1:8])
out = sys.argv[8]
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
send("Page.enable"); send("Runtime.enable"); send("Page.bringToFront")
time.sleep(5)
send("Runtime.evaluate", {"expression": f"""
  document.querySelectorAll('.hud,.panel,.ui,#ui,#hud').forEach(e=>e.style.display='none');
  camera.position.set({cx},{cy},{cz});
  camera.fov = {fov}; camera.updateProjectionMatrix();
  controls.target.set({tx},{ty},{tz});
  controls.update(); renderer.render(scene, camera);
""", "returnByValue": True})
time.sleep(0.8)
d = send("Page.captureScreenshot", {"format": "png"})
open(out, "wb").write(base64.b64decode(d["data"]))
print("截图:", out)
