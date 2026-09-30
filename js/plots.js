/*
 * plots.js — 図（SVG 文字列）を作る
 * 色は CSS 変数（--plot-*）で決めるので、ライト／ダークの両方で読める。
 * Copyright (c) 2026 K.Yamamoto — MIT License
 */
(function (root) {
  'use strict';
  const P = {};
  const W = 520, H = 340, M = { l: 62, r: 18, t: 18, b: 52 };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const SERIES = ['var(--plot-1)', 'var(--plot-2)', 'var(--plot-3)', 'var(--plot-4)', 'var(--plot-5)', 'var(--plot-6)'];
  P.SERIES = SERIES;

  // 見やすい目盛り
  function ticks(lo, hi, n = 5) {
    if (!isFinite(lo) || !isFinite(hi)) return [0, 1];
    if (lo === hi) { lo -= 1; hi += 1; }
    const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw) || raw;
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  const fmtTick = v => (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(1) : String(+v.toPrecision(6)));

  function frame(xr, yr, opt) {
    const x0 = M.l, x1 = W - M.r, y0 = H - M.b, y1 = M.t;
    const sx = v => x0 + (v - xr[0]) / (xr[1] - xr[0]) * (x1 - x0);
    const sy = v => y0 - (v - yr[0]) / (yr[1] - yr[0]) * (y0 - y1);
    let g = '';
    const yt = opt.yticks || ticks(yr[0], yr[1]);
    for (const t of yt) {
      if (t < yr[0] - 1e-9 || t > yr[1] + 1e-9) continue;
      g += `<line x1="${x0}" x2="${x1}" y1="${sy(t)}" y2="${sy(t)}" class="grid"/>`;
      g += `<text x="${x0 - 8}" y="${sy(t) + 4}" text-anchor="end" class="tick">${fmtTick(t)}</text>`;
    }
    if (!opt.categorical) {
      for (const t of ticks(xr[0], xr[1])) {
        if (t < xr[0] - 1e-9 || t > xr[1] + 1e-9) continue;
        g += `<line x1="${sx(t)}" x2="${sx(t)}" y1="${y0}" y2="${y0 + 5}" class="axis"/>`;
        g += `<text x="${sx(t)}" y="${y0 + 19}" text-anchor="middle" class="tick">${fmtTick(t)}</text>`;
      }
    }
    g += `<line x1="${x0}" x2="${x1}" y1="${y0}" y2="${y0}" class="axis"/>`;
    g += `<line x1="${x0}" x2="${x0}" y1="${y0}" y2="${y1}" class="axis"/>`;
    if (opt.xlab) g += `<text x="${(x0 + x1) / 2}" y="${H - 10}" text-anchor="middle" class="lab">${esc(opt.xlab)}</text>`;
    if (opt.ylab) g += `<text transform="translate(16 ${(y0 + y1) / 2}) rotate(-90)" text-anchor="middle" class="lab">${esc(opt.ylab)}</text>`;
    return { g, sx, sy, x0, x1, y0, y1 };
  }
  const svg = (body, label) => `<svg class="plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label || '図')}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  function pad(lo, hi, f = 0.06) { const d = (hi - lo) || Math.abs(hi) || 1; return [lo - d * f, hi + d * f]; }

  // ヒストグラム（Sturges の規則）＋ 密度曲線は描かない
  P.histogram = function (v, xlab) {
    const n = v.length; if (!n) return '';
    const lo = Math.min(...v), hi = Math.max(...v);
    const k = Math.max(1, Math.ceil(Math.log2(n) + 1));
    const tk = ticks(lo, hi, k), step = tk.length > 1 ? tk[1] - tk[0] : 1;
    const start = Math.floor(lo / step) * step;
    const nb = Math.floor((hi - start) / step + 1e-9) + 1;
    const counts = new Array(nb).fill(0);
    for (const x of v) counts[Math.min(nb - 1, Math.floor((x - start) / step + 1e-9))]++;
    const ymax = Math.max(...counts);
    const f = frame([start, start + nb * step], [0, ymax * 1.08], { xlab, ylab: '度数', yticks: ticks(0, ymax * 1.08).filter(t => Number.isInteger(t)) });
    let b = f.g;
    counts.forEach((c, i) => {
      const x = f.sx(start + i * step), w = f.sx(start + (i + 1) * step) - x;
      b += `<rect x="${x + 0.5}" y="${f.sy(c)}" width="${Math.max(0, w - 1)}" height="${f.y0 - f.sy(c)}" class="bar"><title>${fmtTick(start + i * step)}–${fmtTick(start + (i + 1) * step)}: ${c}</title></rect>`;
    });
    return svg(b, `${xlab} のヒストグラム`);
  };

  // 箱ひげ図（ひげは 1.5 IQR まで、外れ値は点）
  P.boxplot = function (groups, labels, ylab) {
    const all = [].concat(...groups);
    if (!all.length) return '';
    const yr = pad(Math.min(...all), Math.max(...all));
    const f = frame([0, groups.length], yr, { ylab, categorical: true });
    let b = f.g;
    const Q = root.Stats.quantile;
    groups.forEach((g, i) => {
      if (!g.length) return;
      const s = g.slice().sort((a, c) => a - c);
      const q1 = Q(s, 0.25, true), md = Q(s, 0.5, true), q3 = Q(s, 0.75, true), iqr = q3 - q1;
      const lo = s.find(x => x >= q1 - 1.5 * iqr), hi = [...s].reverse().find(x => x <= q3 + 1.5 * iqr);
      const cx = f.sx(i + 0.5), bw = Math.min(70, (f.x1 - f.x0) / groups.length * 0.45);
      const col = SERIES[i % SERIES.length];
      b += `<line x1="${cx}" x2="${cx}" y1="${f.sy(lo)}" y2="${f.sy(q1)}" class="whisker"/>`;
      b += `<line x1="${cx}" x2="${cx}" y1="${f.sy(q3)}" y2="${f.sy(hi)}" class="whisker"/>`;
      b += `<line x1="${cx - bw / 4}" x2="${cx + bw / 4}" y1="${f.sy(lo)}" y2="${f.sy(lo)}" class="whisker"/>`;
      b += `<line x1="${cx - bw / 4}" x2="${cx + bw / 4}" y1="${f.sy(hi)}" y2="${f.sy(hi)}" class="whisker"/>`;
      b += `<rect x="${cx - bw / 2}" y="${f.sy(q3)}" width="${bw}" height="${Math.max(1, f.sy(q1) - f.sy(q3))}" rx="3" style="fill:${col};fill-opacity:.28;stroke:${col}" stroke-width="1.5"><title>Q1 ${fmtTick(q1)} / 中央値 ${fmtTick(md)} / Q3 ${fmtTick(q3)}</title></rect>`;
      b += `<line x1="${cx - bw / 2}" x2="${cx + bw / 2}" y1="${f.sy(md)}" y2="${f.sy(md)}" style="stroke:${col}" stroke-width="2.5"/>`;
      for (const x of s) if (x < lo || x > hi) b += `<circle cx="${cx}" cy="${f.sy(x)}" r="3" class="outlier"/>`;
      b += `<text x="${cx}" y="${f.y0 + 19}" text-anchor="middle" class="tick">${esc(labels[i])}</text>`;
    });
    return svg(b, `${ylab} の箱ひげ図`);
  };

  // 散布図（回帰直線つき）
  P.scatter = function (x, y, xlab, ylab, line) {
    if (!x.length) return '';
    const f = frame(pad(Math.min(...x), Math.max(...x)), pad(Math.min(...y), Math.max(...y)), { xlab, ylab });
    let b = f.g;
    for (let i = 0; i < x.length; i++) b += `<circle cx="${f.sx(x[i]).toFixed(1)}" cy="${f.sy(y[i]).toFixed(1)}" r="3.5" class="dot"/>`;
    if (line && x.length > 2) {
      const S = root.Stats, mx = S.mean(x), my = S.mean(y);
      let sxy = 0, sxx = 0;
      for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
      if (sxx > 0) {
        const bb = sxy / sxx, a = my - bb * mx, lo = Math.min(...x), hi = Math.max(...x);
        b += `<line x1="${f.sx(lo)}" x2="${f.sx(hi)}" y1="${f.sy(a + bb * lo)}" y2="${f.sy(a + bb * hi)}" class="fitline"/>`;
      }
    }
    return svg(b, `${xlab} と ${ylab} の散布図`);
  };

  // 平均値と信頼区間（series ごとに線でつなぐ）
  // cells: [{x: 水準番号, s: 系列番号, m, lo, hi}]
  P.means = function (xLabels, seriesLabels, cells, xlab, ylab) {
    const vals = cells.flatMap(c => [c.lo, c.hi, c.m]).filter(isFinite);
    if (!vals.length) return '';
    const f = frame([0, xLabels.length], pad(Math.min(...vals), Math.max(...vals), 0.1), { xlab, ylab, categorical: true });
    let b = f.g;
    const ns = seriesLabels.length, dodge = ns > 1 ? 0.12 : 0;
    xLabels.forEach((l, i) => { b += `<text x="${f.sx(i + 0.5)}" y="${f.y0 + 19}" text-anchor="middle" class="tick">${esc(l)}</text>`; });
    seriesLabels.forEach((sl, s) => {
      const col = SERIES[s % SERIES.length];
      const pts = cells.filter(c => c.s === s && isFinite(c.m)).sort((a, c) => a.x - c.x)
        .map(c => ({ ...c, px: f.sx(c.x + 0.5 + (s - (ns - 1) / 2) * dodge) }));
      if (pts.length > 1) b += `<polyline points="${pts.map(p => `${p.px},${f.sy(p.m)}`).join(' ')}" fill="none" style="stroke:${col}" stroke-width="2"/>`;
      for (const p of pts) {
        if (isFinite(p.lo) && isFinite(p.hi)) {
          b += `<line x1="${p.px}" x2="${p.px}" y1="${f.sy(p.lo)}" y2="${f.sy(p.hi)}" style="stroke:${col}" stroke-width="1.5"/>`;
          b += `<line x1="${p.px - 6}" x2="${p.px + 6}" y1="${f.sy(p.lo)}" y2="${f.sy(p.lo)}" style="stroke:${col}" stroke-width="1.5"/>`;
          b += `<line x1="${p.px - 6}" x2="${p.px + 6}" y1="${f.sy(p.hi)}" y2="${f.sy(p.hi)}" style="stroke:${col}" stroke-width="1.5"/>`;
        }
        b += `<circle cx="${p.px}" cy="${f.sy(p.m)}" r="5" style="fill:${col}" class="meanpt"><title>${fmtTick(p.m)}</title></circle>`;
      }
    });
    if (ns > 1) {
      seriesLabels.forEach((sl, s) => {
        const y = M.t + 6 + s * 18;
        b += `<circle cx="${W - M.r - 110}" cy="${y}" r="5" style="fill:${SERIES[s % SERIES.length]}"/>`;
        b += `<text x="${W - M.r - 100}" y="${y + 4}" class="tick">${esc(sl)}</text>`;
      });
    }
    return svg(b, `${ylab} の平均値`);
  };

  // 正規 Q-Q プロット
  P.qq = function (v, lab) {
    const n = v.length; if (n < 3) return '';
    const S = root.Stats, s = S.sorted(v), m = S.mean(v), sd = S.sd(v);
    const z = s.map((x, i) => S.qnorm((i + 1 - 0.375) / (n + 0.25)));
    const std = s.map(x => (x - m) / sd);
    const lim = pad(Math.min(z[0], std[0]), Math.max(z[n - 1], std[n - 1]));
    const f = frame(lim, lim, { xlab: '理論分位点', ylab: `標準化した${lab}` });
    let b = f.g + `<line x1="${f.sx(lim[0])}" x2="${f.sx(lim[1])}" y1="${f.sy(lim[0])}" y2="${f.sy(lim[1])}" class="fitline"/>`;
    for (let i = 0; i < n; i++) b += `<circle cx="${f.sx(z[i]).toFixed(1)}" cy="${f.sy(std[i]).toFixed(1)}" r="3.5" class="dot"/>`;
    return svg(b, `${lab} の Q-Q プロット`);
  };

  // 棒グラフ（度数）
  P.bars = function (labels, counts, xlab) {
    if (!counts.length) return '';
    const ymax = Math.max(...counts);
    const f = frame([0, labels.length], [0, ymax * 1.1], { xlab, ylab: '度数', categorical: true, yticks: ticks(0, ymax * 1.1).filter(t => Number.isInteger(t)) });
    let b = f.g;
    const bw = (f.x1 - f.x0) / labels.length * 0.6;
    labels.forEach((l, i) => {
      const cx = f.sx(i + 0.5);
      b += `<rect x="${cx - bw / 2}" y="${f.sy(counts[i])}" width="${bw}" height="${f.y0 - f.sy(counts[i])}" class="bar"><title>${esc(l)}: ${counts[i]}</title></rect>`;
      b += `<text x="${cx}" y="${f.y0 + 19}" text-anchor="middle" class="tick">${esc(l)}</text>`;
    });
    return svg(b, `${xlab} の度数`);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = P;
  else root.Plots = P;
})(typeof window !== 'undefined' ? window : globalThis);
