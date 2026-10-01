# 因子分析（探索的・確認的）を、別の実装で計算した値と照合する。R（psych・lavaan）が使えない環境でできる最大限の確認。
#   EFA  抽出: 主因子法 = statsmodels の Factor, 最尤法 = scipy で独立に最適化（解析的な勾配）, 最小残差法 = scipy で独立に最適化
#        回転: statsmodels の勾配射影法（varimax・quartimax・oblimin）, プロマックスは R の手順を numpy で書き直したもの
#        平行分析: 同じ線形合同法の乱数列で numpy が固有値を求める
#   CFA  scipy の BFGS で最尤推定, 標準誤差は duplication 行列を使った期待情報行列, 適合度は ncx2 で RMSEA の信頼区間
# 使い方: python tests/verify_fa.py <run_analyses.js の出力 JSON>
import json, sys, math
from pathlib import Path
import numpy as np, pandas as pd
from scipy import optimize, stats
from statsmodels.multivariate.factor import Factor
from statsmodels.multivariate.factor_rotation import rotate_factors

J = json.load(open(sys.argv[1], encoding="utf-8"))
df_all = pd.read_csv(Path(__file__).parent.parent / "samples" / "sample_fa.csv", encoding="utf-8-sig", na_values=["NA"])
df = df_all.dropna()          # 12 項目すべてがそろった行（項目の一部だけを使う分析では、その項目だけで欠損を除く）
ITEMS = ["意欲1", "意欲2", "意欲3", "意欲4", "不安1", "不安2", "不安3", "不安4", "自信1", "自信2", "自信3", "自信4"]
X = df[ITEMS].to_numpy(float); n, p = X.shape
R = np.corrcoef(X, rowvar=False)
fails = 0; nok = 0
import time
_t0 = time.time()
def tick(label):
    global _t0
    now = time.time(); print(f'   [{now - _t0:6.1f} 秒] {label}', flush=True); _t0 = now

def chk(name, got, exp, tol=1e-6, verbose=True):
    global fails, nok
    if got is None or exp is None or (isinstance(got, float) and math.isnan(got)) != (isinstance(exp, float) and math.isnan(exp)):
        ok = got is None and exp is None
    else:
        ok = abs(float(got) - float(exp)) <= tol * max(1.0, abs(float(exp)))
    nok += ok; fails += (not ok)
    if verbose or not ok:
        print(("OK " if ok else "NG ") + f"{name}: {got if got is None else float(got):.9g} / {exp if exp is None else float(exp):.9g}")

def rows_of(tbl, key):
    return {r[key]: r for r in tbl}

# ================================================================ 抽出（相関行列 R, 因子数 m）
def orient_pa(L):
    w, V = np.linalg.eigh(L @ L.T); idx = np.argsort(w)[::-1][:L.shape[1]]
    return V[:, idx] * np.sqrt(np.maximum(w[idx], 0))

def ref_paf(R, m):
    fa = Factor(corr=R, n_factor=m, method="pa", nobs=n).fit(maxiter=50000, tol=1e-13)
    return orient_pa(np.asarray(fa.loadings))

def ml_lambda(psi, R, m):
    sq = np.sqrt(psi); Ms = R / np.outer(sq, sq); w, V = np.linalg.eigh(Ms); idx = np.argsort(w)[::-1]
    w, V = w[idx], V[:, idx]
    return sq[:, None] * V[:, :m] * np.sqrt(np.maximum(w[:m] - 1, 0))

def ref_ml(R, m):
    pp = len(R)
    def fg(psi):
        L = ml_lambda(psi, R, m); Sg = L @ L.T + np.diag(psi); Si = np.linalg.inv(Sg)
        F = np.linalg.slogdet(Sg)[1] - np.linalg.slogdet(R)[1] + np.trace(Si @ R) - pp
        G = Si @ (Sg - R) @ Si
        return F, np.diag(G)                         # 包絡線定理: ∂F/∂ψ_i = (Σ⁻¹(Σ − R)Σ⁻¹)_ii
    start = (1 - 0.5 * m / pp) / np.diag(np.linalg.inv(R))
    res = optimize.minimize(fg, start, jac=True, method="L-BFGS-B", bounds=[(0.005, 1)] * pp, options={"ftol": 1e-16, "gtol": 1e-11, "maxiter": 20000})
    L = ml_lambda(res.x, R, m)
    return L, res.x, res.fun

