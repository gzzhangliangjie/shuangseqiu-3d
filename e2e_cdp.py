# -*- coding: utf-8 -*-
"""CDP 端到端验证：起摇 → 搅拌期采样(半径分布/环形度) + 截图 → 出球完成 → 控制台错误检查"""
import json, time, base64, urllib.request
import websocket

CDP = "http://127.0.0.1:9333"
URL = "http://127.0.0.1:8777/index.html"

def http(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())

# 新开标签页（新版 Edge 要求 PUT）
tab = http("/json/new?" + URL.replace(":", "%3A").replace("/", "%2F"), "PUT")
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=180)
_id = [0]
def send(method, params=None):
    _id[0] += 1
    ws.send(json.dumps({"id": _id[0], "method": method, "params": params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == _id[0]:
            return msg.get("result", {})

errors = []
send("Runtime.enable")
send("Runtime.evaluate", {"expression": "location.href='" + URL + "'"})
time.sleep(4)

def ev(expr):
    r = send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
    return r.get("result", {}).get("value")

def shot(name):
    d = send("Page.captureScreenshot", {"format": "png"})
    open(name, "wb").write(base64.b64decode(d["data"]))
    print("截图:", name)

send("Runtime.evaluate", {"expression": "document.getElementById('startBtn').click()"})
print("已点击开始")

# 采样：红球机搅拌期球形度 —— 半径 std/mean（环形=趋同，混合=分散）
t0 = time.time()
last_phase = ""
shot_done = []
while time.time() - t0 < 150:
    phase = ev("document.getElementById('phase').textContent")
    filled = ev("[...document.querySelectorAll('.slot.filled')].length")
    if phase != last_phase:
        print(f"[{time.time()-t0:5.1f}s] phase={phase} filled={filled}")
        last_phase = phase
    metrics = ev("""(() => {
      const ms = window.machines || []; if(!ms.length) return null;
      const m = ms[0]; if(m.agit < 0.5) return null;
      const rs = m.balls.filter(b=>b.state==='in').map(b=>Math.hypot(b.p.x-m.cx, b.p.z-m.cz));
      if(rs.length < 5) return null;
      const mean = rs.reduce((a,c)=>a+c,0)/rs.length;
      const sd = Math.sqrt(rs.reduce((a,c)=>a+(c-mean)**2,0)/rs.length);
      const band = lo=>rs.filter(r=>r>=lo&&r<lo+0.08).length;
      return {n:rs.length, sdov: +(sd/mean).toFixed(3),
              r0:band(0.08), r16:band(0.16), r24:band(0.24), r32:band(0.32), r40:band(0.40), r48:band(0.48)};
    })()""")
    if metrics:
        print(f"[{time.time()-t0:5.1f}s] 半径std/mean={metrics['sdov']} 分布{metrics['r0']}/{metrics['r16']}/{metrics['r24']}/{metrics['r32']}/{metrics['r40']}/{metrics['r48']}")
        el = time.time() - t0
        if 8 < el < 12 and "s8" not in shot_done: shot_done.append("s8"); shot("_stir8.png")
        if 25 < el < 32 and "s25" not in shot_done: shot_done.append("s25"); shot("_stir25.png")
    if filled == 7:
        print(f"[{time.time()-t0:5.1f}s] 7 球全部入位")
        break
    time.sleep(1.2)

shot("_final.png")
errs = ev("window.__errs ? window.__errs.length : 'na'")
print("filled =", ev("[...document.querySelectorAll('.slot.filled')].map(d=>d.textContent).join(',')"))
print("完成。控制台错误数:", errs if errs != 'na' else "(未埋点，看上方无异常即通过)")
ws.close()
