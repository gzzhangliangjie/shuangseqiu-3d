# -*- coding: utf-8 -*-
import json, time, urllib.request
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
ev("document.getElementById('startBtn').click()")
ev("camera.position.set(-1.6,2.6,2.6); controls.target.set(-3.9,2.25,0.55); controls.update();")
for i in range(45):
    time.sleep(4)
    n = ev("window.machines[0].balls.filter(b=>b.state==='rail').length")
    if n and n >= 2:
        # 找槽底的 trough mesh 屏幕位置 + 球的屏幕位置
        out = ev("""(() => {
  const m = window.machines[0], cam = window.camera;
  const W = innerWidth, H = innerHeight;
  const proj = p => { const v = new THREE.Vector3(p.x,p.y,p.z).project(cam); return [Math.round((v.x+1)/2*W), Math.round((1-v.y)/2*H)]; };
  const out = {W, H, balls: [], troughs: []};
  for (const b of m.balls.filter(b=>b.state==='rail')) {
    out.balls.push({num:b.num, world:[+b.p.x.toFixed(2),+b.p.y.toFixed(2),+b.p.z.toFixed(2)], screen:proj(b.p),
      mesh:[+b.mesh.position.x.toFixed(2),+b.mesh.position.y.toFixed(2),+b.mesh.position.z.toFixed(2)]});
  }
  scene.traverse(o => {
    if (o.isMesh && o.renderOrder===7 && o.geometry.type==='CylinderGeometry' && o.geometry.parameters.radiusTop>0.1 && o.geometry.parameters.thetaLength<4) {
      out.troughs.push({pos:proj(o.position), axis:[+new THREE.Vector3(0,1,0).applyQuaternion(o.quaternion).x.toFixed(2),
        +new THREE.Vector3(0,1,0).applyQuaternion(o.quaternion).y.toFixed(2), +new THREE.Vector3(0,1,0).applyQuaternion(o.quaternion).z.toFixed(2)]});
    }
  });
  return JSON.stringify(out);
})()""")
        print(out, flush=True)
        break
try:
    urllib.request.urlopen(urllib.request.Request(CDP + "/json/close/" + tab["id"]), timeout=5).read()
except Exception: pass
ws.close()