def ref_minres(R, m, seed=5):
    pp = len(R); rng = np.random.default_rng(seed)
    off = 1 - np.eye(pp)
    def fg(v):
        L = v.reshape(pp, m); E = (R - L @ L.T) * off
        return 0.5 * (E ** 2).sum(), (-2 * E @ L).ravel()
    best = None
    for _ in range(3):                                # 乱数の出発点から 3 回
        res = optimize.minimize(fg, rng.normal(0, 0.4, pp * m), jac=True, method="BFGS", options={"gtol": 1e-12, "maxiter": 20000})
        if best is None or res.fun < best.fun: best = res
    return orient_pa(best.x.reshape(pp, m))

# ================================================================ 回転
def kaiser(A):
    h = np.sqrt((A ** 2).sum(1)); return A / h[:, None], h

def rot_varimax(A):
    An, h = kaiser(A); L, T = rotate_factors(An, "varimax", tol=1e-9, max_tries=3000)
    return L * h[:, None], T

def rot_quartimax(A):
    L, T = rotate_factors(A, "quartimax", tol=1e-9, max_tries=3000); return L, T

def rot_oblimin(A):
    L, T = rotate_factors(A, "oblimin", 0, "oblique", tol=1e-9, max_tries=3000)
    return L, T.T @ T

def rot_promax(A, mp=4):                              # R の stats::promax と同じ手順
    V, T = rot_varimax(A)
    Q = V * np.abs(V) ** (mp - 1)
    U = np.linalg.solve(V.T @ V, V.T @ Q)
    d = np.diag(np.linalg.inv(U.T @ U)); U = U @ np.diag(np.sqrt(d))
    rot = T @ U; ui = np.linalg.inv(rot); C = ui @ ui.T
    return V @ U, C / np.sqrt(np.outer(np.diag(C), np.diag(C)))

def finalize(L, Phi=None):
    sign = np.where(L.sum(0) < 0, -1.0, 1.0); L = L * sign
    if Phi is not None: Phi = Phi * np.outer(sign, sign)
    ss = np.diag(Phi @ L.T @ L) if Phi is not None else (L ** 2).sum(0)
    o = np.argsort(-ss, kind="stable"); L = L[:, o]
    if Phi is not None: Phi = Phi[np.ix_(o, o)]
    ss = np.diag(Phi @ L.T @ L) if Phi is not None else (L ** 2).sum(0)
    return L, Phi, ss

def rotate(A, name):
    if name == "none": return A, None
    if name == "varimax": return rot_varimax(A)[0], None
    if name == "quartimax": return rot_quartimax(A)[0], None
    if name == "oblimin": return rot_oblimin(A)
    return rot_promax(A)

# ================================================================ EFA の照合
M = 3
unrot = {"paf": ref_paf(R, M)}
tick("主因子法")
unrot["minres"] = ref_minres(R, M)
tick("最小残差法")
Lml, psi_ml, Fml = ref_ml(R, M); unrot["ml"] = Lml
tick("最尤法")
print("--- 抽出（回転前の共通性。回転に依らない量で比べる）")
h_js = {}
for method in ("minres", "paf", "ml"):
    tbl = J["fa"][f"{method}-none"]["因子負荷量（3 因子）"]
    L_js = np.array([[r[f"f{k}"] for k in range(M)] for r in tbl])
    h_ref = (unrot[method] ** 2).sum(1)
    for i, it in enumerate(ITEMS):
        chk(f"{method} 共通性 {it}", (L_js[i] ** 2).sum(), h_ref[i], 2e-6, verbose=False)
    chk(f"{method} 共通性の最大差", np.abs((L_js ** 2).sum(1) - h_ref).max(), 0.0, 2e-6)
# 最尤法は statsmodels の Factor(ml) とも比べる（こちらは収束判定が緩い）
fa_ml = Factor(corr=R, n_factor=M, method="ml", nobs=n).fit()
chk("最尤法 共通性 statsmodels との最大差", np.abs((np.asarray(fa_ml.loadings) ** 2).sum(1) - (Lml ** 2).sum(1)).max(), 0.0, 2e-4)
# 主因子法と最小残差法は同じ解（理論どおり）
chk("主因子法 = 最小残差法（共通性の最大差）", np.abs((unrot["paf"] ** 2).sum(1) - (unrot["minres"] ** 2).sum(1)).max(), 0.0, 1e-6)

