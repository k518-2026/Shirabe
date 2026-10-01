# ベイズファクターの参照値を、stats.js とは別の数値積分で求める
# - t 検定（両側）: Rouder et al. (2009) の g による1次元積分（stats.js は δ と s の二重積分）
# - t 検定（片側）: scipy の非心 t 分布の密度を δ で積分
# - 相関: scipy の hyp2f1 で同じ尤度を quad 積分
# - 回帰: Liang et al. (2008) の式を g で quad 積分
# - 分散分析: 行列式・2次形式を numpy で直接計算し、g を quad / dblquad（3次元は準モンテカルロ）で積分
# - 分割表: 周辺の一様事前分布のもとでの周辺尤度を数値積分（2×2）、それ以外はディリクレ多項分布の式
# - 二項: 周辺尤度を quad 積分
# 使い方: python tests/ref_bayes.py b.json → node tests/verify_bayes.js b.json
import json, sys
import numpy as np
from scipy import stats, integrate, special
from scipy.stats import qmc

R_T = np.sqrt(2) / 2

def jzs_two(t, N, nu, r=R_T):
    f = lambda g: (1 + N * r**2 * g) ** -0.5 * (1 + t**2 / ((1 + N * r**2 * g) * nu)) ** (-(nu + 1) / 2) * (2 * np.pi) ** -0.5 * g ** -1.5 * np.exp(-1 / (2 * g))
    num = integrate.quad(f, 0, np.inf, limit=500)[0]
    return num / (1 + t**2 / nu) ** (-(nu + 1) / 2)

def jzs_one(t, N, nu, alt, r=R_T):
    pri = lambda d: 2 * stats.cauchy.pdf(d, scale=r)
    lo, hi = (0, np.inf) if alt == "greater" else (-np.inf, 0)
    num = integrate.quad(lambda d: pri(d) * stats.nct.pdf(t, nu, d * np.sqrt(N)), lo, hi, limit=500)[0]
    return num / stats.t.pdf(t, nu)

def bf_cor(r, n, kappa=1.0, alt="two"):
    a = 1 / kappa
    pri = lambda rho: ((1 + rho) / 2) ** (a - 1) * ((1 - rho) / 2) ** (a - 1) / (2 * special.beta(a, a))
    lik = lambda rho: (1 - rho**2) ** ((n - 1) / 2) * (1 - rho * r) ** (1.5 - n) * special.hyp2f1(0.5, 0.5, n - 0.5, (1 + rho * r) / 2)
    l0 = special.hyp2f1(0.5, 0.5, n - 0.5, 0.5)
    lo, hi, k = (-1, 1, 1) if alt == "two" else ((0, 1, 2) if alt == "greater" else (-1, 0, 2))
    return k * integrate.quad(lambda rho: pri(rho) * lik(rho), lo, hi, limit=500, points=[r] if lo < r < hi else None)[0] / l0

def bf_reg(N, p, R2, r=np.sqrt(2) / 4):
    if p == 0: return 1.0
    b = N * r**2 / 2
    f = lambda g: (1 + g) ** ((N - p - 1) / 2) * (1 + g * (1 - R2)) ** (-(N - 1) / 2) * stats.invgamma.pdf(g, 0.5, scale=b)
    return integrate.quad(f, 0, np.inf, limit=500)[0]

def helmert(k):
    Q = np.zeros((k, k - 1))
    for j in range(1, k):
        v = np.zeros(k); v[:j] = 1; v[j] = -j
        Q[:, j - 1] = v / np.linalg.norm(v)
    return Q

