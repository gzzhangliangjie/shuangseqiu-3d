# -*- coding: utf-8 -*-
"""隐藏区域网格: python _hide_region.py x0 x1 y0 y1 z0 z1"""
import json, time, sys, urllib.request, websocket
CDP = "http://127.0.0.1:9333"
URL = "file:///E:/shuangseqiu-3d-sim/index.html?v=" + str(int(time.time()))
def http(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())
x0,x1,y0,y1,z0,z1 = map(float, sys.argv[1:7])
tab = http("/json/new?" + URL.replace(":", "%3A").replace("/", "%2F"), "PUT")
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=60)
_id=[0]
def send(m,p=None):
    _id[0]+=1; ws.send(json.dumps({"id":_id[0],"method":m,"params":p or {}}))
    while True:
        msg=json.loads(ws.recv())
        if msg.get("id")==_id[0]: return msg.get("result",{})
time.sleep(6)
expr = f"""
(() => {{
  let n=0;
  scene.traverse(o=>{{
    if(!o.isMesh||!o.geometry) return;
    o.geometry.computeBoundingSphere();
    const c=o.geometry.boundingSphere.center.clone().applyMatrix4(o.matrixWorld);
    if(c.x>{x0}&&c.x<{x1}&&c.y>{y0}&&c.y<{y1}&&c.z>{z0}&&c.z<{z1}){{ o.visible=false; n++; }}
  }});
  return n;
}})()
"""
res = send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
print("hidden:", res.get("result",{}).get("value"))
