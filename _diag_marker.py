# -*- coding: utf-8 -*-
import json, time, base64, urllib.request
import websocket
CDP = "http://127.0.0.1:9333"
def http(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())
tab = http("/json/new?" + "file:///E:/shuangseqiu-3d-sim/index.html".replace(":", "%3A").replace("/", "%2F"), "PUT")
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=400)
_id = [0]
def send(method, params=None):
    _id[0] += 1
    ws.send(json.dumps({"id": _id[0], "method": method, "params": params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == _id[0]:
            return msg.get("result", {})
def ev(expr):
    r = send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
    return r.get("result", {}).get("value")
send("Runtime.enable")
time.sleep(5)
# 不开摇奖：直接在红机轨道关键点放标记球（黄=轨道端点，红=物理球心应处位置）
ev("""(() => {
  const m = window.machines[0];
  const mk = (x,y,z,c) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), new THREE.MeshBasicMaterial({color:c}));
    s.position.set(x, y, z); scene.add(s);
  };
  // 上轨两端 + 中点（轴线处，黄）
  mk(-3.8, 2.30, 0.70, 0xffff00); mk(-3.2, 2.28, 0.70, 0xffff00); mk(-2.62, 2.25, 0.70, 0xffff00);
  // 下轨两端 + 中点（黄）
  mk(-2.52, 2.16, 0.70, 0xff00ff); mk(-3.8, 2.12, 0.52, 0xff00ff); mk(-4.9, 2.09, 0.52, 0xff00ff);
  // 球应处的槽底静止位（红）：上轨中点下方0.035、下轨左端
  mk(-3.2, 2.245, 0.70, 0xff0000); mk(-4.81, 2.057, 0.52, 0xff0000);
})()""")
time.sleep(1)
ev("camera.position.set(-1.6,2.6,2.6); controls.target.set(-3.9,2.25,0.55); controls.update();")
time.sleep(0.8)
d = send("Page.captureScreenshot", {"format": "png"})
open("E:/shuangseqiu-3d-sim/_markers.png", "wb").write(base64.b64decode(d["data"]))
print("已截图 _markers.png")
try:
    urllib.request.urlopen(urllib.request.Request(CDP + "/json/close/" + tab["id"]), timeout=5).read()
except Exception: pass
ws.close()
