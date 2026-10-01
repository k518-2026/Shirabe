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