print("--- 回転（3 抽出法 × 5 回転）")
worst = 0
for method in ("minres", "paf", "ml"):
    for rot in ("oblimin", "promax", "varimax", "quartimax", "none"):
        tabs = J["fa"][f"{method}-{rot}"]
        A, Phi_r = rotate(unrot[method], rot)
        L, Phi, ss = finalize(A, Phi_r)
        L_js = np.array([[r[f"f{k}"] for k in range(M)] for r in tabs["因子負荷量（3 因子）"]])
        d = np.abs(L_js - L).max(); worst = max(worst, d)
        chk(f"{method}-{rot} 負荷量の最大差", d, 0.0, 3e-4)
        h2 = np.diag(L @ (Phi if Phi is not None else np.eye(M)) @ L.T)
        chk(f"{method}-{rot} 独自性の最大差", np.abs(np.array([r["u"] for r in tabs["因子負荷量（3 因子）"]]) - (1 - h2)).max(), 0.0, 3e-4)
        ch = tabs["因子の特性"]
        chk(f"{method}-{rot} SS 負荷量", max(abs(ch[k]["ss"] - ss[k]) for k in range(M)), 0.0, 3e-4)
        if Phi is not None:
            pj = tabs["因子間相関"]
            chk(f"{method}-{rot} 因子間相関の最大差", max(abs(pj[i][f"c{j}"] - Phi[i, j]) for i in range(M) for j in range(i + 1)), 0.0, 3e-4)
            St = L @ Phi
            sj = np.array([[r[f"f{k}"] for k in range(M)] for r in tabs["構造行列"]])
            chk(f"{method}-{rot} 構造行列の最大差", np.abs(sj - St).max(), 0.0, 3e-4)
        else:
            chk(f"{method}-{rot} 斜交でないので因子間相関の表は無い", int("因子間相関" in tabs), 0)
        # 残差相関（対角を 1 にそろえて比べる）
        Rhat = L @ (Phi if Phi is not None else np.eye(M)) @ L.T; np.fill_diagonal(Rhat, 1)
        res = tabs["残差相関（観測の相関 − モデルから再現した相関）"]
        chk(f"{method}-{rot} 残差相関の最大差", max(abs(res[i][f"c{j}"] - (R[i, j] - Rhat[i, j])) for i in range(p) for j in range(i)), 0.0, 3e-4)
print(f"   （負荷量の最大差 {worst:.2e}）")

# ---- 固有値・平行分析（同じ線形合同法の乱数）
def lcg_normal(seed):
    st = [seed]
    def u():
        st[0] = (st[0] * 1664525 + 1013904223) % 2 ** 32; return st[0] / 4294967296
    def nrm():
        a = u(); b = u(); return math.sqrt(-2 * math.log(a + 1e-12)) * math.cos(2 * math.pi * b)
    return nrm
def smc(Rm):
    d = np.diag(np.linalg.inv(Rm)); return np.clip(1 - 1 / d, 0.005, 0.995)
def parallel(nn, pp, kind, nsim=500, seed=20261002):
    nrm = lcg_normal(seed); eigs = []
    for _ in range(nsim):
        Z = np.array([[nrm() for _ in range(nn)] for _ in range(pp)]).T
        Rm = np.corrcoef(Z, rowvar=False)
        if kind == "fa": np.fill_diagonal(Rm, smc(Rm))
        eigs.append(np.sort(np.linalg.eigvalsh(Rm))[::-1])
    E = np.array(eigs); return E.mean(0), np.percentile(E, 95, axis=0)
tick("回転")
print("--- 固有値と平行分析")
ev = np.sort(np.linalg.eigvalsh(R))[::-1]
pa_pc = parallel(n, p, "pc"); tick("平行分析 pc"); pa_fa = parallel(n, p, "fa"); tick("平行分析 fa")
for key, pa, kind in (("faPA", pa_pc, "pc"), ("faPAfa", pa_fa, "fa")):
    t = [t for k, t in J[key].items() if k.startswith("固有値")][0]
    chk(f"固有値 ({kind})", max(abs(t[k]["v"] - ev[k]) for k in range(p)), 0.0, 1e-9)
    chk(f"平行分析 乱数の平均 ({kind})", max(abs(t[k]["pm"] - pa[0][k]) for k in range(p)), 0.0, 1e-9)
    chk(f"平行分析 乱数の 95% ({kind})", max(abs(t[k]["p95"] - pa[1][k]) for k in range(p)), 0.0, 1e-9)
    Rr = R.copy(); np.fill_diagonal(Rr, smc(R)) if kind == "fa" else None
    obs = np.sort(np.linalg.eigvalsh(Rr))[::-1]
    chk(f"平行分析 観測の固有値 ({kind})", max(abs(t[k]["o2"] - obs[k]) for k in range(p)), 0.0, 1e-9)
    m_ref = int(np.argmax(~(obs > pa[0]))) if (~(obs > pa[0])).any() else p
    lt = [t_ for k, t_ in J[key].items() if k.startswith("因子負荷量")][0]
    chk(f"平行分析で選ばれた因子数 ({kind})", len([c for c in lt[0] if c.startswith("f")]), m_ref, 0)
