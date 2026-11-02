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
out = send("Runtime.evaluate", {"expression": """(() => {
  const out = [];
  scene.traverse(o => {
    if (o.isMesh && o.geometry && o.geometry.type === 'CylinderGeometry' && o.renderOrder === 7) {
      const g = o.geometry;
      const half = (g.parameters && g.parameters.thetaLength !== undefined) ? g.parameters.thetaLength : null;
      const side = new THREE.Vector3(1,0,0).applyQuaternion(o.quaternion);
      const axis = new THREE.Vector3(0,1,0).applyQuaternion(o.quaternion);
      out.push({pos:[+o.position.x.toFixed(2),+o.position.y.toFixed(2),+o.position.z.toFixed(2)],
        r:+g.parameters.radiusTop.toFixed(3), len:+g.parameters.height.toFixed(2),
        thetaStart:+(g.parameters.thetaStart||0).toFixed(2), thetaLen:+(half===null?-1:half).toFixed(2),
        side:[+side.x.toFixed(2),+side.y.toFixed(2),+side.z.toFixed(2)],
        axis:[+axis.x.toFixed(2),+axis.y.toFixed(2),+axis.z.toFixed(2)]});
    }
  });
  return JSON.stringify(out);
})()""", "returnByValue": True})
print(json.dumps(json.loads(out["result"]["value"]), indent=1, ensure_ascii=False))
try:
    urllib.request.urlopen(urllib.request.Request(CDP + "/json/close/" + tab["id"]), timeout=5).read()
except Exception: pass
ws.close()
