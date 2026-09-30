# 分布関数・ノンパラメトリック検定の参照値を scipy で作る
import json, sys
import numpy as np
from scipy import stats

rng = np.random.default_rng(1)
x = np.round(rng.normal(50, 10, 23), 3).tolist()
y = np.round(rng.normal(55, 12, 17), 3).tolist()
xi = rng.integers(1, 6, 30).tolist()
yi = rng.integers(1, 6, 30).tolist()
small = [3.1, 4.5, 2.2, 5.9, 4.4, 3.3, 6.1, 2.8, 4.0]
d = (np.array(x[:17]) - np.array(y)).tolist()

out = {
  "x": x, "y": y, "xi": xi, "yi": yi, "small": small, "d": d,
  "pt": [stats.t.cdf(v, df) for v, df in [(-2.5, 3), (1.7, 12.4), (0.3, 100), (-8, 5)]],
  "qt": [stats.t.ppf(p, df) for p, df in [(0.975, 3), (0.995, 12.4), (0.025, 100)]],
  "pf": [stats.f.sf(v, a, b) for v, a, b in [(3.2, 2, 27), (0.5, 4, 10), (12, 1, 100)]],
  "pchisq": [stats.chi2.sf(v, k) for v, k in [(3.84, 1), (10, 4), (40, 20)]],
  "qnorm": [stats.norm.ppf(p) for p in [0.001, 0.3, 0.975]],
  "ptukey": [stats.studentized_range.cdf(q, k, df) for q, k, df in [(3.5, 3, 20), (4.2, 5, 12), (2.0, 2, 5), (3.0, 4, 200)]],
  "sw_x": list(stats.shapiro(x)), "sw_small": list(stats.shapiro(small)), "sw_xi": list(stats.shapiro(xi)),
  "sw_5": list(stats.shapiro(small[:5])), "sw_4": list(stats.shapiro(small[:4])),
  "mw_xy": [float(stats.mannwhitneyu(x, y, method="exact").statistic), float(stats.mannwhitneyu(x, y, method="exact").pvalue)],
  "mw_ties": [float(stats.mannwhitneyu(xi[:15], yi[:15], method="asymptotic", use_continuity=True).statistic), float(stats.mannwhitneyu(xi[:15], yi[:15], method="asymptotic", use_continuity=True).pvalue)],
  "sr_d": [float(stats.wilcoxon(d, method="exact").statistic), float(stats.wilcoxon(d, method="exact").pvalue)],
  "kendall_xy": list(map(float, stats.kendalltau(x[:17], y, method="exact"))),
  "kendall_ties": list(map(float, stats.kendalltau(xi, yi, method="asymptotic"))),
  "spearman": list(map(float, stats.spearmanr(xi, yi))),
  "fisher": float(stats.fisher_exact([[8, 2], [1, 5]]).pvalue),
  "binom": [float(stats.binomtest(7, 20, 0.5).pvalue)] + list(stats.binomtest(7, 20, 0.5).proportion_ci(0.95, method="exact")),
  "levene": list(map(float, stats.levene(x, y, center="mean"))),
}
json.dump(out, open(sys.argv[1], "w"), indent=1)