t = [t for k, t in J["faKaiser"].items() if k.startswith("因子負荷量")][0]
chk("固有値 > 1 の因子数", len([c for c in t[0] if c.startswith("f")]), int((ev > 1).sum()), 0)

# ---- KMO と Bartlett
print("--- KMO と Bartlett")
Ri = np.linalg.inv(R); Q = -Ri / np.sqrt(np.outer(np.diag(Ri), np.diag(Ri)))
r2 = R ** 2 - np.eye(p); q2 = Q ** 2 - np.diag(np.diag(Q ** 2))
kmo_all = r2.sum() / (r2.sum() + q2.sum()); kmo_i = r2.sum(1) / (r2.sum(1) + q2.sum(1))
kt = rows_of(J["fa"]["ml-oblimin"]["KMO（標本妥当性）"], "item")
chk("KMO 全体", kt["全体"]["v"], kmo_all, 1e-9)
chk("KMO 項目ごとの最大差", max(abs(kt[it]["v"] - kmo_i[i]) for i, it in enumerate(ITEMS)), 0.0, 1e-9)
chi = -(n - 1 - (2 * p + 5) / 6) * np.log(np.linalg.det(R)); dfb = p * (p - 1) / 2
bt = J["fa"]["ml-oblimin"]["Bartlett の球面性検定"][0]
chk("Bartlett χ²", bt["chi"], chi, 1e-9); chk("Bartlett p", bt["p"], stats.chi2.sf(chi, dfb), 1e-6)

# ---- 最尤法の適合度
print("--- 最尤法の適合度")
def ncp_ci(T, df, level=0.9):
    a = (1 - level) / 2
    lo = 0.0 if stats.ncx2.cdf(T, df, 0) < 1 - a else optimize.brentq(lambda l: stats.ncx2.cdf(T, df, l) - (1 - a), 0, max(T, 1) * 2)
    hi = 0.0 if stats.ncx2.cdf(T, df, 0) < a else optimize.brentq(lambda l: stats.ncx2.cdf(T, df, l) - a, 0, max(T, df) * 20)
    return lo, hi
for key, m_ in (("ml-oblimin", 3), ("fa2", 2)):
    Lm, psim, Fm = ref_ml(R, m_) if m_ != 3 else (Lml, psi_ml, Fml)
    df_m = ((p - m_) ** 2 - (p + m_)) / 2
    chi_m = (n - 1 - (2 * p + 5) / 6 - 2 * m_ / 3) * Fm
    chi0 = -(n - 1 - (2 * p + 5) / 6) * np.log(np.linalg.det(R)); df0 = p * (p - 1) / 2
    t = [r for k, r in J["fa" if key == "ml-oblimin" else key].items() if False]
    tab = J["fa"]["ml-oblimin"]["モデルの適合度（最尤法）"][0] if key == "ml-oblimin" else J["fa2"]["モデルの適合度（最尤法）"][0]
    chk(f"EFA(m={m_}) χ²", tab["chi"], chi_m, 2e-6); chk(f"EFA(m={m_}) df", tab["df"], df_m, 0)
    chk(f"EFA(m={m_}) p", tab["p"], stats.chi2.sf(chi_m, df_m), 1e-5)
    chk(f"EFA(m={m_}) TLI", tab["tli"], (chi0 / df0 - chi_m / df_m) / (chi0 / df0 - 1), 2e-6)
    chk(f"EFA(m={m_}) RMSEA", tab["rmsea"], math.sqrt(max(chi_m - df_m, 0) / (df_m * (n - 1))), 2e-6)
    lo, hi = ncp_ci(chi_m, df_m)
    chk(f"EFA(m={m_}) RMSEA 下限", tab["lo"], math.sqrt(lo / (df_m * (n - 1))), 1e-5); chk(f"EFA(m={m_}) RMSEA 上限", tab["hi"], math.sqrt(hi / (df_m * (n - 1))), 1e-5)
    chk(f"EFA(m={m_}) BIC", tab["bic"], chi_m - df_m * math.log(n), 2e-6)
# 1 因子（4 項目, df = 2）
d4 = df_all.dropna(subset=ITEMS[:4]); X4 = d4[ITEMS[:4]].to_numpy(float); n4 = len(d4); R4 = np.corrcoef(X4, rowvar=False)
L1, psi1, F1 = ref_ml(R4, 1)
tab = J["fa1"]["モデルの適合度（最尤法）"][0]
chk("EFA(1 因子, 4 項目) χ²", tab["chi"], (n4 - 1 - (2 * 4 + 5) / 6 - 2 / 3) * F1, 2e-6); chk("EFA(1 因子, 4 項目) df", tab["df"], 2, 0)
l1 = np.array([r["f0"] for r in [t_ for k, t_ in J["fa1"].items() if k.startswith("因子負荷量")][0]])
chk("EFA(1 因子) 負荷量の最大差", np.abs(l1 - L1[:, 0] * np.sign(L1[:, 0].sum())).max(), 0.0, 1e-5)

