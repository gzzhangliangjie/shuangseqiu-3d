# -*- coding: utf-8 -*-
"""出球口近景对比截图：当前版 / 指定 git 版本"""
import json, time, base64, urllib.request, sys
import websocket

CDP = "http://127.0.0.1:9333"

def http(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())

def newtab(url):
    return http("/json/new?" + url.replace(":", "%3A").replace("/", "%2F"), "PUT")

def shoot(url, name, cam, tgt):
    tab = newtab(url)
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
    d = send("Page.captureScreenshot", {"format": "png"})
    open(name, "wb").write(base64.b64decode(d["data"]))
    print("截图:", name)
    ws.close()

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "file:///E:/shuangseqiu-3d-sim/index.html"
    name = sys.argv[2] if len(sys.argv) > 2 else "_shot.png"
    tab = newtab(url)
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
    # 全景
    d = send("Page.captureScreenshot", {"format": "png"})
    open(name.replace(".png", "_full.png"), "wb").write(base64.b64decode(d["data"]))
    print("截图:", name.replace(".png", "_full.png"))
    # 出球口近景（红球机左前方，对准出球口区域）
    send("Runtime.evaluate", {"expression": """
      camera.position.set(-2.4, 3.2, 3.4);
      controls.target.set(-3.8, 2.55, 0.4);
      controls.update();
    """, "returnByValue": True})
    time.sleep(0.8)
    d = send("Page.captureScreenshot", {"format": "png"})
    open(name, "wb").write(base64.b64decode(d["data"]))
    print("截图:", name)
    ws.close()
