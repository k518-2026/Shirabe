/*
 * stats.js — 統計計算の中核（分布関数・検定・線形モデル）
 * 外部ライブラリに依存しない独自実装。公開文献の式から書き起こしている。
 * Copyright (c) 2026 K.Yamamoto — MIT License
 */
(function (root) {
  'use strict';
  const S = {};

  // ---------------------------------------------------------------- 基本統計量
  S.sum = a => { let s = 0; for (const v of a) s += v; return s; };
  S.mean = a => S.sum(a) / a.length;
  S.variance = a => {
    const n = a.length; if (n < 2) return NaN;
    const m = S.mean(a); let s = 0;
    for (const v of a) s += (v - m) * (v - m);
    return s / (n - 1);
  };
  S.sd = a => Math.sqrt(S.variance(a));
  S.sorted = a => a.slice().sort((x, y) => x - y);
  // 分位点（R の type 7 と同じ定義）
  S.quantile = (a, p, isSorted) => {
    const s = isSorted ? a : S.sorted(a);
    const n = s.length; if (!n) return NaN;
    const h = (n - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
    return s[lo] + (h - lo) * (s[hi] - s[lo]);
  };
  S.median = a => S.quantile(a, 0.5);
  // 歪度・尖度（SPSS と同じ補正済み推定量）と標準誤差
  S.skewness = a => {
    const n = a.length; if (n < 3) return NaN;
    const m = S.mean(a); let m2 = 0, m3 = 0;
    for (const v of a) { const d = v - m; m2 += d * d; m3 += d * d * d; }
    m2 /= n; m3 /= n;
    return Math.sqrt(n * (n - 1)) / (n - 2) * m3 / Math.pow(m2, 1.5);
  };
  S.kurtosis = a => {
    const n = a.length; if (n < 4) return NaN;
    const m = S.mean(a); let m2 = 0, m4 = 0;
    for (const v of a) { const d = v - m; m2 += d * d; m4 += d * d * d * d; }
    m2 /= n; m4 /= n;
    const g2 = m4 / (m2 * m2) - 3;
    return ((n + 1) * g2 + 6) * (n - 1) / ((n - 2) * (n - 3));
  };
  S.seSkewness = n => Math.sqrt(6 * n * (n - 1) / ((n - 2) * (n + 1) * (n + 3)));
  S.seKurtosis = n => 2 * S.seSkewness(n) * Math.sqrt((n * n - 1) / ((n - 3) * (n + 5)));

  // 平均順位（同順位は平均）。ties には同順位グループの大きさを返す
  S.rank = a => {
    const idx = a.map((v, i) => i).sort((i, j) => a[i] - a[j]);
    const r = new Array(a.length), ties = [];
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && a[idx[j + 1]] === a[idx[i]]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k]] = avg;
      if (j > i) ties.push(j - i + 1);
      i = j + 1;
    }
    return { ranks: r, ties };
  };

  // ---------------------------------------------------------------- 特殊関数
  const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  S.lgamma = function lgamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
    x -= 1;
    let a = LANCZOS[0];
    const t = x + 7.5;
    for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  };
  S.lchoose = (n, k) => S.lgamma(n + 1) - S.lgamma(k + 1) - S.lgamma(n - k + 1);

  // 正則化不完全ベータ関数 I_x(a,b)（連分数展開, Lentz 法）
  function betacf(a, b, x) {
    const TINY = 1e-300, EPS = 1e-16;
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < TINY) d = TINY;
    d = 1 / d; let h = d;
    for (let m = 1; m <= 10000; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
      c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
      c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d;
      const del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  S.ibeta = function (x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const lbt = S.lgamma(a + b) - S.lgamma(a) - S.lgamma(b) + a * Math.log(x) + b * Math.log1p(-x);
    if (x < (a + 1) / (a + b + 2)) return Math.exp(lbt) * betacf(a, b, x) / a;
    return 1 - Math.exp(lbt) * betacf(b, a, 1 - x) / b;
  };

  // 正則化不完全ガンマ関数 P(a,x), Q(a,x)
  function gser(a, x) {
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 100000; n++) {
      ap += 1; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - S.lgamma(a));
  }
  function gcf(a, x) {
    const TINY = 1e-300;
    let b = x + 1 - a, c = 1 / TINY, d = 1 / b, h = d;
    for (let i = 1; i < 100000; i++) {
      const an = -i * (i - a); b += 2;
      d = an * d + b; if (Math.abs(d) < TINY) d = TINY;
      c = b + an / c; if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-16) break;
    }
    return Math.exp(-x + a * Math.log(x) - S.lgamma(a)) * h;
  }
  S.gammaP = (a, x) => x <= 0 ? 0 : (x < a + 1 ? gser(a, x) : 1 - gcf(a, x));
  S.gammaQ = (a, x) => x <= 0 ? 1 : (x < a + 1 ? 1 - gser(a, x) : gcf(a, x));

  // ---------------------------------------------------------------- 分布
  // 標準正規分布の下側確率（Hart 1968 の倍精度近似, West 2005 の形）
  S.pnorm = function (x) {
    const z = Math.abs(x);
    let c;
    if (z > 37) c = 0;
    else {
      const e = Math.exp(-z * z / 2);
      if (z < 7.07106781186547) {
        let n = 3.52624965998911e-2 * z + 0.700383064443688;
        n = n * z + 6.37396220353165; n = n * z + 33.912866078383;
        n = n * z + 112.079291497871; n = n * z + 221.213596169931;
        n = n * z + 220.206867912376;
        let d = 8.83883476483184e-2 * z + 1.75566716318264;
        d = d * z + 16.064177579207; d = d * z + 86.7807322029461;
        d = d * z + 296.564248779674; d = d * z + 637.333633378831;
        d = d * z + 793.826512519948; d = d * z + 440.413735824752;
        c = e * n / d;
      } else {
        let b = z + 0.65; b = z + 4 / b; b = z + 3 / b; b = z + 2 / b; b = z + 1 / b;
        c = e / b / 2.506628274631;
      }
    }
    return x > 0 ? 1 - c : c;
  };
  S.dnorm = x => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
  // 標準正規分布の分位点（Acklam の近似＋Halley 法で1回補正）
  S.qnorm = function (p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    let x;
    if (p < 0.02425) {
      const q = Math.sqrt(-2 * Math.log(p));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= 1 - 0.02425) {
      const q = p - 0.5, r = q * q;
      x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
      const q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    const e = S.pnorm(x) - p;
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
    return x - u / (1 + x * u / 2);
  };

  // t 分布：下側確率と両側 p
  S.pt = function (t, df) {
    if (!isFinite(df) || df > 1e7) return S.pnorm(t);
    const tail = 0.5 * S.ibeta(df / (df + t * t), df / 2, 0.5);
    return t > 0 ? 1 - tail : tail;
  };
  S.ptTwo = (t, df) => (!isFinite(df) || df > 1e7) ? 2 * S.pnorm(-Math.abs(t)) : S.ibeta(df / (df + t * t), df / 2, 0.5);
  S.ptUpper = (t, df) => t >= 0 ? S.ptTwo(t, df) / 2 : 1 - S.ptTwo(t, df) / 2;
  S.qt = function (p, df) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    if (p === 0.5) return 0;
    let lo = -1, hi = 1;
    while (S.pt(lo, df) > p) lo *= 2;
    while (S.pt(hi, df) < p) hi *= 2;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (S.pt(mid, df) < p) lo = mid; else hi = mid;
      if (hi - lo < 1e-13 * Math.max(1, Math.abs(mid))) break;
    }
    return (lo + hi) / 2;
  };
  // F 分布の上側確率
  S.pfUpper = (f, d1, d2) => f <= 0 ? 1 : S.ibeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2);
  // カイ二乗分布の上側確率
  S.pchisqUpper = (x, k) => S.gammaQ(k / 2, x / 2);
  // ベータ分布の分位点（二分法）
  S.qbeta = function (p, a, b) {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let lo = 0, hi = 1;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (S.ibeta(mid, a, b) < p) lo = mid; else hi = mid;
      if (hi - lo < 1e-15) break;
    }
    return (lo + hi) / 2;
  };

  // スチューデント化された範囲の分布（Tukey の HSD 用）
  // P(Q < q) = ∫ g(s) · P(範囲 < q s) ds を数値積分する
  function simpson(f, a, b, n) {
    const h = (b - a) / n;
    let s = f(a) + f(b);
    for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
    return s * h / 3;
  }
  function prange(w, k) {
    if (w <= 0) return 0;
    const v = simpson(z => {
      const d = S.pnorm(z + w) - S.pnorm(z);
      return d <= 0 ? 0 : S.dnorm(z) * Math.pow(d, k - 1);
    }, -8.5, 8.5, 340);
    return Math.min(1, k * v);
  }
  S.ptukey = function (q, k, df) {
    if (q <= 0) return 0;
    if (!isFinite(df) || df > 50000) return prange(q, k);
    const half = df / 2;
    const lc = Math.log(2) + half * Math.log(half) - S.lgamma(half);
    const spread = 12 / Math.sqrt(2 * df);
    const lo = Math.max(0, 1 - spread), hi = 1 + spread;
    const v = simpson(s => {
      if (s <= 0) return 0;
      return Math.exp(lc + (df - 1) * Math.log(s) - half * s * s) * prange(q * s, k);
    }, lo, hi, 300);
    return Math.min(1, Math.max(0, v));
  };

  // ---------------------------------------------------------------- 行列
  S.transpose = A => A[0].map((_, j) => A.map(r => r[j]));
  S.matmul = (A, B) => A.map(r => B[0].map((_, j) => { let s = 0; for (let k = 0; k < r.length; k++) s += r[k] * B[k][j]; return s; }));
  // 逆行列（部分ピボット付き Gauss-Jordan）。特異なら null
  S.inverse = function (M) {
    const n = M.length;
    const A = M.map((r, i) => r.concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
    let scale = 0;
    for (const r of M) for (const v of r) scale = Math.max(scale, Math.abs(v));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) <= 1e-12 * (scale || 1)) return null;
      [A[c], A[p]] = [A[p], A[c]];
      const pv = A[c][c];
      for (let j = 0; j < 2 * n; j++) A[c][j] /= pv;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = A[r][c];
        if (f) for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j];
      }
    }
    return A.map(r => r.slice(n));
  };
  S.det = function (M) {
    const n = M.length, A = M.map(r => r.slice());
    let d = 1;
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (A[p][c] === 0) return 0;
      if (p !== c) { [A[c], A[p]] = [A[p], A[c]]; d = -d; }
      d *= A[c][c];
      for (let r = c + 1; r < n; r++) {
        const f = A[r][c] / A[c][c];
        for (let j = c; j < n; j++) A[r][j] -= f * A[c][j];
      }
    }
    return d;
  };

  // 最小二乗法。X は切片列を含む計画行列
  S.ols = function (X, y) {
    const n = X.length, p = X[0].length;
    const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
    const Xty = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      const r = X[i];
      for (let a = 0; a < p; a++) {
        Xty[a] += r[a] * y[i];
        for (let b = a; b < p; b++) XtX[a][b] += r[a] * r[b];
      }
    }
    for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
    const inv = S.inverse(XtX);
    if (!inv) return null;
    const b = inv.map(r => r.reduce((s, v, j) => s + v * Xty[j], 0));
    let sse = 0;
    const fitted = new Array(n), resid = new Array(n);
    for (let i = 0; i < n; i++) {
      let f = 0; for (let a = 0; a < p; a++) f += X[i][a] * b[a];
      fitted[i] = f; resid[i] = y[i] - f; sse += resid[i] * resid[i];
    }
    return { b, inv, sse, dfResid: n - p, fitted, resid };
  };

  // ---------------------------------------------------------------- 検定
  // Shapiro-Wilk 検定（Royston 1992/1995 の近似式）
  S.shapiroWilk = function (x) {
    const n = x.length;
    if (n < 3 || n > 5000) return null;
    const s = S.sorted(x);
    if (s[n - 1] - s[0] < 1e-12 * Math.max(1, Math.abs(s[0]))) return null;
    let a = new Array(n);
    if (n === 3) {
      a = [-Math.SQRT1_2, 0, Math.SQRT1_2];
    } else {
      const m = [];
      for (let i = 1; i <= n; i++) m.push(S.qnorm((i - 0.375) / (n + 0.25)));
      const mm = m.reduce((t, v) => t + v * v, 0);
      const u = 1 / Math.sqrt(n);
      const cn = m[n - 1] / Math.sqrt(mm), cn1 = m[n - 2] / Math.sqrt(mm);
      const an = cn + 0.221157 * u - 0.147981 * u ** 2 - 2.071190 * u ** 3 + 4.434685 * u ** 4 - 2.706056 * u ** 5;
      if (n > 5) {
        const an1 = cn1 + 0.042981 * u - 0.293762 * u ** 2 - 1.752461 * u ** 3 + 5.682633 * u ** 4 - 3.582633 * u ** 5;
        const phi = (mm - 2 * m[n - 1] ** 2 - 2 * m[n - 2] ** 2) / (1 - 2 * an ** 2 - 2 * an1 ** 2);
        for (let i = 0; i < n; i++) a[i] = m[i] / Math.sqrt(phi);
        a[n - 1] = an; a[0] = -an; a[n - 2] = an1; a[1] = -an1;
      } else {
        const phi = (mm - 2 * m[n - 1] ** 2) / (1 - 2 * an ** 2);
        for (let i = 0; i < n; i++) a[i] = m[i] / Math.sqrt(phi);
        a[n - 1] = an; a[0] = -an;
      }
    }
    const mean = S.mean(s);
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += a[i] * s[i]; den += (s[i] - mean) ** 2; }
    const W = Math.min(1, num * num / den);
    let p;
    if (n === 3) {
      p = Math.max(0, 6 / Math.PI * (Math.asin(Math.sqrt(W)) - Math.asin(Math.sqrt(0.75))));
    } else if (n <= 11) {
      const g = 0.459 * n - 2.273;
      const mu = 0.5440 - 0.39978 * n + 0.025054 * n * n - 0.0006714 * n ** 3;
      const sg = Math.exp(1.3822 - 0.77857 * n + 0.062767 * n * n - 0.0020322 * n ** 3);
      const t = g - Math.log(1 - W);
      p = t <= 0 ? 0 : 1 - S.pnorm((-Math.log(t) - mu) / sg);
    } else {
      const ln = Math.log(n);
      const mu = -1.5861 - 0.31082 * ln - 0.083751 * ln * ln + 0.0038915 * ln ** 3;
      const sg = Math.exp(-0.4803 - 0.082676 * ln + 0.0030302 * ln * ln);
      p = 1 - S.pnorm((Math.log(1 - W) - mu) / sg);
    }
    return { W, p };
  };

  // Levene 検定（平均からの絶対偏差による一元配置分散分析）
  S.levene = function (groups) {
    const g = groups.filter(x => x.length > 0);
    const dev = g.map(x => { const m = S.mean(x); return x.map(v => Math.abs(v - m)); });
    const r = S.oneWay(dev);
    return r ? { F: r.F, df1: r.dfB, df2: r.dfW, p: r.p } : null;
  };

  // 一元配置分散分析（グループの配列）
  S.oneWay = function (groups) {
    const g = groups.filter(x => x.length > 0), k = g.length;
    const all = [].concat(...g), N = all.length;
    if (k < 2 || N <= k) return null;
    const gm = S.mean(all);
    let ssb = 0, ssw = 0;
    for (const x of g) {
      const m = S.mean(x); ssb += x.length * (m - gm) ** 2;
      for (const v of x) ssw += (v - m) ** 2;
    }
    const dfB = k - 1, dfW = N - k;
    const F = (ssb / dfB) / (ssw / dfW);
    return { ssb, ssw, dfB, dfW, F, p: S.pfUpper(F, dfB, dfW) };
  };

  // 対立仮説ごとの p 値（lower = P(T<=t), upper = P(T>=t)）
  function tailP(lower, upper, alt) {
    if (alt === 'less') return Math.min(1, lower);
    if (alt === 'greater') return Math.min(1, upper);
    return Math.min(1, 2 * Math.min(lower, upper));
  }
  const corr = (d, alt) => (alt === 'greater' ? 0.5 : alt === 'less' ? -0.5 : 0.5 * Math.sign(d));
  const zP = (z, alt) => (alt === 'greater' ? 1 - S.pnorm(z) : alt === 'less' ? S.pnorm(z) : 2 * S.pnorm(-Math.abs(z)));
  S.zP = zP;

  // Mann-Whitney の U の正確分布（生成関数の係数）
  function mwCounts(m, n) {
    const len = m * n + 1;
    let c = new Float64Array(len); c[0] = 1;
    for (let i = 1; i <= m; i++) {
      // (1 - q^{n+i}) を掛ける
      for (let u = len - 1; u >= n + i; u--) c[u] -= c[u - n - i];
      // (1 - q^i) で割る
      for (let u = i; u < len; u++) c[u] += c[u - i];
    }
    return c;
  }
  S.mannWhitney = function (x, y, alt) {
    const m = x.length, n = y.length;
    const all = x.concat(y), rk = S.rank(all);
    let r1 = 0; for (let i = 0; i < m; i++) r1 += rk.ranks[i];
    const W = r1 - m * (m + 1) / 2; // x 側の U
    const N = m + n;
    let p, method, z = null;
    if (m < 50 && n < 50 && rk.ties.length === 0) {
      const c = mwCounts(m, n), total = Math.exp(S.lchoose(N, m));
      let lower = 0, upper = 0;
      for (let u = 0; u < c.length; u++) { if (u <= W) lower += c[u]; if (u >= W) upper += c[u]; }
      p = tailP(lower / total, upper / total, alt);
      method = 'exact';
    } else {
      const tc = rk.ties.reduce((s, t) => s + t * t * t - t, 0);
      const sigma = Math.sqrt(m * n / 12 * ((N + 1) - tc / (N * (N - 1))));
      const d = W - m * n / 2;
      z = (d - corr(d, alt)) / sigma;
      p = zP(z, alt);
      method = 'normal';
    }
    return { W, p, z, method, rankBiserial: 2 * W / (m * n) - 1 };
  };

  // Wilcoxon の符号付き順位検定（差の配列）
  S.signedRank = function (d0, alt) {
    const d = d0.filter(v => v !== 0), n = d.length;
    if (n === 0) return null;
    const rk = S.rank(d.map(Math.abs));
    let V = 0; for (let i = 0; i < n; i++) if (d[i] > 0) V += rk.ranks[i];
    const tot = n * (n + 1) / 2;
    let p, method, z = null;
    if (n < 50 && rk.ties.length === 0 && d.length === d0.length) {
      const c = new Float64Array(tot + 1); c[0] = 1;
      for (let i = 1; i <= n; i++) for (let u = tot; u >= i; u--) c[u] += c[u - i];
      const total = Math.pow(2, n);
      let lower = 0, upper = 0;
      for (let u = 0; u <= tot; u++) { if (u <= V) lower += c[u]; if (u >= V) upper += c[u]; }
      p = tailP(lower / total, upper / total, alt);
      method = 'exact';
    } else {
      const tc = rk.ties.reduce((s, t) => s + t * t * t - t, 0);
      const sigma = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24 - tc / 48);
      const dd = V - n * (n + 1) / 4;
      z = (dd - corr(dd, alt)) / sigma;
      p = zP(z, alt);
      method = 'normal';
    }
    return { V, p, z, method, n, rankBiserial: (V - (tot - V)) / tot };
  };

  // 相関
  S.pearson = function (x, y) {
    const n = x.length, mx = S.mean(x), my = S.mean(y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
    return sxy / Math.sqrt(sxx * syy);
  };
  S.corTest = function (r, n) {
    const df = n - 2;
    if (df < 1 || !isFinite(r)) return { t: NaN, df, p: NaN };
    if (Math.abs(r) >= 1) return { t: Infinity * Math.sign(r), df, p: 0 };
    const t = r * Math.sqrt(df / (1 - r * r));
    return { t, df, p: S.ptTwo(t, df) };
  };
  S.fisherCI = function (r, n, level) {
    if (n < 4 || Math.abs(r) >= 1) return [NaN, NaN];
    const z = Math.atanh(r), se = 1 / Math.sqrt(n - 3), q = S.qnorm(1 - (1 - level) / 2);
    return [Math.tanh(z - q * se), Math.tanh(z + q * se)];
  };
  S.spearman = (x, y) => S.pearson(S.rank(x).ranks, S.rank(y).ranks);
  // Kendall の τb
  S.kendall = function (x, y) {
    const n = x.length;
    let c = 0, d = 0, tx = 0, ty = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = Math.sign(x[i] - x[j]), b = Math.sign(y[i] - y[j]);
      if (a === 0 && b === 0) continue;
      if (a === 0) tx++; else if (b === 0) ty++;
      else if (a === b) c++; else d++;
    }
    const tau = (c - d) / Math.sqrt((c + d + tx) * (c + d + ty));
    const rx = S.rank(x).ties, ry = S.rank(y).ties;
    let p;
    if (rx.length === 0 && ry.length === 0 && n < 50) {
      // 反転数の正確分布
      const maxT = n * (n - 1) / 2;
      let cnt = new Float64Array(maxT + 1); cnt[0] = 1;
      for (let k = 2; k <= n; k++) {
        const nx = new Float64Array(maxT + 1);
        let win = 0;
        for (let u = 0; u <= maxT; u++) {
          win += cnt[u];
          if (u - k >= 0) win -= cnt[u - k];
          nx[u] = win;
        }
        cnt = nx;
      }
      const total = Math.exp(S.lgamma(n + 1));
      const q = d; // 不一致ペア数
      let lower = 0, upper = 0;
      for (let u = 0; u <= maxT; u++) { if (u <= q) lower += cnt[u]; if (u >= q) upper += cnt[u]; }
      p = Math.min(1, 2 * Math.min(lower, upper) / total);
    } else {
      const v0 = n * (n - 1) * (2 * n + 5);
      const vt = rx.reduce((s, t) => s + t * (t - 1) * (2 * t + 5), 0);
      const vu = ry.reduce((s, t) => s + t * (t - 1) * (2 * t + 5), 0);
      const v1 = rx.reduce((s, t) => s + t * (t - 1), 0) * ry.reduce((s, t) => s + t * (t - 1), 0);
      const v2 = rx.reduce((s, t) => s + t * (t - 1) * (t - 2), 0) * ry.reduce((s, t) => s + t * (t - 1) * (t - 2), 0);
      const varS = (v0 - vt - vu) / 18 + v1 / (2 * n * (n - 1)) + v2 / (9 * n * (n - 1) * (n - 2));
      const z = (c - d) / Math.sqrt(varS);
      p = 2 * S.pnorm(-Math.abs(z));
    }
    return { tau, p };
  };

  // 2×2 表の Fisher の正確検定（両側, R と同じ定義）
  S.fisher2x2 = function (a, b, c, d) {
    const r1 = a + b, c1 = a + c, N = a + b + c + d;
    const lo = Math.max(0, r1 + c1 - N), hi = Math.min(r1, c1);
    const lp = k => S.lchoose(c1, k) + S.lchoose(N - c1, r1 - k) - S.lchoose(N, r1);
    const pObs = lp(a);
    let p = 0;
    for (let k = lo; k <= hi; k++) { const l = lp(k); if (l <= pObs + 1e-7) p += Math.exp(l); }
    // 条件付き最尤推定ではなく標本オッズ比を返す
    return { p: Math.min(1, p), oddsRatio: (a * d) / (b * c) };
  };

  // 二項検定（両側は R と同じ定義）と Clopper-Pearson 信頼区間
  S.binomTest = function (x, n, p0, alt, level) {
    const lp = k => S.lchoose(n, k) + k * Math.log(p0) + (n - k) * Math.log1p(-p0);
    const dens = k => (p0 === 0 ? (k === 0 ? 1 : 0) : p0 === 1 ? (k === n ? 1 : 0) : Math.exp(lp(k)));
    let p;
    if (alt === 'less') { p = 0; for (let k = 0; k <= x; k++) p += dens(k); }
    else if (alt === 'greater') { p = 0; for (let k = x; k <= n; k++) p += dens(k); }
    else {
      const dx = dens(x); p = 0;
      for (let k = 0; k <= n; k++) { const v = dens(k); if (v <= dx * (1 + 1e-7)) p += v; }
    }
    const a = 1 - level;
    let lo, hi;
    if (alt === 'less') { lo = 0; hi = x === n ? 1 : S.qbeta(1 - a, x + 1, n - x); }
    else if (alt === 'greater') { lo = x === 0 ? 0 : S.qbeta(a, x, n - x + 1); hi = 1; }
    else { lo = x === 0 ? 0 : S.qbeta(a / 2, x, n - x + 1); hi = x === n ? 1 : S.qbeta(1 - a / 2, x + 1, n - x); }
    return { p: Math.min(1, p), lo, hi };
  };

  // 多重比較の p 値補正
  S.adjust = function (ps, method) {
    const m = ps.length;
    if (method === 'bonferroni') return ps.map(p => Math.min(1, p * m));
    if (method === 'holm') {
      const o = ps.map((p, i) => i).sort((i, j) => ps[i] - ps[j]);
      const out = new Array(m); let run = 0;
      o.forEach((i, r) => { run = Math.max(run, Math.min(1, (m - r) * ps[i])); out[i] = run; });
      return out;
    }
    return ps.slice();
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = S;
  else root.Stats = S;
})(typeof window !== 'undefined' ? window : globalThis);