def logbf_glm(X, y, blocks, qmc_m=18):
    """切片だけのモデルに対する log BF。X は（未中心化でもよい）計画行列、blocks は [{cols, r}]"""
    X = np.asarray(X, float); y = np.asarray(y, float)
    X = X - X.mean(0); y = y - y.mean(); N = len(y)
    XtX, Xty, yty = X.T @ X, X.T @ y, y @ y
    def lbf(gs):
        Ginv = np.zeros(X.shape[1]); ldG = 0.0
        for g, bl in zip(gs, blocks): Ginv[bl["cols"]] = 1 / g; ldG += len(bl["cols"]) * np.log(g)
        V = XtX + np.diag(Ginv)
        _, ldV = np.linalg.slogdet(V)
        q = Xty @ np.linalg.solve(V, Xty)
        return -0.5 * (ldG + ldV) - (N - 1) / 2 * np.log(1 - q / yty)
    pri = lambda g, r: stats.invgamma.pdf(g, 0.5, scale=r**2 / 2)
    if len(blocks) == 1:
        f = lambda t: np.exp(lbf([np.exp(t)]) + t) * pri(np.exp(t), blocks[0]["r"])
        return float(np.log(integrate.quad(f, -25, 30, limit=500)[0]))
    if len(blocks) == 2:
        f = lambda t2, t1: np.exp(lbf([np.exp(t1), np.exp(t2)]) + t1 + t2) * pri(np.exp(t1), blocks[0]["r"]) * pri(np.exp(t2), blocks[1]["r"])
        return float(np.log(integrate.dblquad(f, -25, 22, -25, 22, epsabs=1e-14, epsrel=1e-7)[0]))
    # 3次元以上：事前分布から Sobol 点で g を引き、BF(g) を平均する（準モンテカルロ）
    u = qmc.Sobol(len(blocks), scramble=True, seed=11).random_base2(qmc_m)
    gs = np.column_stack([stats.invgamma.ppf(np.clip(u[:, j], 1e-12, 1 - 1e-12), 0.5, scale=bl["r"]**2 / 2) for j, bl in enumerate(blocks)])
    ls = np.array([lbf(g) for g in gs])
    return float(np.log(np.mean(np.exp(ls - ls.max()))) + ls.max())

def logbf_rm_model(X, y, subj, rS=1.0, blocks=(), epsrel=1e-6):
    """反復測定（被験者の変量効果＋固定効果）の、切片だけのモデルに対する log BF。
    被験者の列をシューア補行列で消去した式（numpy で別に実装）を、scipy の nquad で適応的に積分する"""
    y = np.asarray(y, float); y = y - y.mean(); N = len(y)
    subj = np.asarray(subj); n = subj.max() + 1; k = N // n
    X = np.zeros((N, 0)) if X is None or len(X) == 0 else np.asarray(X, float)
    X = X - X.mean(0)
    Sy = np.bincount(subj, weights=y, minlength=n)
    SX = np.vstack([np.bincount(subj, weights=X[:, j], minlength=n) for j in range(X.shape[1])]).T if X.shape[1] else np.zeros((n, 0))
    XtX, Xty, yty, aa = X.T @ X, X.T @ y, y @ y, Sy @ Sy
    SXSX, SXSy = SX.T @ SX, SX.T @ Sy
    bs = [rS**2 / 2] + [bl["r"] ** 2 / 2 for bl in blocks]
    lpri = lambda t, b: 0.5 * np.log(b / np.pi) - t / 2 - b * np.exp(-t)
    def logf(*tau):
        gs = np.exp(tau[0]); c = gs / (1 + k * gs)
        ld = (n - 1) * np.log1p(k * gs); quad = c * aa
        if X.shape[1]:
            Ginv = np.zeros(X.shape[1])
            for t, bl in zip(tau[1:], blocks): Ginv[bl["cols"]] = np.exp(-t); ld += t * len(bl["cols"])
            M = XtX - c * SXSX + np.diag(Ginv); w = Xty - c * SXSy
            ld += np.linalg.slogdet(M)[1]; quad += w @ np.linalg.solve(M, w)
        return sum(lpri(t, b) for t, b in zip(tau, bs)) - 0.5 * ld - (N - 1) / 2 * np.log(1 - quad / yty)
    # 最大点を探して、その値で割ってから積分する（桁あふれ防止）
    from scipy.optimize import minimize
    x0 = np.log(2 * np.array(bs))
    opt = minimize(lambda t: -logf(*t), x0, method="Nelder-Mead", options={"xatol": 1e-6, "fatol": 1e-9, "maxiter": 4000})
    fmax = -opt.fun
    rng_ = [[np.log(b) - 7, np.log(b) + 25] for b in bs]
    # 被積分関数が鋭い軸（被験者）は最大点のまわりに区切り点を置く
    opts = [{"limit": 200, "epsrel": epsrel, "points": [opt.x[j]]} for j in range(len(bs))]
    v = integrate.nquad(lambda *t: np.exp(logf(*t) - fmax), rng_, opts=opts)[0]
    return float(fmax + np.log(v))

