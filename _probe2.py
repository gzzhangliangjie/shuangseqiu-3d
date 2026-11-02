# -*- coding: utf-8 -*-
import json, urllib.request
import websocket
CDP = "http://127.0.0.1:9333"
tabs = json.loads(urllib.request.urlopen(CDP + "/json/list", timeout=10).read())
print("标签页数:", len(tabs))
for t in tabs[:6]:
    print("-", t.get("type"), (t.get("url") or "")[:80])
target = [t for t in tabs if "index.html" in (t.get("url") or "")]
print("页面标签:", len(target))
if target:
    ws = websocket.create_connection(target[0]["webSocketDebuggerUrl"], timeout=30)
    ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
                        "params": {"expression": "typeof machines!=='undefined'? machines.length+'/'+machines[1].phase : 'no machines'", "returnByValue": True}}))
    print("状态:", ws.recv()[:300])
    ws.close()
