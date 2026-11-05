# -*- coding: utf-8 -*-
"""离线体检：把 _audio_render.js 导出的裸采样做频谱与包络分析。
   重点回答三个主观问题的客观依据：
     - 搅拌「尖不尖」→ 频谱重心 + 各频段能量占比（尖 = 能量堆在高频）
     - 下落「弱不弱/短不短」→ 时长 + 分段 RMS 包络
     - 「电子音感」→ 谱峰突出度：纯振荡器只有几根极细的峰，
       真实撞击是宽带 + 若干非谐波峰。峰数很少且极高 = 合成味。"""
import numpy as np, wave

SR = int(open('_sr.txt').read())
BANDS = [(0, 120), (120, 250), (250, 500), (500, 1000),
         (1000, 2000), (2000, 4000), (4000, 8000), (8000, 11025)]

def load(name):
    return np.fromfile(f'_{name}.raw', dtype=np.float32).astype(np.float64)

def spectrum(x):
    n = min(4096, len(x))
    win = np.hanning(n)
    # max(1, ...) 兜住「信号比窗还短」的情况（比如 0.17s 的出球声），否则 segs 为空
    segs = [x[i:i+n] * win for i in range(0, max(1, len(x) - n + 1), max(1, n // 2))]
    P = np.mean([np.abs(np.fft.rfft(s))**2 for s in segs], axis=0)
    return np.fft.rfftfreq(n, 1 / SR), P

def tonality(f, P):
    """谱峰突出度：只统计 150~5000Hz（听觉最敏感、合成味最明显的区间）。
       返回 (最强峰高出中位数多少 dB, 明显窄峰个数)。
       纯正弦/三角：1~3 个峰、高 40~60dB；噪声敲击：很多峰、普遍 <25dB。"""
    m = (f > 150) & (f < 5000)
    p = 10 * np.log10(P[m] + 1e-20)
    med = np.median(p)
    # 局部极大且比 3 邻域均值高 8dB 以上，才算「一根窄峰」
    peaks = [(p[i], p[i] - med) for i in range(2, len(p) - 2)
             if p[i] > p[i-2] and p[i] > p[i+2] and p[i] - med > 8]
    peaks.sort(reverse=True)
    return (peaks[0][1] if peaks else 0.0), len([x for x in peaks if x[1] > 15])

def report(name, label, loop=False):
    x = load(name)
    dur = len(x) / SR
    rms = np.sqrt(np.mean(x**2))
    pk = np.abs(x).max()
    f, P = spectrum(x)
    tot = P.sum()
    cent = (f * P).sum() / tot
    ton, npeak = tonality(f, P)
    print(f"\n===== {label} =====")
    print(f"时长 {dur:.2f}s  峰值 {pk:.3f}  RMS {rms:.4f} ({20*np.log10(max(rms,1e-9)):.1f} dBFS)"
          f"  波峰因数 {pk/max(rms,1e-9):.1f}  谱峰 {ton:.0f}dB / {npeak}根")
    print(f"频谱重心 {cent:.0f} Hz")
    for lo, hi in BANDS:
        m = (f >= lo) & (f < hi)
        pct = P[m].sum() / tot * 100 if tot else 0
        print(f"  {lo:>5}-{hi:<5}Hz {pct:>5.1f}%  " + '#' * int(round(pct / 2)))
    if loop:
        step = np.abs(np.diff(x)).mean()
        seam = abs(x[0] - x[-1])
        print(f"循环接缝跳变 {seam:.4f} vs 内部平均 {step:.4f} → {seam/max(step,1e-9):.1f}×")
    else:
        seg = max(1, int(SR * 0.05))
        env = [np.sqrt(np.mean(x[i:i+seg]**2)) for i in range(0, len(x) - seg, seg)]
        peak_env = max(env) if env else 0
        print("包络（每 50ms 的 RMS）:")
        for i, e in enumerate(env[:24]):
            print(f"  {i*0.05:>4.2f}s {e:.3f} " + '#' * int(round(e / max(peak_env, 1e-9) * 40)))
    with wave.open(f'_{name}.wav', 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())

report('fall', '② 下落')
for k, lb in [('hit', '③ 落位'), ('clunk', '④ 开局'), ('slide', '⑤ 开阀'),
              ('out', '⑥ 出球'), ('chime', '⑦ 完成'), ('tick', '⑧ 复位')]:
    report(k, lb)
