# ω 係数の参照値。stats.js（EM アルゴリズム）とは別に、1因子モデルの最尤推定を2通りで求める
# - sklearn の FactorAnalysis（SVD を使う反復法）
# - 最尤の不一致関数 F = log|Σ| + tr(SΣ⁻¹) を scipy の L-BFGS-B で直接最小化
# 使い方: python tests/ref_omega.py o.json → node tests/verify_omega.js o.json
import json, sys
from pathlib import Path
import numpy as np, pandas as pd
from scipy import optimize
from sklearn.decomposition import FactorAnalysis

def fa_direct(X):
    S = np.cov(X, rowvar=False, bias=True); p = S.shape[0]
    def F(th):
        lam, psi = th[:p], np.exp(th[p:])
        Sig = np.outer(lam, lam) + np.diag(psi)
        sign, ld = np.linalg.slogdet(Sig)
        return ld + np.trace(np.linalg.solve(Sig, S))
    ev, vec = np.linalg.eigh(S)
    lam0 = vec[:, -1] * np.sqrt(ev[-1]) * 0.9
    th0 = np.concatenate([lam0, np.log(np.maximum(np.diag(S) - lam0**2, 0.05 * np.diag(S)))])
    r = optimize.minimize(F, th0, method="L-BFGS-B", options={"maxiter": 20000, "ftol": 1e-15, "gtol": 1e-12})
    lam, psi = r.x[:p], np.exp(r.x[p:])
    return lam * np.sign(lam.sum()), psi

def omega_from(lam, psi):
    s = lam.sum(); return float(s * s / (s * s + psi.sum()))

def fa_sklearn(X):
    fa = FactorAnalysis(n_components=1, tol=1e-12, max_iter=100000).fit(X)
    lam = fa.components_[0]
    return lam * np.sign(lam.sum()), fa.noise_variance_

out = {"sets": []}
rng = np.random.default_rng(12)
datasets = []
# サンプルの満足度（満足度3 を逆転：1〜5 なので 6 − x）
df = pd.read_csv(Path(__file__).parent.parent / "samples" / "sample.csv", encoding="utf-8-sig", na_values=["NA", ""])
it = df[["満足度1", "満足度2", "満足度3", "満足度4"]].dropna().copy()
lo, hi = it.to_numpy().min(), it.to_numpy().max(); it["満足度3"] = lo + hi - it["満足度3"]
datasets.append(("サンプル満足度（逆転あり）", it.to_numpy(float)))
# 負荷の大きさがばらばらの6項目
f = rng.normal(size=200)
datasets.append(("6項目 負荷ばらばら", np.column_stack([l * f + rng.normal(scale=s, size=200) for l, s in [(0.9, 0.5), (0.7, 0.8), (0.5, 1.0), (0.8, 0.6), (0.3, 1.2), (0.6, 0.9)]])))
# 3項目・小標本
f = rng.normal(size=25)
datasets.append(("3項目 n=25", np.column_stack([l * f + rng.normal(size=25) for l in (1.0, 0.6, 0.8)])))
# ほぼ τ 等価（α と ω が近いはず）
f = rng.normal(size=150)
datasets.append(("τ等価に近い5項目", np.column_stack([0.7 * f + rng.normal(scale=0.7, size=150) for _ in range(5)])))
for name, X in datasets:
    lam_d, psi_d = fa_direct(X); lam_s, psi_s = fa_sklearn(X)
    drop = []
    for j in range(X.shape[1]):
        if X.shape[1] > 3:
            l2, p2 = fa_direct(np.delete(X, j, axis=1)); drop.append(omega_from(l2, p2))
        else: drop.append(None)
    out["sets"].append({"name": name, "X": X.tolist(), "omega_direct": omega_from(lam_d, psi_d), "omega_sklearn": omega_from(lam_s, psi_s),
                        "lambda": lam_d.tolist(), "psi": psi_d.tolist(), "omega_drop": drop})
json.dump(out, open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