# ================================================================ CFA
def vech(A): return A[np.tril_indices(A.shape[0])]
def dup(pp):
    idx = list(zip(*np.tril_indices(pp))); D = np.zeros((pp * pp, len(idx)))
    for c, (i, j) in enumerate(idx): D[i * pp + j, c] = 1; D[j * pp + i, c] = 1
    return D

def cfa_ref(S, N, free, first, orth, scaling):
    pp, nf = free.shape
    plist = []
    for k in range(nf):
        for i in range(pp):
            if free[i, k] and not (scaling == "marker" and first[k] == i): plist.append(("lam", i, k))
    for k in range(nf):
        for l in range(k, nf):
            if (scaling == "marker") if k == l else (not orth): plist.append(("phi", k, l))
    for i in range(pp): plist.append(("psi", i, i))
    def mats(th):
        Lam = np.zeros((pp, nf)); Phi = np.eye(nf); Psi = np.zeros(pp)
        if scaling == "marker":
            for k in range(nf): Lam[first[k], k] = 1.0
        for v, (t, a, b) in zip(th, plist):
            if t == "lam": Lam[a, b] = v
            elif t == "phi": Phi[a, b] = Phi[b, a] = v
            else: Psi[a] = v
        return Lam, Phi, Psi
    def sigma(th):
        Lam, Phi, Psi = mats(th); return Lam @ Phi @ Lam.T + np.diag(Psi)
    logdetS = np.linalg.slogdet(S)[1]
    def F(th):
        Sg = sigma(th)
        try: np.linalg.cholesky(Sg)
        except np.linalg.LinAlgError: return 1e10
        return np.linalg.slogdet(Sg)[1] - logdetS + np.trace(np.linalg.solve(Sg, S)) - pp
    th0 = []
    for t, a, b in plist:
        if t == "lam": th0.append(1.0)
        elif t == "phi": th0.append(0.5 * np.mean(np.diag(S)) if (a == b) else 0.1)
        else: th0.append(0.5 * S[a, a])
    if scaling == "std":
        th0 = [0.7 * math.sqrt(S[a, a]) if t == "lam" else (0.3 if t == "phi" else 0.5 * S[a, a]) for t, a, b in plist]
    res = optimize.minimize(F, th0, method="BFGS", options={"gtol": 1e-10, "maxiter": 5000})
    res = optimize.minimize(F, res.x, method="BFGS", options={"gtol": 1e-11, "maxiter": 5000})   # 出発点を変えて磨く
    th = res.x
    # 向きをそろえる（最初の項目の負荷量が正）— 'std' のとき
    Lam, Phi, Psi = mats(th)
    Sg = sigma(th); Fmin = F(th)
    # 標準誤差: 期待情報行列 (N/2) J' D'(Σ⁻¹ ⊗ Σ⁻¹) D J
    q = len(th); Jm = np.zeros((pp * (pp + 1) // 2, q))
    for a in range(q):
        h = 1e-6 * max(1.0, abs(th[a])); tp_, tm_ = th.copy(), th.copy(); tp_[a] += h; tm_[a] -= h
        Jm[:, a] = (vech(sigma(tp_)) - vech(sigma(tm_))) / (2 * h)
    Si = np.linalg.inv(Sg); D = dup(pp)
    I = (N / 2) * Jm.T @ D.T @ np.kron(Si, Si) @ D @ Jm
    cov = np.linalg.inv(I)
    def stdv(t_):
        Lm, Pm, Qm = mats(t_); Sx = Lm @ Pm @ Lm.T + np.diag(Qm); out = []
        for i in range(pp):
            for k in range(nf):
                if free[i, k]: out.append(Lm[i, k] * math.sqrt(Pm[k, k]) / math.sqrt(Sx[i, i]))
        for k in range(nf):
            for l in range(k, nf): out.append(Pm[k, l] / math.sqrt(Pm[k, k] * Pm[l, l]))
        for i in range(pp): out.append(Qm[i] / Sx[i, i])
        return np.array(out)
    sv = stdv(th); Jsd = np.zeros((len(sv), q))
    for a in range(q):
        h = 1e-5 * max(1.0, abs(th[a])); tp_, tm_ = th.copy(), th.copy(); tp_[a] += h; tm_[a] -= h
        Jsd[:, a] = (stdv(tp_) - stdv(tm_)) / (2 * h)
    sse = np.sqrt(np.diag(Jsd @ cov @ Jsd.T))
    se = np.sqrt(np.diag(cov))
    # 適合度
    chisq = N * Fmin; df_ = pp * (pp + 1) // 2 - q
    F0 = -logdetS + np.log(np.diag(S)).sum(); chisqB = N * F0; dfB = pp * (pp - 1) // 2
    cfi = 1 - max(chisq - df_, 0) / max(chisq - df_, chisqB - dfB, 1e-300)
    tli = (chisqB / dfB - chisq / df_) / (chisqB / dfB - 1) if df_ > 0 else float("nan")
    rmsea = math.sqrt(max(chisq - df_, 0) / (N * df_)) if df_ > 0 else 0.0
    lo, hi = ncp_ci(chisq, df_) if df_ > 0 else (0, 0)
    sd = np.sqrt(np.diag(S)); sr = sum(((S[i, j] - Sg[i, j]) / (sd[i] * sd[j])) ** 2 for i in range(pp) for j in range(i, pp))
    srmr = math.sqrt(2 * sr / (pp * (pp + 1)))
    tick(f"cfa_ref 反復 {res.nit} 回")
    return dict(th=th, plist=plist, mats=mats(th), se=se, sv=sv, sse=sse, chisq=chisq, df=df_, chisqB=chisqB, dfB=dfB, cfi=cfi, tli=tli, rmsea=rmsea,
                rlo=math.sqrt(lo / (N * df_)) if df_ > 0 else 0, rhi=math.sqrt(hi / (N * df_)) if df_ > 0 else 0, srmr=srmr, Sg=Sg)

def check_cfa(label, key, groups, names_f, scaling, orth, ci_level=0.95, extra=None):
    names = list(dict.fromkeys(i for g in groups for i in g)); pp, nf = len(names), len(groups)
    free = np.array([[nm in g for g in groups] for nm in names]); first = [names.index(g[0]) for g in groups]
    sub = df_all.dropna(subset=names); Xc = sub[names].to_numpy(float); Nn = len(Xc); S = np.cov(Xc, rowvar=False, bias=True)
    ref = cfa_ref(S, Nn, free, first, orth, scaling)
    Lam, Phi, Psi = ref["mats"]
    # 符号の向きがそろわない場合に備え、第 1 因子の最初の項目が正になるよう反転して比べる
    for k in range(nf):
        if Lam[first[k], k] < 0 and scaling == "std":
            Lam[:, k] *= -1
            for l in range(nf):
                if l != k: Phi[k, l] *= -1; Phi[l, k] *= -1
    T = J[key]
    t = T["モデルの検定（χ²）"]
    chk(f"{label} χ²", t[1]["chi"], ref["chisq"], 2e-6); chk(f"{label} df", t[1]["df"], ref["df"], 0)
    chk(f"{label} χ²（ベースライン）", t[0]["chi"], ref["chisqB"], 1e-9); chk(f"{label} df（ベースライン）", t[0]["df"], ref["dfB"], 0)
    if ref["df"] > 0: chk(f"{label} p", t[1]["p"], stats.chi2.sf(ref["chisq"], ref["df"]), 1e-4)
    if "適合度指標" in T:
        f = T["適合度指標"][0]
        chk(f"{label} CFI", f["cfi"], ref["cfi"], 2e-6); chk(f"{label} TLI", f["tli"], ref["tli"], 2e-6) if ref["df"] > 0 else None
        chk(f"{label} RMSEA", f["rmsea"], ref["rmsea"], 2e-6); chk(f"{label} RMSEA 下限", f["lo"], ref["rlo"], 1e-5); chk(f"{label} RMSEA 上限", f["hi"], ref["rhi"], 1e-5)
        chk(f"{label} SRMR", f["srmr"], ref["srmr"], 2e-6)
    # 推定値・標準誤差・標準化（JS の表と一対一）
    zq = stats.norm.ppf(1 - (1 - ci_level) / 2)
    lam_rows = [r for r in T["因子負荷量"]]
    se_lam = np.full((pp, nf), np.nan); se_phi = np.full((nf, nf), np.nan); se_psi = np.full(pp, np.nan)
    for v, (tp, a, b) in zip(ref["se"], ref["plist"]):
        if tp == "lam": se_lam[a, b] = v
        elif tp == "phi": se_phi[a, b] = se_phi[b, a] = v
        else: se_psi[a] = v
    # 標準化解の配置
    c = 0; std_lam = np.full((pp, nf), np.nan); sse_lam = np.full((pp, nf), np.nan)
    for i in range(pp):
        for k in range(nf):
            if free[i, k]: std_lam[i, k] = ref["sv"][c]; sse_lam[i, k] = ref["sse"][c]; c += 1
    std_phi = np.eye(nf); c0 = c
    for k in range(nf):
        for l in range(k, nf): std_phi[k, l] = std_phi[l, k] = ref["sv"][c]; c += 1
    std_psi = ref["sv"][c:c + pp]
    # 符号反転（std のとき）に合わせて標準化解も反転
    for k in range(nf):
        if scaling == "std" and ref["mats"][0][first[k], k] < 0:
            std_lam[:, k] *= -1
    r_i = 0; worst_est = worst_se = worst_std = 0.0
    for k in range(nf):
        for i in range(pp):
            if not free[i, k]: continue
            jr = lam_rows[r_i]; r_i += 1
            assert jr["item"] == names[i], (jr["item"], names[i])
            worst_est = max(worst_est, abs(jr["est"] - Lam[i, k]) / max(1, abs(Lam[i, k])))
            if jr["se"] is not None: worst_se = max(worst_se, abs(jr["se"] - se_lam[i, k]) / max(1, se_lam[i, k]))
            else: assert np.isnan(se_lam[i, k])
            worst_std = max(worst_std, abs(jr["std"] - std_lam[i, k]))
            if jr["se"] is not None:
                chk(f"{label} z({jr['item']}←{k})", jr["z"], jr["est"] / jr["se"], 1e-9, verbose=False)
                chk(f"{label} CI 下限({jr['item']}←{k})", jr["lo"], jr["est"] - zq * jr["se"], 1e-9, verbose=False)
    chk(f"{label} 負荷量の推定値（最大の相対差）", worst_est, 0.0, 5e-5); chk(f"{label} 負荷量の標準誤差（最大の相対差）", worst_se, 0.0, 2e-4)
    chk(f"{label} 標準化負荷量（最大差）", worst_std, 0.0, 2e-5)
    # 因子の分散・共分散
    if "因子の分散・共分散" in T:
        w1 = w2 = w3 = 0.0
        for r in T["因子の分散・共分散"]:
            ka = [d for d in names_f if d == r["a"]][0]; k = names_f.index(ka)
            if r["b"] == "（分散）": l = k; stdv_ = 1.0
            else: l = names_f.index(r["b"]); stdv_ = std_phi[k, l]
            w1 = max(w1, abs(r["est"] - Phi[k, l]) / max(1, abs(Phi[k, l]))); w2 = max(w2, abs(r["se"] - se_phi[k, l]) / max(1, se_phi[k, l])); w3 = max(w3, abs(r["std"] - stdv_))
        chk(f"{label} 因子の分散・共分散（推定値）", w1, 0.0, 5e-5); chk(f"{label} 因子の分散・共分散（標準誤差）", w2, 0.0, 2e-4); chk(f"{label} 因子間相関（標準化）", w3, 0.0, 2e-5)
    else:
        chk(f"{label} 分散・共分散の表が無い（因子が 1 つで分散固定）", int(nf == 1 and scaling == "std"), 1, 0)
    pr = T["項目の独自分散（誤差分散）"]
    chk(f"{label} 独自分散（推定値）", max(abs(pr[i]["est"] - Psi[i]) / max(1, Psi[i]) for i in range(pp)), 0.0, 5e-5)
    chk(f"{label} 独自分散（標準誤差）", max(abs(pr[i]["se"] - se_psi[i]) / max(1, se_psi[i]) for i in range(pp)), 0.0, 2e-4)
    chk(f"{label} 独自分散（標準化）", max(abs(pr[i]["std"] - std_psi[i]) for i in range(pp)), 0.0, 2e-5)
    # 標準化した推定値の標準誤差（デルタ法）。JS 側は表「標準化した…」に出している
    if "標準化した因子負荷量" in T:
        sse_phi = np.zeros((nf, nf)); c = c0
        for k in range(nf):
            for l in range(k, nf): sse_phi[k, l] = sse_phi[l, k] = ref["sse"][c]; c += 1
        sse_psi = ref["sse"][c:c + pp]
        w1 = 0.0; r_i = 0
        for k in range(nf):
            for i in range(pp):
                if not free[i, k]: continue
                jr = T["標準化した因子負荷量"][r_i]; r_i += 1
                w1 = max(w1, abs(jr["se"] - sse_lam[i, k]) / max(1, sse_lam[i, k]), abs(jr["est"] - std_lam[i, k]))
                chk(f"{label} 標準化負荷量 z({jr['item']}←{k})", jr["z"], jr["est"] / jr["se"], 1e-9, verbose=False)
        chk(f"{label} 標準化負荷量の標準誤差（デルタ法, 最大差）", w1, 0.0, 5e-4)
        if "標準化した因子間相関" in T:
            w2 = 0.0
            for rr_ in T["標準化した因子間相関"]:
                k = names_f.index(rr_["a"]); l = names_f.index(rr_["b"])
                w2 = max(w2, abs(rr_["se"] - sse_phi[k, l]) / max(1, sse_phi[k, l]), abs(rr_["est"] - std_phi[k, l]))
            chk(f"{label} 標準化した因子間相関の標準誤差（デルタ法, 最大差）", w2, 0.0, 5e-4)
        chk(f"{label} 標準化した独自分散の標準誤差（デルタ法, 最大差）", max(abs(T["標準化した独自分散"][i]["se"] - sse_psi[i]) / max(1, sse_psi[i]) for i in range(pp)), 0.0, 5e-4)
    return dict(names=names, ref=ref, std_lam=std_lam, std_psi=std_psi, std_phi=std_phi, Sg=ref["Sg"], S=S, Lam=Lam, free=free)

names3 = ["意欲", "不安", "自信"]
g3 = [ITEMS[:4], ITEMS[4:8], ITEMS[8:]]
tick("EFA の残り")
print("--- CFA: 3 因子（マーカー変数法）")
mk = check_cfa("CFA マーカー", "cfaMarker", g3, names3, "marker", False)
print("--- CFA: 3 因子（因子分散 = 1）")
sd_ = check_cfa("CFA 分散1", "cfaStd", g3, names3, "std", False)
print("--- CFA: 3 因子（無相関）")
check_cfa("CFA 無相関", "cfaOrth", g3, ["因子1", "因子2", "因子3"], "marker", True)
print("--- CFA: 交差負荷（意欲4 が自信にも負荷, 信頼水準 90%）")
g3x = [ITEMS[:4], ITEMS[4:8], ITEMS[8:] + ["意欲4"]]
check_cfa("CFA 交差負荷", "cfaCross", g3x, ["因子1", "因子2", "因子3"], "marker", False, ci_level=0.90)
print("--- CFA: 1 因子（4 項目, 自由度 2）")
check_cfa("CFA 1因子", "cfa1", [ITEMS[:4]], ["因子1"], "marker", False)
print("--- CFA: 2 因子 × 3 項目（因子分散 = 1）")
check_cfa("CFA 2因子", "cfa2f", [ITEMS[:3], ITEMS[4:7]], ["因子1", "因子2"], "std", False)

# 標準化推定値の標準誤差（デルタ法）を、JS の表にある標準化値と z から直接は取れないので、
# マーカー変数法と因子分散 1 の 2 通りで標準化解が同じになること、信頼性・残差を確かめる
print("--- 標準化解は尺度の固定の仕方に依らない / 信頼性 / 残差")
chk("標準化負荷量: マーカー = 因子分散 1（最大差）", max(abs(a["std"] - b["std"]) for a, b in zip(J["cfaMarker"]["因子負荷量"], J["cfaStd"]["因子負荷量"])), 0.0, 1e-6)
chk("χ²: マーカー = 因子分散 1", J["cfaMarker"]["モデルの検定（χ²）"][1]["chi"], J["cfaStd"]["モデルの検定（χ²）"][1]["chi"], 1e-6)
rel = J["cfaMarker"]["因子ごとの信頼性"]
for k, g in enumerate(g3):
    idx = [mk["names"].index(i) for i in g]; ls = mk["std_lam"][idx, k]; th = mk["std_psi"][idx]
    chk(f"信頼性 ω ({names3[k]})", rel[k]["w"], ls.sum() ** 2 / (ls.sum() ** 2 + th.sum()), 1e-5)
    chk(f"AVE ({names3[k]})", rel[k]["ave"], (ls ** 2).mean(), 1e-5)
Sx = mk["S"]; Sg = mk["Sg"]; dS = np.sqrt(np.diag(Sx)); dG = np.sqrt(np.diag(Sg))
resid_ref = Sx / np.outer(dS, dS) - Sg / np.outer(dG, dG)
rr = J["cfaMarker"]["残差相関（観測の相関 − モデルから再現した相関）"]
chk("CFA 残差相関（最大差）", max(abs(rr[i][f"c{j}"] - resid_ref[i, j]) for i in range(p) for j in range(i)), 0.0, 2e-5)

print(f"\n{nok} 件一致, {fails} 件不一致" if fails else f"\nすべて一致（{nok} 件）")
sys.exit(1 if fails else 0)
