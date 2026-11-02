# -*- coding: utf-8 -*-
import json, time, urllib.request
import websocket
CDP = "http://127.0.0.1:9333"
def http(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())
tab = http("/json/new?" + "file:///E:/shuangseqiu-3d-sim/index.html".replace(":", "%3A").replace("/", "%2F"), "PUT")
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
ev("""(() => {
  const mk = (x,y,z,c) => { const s = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), new THREE.MeshBasicMaterial({color:c})); s.position.set(x,y,z); scene.add(s); };
  mk(-3.8, 2.30, 0.70, 0xffff00); mk(-3.2, 2.28, 0.70, 0xffff00); mk(-2.62, 2.25, 0.70, 0xffff00);
  mk(-2.52, 2.16, 0.70, 0xff00ff); mk(-3.8, 2.12, 0.52, 0xff00ff); mk(-4.9, 2.09, 0.52, 0xff00ff);
  mk(-3.2, 2.245, 0.70, 0xff0000); mk(-4.81, 2.057, 0.52, 0xff0000);
})()""")
time.sleep(1)
ev("camera.position.set(-1.6,2.6,2.6); controls.target.set(-3.9,2.25,0.55); controls.update();")
time.sleep(0.8)
out = send("Runtime.evaluate", {"expression": """(() => {
  const cam = window.camera, W = innerWidth, H = innerHeight;
  const proj = (x,y,z) => { const v = new THREE.Vector3(x,y,z).project(cam); return [Math.round((v.x+1)/2*W), Math.round((1-v.y)/2*H)]; };
  return JSON.stringify({
    y1: proj(-3.8,2.30,0.70), y2: proj(-3.2,2.28,0.70), y3: proj(-2.62,2.25,0.70),
    m1: proj(-2.52,2.16,0.70), m2: proj(-3.8,2.12,0.52), m3: proj(-4.9,2.09,0.52),
    r1: proj(-3.2,2.245,0.70), r2: proj(-4.81,2.057,0.52)
  });
})()""", "returnByValue": True})
print("理论投影:", out["result"]["value"])
import base64
d = send("Page.captureScreenshot", {"format": "png"})
open("E:/shuangseqiu-3d-sim/_markers2.png", "wb").write(base64.b64decode(d["data"]))
try:
    urllib.request.urlopen(urllib.request.Request(CDP + "/json/close/" + tab["id"]), timeout=5).read()
except Exception: pass
ws.close()
