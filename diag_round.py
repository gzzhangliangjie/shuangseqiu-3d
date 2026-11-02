# -*- coding: utf-8 -*-
"""单轮验证：等机器就绪 → 开始摇奖 → 7 球入位/超时；打印结果"""
import json, time, urllib.request, websocket
CDP = "http://127.0.0.1:9333"; URL = "http://127.0.0.1:8777/index.html"
def http(p, m="GET"):
    return json.loads(urllib.request.urlopen(urllib.request.Request(CDP + p, method=m), timeout=5).read())
tab = http("/json/new?" + URL.replace(":", "%3A").replace("/", "%2F"), "PUT")
tid = tab["id"]
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=200)
_id = [0]
def send(e):
    _id[0] += 1
    ws.send(json.dumps({"id": _id[0], "method": "Runtime.evaluate", "params": {"expression": e, "returnByValue": True}}))
    end = time.time() + 8
    while time.time() < end:
        try: m = json.loads(ws.recv())
        except Exception: return None
        if m.get("id") == _id[0]: return m.get("result", {}).get("result", {}).get("value")
    return None
send("location.href='" + URL + "'")
ready = False
for _ in range(60):
    if send("window.machines && machines.length===2"): ready = True; break
    time.sleep(1)
if not ready:
    print("R?: machines NOT ready")
else:
    send("document.getElementById('startBtn').click()")
    t0 = time.time(); filled = 0
    while time.time() - t0 < 170:
        filled = send("[...document.querySelectorAll('.slot.filled')].length") or 0
        if filled == 7: break
        time.sleep(2)
    detail = ""
    if filled < 7:
        d = send("""JSON.stringify((()=>{const out=[];
          for(const mi of (window.machines||[])){ if(mi.key!=='red') continue;
            for(const b of mi.balls){ if(b.state==='rail'&&(!b.placed)) out.push({BALL:b.num,x:+b.p.x.toFixed(2),y:+b.p.y.toFixed(2),vx:+b.v.x.toFixed(2),railT:+(b.railT||0).toFixed(1)}); }
          } return out;})())""")
        detail = "  STUCK " + (d or "?")
    print(f"filled={filled} {time.time()-t0:.0f}s{detail}")
ws.close()
try: http("/json/close/" + tid)
except Exception: pass
