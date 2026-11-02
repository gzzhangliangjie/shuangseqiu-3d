# -*- coding: utf-8 -*-
import json, time, urllib.request, websocket
CDP = "http://127.0.0.1:9333"
URL = "file:///E:/shuangseqiu-3d-sim/index.html"
def http(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())
tab = http("/json/new?" + URL.replace(":", "%3A").replace("/", "%2F"), "PUT")
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=60)
_id=[0]
def send(m,p=None):
    _id[0]+=1; ws.send(json.dumps({"id":_id[0],"method":m,"params":p or {}}))
    while True:
        msg=json.loads(ws.recv())
        if msg.get("id")==_id[0]: return msg.get("result",{})
time.sleep(5)
expr = r"""
(() => {
  const out = [];
  for (const m of window.machines) {
    if (m.key !== 'red') continue;
    scene.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      o.geometry.computeBoundingSphere();
      const bs = o.geometry.boundingSphere;
      const c = bs.center.clone().applyMatrix4(o.matrixWorld);
      const r = bs.radius * o.getWorldScale(new window.THREE.Vector3()).x;
      if (c.y > 2.1 && c.y < 2.85 && c.x > -3.75 && c.x < -3.0 && c.z > 0.35 && c.z < 1.1) {
        out.push({type:o.geometry.type, pos:[c.x.toFixed(2),c.y.toFixed(2),c.z.toFixed(2)], r:r.toFixed(2)});
      }
    });
  }
  return JSON.stringify(out);
})()
"""
res = send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
import sys
v = res.get("result",{}).get("value")
print(v if v else json.dumps(res)[:1500])
