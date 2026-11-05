"""场景资源与渲染开销明细：draw call 构成、几何/纹理内存、合成耗时、帧时间分布。"""
import json, urllib.request, websocket, time

CDP = "http://127.0.0.1:9333"
URL = "http://127.0.0.1:8777/index.html?debug"


def req(path, method="GET"):
    r = urllib.request.Request(CDP + path, method=method)
    return json.loads(urllib.request.urlopen(r, timeout=10).read())


tab = req("/json/new?about:blank", "PUT")
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=180)
_id = [0]


def send(m, p=None):
    _id[0] += 1
    ws.send(json.dumps({"id": _id[0], "method": m, "params": p or {}}))
    while True:
        r = json.loads(ws.recv())
        if r.get("id") == _id[0]:
            return r.get("result", {})


def ev(e):
    r = send("Runtime.evaluate", {"expression": e, "returnByValue": True, "awaitPromise": True})
    if "exceptionDetails" in r:
        return "ERR: " + r["exceptionDetails"].get("text", "")
    return r.get("result", {}).get("value")


send("Page.enable")
send("Runtime.enable")
send("Page.navigate", {"url": URL})
time.sleep(9)

print("=== 静态资源 ===")
print(ev("""(() => {
  const r = __DBG.renderer, s = __DBG.scene;
  let meshes = 0, inst = 0, tris = 0, verts = 0, geos = new Set(), mats = new Set(), texs = new Set();
  const byType = {};
  s.traverse(o => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    if (o.isInstancedMesh) inst++; else meshes++;
    const t = o.geometry && o.geometry.type || '?';
    byType[t] = (byType[t] || 0) + 1;
    if (o.geometry) {
      geos.add(o.geometry.uuid);
      const g = o.geometry;
      verts += g.attributes.position ? g.attributes.position.count : 0;
      tris += g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
    }
    const mm = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mm) {
      if (!m) continue;
      mats.add(m.uuid);
      for (const k of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','envMap','alphaMap'])
        if (m[k]) texs.add(m[k].uuid);
    }
  });
  return { drawObjects: meshes + inst, meshes, instances: inst, uniqueGeometries: geos.size,
           triangles: Math.round(tris), vertices: verts, materials: mats.size, textures: texs.size,
           byType };
})()"""))

print("\n=== 渲染统计（摇奖中）===")
ev("document.getElementById('startBtn').click()")
time.sleep(4)
print(" 合成耗时(ms):", ev("__T && __T.build"))
print(ev("""(() => {
  const i = __DBG.renderer.info;
  return { drawCalls: i.render.calls, triangles: i.render.triangles, points: i.render.points,
           geometries: i.memory.geometries, textures: i.memory.textures,
           programs: i.programs ? i.programs.length : -1,
           shadowMap: !!__DBG.renderer.shadowMap.enabled };
})()"""))

print("\n帧时间分布（摇奖中 6s）:")
print(ev("""new Promise(res => {
  const t = []; let last = 0, n = 0;
  const f = ts => { if (last) t.push(ts - last); last = ts;
    if (++n < 360) requestAnimationFrame(f); else {
      t.sort((a,b)=>a-b);
      const q = p => +t[Math.floor(t.length*p)].toFixed(1);
      res({ frames: t.length, p50: q(.5), p90: q(.9), p99: q(.99),
            worst: +t[t.length-1].toFixed(1),
            over16: t.filter(v=>v>16.7).length, over33: t.filter(v=>v>33).length });
    }
  };
  requestAnimationFrame(f);
})"""))

ws.close()
urllib.request.urlopen(CDP + "/json/close/" + tab["id"], timeout=5).read()
