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

  // ---------------------------------------------------------------- 1因子モデル（ω 係数用）
  // 共分散行列 C（p × p）に1因子モデル Σ = λλ' + Ψ を最尤法であてはめる（EM アルゴリズム）。
  // 返り値の λ は合計が正になる向きにそろえる。Ψ が下限に張りついたら heywood = true
  S.factor1ML = function (C) {
    const p = C.length, d = C.map((r, i) => r[i]);
    // 初期値：第1主成分の方向（べき乗法）
    let v = new Array(p).fill(1);
    for (let it = 0; it < 200; it++) {
      const w = C.map(r => r.reduce((s, x, j) => s + x * v[j], 0)), nv = Math.sqrt(S.sum(w.map(x => x * x)));
      v = w.map(x => x / nv);
    }
    const ev = v.reduce((s, x, i) => s + x * C[i].reduce((t, c, j) => t + c * v[j], 0), 0);
    let lam = v.map(x => x * Math.sqrt(Math.max(ev, 1e-12)) * 0.9);
    let psi = d.map((x, i) => Math.max(x - lam[i] * lam[i], 0.05 * x));
    const floor = d.map(x => 1e-6 * x);
    let heywood = false, it = 0;
    for (; it < 50000; it++) {
      // β = λ'Σ⁻¹（ウッドベリーの公式で Σ⁻¹ を避ける）
      const lp = lam.map((l, i) => l / psi[i]), q = S.sum(lam.map((l, i) => l * lp[i]));
      const beta = lp.map(x => x / (1 + q));
      const Sb = C.map(r => r.reduce((s, x, j) => s + x * beta[j], 0));
      const Ezz = 1 - S.sum(beta.map((b, i) => b * lam[i])) + S.sum(beta.map((b, i) => b * Sb[i]));
      const nl = Sb.map(x => x / Ezz);
      const np = d.map((x, i) => x - nl[i] * Sb[i]);
      heywood = false;
      for (let i = 0; i < p; i++) if (np[i] < floor[i]) { np[i] = floor[i]; heywood = true; }
      let delta = 0;
      for (let i = 0; i < p; i++) delta = Math.max(delta, Math.abs(nl[i] - lam[i]) / Math.sqrt(d[i]), Math.abs(np[i] - psi[i]) / d[i]);
      lam = nl; psi = np;
      if (delta < 1e-11) break;
    }
    if (S.sum(lam) < 0) lam = lam.map(x => -x);
    return { lambda: lam, psi, heywood, iterations: it, converged: it < 50000 };
  };
  // McDonald の ω（1因子モデルの λ と Ψ から）：(Σλ)² / ((Σλ)² + ΣΨ)
  S.omega = function (C) {
    const f = S.factor1ML(C), sl = S.sum(f.lambda);
    return { omega: sl * sl / (sl * sl + S.sum(f.psi)), ...f };
  };

  // ---------------------------------------------------------------- 因子分析（探索的・確認的）
  // 方法はどれも教科書・原論文の式から書いている（Jöreskog 1967; Rubin & Thayer 1982; Harman 1976;
  // Bernaards & Jennrich 2005 の勾配射影法; Kaiser 1958; Hendrickson & White 1964; Browne & Cudeck 1993 ほか）
  const idn = n => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  const mmul = (A, B) => S.matmul(A, B), tpose = A => S.transpose(A);
  const ssq = A => { let s = 0; for (const r of A) for (const v of r) s += v * v; return s; };
  const diagOf = A => A.map((r, i) => r[i]);
  const madd = (A, B, a, b) => A.map((r, i) => r.map((v, j) => a * v + b * B[i][j]));

  // 対称行列の固有値分解（Jacobi 法）。values は降順、vectors[i][k] は k 番目の固有ベクトルの第 i 成分
  S.eigSym = function (A) {
    const n = A.length, a = A.map(r => r.slice()), V = idn(n);
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0, dg = 0;
      for (let i = 0; i < n; i++) { dg += a[i][i] * a[i][i]; for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j]; }
      if (off <= 1e-30 * (dg + off) || off < 1e-300) break;
      for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
        for (let k = 0; k < n; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
        for (let k = 0; k < n; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = c * x - s * y; V[k][q] = s * x + c * y; }
      }
    }
    const ord = a.map((r, i) => i).sort((i, j) => a[j][j] - a[i][i]);
    return { values: ord.map(i => a[i][i]), vectors: V.map(r => ord.map(i => r[i])) };
  };
  // コレスキー分解で、対称正定値行列の逆行列と対数行列式を返す。正定値でなければ null
  S.spd = function (A) {
    const n = A.length, L = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let s = A[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) { if (!(s > 1e-300)) return null; L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j];
    }
    let logdet = 0; for (let i = 0; i < n; i++) logdet += 2 * Math.log(L[i][i]);
    const Li = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      Li[i][i] = 1 / L[i][i];
      for (let j = 0; j < i; j++) { let s = 0; for (let k = j; k < i; k++) s -= L[i][k] * Li[k][j]; Li[i][j] = s / L[i][i]; }
    }
    const inv = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let a = 0; a < n; a++) for (let b = a; b < n; b++) { let s = 0; for (let k = b; k < n; k++) s += Li[k][a] * Li[k][b]; inv[a][b] = s; inv[b][a] = s; }
    return { inv, logdet };
  };
  // 共分散行列（ddof = 0 なら n で割る最尤推定、1 なら n − 1）と相関行列
  S.covMat = function (cols, ddof) {
    const p = cols.length, n = cols[0].length, m = cols.map(S.mean);
    const C = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let a = 0; a < p; a++) for (let b = a; b < p; b++) {
      let s = 0; for (let r = 0; r < n; r++) s += (cols[a][r] - m[a]) * (cols[b][r] - m[b]);
      C[a][b] = C[b][a] = s / (n - ddof);
    }
    return C;
  };
  S.cov2cor = C => C.map((r, i) => r.map((v, j) => v / Math.sqrt(C[i][i] * C[j][j])));
  // 重相関係数の二乗（SMC）：共通性の初期値
  S.smc = function (R) {
    const sp = S.spd(R);
    if (!sp) return R.map(() => 0.5);
    return sp.inv.map((r, i) => Math.min(0.995, Math.max(0.005, 1 - 1 / r[i])));
  };

  // 乱数（線形合同法 + Box-Muller）。種を固定して同じ結果を再現できるようにする
  S.rngNormal = function (seed) {
    const u = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    return () => { const a = u(), b = u(); return Math.sqrt(-2 * Math.log(a + 1e-12)) * Math.cos(2 * Math.PI * b); };
  };
  // 平行分析（Horn 1965）：同じ n × p の正規乱数の相関行列の固有値の平均と 95 パーセンタイル。
  // type = 'fa' のときは対角を SMC に置き換えた行列（共通因子の固有値）
  S.parallelAnalysis = function (n, p, type, nsim, seed) {
    const nrm = S.rngNormal(seed), all = [];
    for (let s = 0; s < nsim; s++) {
      const cols = Array.from({ length: p }, () => Array.from({ length: n }, nrm));
      let R = S.cov2cor(S.covMat(cols, 1));
      if (type === 'fa') { const h = S.smc(R); R = R.map((r, i) => r.map((v, j) => (i === j ? h[i] : v))); }
      all.push(S.eigSym(R).values);
    }
    const mean = [], hi = [];
    for (let k = 0; k < p; k++) {
      const v = all.map(e => e[k]);
      mean.push(S.mean(v)); hi.push(S.quantile(v, 0.95));
    }
    return { mean, p95: hi };
  };
  // 上から数えて、観測の固有値が乱数の平均を上回る間の個数
  S.paFactors = (obs, sim) => { let m = 0; while (m < obs.length && obs[m] > sim[m]) m++; return m; };

  // KMO（標本妥当性）と Bartlett の球面性検定
  S.kmo = function (R) {
    const p = R.length, sp = S.spd(R);
    if (!sp) return null;
    const Q = sp.inv.map((r, i) => r.map((v, j) => -v / Math.sqrt(sp.inv[i][i] * sp.inv[j][j])));
    let r2 = 0, q2 = 0; const ri = new Array(p).fill(0), qi = new Array(p).fill(0);
    for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) if (i !== j) {
      r2 += R[i][j] ** 2; q2 += Q[i][j] ** 2; ri[i] += R[i][j] ** 2; qi[i] += Q[i][j] ** 2;
    }
    return { overall: r2 / (r2 + q2), items: ri.map((v, i) => v / (v + qi[i])), logdet: sp.logdet };
  };
  S.bartlett = function (R, n) {
    const p = R.length, sp = S.spd(R); if (!sp) return null;
    const chi = -(n - 1 - (2 * p + 5) / 6) * sp.logdet, df = p * (p - 1) / 2;
    return { chi, df, p: S.pchisqUpper(chi, df) };
  };

  // --- 因子の抽出（相関行列 R, 因子数 m）。どれも「主軸の向き」の負荷量 loadings（p × m）と独自分散 psi を返す
  const topLoad = (M, m) => {
    const e = S.eigSym(M);
    return M.map((_, i) => Array.from({ length: m }, (_, k) => e.vectors[i][k] * Math.sqrt(Math.max(e.values[k], 0))));
  };
  // 主因子法：共通性を SMC から始め、対角に共通性を入れた相関行列の固有値分解を収束するまで繰り返す
  S.efaPAF = function (R, m) {
    let h = S.smc(R), L = null, it = 0, conv = false;
    for (; it < 20000; it++) {
      L = topLoad(R.map((r, i) => r.map((v, j) => (i === j ? h[i] : v))), m);
      const hn = L.map(r => S.sum(r.map(v => v * v)));
      let d = 0; for (let i = 0; i < h.length; i++) d = Math.max(d, Math.abs(hn[i] - h[i]));
      h = hn;
      if (d < 1e-13) { conv = true; break; }
    }
    return { loadings: L, psi: h.map((v, i) => R[i][i] - v), iterations: it, converged: conv, heywood: h.some((v, i) => v >= R[i][i]) };
  };
  // 最小残差法（Harman 1976）：対角を除いた残差平方和 Σ_{i≠j}(R_ij − λ_i·λ_j)² を最小にする。
  // 行ごとの最小二乗を順に解く座標降下法（毎回の更新で目的関数は減り続ける）
  S.efaMinres = function (R, m) {
    // 主因子法とは別の出発点（主成分の負荷量）から始める。主因子法は収束すると同じ解になるので、独立した確認にもなる
    const p = R.length, L = topLoad(R, m).map(r => r.slice());
    let it = 0, conv = false;
    for (; it < 100000; it++) {
      let d = 0;
      for (let i = 0; i < p; i++) {
        const A = Array.from({ length: m }, () => new Array(m).fill(0)), b = new Array(m).fill(0);
        for (let j = 0; j < p; j++) if (j !== i) for (let a = 0; a < m; a++) {
          b[a] += R[i][j] * L[j][a];
          for (let c = 0; c < m; c++) A[a][c] += L[j][a] * L[j][c];
        }
        const Ai = S.inverse(A); if (!Ai) continue;
        const old = S.sum(L[i].map(v => v * v));
        L[i] = Ai.map(r => S.sum(r.map((v, c) => v * b[c])));
        d = Math.max(d, Math.abs(S.sum(L[i].map(v => v * v)) - old));
      }
      if (d < 1e-13) { conv = true; break; }
    }
    const loadings = topLoad(mmul(L, tpose(L)), m), h = loadings.map(r => S.sum(r.map(v => v * v)));
    return { loadings, psi: h.map((v, i) => R[i][i] - v), iterations: it, converged: conv, heywood: h.some((v, i) => v >= R[i][i]) };
  };
  // 最尤法：EM アルゴリズム（Rubin & Thayer 1982）で独自分散を求め、最後に負荷量を厳密に計算し直す。
  // 独自分散には R の factanal と同じく下限 0.005 を置く
  S.efaML = function (R, m) {
    const p = R.length, LOW = 0.005, sp = S.spd(R);
    if (!sp) return null;
    let psi = sp.inv.map((r, i) => (1 - 0.5 * m / p) / r[i]);
    const lamOf = ps => {
      const sq = ps.map(Math.sqrt), Ms = R.map((r, i) => r.map((v, j) => v / (sq[i] * sq[j]))), e = S.eigSym(Ms);
      return Ms.map((_, i) => Array.from({ length: m }, (_, k) => sq[i] * e.vectors[i][k] * Math.sqrt(Math.max(e.values[k] - 1, 0))));
    };
    let L = lamOf(psi), it = 0, conv = false;
    for (; it < 300000; it++) {
      const lp = L.map((r, i) => r.map(v => v / psi[i]));                  // Ψ⁻¹Λ（p × m）
      const Mm = S.inverse(madd(idn(m), mmul(tpose(L), lp), 1, 1));          // (I + Λ'Ψ⁻¹Λ)⁻¹
      if (!Mm) break;
      const beta = mmul(Mm, tpose(lp));                                     // m × p
      const Rb = mmul(R, tpose(beta));                                      // R β'
      const Ezz = madd(madd(idn(m), mmul(beta, L), 1, -1), mmul(beta, Rb), 1, 1);
      const Ei = S.inverse(Ezz); if (!Ei) break;
      const Ln = mmul(Rb, Ei), T = mmul(Ln, mmul(beta, R));
      const pn = psi.map((_, i) => Math.max(R[i][i] - T[i][i], LOW));
      let d = 0; for (let i = 0; i < p; i++) d = Math.max(d, Math.abs(pn[i] - psi[i]));
      psi = pn; L = Ln;
      if (d < 1e-12) { conv = true; break; }
    }
    L = lamOf(psi);
    const Sig = madd(mmul(L, tpose(L)), psi.map((v, i) => psi.map((_, j) => (i === j ? v : 0))), 1, 1), sg = S.spd(Sig);
    let tr = 0; if (sg) for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) tr += sg.inv[i][j] * R[i][j];
    const F = sg ? sg.logdet - sp.logdet + tr - p : NaN;
    return { loadings: L, psi, F, iterations: it, converged: conv, heywood: psi.some(v => v <= LOW * 1.0001) };
  };

  // --- 回転（勾配射影法 GPA; Bernaards & Jennrich 2005）
  const polar = X => {
    const m = X[0].length, e = S.eigSym(mmul(tpose(X), X));
    const D = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => { let s = 0; for (let k = 0; k < m; k++) s += e.vectors[i][k] * e.vectors[j][k] / Math.sqrt(e.values[k]); return s; }));
    return mmul(X, D);
  };
  const crit = {
    quartimax: L => ({ f: -ssq(L.map(r => r.map(v => v * v))) / 4, Gq: L.map(r => r.map(v => -v * v * v)) }),
    varimax: L => {
      const L2 = L.map(r => r.map(v => v * v)), p = L.length, m = L[0].length;
      const mean = Array.from({ length: m }, (_, k) => S.sum(L2.map(r => r[k])) / p);
      const QL = L2.map(r => r.map((v, k) => v - mean[k]));
      return { f: -ssq(QL) / 4, Gq: L.map((r, i) => r.map((v, k) => -v * QL[i][k])) };
    },
    oblimin: (L, gam) => {
      const p = L.length, m = L[0].length, L2 = L.map(r => r.map(v => v * v));
      let X = L2.map(r => r.map((_, j) => S.sum(r) - r[j]));              // L² (1 − I)
      if (gam) { const cm = Array.from({ length: m }, (_, j) => S.sum(X.map(r => r[j])) / p); X = X.map(r => r.map((v, j) => v - gam * cm[j])); }
      let f = 0; for (let i = 0; i < p; i++) for (let j = 0; j < m; j++) f += L2[i][j] * X[i][j];
      return { f: f / 4, Gq: L.map((r, i) => r.map((v, j) => v * X[i][j])) };
    },
  };
  const kaiserNorm = A => { const w = A.map(r => Math.sqrt(S.sum(r.map(v => v * v))) || 1); return { w, An: A.map((r, i) => r.map(v => v / w[i])) }; };
  // 直交回転。名前: 'varimax' | 'quartimax'。kaiser = true で行を長さ 1 にそろえてから回す
  S.rotateOrth = function (A, name, kaiser) {
    const m = A[0].length;
    if (m < 2) return { loadings: A, T: idn(m) };
    const kn = kaiser ? kaiserNorm(A) : null, A0 = kn ? kn.An : A, cf = crit[name];
    let T = idn(m), cur = cf(A0), G = mmul(tpose(A0), cur.Gq), al = 1;
    for (let iter = 0; iter < 20000; iter++) {
      const M = mmul(tpose(T), G), Sm = M.map((r, i) => r.map((v, j) => (v + M[j][i]) / 2));
      const Gp = madd(G, mmul(T, Sm), 1, -1), s = Math.sqrt(ssq(Gp));
      if (s < 1e-7) break;               // 勾配の大きさ。1e-8 より小さくは下がらない（丸め誤差）
      al *= 2;
      let Tt, ct;
      for (let i = 0; i <= 10; i++) {
        Tt = polar(madd(T, Gp, 1, -al)); ct = cf(mmul(A0, Tt));
        if (ct.f < cur.f - 0.5 * s * s * al) break;
        al /= 2;
      }
      T = Tt; cur = ct; G = mmul(tpose(A0), cur.Gq);
    }
    let L = mmul(A0, T);
    if (kn) L = L.map((r, i) => r.map(v => v * kn.w[i]));
    return { loadings: L, T };
  };
  // 斜交回転（オブリミン; gam = 0 はクォーティミン）。L = A (T')⁻¹, 因子相関 Φ = T'T
  S.rotateOblimin = function (A, gam) {
    const m = A[0].length;
    if (m < 2) return { loadings: A, phi: [[1]], T: idn(m) };
    const cf = L => crit.oblimin(L, gam || 0), Linv = T => mmul(A, S.inverse(tpose(T)));
    let T = idn(m), L = Linv(T), cur = cf(L), al = 1;
    const grad = (L, Gq, T) => tpose(mmul(mmul(tpose(L), Gq), S.inverse(T))).map(r => r.map(v => -v));
    let G = grad(L, cur.Gq, T);
    for (let iter = 0; iter < 50000; iter++) {
      const cs = Array.from({ length: m }, (_, j) => { let s = 0; for (let i = 0; i < m; i++) s += T[i][j] * G[i][j]; return s; });
      const Gp = G.map((r, i) => r.map((v, j) => v - T[i][j] * cs[j])), s = Math.sqrt(ssq(Gp));
      if (s < 1e-7) break;               // 勾配の大きさ。1e-8 より小さくは下がらない（丸め誤差）
      al *= 2;
      let Tt, Lt, ct;
      for (let i = 0; i <= 10; i++) {
        const X = madd(T, Gp, 1, -al), v = Array.from({ length: m }, (_, j) => 1 / Math.sqrt(S.sum(X.map(r => r[j] * r[j]))));
        Tt = X.map(r => r.map((x, j) => x * v[j]));
        Lt = Linv(Tt); ct = cf(Lt);
        if (cur.f - ct.f > 0.5 * s * s * al) break;
        al /= 2;
      }
      T = Tt; L = Lt; cur = ct; G = grad(L, cur.Gq, T);
    }
    return { loadings: L, phi: mmul(tpose(T), T), T };
  };
  // プロマックス（R の stats::promax と同じ手順; m = 4）
  S.promax = function (A, mpow) {
    const m = A[0].length; mpow = mpow || 4;
    if (m < 2) return { loadings: A, phi: [[1]] };
    const vm = S.rotateOrth(A, 'varimax', true), X = vm.loadings;
    const Q = X.map(r => r.map(v => v * Math.pow(Math.abs(v), mpow - 1)));
    let U = mmul(S.inverse(mmul(tpose(X), X)), mmul(tpose(X), Q));
    const d = diagOf(S.inverse(mmul(tpose(U), U)));
    U = U.map(r => r.map((v, j) => v * Math.sqrt(d[j])));
    const rot = mmul(vm.T, U), ui = S.inverse(rot), C = mmul(ui, tpose(ui));
    return { loadings: mmul(X, U), phi: S.cov2cor(C) };
  };
  // 回転の入口。name: 'none' | 'varimax' | 'quartimax' | 'oblimin' | 'promax'
  S.efaRotate = function (L0, name) {
    const m = L0[0].length;
    if (m < 2 || name === 'none') return { loadings: L0, phi: null };
    if (name === 'varimax' || name === 'quartimax') return { loadings: S.rotateOrth(L0, name, name === 'varimax').loadings, phi: null };
    if (name === 'oblimin') { const r = S.rotateOblimin(L0, 0); return { loadings: r.loadings, phi: r.phi }; }
    return S.promax(L0, 4);
  };
  // 因子の並べ替え（寄与の大きい順）と符号の統一（各列の合計が正）。SS 負荷量も返す（斜交は diag(Φ L'L)）
  S.efaFinalize = function (L, phi) {
    const p = L.length, m = L[0].length;
    const sign = Array.from({ length: m }, (_, k) => (S.sum(L.map(r => r[k])) < 0 ? -1 : 1));
    let Ls = L.map(r => r.map((v, k) => v * sign[k])), Ph = phi ? phi.map((r, i) => r.map((v, j) => v * sign[i] * sign[j])) : null;
    const ssOf = (LL, PP) => (PP ? diagOf(mmul(PP, mmul(tpose(LL), LL))) : Array.from({ length: m }, (_, k) => S.sum(LL.map(r => r[k] * r[k]))));
    let ss = ssOf(Ls, Ph);
    const ord = ss.map((_, k) => k).sort((a, b) => ss[b] - ss[a]);
    Ls = Ls.map(r => ord.map(k => r[k]));
    if (Ph) Ph = ord.map(a => ord.map(b => Ph[a][b]));
    ss = ssOf(Ls, Ph);
    return { loadings: Ls, phi: Ph, ss, p };
  };

  // 非心カイ二乗分布の下側確率（ポアソン混合）と RMSEA の信頼区間（Browne & Cudeck 1993）
  S.pchisqNC = function (x, k, ncp) {
    if (ncp < 1e-12) return 1 - S.pchisqUpper(x, k);
    const lam = ncp / 2, jm = Math.floor(lam);
    const term = j => Math.exp(-lam + j * Math.log(lam) - S.lgamma(j + 1)) * S.gammaP((k + 2 * j) / 2, x / 2);
    let sum = 0;
    for (let j = jm; j < jm + 200000; j++) { const t = term(j); sum += t; if (t < 1e-18 * Math.max(sum, 1e-300) && j > jm + 5) break; }
    for (let j = jm - 1; j >= 0; j--) { const t = term(j); sum += t; if (t < 1e-18 * Math.max(sum, 1e-300) && j < jm - 5) break; }
    return Math.min(1, sum);
  };
  // 返り値は非心パラメータ λ の下限・上限（RMSEA = √(λ / (df · n))）
  S.rmseaNcp = function (T, df, level) {
    const a = (1 - level) / 2, f = lam => S.pchisqNC(T, df, lam);
    const bis = (g, lo, hi) => { for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (g(mid) > 0) lo = mid; else hi = mid; if (hi - lo < 1e-10 * Math.max(1, hi)) break; } return (lo + hi) / 2; };
    let lower = 0, upper = 0;
    if (f(0) > 1 - a) lower = bis(l => f(l) - (1 - a), 0, Math.max(T, 1));
    if (f(0) > a) { let hi = Math.max(T, df, 1); while (f(hi) > a && hi < 1e9) hi *= 2; upper = bis(l => f(l) - a, 0, hi); }
    return [lower, upper];
  };

  // --- 確認的因子分析（最尤法）。Sm: 共分散行列（n で割る）, N: 標本サイズ,
  //     spec: { p, nf, free[i][k], first[k]（各因子の最初の項目＝マーカー）, orth }, scaling: 'marker' | 'std'
  //     Σ = ΛΦΛ' + Ψ。推定は因子分散 1 の形で行い、マーカー変数法のときは尺度を変換する（解は同じ）
  S.bfgs = function (fg, x0, maxIter, gtol) {
    // 勾配は 6e-9 付近が倍精度の下限（目的関数の差が丸め誤差に埋もれる）なので、判定は 1e-7 にする。
    // このときパラメータの誤差は 勾配 ÷ ヘッセ行列 ≒ 1e-7 で、標準誤差（0.01 以上）に比べて十分に小さい
    maxIter = maxIter || 4000; gtol = gtol || 1e-7;
    const n = x0.length;
    let x = x0.slice(), cur = fg(x), H = idn(n), it = 0, conv = false;
    if (!isFinite(cur.f)) return { x, f: cur.f, iterations: 0, converged: false };
    for (; it < maxIter; it++) {
      let gmax = 0; for (const v of cur.g) gmax = Math.max(gmax, Math.abs(v));
      if (gmax < gtol) { conv = true; break; }
      let d = H.map(r => -S.sum(r.map((v, j) => v * cur.g[j])));
      let gd = S.sum(d.map((v, j) => v * cur.g[j]));
      if (gd >= 0) { H = idn(n); d = cur.g.map(v => -v); gd = -S.sum(cur.g.map(v => v * v)); }
      let step = 1, nx, nf;
      for (let ls = 0; ls < 60; ls++) {
        nx = x.map((v, j) => v + step * d[j]); nf = fg(nx);
        if (isFinite(nf.f) && nf.f <= cur.f + 1e-4 * step * gd) break;
        step *= 0.5; nf = null;
      }
      if (!nf) { conv = gmax < 1e-5; break; }                  // 進めなくなっても、勾配が十分小さければ収束とみなす
      const s = nx.map((v, j) => v - x[j]), y = nf.g.map((v, j) => v - cur.g[j]), sy = S.sum(s.map((v, j) => v * y[j]));
      if (sy > 1e-14) {
        const rho = 1 / sy, Hy = H.map(r => S.sum(r.map((v, j) => v * y[j])));
        const yHy = S.sum(y.map((v, j) => v * Hy[j]));
        H = H.map((r, i) => r.map((v, j) => v - rho * (Hy[i] * s[j] + s[i] * Hy[j]) + (rho * rho * yHy + rho) * s[i] * s[j]));
      }
      x = nx; cur = nf;
    }
    return { x, f: cur.f, iterations: it, converged: conv };
  };

  S.cfa = function (Sm, N, spec, scaling) {
    const { p, nf, free, first, orth } = spec;
    const sp0 = S.spd(Sm);
    if (!sp0) return { error: '観測の共分散行列が正定値ではありません（項目が線形従属か、完全に相関しています）。' };
    const logdetS = sp0.logdet;
    // パラメータの並び（負荷量 → 因子の分散・共分散 → 独自分散）と、それを行列に戻す関数
    const layout = scl => {
      const params = [];
      const fixedLam = free.map((r, i) => r.map((f, k) => (scl === 'marker' && first[k] === i ? 1 : 0)));
      for (let k = 0; k < nf; k++) for (let i = 0; i < p; i++) if (free[i][k] && !(scl === 'marker' && first[k] === i)) params.push({ t: 'lam', i, k });
      for (let k = 0; k < nf; k++) for (let l = k; l < nf; l++) if (k === l ? scl === 'marker' : !orth) params.push({ t: 'phi', k, l });
      for (let i = 0; i < p; i++) params.push({ t: 'psi', i });
      const unpack = th => {
        const Lam = fixedLam.map(r => r.slice()), Phi = idn(nf), Psi = new Array(p).fill(0);
        params.forEach((pr, a) => {
          if (pr.t === 'lam') Lam[pr.i][pr.k] = th[a];
          else if (pr.t === 'phi') { Phi[pr.k][pr.l] = th[a]; Phi[pr.l][pr.k] = th[a]; }
          else Psi[pr.i] = th[a];
        });
        return { Lam, Phi, Psi };
      };
      return { params, unpack, q: params.length, fixedLam };
    };
    const sigmaOf = ({ Lam, Phi, Psi }) => {
      const LP = mmul(Lam, Phi), Sg = mmul(LP, tpose(Lam));
      for (let i = 0; i < p; i++) Sg[i][i] += Psi[i];
      return { Sg, LP };
    };
    const Lstd = layout('std'), Lsel = layout(scaling);
    const dfAll = p * (p + 1) / 2 - Lsel.q;
    if (dfAll < 0) return { error: `推定するパラメータ（${Lsel.q} 個）が、データから得られる情報（${p * (p + 1) / 2} 個）より多いため、モデルを推定できません。項目を増やすか、モデルを簡単にしてください。` };

    // 最尤推定（因子分散 1 の形）
    const fg = th => {
      const m = Lstd.unpack(th), { Sg, LP } = sigmaOf(m), sp = S.spd(Sg);
      if (!sp) return { f: Infinity, g: null };
      let tr = 0; for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) tr += sp.inv[i][j] * Sm[i][j];
      const Dm = Sg.map((r, i) => r.map((v, j) => v - Sm[i][j])), G = mmul(sp.inv, mmul(Dm, sp.inv));
      const GLP = mmul(G, LP), LGL = mmul(tpose(m.Lam), mmul(G, m.Lam));
      const g = Lstd.params.map(pr => (pr.t === 'lam' ? 2 * GLP[pr.i][pr.k] : pr.t === 'phi' ? (pr.k === pr.l ? LGL[pr.k][pr.k] : 2 * LGL[pr.k][pr.l]) : G[pr.i][pr.i]));
      return { f: sp.logdet - logdetS + tr - p, g };
    };
    const primary = free.map(r => r.indexOf(true));
    const th0 = Lstd.params.map(pr => {
      if (pr.t === 'lam') return (primary[pr.i] === pr.k ? 0.7 : 0.15) * Math.sqrt(Sm[pr.i][pr.i]);
      if (pr.t === 'phi') return 0.3;
      return 0.5 * Sm[pr.i][pr.i];
    });
    const fit = S.bfgs(fg, th0);
    let { Lam, Phi, Psi } = Lstd.unpack(fit.x);
    // 向きをそろえる：各因子の最初の項目の負荷量が正になるように符号を反転
    for (let k = 0; k < nf; k++) if (Lam[first[k]][k] < 0) {
      for (let i = 0; i < p; i++) Lam[i][k] = -Lam[i][k];
      for (let l = 0; l < nf; l++) if (l !== k) { Phi[k][l] = -Phi[k][l]; Phi[l][k] = -Phi[l][k]; }
    }
    // マーカー変数法に変換：Λ' = Λ D⁻¹, Φ' = D Φ D（D の対角は各因子のマーカーの負荷量）
    let unstable = false;
    if (scaling === 'marker') {
      const d = first.map((i, k) => Lam[i][k]);
      if (d.some(v => Math.abs(v) < 1e-6)) unstable = true;
      Lam = Lam.map(r => r.map((v, k) => v / d[k]));
      Phi = Phi.map((r, k) => r.map((v, l) => v * d[k] * d[l]));
    }
    const th = Lsel.params.map(pr => (pr.t === 'lam' ? Lam[pr.i][pr.k] : pr.t === 'phi' ? Phi[pr.k][pr.l] : Psi[pr.i]));
    const model = Lsel.unpack(th), { Sg, LP } = sigmaOf(model), sp = S.spd(Sg);
    if (!sp) return { error: '推定された共分散行列が正定値になりませんでした。モデルを見直してください。' };
    let tr = 0; for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) tr += sp.inv[i][j] * Sm[i][j];
    const Fmin = sp.logdet - logdetS + tr - p;

    // 標準誤差（期待情報行列）: cov(θ) = (2/N) M⁻¹, M_ab = tr(Σ⁻¹Σ_a Σ⁻¹Σ_b)
    const q = Lsel.q, As = Lsel.params.map(pr => {
      const D = Array.from({ length: p }, () => new Array(p).fill(0));
      if (pr.t === 'lam') { for (let j = 0; j < p; j++) { D[pr.i][j] += LP[j][pr.k]; D[j][pr.i] += LP[j][pr.k]; } }
      else if (pr.t === 'phi') {
        for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) {
          D[i][j] = model.Lam[i][pr.k] * model.Lam[j][pr.l] + (pr.k === pr.l ? 0 : model.Lam[i][pr.l] * model.Lam[j][pr.k]);
        }
      } else D[pr.i][pr.i] = 1;
      return mmul(sp.inv, D);
    });
    const M = Array.from({ length: q }, () => new Array(q).fill(0));
    for (let a = 0; a < q; a++) for (let b = a; b < q; b++) {
      let s = 0; for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) s += As[a][i][j] * As[b][j][i];
      M[a][b] = M[b][a] = s;
    }
    const Mi = S.inverse(M), identified = !!Mi;
    const cov = Mi ? Mi.map(r => r.map(v => v * 2 / N)) : null;

    // 標準化解と、そのデルタ法による標準誤差
    const stdOf = t => {
      const m = Lsel.unpack(t), { Sg: Sx } = sigmaOf(m), out = [];
      for (let i = 0; i < p; i++) for (let k = 0; k < nf; k++) if (free[i][k]) out.push(m.Lam[i][k] * Math.sqrt(m.Phi[k][k]) / Math.sqrt(Sx[i][i]));
      for (let k = 0; k < nf; k++) for (let l = k; l < nf; l++) out.push(m.Phi[k][l] / Math.sqrt(m.Phi[k][k] * m.Phi[l][l]));
      for (let i = 0; i < p; i++) out.push(m.Psi[i] / Sx[i][i]);
      return out;
    };
    const sv = stdOf(th);
    let sSE = sv.map(() => NaN);
    if (cov) {
      const J = th.map((v, a) => {
        const h = 1e-6 * Math.max(1, Math.abs(v)), tp_ = th.slice(), tm_ = th.slice(); tp_[a] += h; tm_[a] -= h;
        const u = stdOf(tp_), w = stdOf(tm_); return u.map((x, c) => (x - w[c]) / (2 * h));
      });
      sSE = sv.map((_, c) => { let s = 0; for (let a = 0; a < q; a++) for (let b = 0; b < q; b++) s += J[a][c] * cov[a][b] * J[b][c]; return Math.sqrt(Math.max(s, 0)); });
    }
    const stdLam = free.map(r => r.map(() => null)), seStdLam = free.map(r => r.map(() => null));
    let c = 0;
    for (let i = 0; i < p; i++) for (let k = 0; k < nf; k++) if (free[i][k]) { stdLam[i][k] = sv[c]; seStdLam[i][k] = sSE[c]; c++; }
    const stdPhi = idn(nf), seStdPhi = Array.from({ length: nf }, () => new Array(nf).fill(0));
    for (let k = 0; k < nf; k++) for (let l = k; l < nf; l++) { stdPhi[k][l] = stdPhi[l][k] = sv[c]; seStdPhi[k][l] = seStdPhi[l][k] = sSE[c]; c++; }
    const stdPsi = [], seStdPsi = [];
    for (let i = 0; i < p; i++) { stdPsi.push(sv[c]); seStdPsi.push(sSE[c]); c++; }
    // 推定値ごとの標準誤差（固定したものは null）
    const seLam = free.map(r => r.map(() => null)), sePhi = Array.from({ length: nf }, () => new Array(nf).fill(null)), sePsi = new Array(p).fill(null);
    Lsel.params.forEach((pr, a) => {
      const se = cov ? Math.sqrt(Math.max(cov[a][a], 0)) : NaN;
      if (pr.t === 'lam') seLam[pr.i][pr.k] = se; else if (pr.t === 'phi') { sePhi[pr.k][pr.l] = se; sePhi[pr.l][pr.k] = se; } else sePsi[pr.i] = se;
    });

    // 適合度
    const chisq = N * Fmin, df = dfAll;
    let F0 = -logdetS; for (let i = 0; i < p; i++) F0 += Math.log(Sm[i][i]);
    const chisqB = N * F0, dfB = p * (p - 1) / 2;
    const dd = Math.max(chisq - df, 0);
    const cfi = df > 0 || chisq > 0 ? 1 - dd / Math.max(chisq - df, chisqB - dfB, 1e-300) : 1;
    const tli = df > 0 ? (chisqB / dfB - chisq / df) / (chisqB / dfB - 1) : NaN;
    const rmsea = df > 0 ? Math.sqrt(dd / (N * df)) : 0;
    let rmseaLo = NaN, rmseaHi = NaN;
    if (df > 0) { const [lo, hi] = S.rmseaNcp(chisq, df, 0.9); rmseaLo = Math.sqrt(lo / (N * df)); rmseaHi = Math.sqrt(hi / (N * df)); }
    let sr = 0; for (let i = 0; i < p; i++) for (let j = i; j < p; j++) sr += ((Sm[i][j] - Sg[i][j]) / Math.sqrt(Sm[i][i] * Sm[j][j])) ** 2;
    const srmr = Math.sqrt(2 * sr / (p * (p + 1)));
    const sdS = Sm.map((r, i) => Math.sqrt(r[i])), sdG = Sg.map((r, i) => Math.sqrt(r[i]));
    const resid = Sm.map((r, i) => r.map((v, j) => v / (sdS[i] * sdS[j]) - Sg[i][j] / (sdG[i] * sdG[j])));
    const heywood = model.Psi.some(v => v < 0) || stdLam.some(r => r.some(v => v !== null && Math.abs(v) > 1));
    return {
      ok: true, converged: fit.converged, iterations: fit.iterations, N, p, nf, q, df, chisq, pval: df > 0 ? S.pchisqUpper(chisq, df) : NaN,
      chisqB, dfB, pvalB: S.pchisqUpper(chisqB, dfB), cfi, tli, rmsea, rmseaLo, rmseaHi, srmr,
      Lam: model.Lam, Phi: model.Phi, Psi: model.Psi, Sigma: Sg, lamFixed: free.map((r, i) => r.map((f, k) => f && Lsel.fixedLam[i][k] === 1)),
      seLam, sePhi, sePsi, stdLam, stdPhi, stdPsi, seStdLam, seStdPhi, seStdPsi, resid, identified, heywood, unstable,
    };
  };

  // ---------------------------------------------------------------- ベイズファクター
  // どれも BF10（対立仮説 / 帰無仮説）を返す。事前分布の既定値は JASP の既定値にそろえている。
  const logSumExp = a => { const m = Math.max(...a); if (!isFinite(m)) return m; let s = 0; for (const v of a) s += Math.exp(v - m); return m + Math.log(s); };
  S.logSumExp = logSumExp;
  S.dt = (t, nu) => Math.exp(S.lgamma((nu + 1) / 2) - S.lgamma(nu / 2) - 0.5 * Math.log(nu * Math.PI) - (nu + 1) / 2 * Math.log1p(t * t / nu));

  // t 検定の JZS ベイズファクター（Rouder et al., 2009）。δ ~ Cauchy(0, r)。
  // t の尤度（非心 t 分布）を「s = √(χ²/ν)」と δ の二重積分で求める。片側は δ の符号で事前分布を切る。
  // N は有効サンプルサイズ（1群・対応あり: n、独立2群: n1·n2/(n1+n2)）、nu は自由度
  S.bfT = function (t, N, nu, r, alt) {
    r = r || Math.SQRT1_2; alt = alt || 'two';
    if (!isFinite(t) || N <= 0 || nu < 1) return NaN;
    const sq = Math.sqrt(N), k = alt === 'two' ? 1 : 2;
    const prior = d => k / (Math.PI * r * (1 + (d / r) * (d / r)));
    const half = nu / 2, lc = Math.log(2) + half * Math.log(half) - S.lgamma(half);
    const spread = 12 / Math.sqrt(2 * nu), sLo = Math.max(0, 1 - spread), sHi = 1 + spread;
    const w = 9 / sq;
    const inner = s => {
      const m = t * s / sq;
      let a = m - w, b = m + w;
      if (alt === 'greater') { a = Math.max(a, 0); b = Math.max(b, a + w); }
      if (alt === 'less') { b = Math.min(b, 0); a = Math.min(a, b - w); }
      return simpson(d => prior(d) * S.dnorm(t * s - d * sq), a, b, 200);
    };
    const num = simpson(s => (s <= 0 ? 0 : s * Math.exp(lc + (nu - 1) * Math.log(s) - half * s * s) * inner(s)), sLo, sHi, 300);
    return num / S.dt(t, nu);
  };

  // ガウスの超幾何関数 2F1(1/2, 1/2; c; z)（0 ≤ z < 1、c > 1）
  function hyp2f1Half(c, z) {
    let term = 1, sum = 1;
    for (let k = 0; k < 20000; k++) {
      term *= (0.5 + k) * (0.5 + k) / ((c + k) * (k + 1)) * z;
      sum += term;
      if (term < 1e-15 * sum) break;
    }
    return sum;
  }
  // Pearson の相関のベイズファクター（Ly, Verhagen & Wagenmakers, 2016）。
  // r の正確な尤度を使い、ρ の事前分布は幅 κ の伸長ベータ分布（κ = 1 で一様分布）
  S.bfCor = function (r, n, kappa, alt) {
    kappa = kappa || 1; alt = alt || 'two';
    if (n < 3 || !isFinite(r) || Math.abs(r) >= 1) return NaN;
    const a = 1 / kappa, c = n - 0.5;
    const lpri = rho => (a - 1) * (Math.log1p(rho) + Math.log1p(-rho)) - (2 * a - 1) * Math.log(2) - (2 * S.lgamma(a) - S.lgamma(2 * a));
    const llik = rho => (n - 1) / 2 * Math.log1p(-rho * rho) + (1.5 - n) * Math.log1p(-rho * r) + Math.log(hyp2f1Half(c, (1 + rho * r) / 2));
    const l0 = Math.log(hyp2f1Half(c, 0.5));
    const lo = alt === 'greater' ? 0 : -1, hi = alt === 'less' ? 0 : 1, m = 4000, h = (hi - lo) / m;
    const ls = [];
    for (let i = 0; i < m; i++) { const rho = lo + (i + 0.5) * h; ls.push(lpri(rho) + llik(rho) - l0); }
    const k = alt === 'two' ? 1 : 2;
    return k * Math.exp(logSumExp(ls)) * h;
  };

  // g の事前分布 IG(1/2, b) を τ = log g の格子で台形積分するための点と重み
  function gGrid(b, npts) {
    const lo = Math.log(b) - 7, hi = Math.log(b) + 25, h = (hi - lo) / (npts - 1), pts = [];
    for (let i = 0; i < npts; i++) {
      const tau = lo + i * h;
      pts.push({ tau, g: Math.exp(tau), lw: 0.5 * Math.log(b / Math.PI) - tau / 2 - b * Math.exp(-tau) + Math.log(h) });
    }
    return pts;
  }

  // 線形回帰の Zellner-Siow（JZS）ベイズファクター（Liang et al., 2008）。g ~ IG(1/2, N r²/2)
  // p は説明変数の数（切片を除く列数）
  S.bfRegR2 = function (N, p, R2, r) {
    r = r || Math.SQRT2 / 4;
    if (N - p - 1 < 1 || p < 1) return NaN;
    const ls = gGrid(N * r * r / 2, 400).map(q => q.lw + (N - p - 1) / 2 * Math.log1p(q.g) - (N - 1) / 2 * Math.log1p(q.g * (1 - R2)));
    return Math.exp(logSumExp(ls));
  };

  // 分散分析の既定のベイズファクター（Rouder, Morey, Speckman & Province, 2012）の対数（切片だけのモデルとの比）。
  // X は中心化した計画行列（N × p）、y は中心化した従属変数、blocks は [{cols:[列番号], r}]（項ごとに g を1つ）
  S.logBfGLM = function (X, y, blocks) {
    const N = y.length, p = X[0].length;
    const XtX = Array.from({ length: p }, () => new Array(p).fill(0)), Xty = new Array(p).fill(0);
    let yty = 0;
    for (let i = 0; i < N; i++) {
      yty += y[i] * y[i];
      for (let a = 0; a < p; a++) { Xty[a] += X[i][a] * y[i]; for (let c = a; c < p; c++) XtX[a][c] += X[i][a] * X[i][c]; }
    }
    for (let a = 0; a < p; a++) for (let c = 0; c < a; c++) XtX[a][c] = XtX[c][a];
    const d = blocks.length, npts = d === 1 ? 160 : d === 2 ? 70 : 40;
    const grids = blocks.map(bl => gGrid(bl.r * bl.r / 2, npts));
    const colBlock = new Array(p).fill(-1);
    blocks.forEach((bl, j) => bl.cols.forEach(c => { colBlock[c] = j; }));
    const out = [], idx = new Array(d).fill(0);
    const V = Array.from({ length: p }, () => new Array(p).fill(0)), L = Array.from({ length: p }, () => new Array(p).fill(0)), z = new Array(p);
    for (;;) {
      let lw = 0, ldG = 0;
      const gs = idx.map((ii, j) => { const q = grids[j][ii]; lw += q.lw; ldG += q.tau * blocks[j].cols.length; return q.g; });
      for (let a = 0; a < p; a++) for (let c = 0; c < p; c++) V[a][c] = XtX[a][c] + (a === c ? 1 / gs[colBlock[a]] : 0);
      // コレスキー分解で log|V| と Xty' V⁻¹ Xty を求める
      let ldV = 0, ok = true;
      for (let a = 0; a < p && ok; a++) {
        for (let c = 0; c <= a; c++) {
          let s = V[a][c];
          for (let k = 0; k < c; k++) s -= L[a][k] * L[c][k];
          if (a === c) { if (s <= 0) { ok = false; break; } L[a][a] = Math.sqrt(s); ldV += 2 * Math.log(L[a][a]); }
          else L[a][c] = s / L[c][c];
        }
      }
      if (ok) {
        let quad = 0;
        for (let a = 0; a < p; a++) { let s = Xty[a]; for (let k = 0; k < a; k++) s -= L[a][k] * z[k]; z[a] = s / L[a][a]; quad += z[a] * z[a]; }
        const rest = Math.max(1e-300, 1 - quad / yty);
        out.push(lw - 0.5 * (ldG + ldV) - (N - 1) / 2 * Math.log(rest));
      }
      let j = 0;
      while (j < d && ++idx[j] === npts) { idx[j] = 0; j++; }
      if (j === d) break;
    }
    return logSumExp(out);
  };

  // 対数の被積分関数 f(τ)（τ = log g のベクトル）を格子で積分し、log ∫ exp(f) dτ を返す。
  // まず座標ごとの黄金分割で最大点を探し、各軸の切り口から積分範囲（最大値から 32 以内）と
  // 刻み（最大点の曲率から求めた広がりの 0.9 倍以下）を決めて、台形則で積分する
  S.integrateLog = function (f, start, lo, hi, maxPts) {
    // 上限で格子を間引くと精度が落ちる（40万点で 0.2% ずれた）ので、上限は余裕をもって大きくとる
    maxPts = maxPts || 2000000;
    const d = start.length, x = start.slice();
    const along = (j, t) => { const y = x.slice(); y[j] = t; return f(y); };
    for (let pass = 0; pass < 3; pass++) {
      for (let j = 0; j < d; j++) {
        let a = lo[j], b = hi[j];
        const gr = (Math.sqrt(5) - 1) / 2;
        let c = b - gr * (b - a), e = a + gr * (b - a), fc = along(j, c), fe = along(j, e);
        for (let it = 0; it < 40; it++) {
          if (fc > fe) { b = e; e = c; fe = fc; c = b - gr * (b - a); fc = along(j, c); }
          else { a = c; c = e; fc = fe; e = a + gr * (b - a); fe = along(j, e); }
        }
        x[j] = (a + b) / 2;
      }
    }
    const fmax = f(x), axes = [];
    for (let j = 0; j < d; j++) {
      // 範囲：切り口が fmax − 32 を下回らない区間（両側に 1.5 の余裕）
      const m = 160, step = (hi[j] - lo[j]) / m;
      let a = x[j], b = x[j];
      for (let i = 0; i <= m; i++) { const t = lo[j] + i * step; if (along(j, t) >= fmax - 32) { a = Math.min(a, t); b = Math.max(b, t); } }
      a = Math.max(lo[j], a - 1.5); b = Math.min(hi[j], b + 1.5);
      // 刻み：最大点での2階差分から広がり sd を見積もる
      const dl = 0.05, f2 = (along(j, x[j] + dl) + along(j, x[j] - dl) - 2 * fmax) / (dl * dl);
      const sd = f2 < -1e-8 ? 1 / Math.sqrt(-f2) : 5;
      // 刻みは広がりの 0.6 倍（4次元で 1.2 倍にすると 0.08%、0.9 倍で 6e-5 ずれた。0.6 倍と 0.45 倍は同じ値）
      const h = Math.min(1.2, Math.max(0.02, 0.6 * sd));
      axes.push({ a, b, n: Math.min(120, Math.ceil((b - a) / h) + 1) });
    }
    let total = axes.reduce((p, ax) => p * ax.n, 1);
    if (total > maxPts) { const s = Math.pow(maxPts / total, 1 / d); axes.forEach(ax => { ax.n = Math.max(12, Math.floor(ax.n * s)); }); }
    axes.forEach(ax => { ax.h = ax.n > 1 ? (ax.b - ax.a) / (ax.n - 1) : 1; });
    const idx = new Array(d).fill(0), y = new Array(d);
    let sum = 0;
    for (;;) {
      let w = 1;
      for (let j = 0; j < d; j++) {
        y[j] = axes[j].a + idx[j] * axes[j].h;
        if (idx[j] === 0 || idx[j] === axes[j].n - 1) w *= 0.5;
      }
      sum += w * Math.exp(f(y) - fmax);
      let j = 0;
      while (j < d && ++idx[j] === axes[j].n) { idx[j] = 0; j++; }
      if (j === d) break;
    }
    return fmax + Math.log(sum) + axes.reduce((s, ax) => s + Math.log(ax.h), 0);
  };
  // IG(1/2, b) の τ = log g での対数密度
  const lpriorTau = (tau, b) => 0.5 * Math.log(b / Math.PI) - tau / 2 - b * Math.exp(-tau);

  // 反復測定の計画（欠損なし、1人 k 個の測定値）で、被験者の変量効果（幅 rS）＋固定効果のモデルの
  // 切片だけのモデルに対する log BF（Rouder et al., 2012）。被験者の列は、
  // 中心化した固定効果の列・従属変数と直交する成分だけが効くので、シューア補行列で行列を小さくできる。
  // X: 中心化した固定効果の計画行列（N × p, p は 0 でもよい）、y: 中心化した従属変数、subj: 行ごとの被験者番号
  S.logBfRMModel = function (X, y, subj, n, k, blocks, rS, maxPts) {
    rS = rS || 1;
    const N = y.length, p = X.length ? X[0].length : 0;
    const Sy = new Array(n).fill(0), SX = Array.from({ length: n }, () => new Array(p).fill(0));
    let yty = 0;
    const XtX = Array.from({ length: p }, () => new Array(p).fill(0)), Xty = new Array(p).fill(0);
    for (let i = 0; i < N; i++) {
      const s = subj[i]; Sy[s] += y[i]; yty += y[i] * y[i];
      for (let a = 0; a < p; a++) {
        SX[s][a] += X[i][a]; Xty[a] += X[i][a] * y[i];
        for (let c = a; c < p; c++) XtX[a][c] += X[i][a] * X[i][c];
      }
    }
    for (let a = 0; a < p; a++) for (let c = 0; c < a; c++) XtX[a][c] = XtX[c][a];
    const aa = S.sum(Sy.map(v => v * v));
    const SXtSX = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, c) => { let s = 0; for (let i = 0; i < n; i++) s += SX[i][a] * SX[i][c]; return s; }));
    const SXtSy = Array.from({ length: p }, (_, a) => { let s = 0; for (let i = 0; i < n; i++) s += SX[i][a] * Sy[i]; return s; });
    const colBlock = new Array(p).fill(0);
    blocks.forEach((bl, j) => bl.cols.forEach(c => { colBlock[c] = j; }));
    const bs = [rS * rS / 2, ...blocks.map(bl => bl.r * bl.r / 2)];
    const M = Array.from({ length: p }, () => new Array(p).fill(0)), L = Array.from({ length: p }, () => new Array(p).fill(0)), z = new Array(p), w = new Array(p);
    const f = tau => {
      const gs = Math.exp(tau[0]), c = gs / (1 + k * gs);
      let lp = 0;
      for (let j = 0; j < tau.length; j++) lp += lpriorTau(tau[j], bs[j]); // τ での密度（ヤコビアン込み）
      let ld = (n - 1) * Math.log1p(k * gs), quad = c * aa;
      for (let j = 0; j < blocks.length; j++) ld += tau[j + 1] * blocks[j].cols.length;
      for (let a = 0; a < p; a++) {
        w[a] = Xty[a] - c * SXtSy[a];
        for (let b = 0; b < p; b++) M[a][b] = XtX[a][b] - c * SXtSX[a][b] + (a === b ? Math.exp(-tau[colBlock[a] + 1]) : 0);
      }
      for (let a = 0; a < p; a++) {
        for (let b = 0; b <= a; b++) {
          let s = M[a][b];
          for (let q = 0; q < b; q++) s -= L[a][q] * L[b][q];
          if (a === b) { if (s <= 0) return -Infinity; L[a][a] = Math.sqrt(s); ld += 2 * Math.log(L[a][a]); }
          else L[a][b] = s / L[b][b];
        }
      }
      for (let a = 0; a < p; a++) { let s = w[a]; for (let q = 0; q < a; q++) s -= L[a][q] * z[q]; z[a] = s / L[a][a]; quad += z[a] * z[a]; }
      return lp - 0.5 * ld - (N - 1) / 2 * Math.log(Math.max(1e-300, 1 - quad / yty));
    };
    const start = bs.map(b => Math.log(2 * b)), lo = bs.map(b => Math.log(b) - 7), hi = bs.map(b => Math.log(b) + 25);
    return S.integrateLog(f, start, lo, hi, maxPts);
  };

  // 1要因の反復測定：被験者（変量, r = 1）＋条件（固定, r = 0.5）のモデルと被験者だけのモデルの比。
  // 欠損のないデータでは被験者と条件の列が直交するので、行列を使わずに閉じた式で書ける
  S.bfRM = function (n, k, ssSubj, ssCond, ssTot, rFixed, rRandom) {
    rFixed = rFixed || 0.5; rRandom = rRandom || 1;
    const N = n * k;
    const gsS = gGrid(rRandom * rRandom / 2, 160), gsC = gGrid(rFixed * rFixed / 2, 160);
    const fs = gsS.map(q => ({ lw: q.lw, a: -(n - 1) / 2 * Math.log1p(k * q.g), s: ssSubj * k * q.g / (1 + k * q.g) }));
    const fc = gsC.map(q => ({ lw: q.lw, a: -(k - 1) / 2 * Math.log1p(n * q.g), s: ssCond * n * q.g / (1 + n * q.g) }));
    const lNull = logSumExp(fs.map(f => f.lw + f.a - (N - 1) / 2 * Math.log(1 - f.s / ssTot)));
    const lFull = [];
    for (const a of fs) for (const b of fc) lFull.push(a.lw + b.lw + a.a + b.a - (N - 1) / 2 * Math.log(Math.max(1e-300, 1 - (a.s + b.s) / ssTot)));
    return Math.exp(logSumExp(lFull) - lNull);
  };

  // 分割表の Gunel-Dickey ベイズファクター（同時多項分布; Gunel & Dickey, 1974; Jamil et al., 2017）。
  // H₁ はセルの確率に Dirichlet(a, …, a)、H₀（独立）は行・列の確率に Dirichlet(ξ) で、
  // ξ_行 = J·a − (J − 1)、ξ_列 = I·a − (I − 1)（a = 1 なら どちらも一様分布）
  S.bfContingency = function (O, a) {
    a = a || 1;
    const logD = v => S.sum(v.map(S.lgamma)) - S.lgamma(S.sum(v));
    const I = O.length, J = O[0].length, xr = J * a - (J - 1), xc = I * a - (I - 1);
    if (xr <= 0 || xc <= 0) return NaN;
    const rep = (n, v) => new Array(n).fill(v);
    const rs = O.map(r => S.sum(r) + xr), cs = O[0].map((_, j) => S.sum(O.map(r => r[j])) + xc);
    const lBF01 = logD(rs) + logD(cs) - logD(rep(I, xr)) - logD(rep(J, xc)) - logD(O.flat().map(v => v + a)) + logD(rep(I * J, a));
    return Math.exp(-lBF01);
  };

  // 二項検定のベイズファクター。比率の事前分布は Beta(a, b)（既定は一様分布 Beta(1, 1)）
  S.bfBinom = function (x, n, p0, alt, a, b) {
    a = a || 1; b = b || 1;
    const lB = (u, v) => S.lgamma(u) + S.lgamma(v) - S.lgamma(u + v);
    const l0 = x * Math.log(p0) + (n - x) * Math.log1p(-p0);
    let l1 = lB(x + a, n - x + b) - lB(a, b);
    if (alt === 'greater') l1 += Math.log(1 - S.ibeta(p0, x + a, n - x + b)) - Math.log(1 - S.ibeta(p0, a, b));
    else if (alt === 'less') l1 += Math.log(S.ibeta(p0, x + a, n - x + b)) - Math.log(S.ibeta(p0, a, b));
    return Math.exp(l1 - l0);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = S;
  else root.Stats = S;
})(typeof window !== 'undefined' ? window : globalThis);