def logbf_rm_model_gl(X, y, subj, rS=1.0, blocks=(), nodes=36, width=9.0):
    """logbf_rm_model と同じモデルを、最大点のまわりの Gauss-Legendre の直積で積分する（4次元でも速い）。
    各軸の範囲は最大点 ± width × 広がり（ヘッセ行列の対角から）を事前分布の範囲で切ったもの"""
    y = np.asarray(y, float); y = y - y.mean(); N = len(y)
    subj = np.asarray(subj); n = subj.max() + 1; k = N // n
    X = np.zeros((N, 0)) if X is None or len(X) == 0 else np.asarray(X, float)
    X = X - X.mean(0); p = X.shape[1]
    Sy = np.bincount(subj, weights=y, minlength=n)
    SX = np.vstack([np.bincount(subj, weights=X[:, j], minlength=n) for j in range(p)]).T if p else np.zeros((n, 0))
    XtX, Xty, yty, aa = X.T @ X, X.T @ y, y @ y, Sy @ Sy
    SXSX, SXSy = SX.T @ SX, SX.T @ Sy
    bs = np.array([rS**2 / 2] + [bl["r"] ** 2 / 2 for bl in blocks]); d = len(bs)
    colb = np.zeros(p, int)
    for j, bl in enumerate(blocks): colb[bl["cols"]] = j + 1
    def logf(T):  # T: (m, d)
        gs = np.exp(T[:, 0]); c = gs / (1 + k * gs)
        ld = (n - 1) * np.log1p(k * gs); quad = c * aa
        if p:
            Ginv = np.exp(-T[:, colb])                                  # (m, p)
            M = XtX[None] - c[:, None, None] * SXSX[None] + Ginv[:, :, None] * np.eye(p)[None]
            w = Xty[None] - c[:, None] * SXSy[None]
            ld = ld + np.linalg.slogdet(M)[1] + sum(T[:, j + 1] * len(bl["cols"]) for j, bl in enumerate(blocks))
            quad = quad + np.einsum("mi,mi->m", w, np.linalg.solve(M, w[..., None])[..., 0])
        lp = (0.5 * np.log(bs / np.pi) - T / 2 - bs * np.exp(-T)).sum(1)
        return lp - 0.5 * ld - (N - 1) / 2 * np.log(1 - quad / yty)
    from scipy.optimize import minimize
    opt = minimize(lambda t: -logf(t[None])[0], np.log(2 * bs), method="Nelder-Mead", options={"xatol": 1e-7, "fatol": 1e-10, "maxiter": 6000})
    x0, fmax = opt.x, -opt.fun
    lo_all, hi_all = np.log(bs) - 7, np.log(bs) + 25
    grids = []
    for j in range(d):
        e = np.zeros(d); e[j] = 0.02
        f2 = (logf((x0 + e)[None])[0] + logf((x0 - e)[None])[0] - 2 * fmax) / 0.02**2
        sd = 1 / np.sqrt(-f2) if f2 < 0 else 5.0
        # 広がりが大きい軸（事前分布の裾が効く）は事前分布の範囲全体、鋭い軸は最大点のまわりだけ
        # （36 点では範囲全体の軸が粗く 2e-4 ずれた。64 点で nquad と一致）
        if sd > 1: a, b, m = lo_all[j], hi_all[j], max(nodes, 64)
        else: a, b, m = max(lo_all[j], x0[j] - width * sd), min(hi_all[j], x0[j] + width * sd), nodes
        xs, ws = np.polynomial.legendre.leggauss(m)
        grids.append(((b - a) / 2 * xs + (a + b) / 2, (b - a) / 2 * ws))
    mesh = np.stack(np.meshgrid(*[g[0] for g in grids], indexing="ij"), -1).reshape(-1, d)
    W = np.prod(np.stack(np.meshgrid(*[g[1] for g in grids], indexing="ij"), -1).reshape(-1, d), axis=1)
    tot = 0.0
    for s in range(0, len(mesh), 200000):
        tot += np.sum(W[s:s + 200000] * np.exp(logf(mesh[s:s + 200000]) - fmax))
    return float(fmax + np.log(tot))

def bf_ct_dirichlet(O, a=1.0):
    """同時多項分布：ディリクレ多項分布の周辺尤度の比（Gunel & Dickey の ξ）"""
    O = np.asarray(O, float); I, J = O.shape
    lD = lambda v: special.gammaln(v).sum() - special.gammaln(v.sum())
    xr, xc = J * a - (J - 1), I * a - (I - 1)
    l0 = lD(O.sum(1) + xr) - lD(np.full(I, xr)) + lD(O.sum(0) + xc) - lD(np.full(J, xc))
    l1 = lD(O.ravel() + a) - lD(np.full(I * J, a))
    return float(np.exp(l1 - l0))

