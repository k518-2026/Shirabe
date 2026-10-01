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
      for (const t of opt.xticks || ticks(xr[0], xr[1])) {
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

  // スクリープロット：固有値の折れ線。Kaiser の基準（1）と、平行分析（乱数の固有値の平均）を重ねる
  // pa は null でもよい。nf は採用した因子数（その位置に縦の目印を入れる）
  P.scree = function (eig, pa, nf, ylab) {
    const k = eig.length; if (!k) return '';
    const all = eig.concat(pa || [], [1]);
    const yr = [Math.min(0, Math.min(...all)), Math.max(...all) * 1.08];
    const f = frame([0.5, k + 0.5], yr, { xlab: '成分（因子）の番号', ylab: ylab || '固有値', xticks: Array.from({ length: k }, (_, i) => i + 1).filter(i => k <= 12 || i % 2 === 1) });
    let b = f.g;
    b += `<line x1="${f.x0}" x2="${f.x1}" y1="${f.sy(1)}" y2="${f.sy(1)}" class="refline"><title>Kaiser の基準（固有値 = 1）</title></line>`;
    if (nf >= 1 && nf < k) b += `<line x1="${f.sx(nf + 0.5)}" x2="${f.sx(nf + 0.5)}" y1="${f.y1}" y2="${f.y0}" class="refline"><title>採用した因子数</title></line>`;
    const line = (v, cls, col) => {
      const pts = v.map((y, i) => `${f.sx(i + 1).toFixed(1)},${f.sy(y).toFixed(1)}`).join(' ');
      return `<polyline points="${pts}" fill="none" style="stroke:${col}" stroke-width="2" ${cls || ''}/>` + v.map((y, i) => `<circle cx="${f.sx(i + 1).toFixed(1)}" cy="${f.sy(y).toFixed(1)}" r="3.8" style="fill:${col}"><title>${i + 1}: ${fmtTick(y)}</title></circle>`).join('');
    };
    if (pa) b += line(pa, 'stroke-dasharray="5 4"', SERIES[1]);
    b += line(eig, '', SERIES[0]);
    const lg = [['観測データ', SERIES[0]]].concat(pa ? [['平行分析（乱数の平均）', SERIES[1]]] : []);
    lg.forEach(([t, c], i) => {
      const y = M.t + 8 + i * 18;
      b += `<circle cx="${W - M.r - 150}" cy="${y}" r="5" style="fill:${c}"/><text x="${W - M.r - 140}" y="${y + 4}" class="tick">${esc(t)}</text>`;
    });
    return svg(b, 'スクリープロット');
  };

  // 確認的因子分析のパス図（標準化した解）。左に因子（楕円）、右に項目（四角）を縦に並べる。
  // 項目が多くても横に伸びず、画面幅に収めても文字が読める。
  // m: { factors: [名前], items: [{name, loads: [λ*（その因子に負荷しない所は null）], psi, primary}], phi: 因子間相関 }
  let pdId = 0;
  P.pathDiagram = function (m) {
    const nf = m.factors.length, p = m.items.length;
    const order = [...Array(p).keys()].sort((a, b) => (m.items[a].primary - m.items[b].primary) || (a - b));   // 主な因子ごとにまとめる
    const showPhi = nf >= 2 && nf <= 5, arcStep = 30;
    const rowH = 40, bh = 28, bw = 104, top = 22, ery = 24;
    const rx = k => Math.max(48, 7 * Math.min(m.factors[k].length, 8) + 14);
    const rxMax = Math.max(...m.factors.map((_, k) => rx(k)));
    const arcsW = showPhi ? (nf - 1) * arcStep + 30 : 6;
    const fcx = arcsW + 8 + rxMax;                          // 因子の楕円の中心の x
    const ix = fcx + rxMax + 150;                           // 項目の四角の左端
    const Wd = ix + bw + 76, Hd = top + p * rowH + 12;
    const iy = new Array(p);
    order.forEach((i, pos) => { iy[i] = top + pos * rowH + bh / 2; });                              // 各項目の中心の y
    const fy = m.factors.map((_, k) => {
      const ys = m.items.map((it, i) => (it.primary === k ? iy[i] : null)).filter(v => v !== null);
      return ys.length ? S_mean(ys) : Hd / 2;
    });
    const id = `pd${++pdId}`;
    let b = `<defs><marker id="${id}a" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="8" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,4 L0,8 z" class="pd-arrow"/></marker></defs>`;
    const fmt = v => (v === null || v === undefined || !isFinite(v) ? '' : v.toFixed(2).replace(/^(-?)0\./, '$1.'));
    const trunc = s => (s.length > 8 ? s.slice(0, 7) + '…' : s);
    // 因子間の相関（左側の弧）。隣り合う因子は小さい弧、離れた因子は大きい弧
    if (showPhi) {
      for (let d = 1; d < nf; d++) for (let k = 0; k + d < nf; k++) {
        const l = k + d, y1 = fy[k], y2 = fy[l], e = d * arcStep;
        const x1 = fcx - rx(k) * 0.72, x2 = fcx - rx(l) * 0.72;                  // 楕円の左端あたりから出る
        b += `<path d="M${x1},${y1 - ery * 0.62} C${x1 - e - 6},${y1} ${x2 - e - 6},${y2} ${x2},${y2 + ery * 0.62}" class="pd-line" marker-start="url(#${id}a)" marker-end="url(#${id}a)"/>`;
        b += `<text x="${Math.min(x1, x2) - e * 0.78 - 12}" y="${(y1 + y2) / 2 + 4}" text-anchor="end" class="pd-num">${fmt(m.phi[k][l])}</text>`;
      }
    }
    // 矢印（因子 → 項目）と標準化した負荷量
    m.items.forEach((it, i) => {
      it.loads.forEach((v, k) => {
        if (v === null) return;
        const x1 = fcx + rx(k), y1 = fy[k], x2 = ix, y2 = iy[i], prim = it.primary === k;
        b += `<line x1="${x1}" y1="${y1}" x2="${x2 - 1}" y2="${y2}" class="pd-line${prim ? '' : ' pd-dash'}" marker-end="url(#${id}a)"/>`;
        const t = prim ? 0.68 : 0.9;
        b += `<text x="${x1 + (x2 - x1) * t}" y="${y1 + (y2 - y1) * t - 3}" text-anchor="middle" class="pd-num">${fmt(v)}</text>`;
      });
      // 独自分散（箱の右）
      b += `<line x1="${ix + bw + 30}" y1="${iy[i]}" x2="${ix + bw}" y2="${iy[i]}" class="pd-line" marker-end="url(#${id}a)"/>`;
      b += `<text x="${ix + bw + 36}" y="${iy[i] + 4}" class="pd-num">${fmt(it.psi)}</text>`;
    });
    m.items.forEach((it, i) => {
      b += `<rect x="${ix}" y="${iy[i] - bh / 2}" width="${bw}" height="${bh}" rx="4" class="pd-box"><title>${esc(it.name)}</title></rect>`;
      b += `<text x="${ix + bw / 2}" y="${iy[i] + 4}" text-anchor="middle" class="pd-text">${esc(trunc(it.name))}</text>`;
    });
    m.factors.forEach((nm, k) => {
      b += `<ellipse cx="${fcx}" cy="${fy[k]}" rx="${rx(k)}" ry="${ery}" class="pd-ell"/>`;
      b += `<text x="${fcx}" y="${fy[k] + 4}" text-anchor="middle" class="pd-text">${esc(nm)}</text>`;
    });
    return `<svg class="plot" viewBox="0 0 ${Wd} ${Hd}" role="img" aria-label="パス図" xmlns="http://www.w3.org/2000/svg">${b}</svg>`;
  };  const S_mean = a => a.reduce((s, v) => s + v, 0) / a.length;

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

  // 雨雲プロット（raincloud plot）：片側の密度（雲）＋ 箱ひげ図 ＋ ずらした個々の点（雨）
  // groups: [{x: 水準番号, s: 系列番号, v: 値の配列}]
  // opt.paired が真なら、各群の同じ位置の値を同じ人とみなして線でつなぐ
  P.raincloud = function (groups, xLabels, seriesLabels, xlab, ylab, opt = {}) {
    const all = groups.flatMap(g => g.v);
    if (!all.length) return '';
    const S = root.Stats;
    const ns = Math.max(1, seriesLabels.length);
    // 雲：ガウス核の密度推定（帯域は Silverman の目安 = R の bw.nrd0）。
    // R の density() と同じく帯域の3倍まで裾を伸ばし、端が0近くまで細くなるようにする
    const clouds = groups.map(g => {
      const s = S.sorted(g.v), n = s.length;
      if (n < 2 || s[n - 1] <= s[0]) return null;
      const sd = S.sd(s), iqr = S.quantile(s, 0.75, true) - S.quantile(s, 0.25, true);
      const bw = 0.9 * Math.min(sd, iqr > 0 ? iqr / 1.34 : sd) * Math.pow(n, -0.2) || sd;
      const lo = s[0] - 3 * bw, hi = s[n - 1] + 3 * bw, m = 120;
      const ys = [], ds = [];
      for (let k = 0; k <= m; k++) {
        const y = lo + (hi - lo) * k / m;
        let d = 0; for (const x of s) d += Math.exp(-0.5 * ((y - x) / bw) ** 2);
        ys.push(y); ds.push(d);
      }
      return { ys, ds, lo, hi };
    });
    // 縦軸は雲の裾まで入る範囲にする（範囲外を切り詰めると雲の端が平らになる）
    const lows = clouds.filter(Boolean).map(c => c.lo), highs = clouds.filter(Boolean).map(c => c.hi);
    const yr = pad(Math.min(...all, ...lows), Math.max(...all, ...highs), 0.03);
    // 凡例があるときは、凡例の高さ分だけ上に余白をとって雲と重ならないようにする
    if (ns > 1) { const plotH = H - M.t - M.b, legH = 10 + ns * 18; yr[1] += (yr[1] - yr[0]) * legH / (plotH - legH); }
    const f = frame([0, xLabels.length], yr, { xlab, ylab, categorical: true });
    let b = f.g;
    const slot = (f.x1 - f.x0) / xLabels.length, w = slot / ns;
    // 点の横のずれは種を固定した乱数で決める（描き直しても同じ図になる）
    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const pos = [];
    groups.forEach((g, gi) => {
      const v = g.v; if (!v.length) { pos.push([]); return; }
      const c = f.x0 + slot * g.x + w * (g.s + 0.5);
      const col = SERIES[(ns > 1 ? g.s : g.x) % SERIES.length];
      const s = S.sorted(v);
      const cl = clouds[gi];
      if (cl) {
        const dmax = Math.max(...cl.ds), half = w * 0.42, m = cl.ys.length - 1;
        const pts = cl.ys.map((y, k) => `${(c + 2 + cl.ds[k] / dmax * half).toFixed(1)},${f.sy(y).toFixed(1)}`);
        b += `<path d="M${c + 2},${f.sy(cl.ys[0]).toFixed(1)} L${pts.join(' L')} L${c + 2},${f.sy(cl.ys[m]).toFixed(1)} Z" style="fill:${col};fill-opacity:.35;stroke:${col}" stroke-width="1.2"/>`;
      }
      // 箱ひげ図（細め）
      const q1 = S.quantile(s, 0.25, true), md = S.quantile(s, 0.5, true), q3 = S.quantile(s, 0.75, true), iq = q3 - q1;
      const wl = s.find(x => x >= q1 - 1.5 * iq), wh = [...s].reverse().find(x => x <= q3 + 1.5 * iq);
      const bx = c - w * 0.07, bwid = Math.min(14, w * 0.1);
      b += `<line x1="${bx}" x2="${bx}" y1="${f.sy(wl)}" y2="${f.sy(wh)}" class="whisker"/>`;
      b += `<rect x="${bx - bwid / 2}" y="${f.sy(q3)}" width="${bwid}" height="${Math.max(1, f.sy(q1) - f.sy(q3))}" style="fill:var(--panel);stroke:${col}" stroke-width="1.5"><title>Q1 ${fmtTick(q1)} / 中央値 ${fmtTick(md)} / Q3 ${fmtTick(q3)}</title></rect>`;
      b += `<line x1="${bx - bwid / 2}" x2="${bx + bwid / 2}" y1="${f.sy(md)}" y2="${f.sy(md)}" style="stroke:${col}" stroke-width="2.5"/>`;
      // 雨：個々の点
      const px = v.map(() => c - w * (0.18 + 0.2 * rnd()));
      pos.push(v.map((y, k) => [px[k], f.sy(y)]));
      void gi;
    });
    if (opt.paired) {
      // 同じ系列の隣り合う水準（x と x+1）をつなぐ。値の配列は同じ位置が同じ人
      for (let a = 0; a < pos.length; a++) {
        const nb = groups.findIndex(g => g.s === groups[a].s && g.x === groups[a].x + 1);
        if (nb < 0) continue;
        const A = pos[a], B = pos[nb];
        for (let k = 0; k < Math.min(A.length, B.length); k++) b += `<line x1="${A[k][0].toFixed(1)}" y1="${A[k][1].toFixed(1)}" x2="${B[k][0].toFixed(1)}" y2="${B[k][1].toFixed(1)}" class="pairline"/>`;
      }
    }
    pos.forEach((ps, gi) => {
      const g = groups[gi], col = SERIES[(ns > 1 ? g.s : g.x) % SERIES.length];
      for (const [x, y] of ps) b += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.8" style="fill:${col}" fill-opacity=".75"/>`;
    });
    xLabels.forEach((l, i) => { b += `<text x="${f.sx(i + 0.5)}" y="${f.y0 + 19}" text-anchor="middle" class="tick">${esc(l)}</text>`; });
    if (ns > 1) {
      seriesLabels.forEach((sl, s) => {
        const y = M.t + 6 + s * 18;
        b += `<circle cx="${W - M.r - 110}" cy="${y}" r="5" style="fill:${SERIES[s % SERIES.length]}"/>`;
        b += `<text x="${W - M.r - 100}" y="${y + 4}" class="tick">${esc(sl)}</text>`;
      });
    }
    return svg(b, `${ylab} の雨雲プロット`);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = P;
  else root.Plots = P;
})(typeof window !== 'undefined' ? window : globalThis);
