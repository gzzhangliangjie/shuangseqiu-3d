# -*- coding: utf-8 -*-
"""点开始后采样第二层滑道球位置, 并在球停稳时截图: python _probe.py"""
import json, time, base64, urllib.request, websocket
CDP = "http://127.0.0.1:9333"
URL = "file:///E:/shuangseqiu-3d-sim/index.html?v=" + str(int(time.time()))
def http(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())
tab = http("/json/new?" + URL.replace(":", "%3A").replace("/", "%2F"), "PUT")
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=300)
_id=[0]
def send(m,p=None):
    _id[0]+=1; ws.send(json.dumps({"id":_id[0],"method":m,"params":p or {}}))
    while True:
        msg=json.loads(ws.recv())
        if msg.get("id")==_id[0]: return msg.get("result",{})
send("Runtime.enable"); send("Page.bringToFront")
time.sleep(6)
send("Runtime.evaluate", {"expression":"startBtn && startBtn.click()"})
time.sleep(3)
# 相机对准用户截图视角
send("Runtime.evaluate", {"expression":"camera.position.set(-2.7,2.75,2.1);camera.fov=34;camera.updateProjectionMatrix();controls.target.set(-3.5,2.45,0.55);controls.update();"})
for i in range(45):
    r = send("Runtime.evaluate", {"expression": """
(() => {
  try {
    const m = machines.find(m=>m.key==='red');
    const out=[];
    for (const b of m.balls) {
      if (b.state==='rail') out.push({n:b.num, x:(b.p.x-m.cx).toFixed(3), y:b.p.y.toFixed(3),
        z:(b.p.z-m.cz).toFixed(3), v:Math.hypot(b.v.x,b.v.y,b.v.z).toFixed(3), pl:!!b.placed});
    }
    return JSON.stringify(out);
  } catch(e) { return 'ERR:'+e.message; }
})()
""", "returnByValue": True})
    v = r.get("result",{}).get("value")
    print(f"t={i*2}s", v)
    if i==40:
        d = send("Page.captureScreenshot", {"format":"png"})
        open("_probe.png","wb").write(base64.b64decode(d["data"]))
    time.sleep(2)