def bf_ct22(O):
    """2×2 を直接の数値積分で（H0 は行・列の比率にそれぞれ一様分布）"""
    O = np.array(O, float)
    L1 = np.exp(special.gammaln(4) + special.gammaln(O + 1).sum() - special.gammaln(O.sum() + 4))
    f0 = lambda q, p: (p * q) ** O[0, 0] * (p * (1 - q)) ** O[0, 1] * ((1 - p) * q) ** O[1, 0] * ((1 - p) * (1 - q)) ** O[1, 1]
    L0 = integrate.dblquad(f0, 0, 1, 0, 1, epsabs=1e-300, epsrel=1e-10)[0]
    return L1 / L0

def bf_binom(x, n, p0, alt="two"):
    lf = lambda p: np.exp(x * np.log(p) + (n - x) * np.log1p(-p) - (x * np.log(p0) + (n - x) * np.log1p(-p0)))
    if alt == "two": return integrate.quad(lf, 0, 1, points=[x / n])[0]
    if alt == "greater": return integrate.quad(lf, p0, 1)[0] / (1 - p0)
    return integrate.quad(lf, 0, p0)[0] / p0

if __name__ == "__main__":
    out = {}
    tcases = [(2.1, 20, 19), (0.4, 12, 11), (-1.3, 7.5, 28), (3.8, 45, 88), (1.0, 3, 2)]
    out["t_two"] = [[t, N, nu, jzs_two(t, N, nu)] for t, N, nu in tcases]
    out["t_two_r1"] = [[2.1, 20, 19, jzs_two(2.1, 20, 19, r=1.0)]]
    out["t_one"] = [[t, N, nu, a, jzs_one(t, N, nu, a)] for (t, N, nu) in tcases[:4] for a in ("greater", "less")]
    out["cor"] = [[r, n, bf_cor(r, n)] for r, n in [(0.35, 30), (-0.1, 50), (0.62, 15), (0.05, 200)]]
    out["cor_k05"] = [[0.35, 30, bf_cor(0.35, 30, kappa=0.5)]]
    out["cor_one"] = [[0.35, 30, a, bf_cor(0.35, 30, alt=a)] for a in ("greater", "less")]
    out["reg"] = [[N, p, R2, bf_reg(N, p, R2)] for N, p, R2 in [(90, 3, 0.88), (40, 2, 0.1), (25, 1, 0.02)]]
    rng = np.random.default_rng(7)
    lev = np.array([0] * 9 + [1] * 12 + [2] * 10)
    y1 = rng.normal(0, 1, len(lev)) + np.array([0, 0.5, 0.9])[lev]
    X1 = helmert(3)[lev]
    out["glm1"] = {"y": y1.tolist(), "X": X1.tolist(), "logbf": logbf_glm(X1, y1, [{"cols": [0, 1], "r": 0.5}])}
    a2 = np.repeat([0, 1], 12); b2 = np.tile(np.repeat([0, 1, 2], 4), 2)
    y2 = rng.normal(0, 1, 24) + 0.8 * a2 + np.array([0, 0.2, 0.6])[b2]
    X2 = np.hstack([helmert(2)[a2], helmert(3)[b2]])
    out["glm2"] = {"y": y2.tolist(), "X": X2.tolist(), "logbf": logbf_glm(X2, y2, [{"cols": [0], "r": 0.5}, {"cols": [1, 2], "r": 0.5}])}
    Xi = np.hstack([X2, np.einsum("ni,nj->nij", helmert(2)[a2], helmert(3)[b2]).reshape(24, -1)])
    out["glm3"] = {"y": y2.tolist(), "X": Xi.tolist(), "logbf": logbf_glm(Xi, y2, [{"cols": [0], "r": 0.5}, {"cols": [1, 2], "r": 0.5}, {"cols": [3, 4], "r": 0.5}], qmc_m=20)}
    out["ct"] = [[O, bf_ct22(O)] for O in ([[12, 5], [6, 14]], [[20, 21], [19, 22]], [[3, 9], [8, 2]])]
    out["ct_a"] = [[O, a, bf_ct_dirichlet(O, a)] for O, a in [([[12, 5, 3], [6, 14, 9]], 1.0), ([[12, 5], [6, 14]], 2.0)]]
    out["binom"] = [[x, n, p0, a, bf_binom(x, n, p0, a)] for (x, n, p0) in [(7, 20, 0.5), (49, 90, 0.6)] for a in ("two", "greater", "less")]
    json.dump(out, open(sys.argv[1], "w"), indent=1)
