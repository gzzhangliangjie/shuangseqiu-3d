# -*- coding: utf-8 -*-
"""逃逸复现：多轮完整摇奖，周期扫描 rail 球坐标——
球 y 低于下轨底(≈1.97)或坐标 NaN 即逃逸；验证洞→下轨捕获窗修复"""
import json, time, base64, urllib.request
import websocket

CDP = "http://127.0.0.1:9333"
URL = "http://127.0.0.1:8777/index.html"
ROUNDS = 3

def http(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())

def one_round(idx):
    tab = http("/json/new?" + URL.replace(":", "%3A").replace("/", "%2F"), "PUT")
    ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=200)
    tab_id = tab["id"]
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
    send("Runtime.evaluate", {"expression": "location.href='" + URL + "'"})
    for _ in range(60):                     # 等机器建好再点开始，避免整轮空转
        ready = send(3, "window.machines && machines.length === 2")
        if ready: break
        time.sleep(1)
    send("Runtime.evaluate", {"expression": "document.getElementById('startBtn').click()"})
    t0 = time.time()
    escaped = []
    filled = 0
    while time.time() - t0 < 170 and filled < 7:
        filled = ev("[...document.querySelectorAll('.slot.filled')].length") or 0
        esc = ev("""(() => {
          const out = [];
          for (const m of (window.machines||[]))
            for (const b of m.balls)
              if (b.state==='rail' && (b.p.y < 1.7 || !isFinite(b.p.x+b.p.y+b.p.z)))
                out.push({n: b.num, x:+b.p.x.toFixed(2), y:+b.p.y.toFixed(2), z:+b.p.z.toFixed(2),
                          vx:+b.v.x.toFixed(2), vy:+b.v.y.toFixed(2), vz:+b.v.z.toFixed(2)});
          return out.length ? out : null;
        })()""")
        if esc and not any(e["n"] == esc[0]["n"] for e in escaped):
            escaped.extend(esc)
            print(f"  [R{idx} {time.time()-t0:5.1f}s] 逃逸球! {esc}")
        time.sleep(1.0)
    print(f"R{idx}: filled={filled} 逃逸={len(escaped)} 耗时{time.time()-t0:.0f}s")
    ws.close()
    try: http("/json/close/" + tab_id)      # 关闭本标签，防止多轮 WebGL 实例堆积拖慢模拟
    except Exception: pass
    return filled, escaped

ok = True
for i in range(1, ROUNDS + 1):
    filled, esc = one_round(i)
    if filled != 7 or esc:
        ok = False
print("结论:", "全部通过，无逃逸" if ok else "存在逃逸/未完成，需继续修")
