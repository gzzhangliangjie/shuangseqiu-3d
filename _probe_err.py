# -*- coding: utf-8 -*-
import json, time, urllib.request
import websocket
CDP = "http://127.0.0.1:9333"
def http(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())
tab = http("/json/new?" + "file:///E:/shuangseqiu-3d-sim/index.html".replace(":", "%3A").replace("/", "%2F"), "PUT")
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=600)
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
ev("window.__errs=[]; window.addEventListener('error',e=>window.__errs.push(String(e.message||e))); window.addEventListener('unhandledrejection',e=>window.__errs.push('rej:'+String(e.reason)));")
# 注入 rAF 心跳：记录每帧时间，冻结可检测
ev("window.__frames=[]; (function loop(t){ window.__frames.push(performance.now()); if(window.__frames.length>600) window.__frames.shift(); requestAnimationFrame(loop); })();")
time.sleep(4)
ev("document.getElementById('startBtn').click()")
t0 = time.time()
last_phase = ""
last_phase_t = time.time()
while time.time() - t0 < 300:
    el = time.time() - t0
    ph = ev("window.machines[0].phase + '|' + window.machines[1].phase")
    filled = ev("[...document.querySelectorAll('.slot.filled')].length")
    if ph != last_phase:
        last_phase = ph; last_phase_t = time.time()
        print(f"[{el:5.1f}s] {ph} filled={filled} errs={ev('window.__errs.length')}", flush=True)
    # 冻结检测：60s 阶段无变化
    if time.time() - last_phase_t > 60:
        fr = ev("window.__frames.length ? +(performance.now() - window.__frames[window.__frames.length-1]).toFixed(0) : -1")
        print(f"\n!!!!! 阶段冻结 [{el:5.1f}s] filled={filled} 最后帧距今={fr}ms errs={ev('JSON.stringify(window.__errs)')}", flush=True)
        print("状态:", ev("""JSON.stringify({m0:{ph:window.machines[0].phase,ho:window.machines[0].holeOpen,capt:!!window.machines[0].capturedBall,acc:+(window.machines[0].acc||0).toFixed(3)},m1:{ph:window.machines[1].phase,ho:window.machines[1].holeOpen,capt:!!window.machines[1].capturedBall}})"""), flush=True)
        break
    if filled == 7:
        print(f"[{el:5.1f}s] 7/7 完成 errs={ev('JSON.stringify(window.__errs)')}")
        break
    time.sleep(1)
try:
    urllib.request.urlopen(urllib.request.Request(CDP + "/json/close/" + tab["id"]), timeout=5).read()
except Exception: pass
ws.close()
print("结束")
