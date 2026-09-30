# run_analyses.js の結果を SciPy / statsmodels で独立に計算した値と照合する
# 使い方: python tests/verify_analyses.py <run_analyses.js の出力 JSON>
import json, sys, itertools
from pathlib import Path
import numpy as np, pandas as pd
from scipy import stats
import statsmodels.api as sm
import statsmodels.formula.api as smf
from statsmodels.stats.anova import anova_lm, AnovaRM
from statsmodels.stats.multicomp import pairwise_tukeyhsd
from statsmodels.stats.oneway import anova_oneway
from statsmodels.stats.outliers_influence import variance_inflation_factor

J = json.load(open(sys.argv[1], encoding="utf-8"))
df = pd.read_csv(Path(__file__).parent.parent / "samples" / "sample.csv", encoding="utf-8-sig", na_values=["NA", ""])
fails = 0
def chk(name, got, exp, tol=1e-6):
    global fails
    got = float(got); exp = float(exp)
    ok = abs(got - exp) <= tol * max(1, abs(exp))
    if not ok: fails += 1
    print(("OK " if ok else "NG ") + f"{name}: {got:.10g} / {exp:.10g}")
def row(tbl, **kw):
    return next(r for r in tbl if all(r.get(k) == v for k, v in kw.items()))

# 記述統計
t = J["desc"]["記述統計"]
for v in ["事前テスト", "3か月後"]:
    x = df[v].dropna(); r = row(t, var=v)
    chk(f"{v} mean", r["mean"], x.mean()); chk(f"{v} sd", r["sd"], x.std())
    chk(f"{v} skew", r["skew"], stats.skew(x, bias=False)); chk(f"{v} kurt", r["kurt"], stats.kurtosis(x, bias=False))
    chk(f"{v} q1", r["q1"], np.percentile(x, 25)); chk(f"{v} SW p", r["swp"], stats.shapiro(x).pvalue, 1e-4)
    lo, hi = stats.t.interval(0.95, len(x) - 1, x.mean(), stats.sem(x)); chk(f"{v} CI lo", r["lo"], lo)
    chk(f"{v} missing", r["miss"], df[v].isna().sum())

# 1サンプル
x = df["事後テスト"]
r = row(J["one"]["1サンプルの t 検定"], test="Student"); res = stats.ttest_1samp(x, 60)
chk("one t", r["stat"], res.statistic); chk("one p", r["p"], res.pvalue); chk("one CI lo (差)", r["lo"], res.confidence_interval().low - 60)
r = row(J["one"]["1サンプルの t 検定"], test="Wilcoxon"); w = stats.wilcoxon(x - 60, correction=True, method="approx")
chk("one wilcoxon p", r["p"], w.pvalue)
r = row(J["oneGreater"]["1サンプルの t 検定"], test="Student"); res = stats.ttest_1samp(x, 60, alternative="greater")
chk("one greater p", r["p"], res.pvalue); chk("one greater CI lo (差)", r["lo"], res.confidence_interval().low - 60)
r = row(J["oneGreater"]["1サンプルの t 検定"], test="Wilcoxon")
chk("one greater wilcoxon p", r["p"], stats.wilcoxon(x - 60, correction=True, method="approx", alternative="greater").pvalue)

# 独立 2 群（群1 = 協同学習）
a = df.loc[df["指導法"] == "協同学習", "事後テスト"]; b = df.loc[df["指導法"] == "従来型", "事後テスト"]
t = J["ind"]["独立したサンプルの t 検定"]
chk("ind student t", row(t, test="Student")["stat"], stats.ttest_ind(a, b).statistic)
chk("ind student p", row(t, test="Student")["p"], stats.ttest_ind(a, b).pvalue)
chk("ind student CI hi", row(t, test="Student")["hi"], stats.ttest_ind(a, b).confidence_interval().high)
chk("ind welch p", row(t, test="Welch")["p"], stats.ttest_ind(a, b, equal_var=False).pvalue)
chk("ind welch df", row(t, test="Welch")["df"], stats.ttest_ind(a, b, equal_var=False).df)
chk("ind MW U", row(t, test="Mann-Whitney")["stat"], stats.mannwhitneyu(a, b).statistic)
chk("ind MW p", row(t, test="Mann-Whitney")["p"], stats.mannwhitneyu(a, b, method="asymptotic").pvalue)
chk("ind levene p", J["ind"]["等分散性の検定（Levene）"][0]["p"], stats.levene(a, b, center="mean").pvalue)
t = J["indLess"]["独立したサンプルの t 検定"]
chk("ind less p", row(t, test="Student")["p"], stats.ttest_ind(a, b, alternative="less").pvalue)
chk("ind less welch p", row(t, test="Welch")["p"], stats.ttest_ind(a, b, equal_var=False, alternative="less").pvalue)
chk("ind less MW p", row(t, test="Mann-Whitney")["p"], stats.mannwhitneyu(a, b, alternative="less", method="asymptotic").pvalue)

# 対応あり
t = J["paired"]["対応のあるサンプルの t 検定"]
chk("paired t", row(t, test="Student")["stat"], stats.ttest_rel(df["事後テスト"], df["事前テスト"]).statistic)
chk("paired p", row(t, test="Student")["p"], stats.ttest_rel(df["事後テスト"], df["事前テスト"]).pvalue)
d = df["事後テスト"] - df["事前テスト"]
chk("paired wilcoxon p", row(t, test="Wilcoxon")["p"], stats.wilcoxon(d, correction=True, method="approx").pvalue)

# 1 要因分散分析
m = smf.ols("事後テスト ~ C(学級)", df).fit(); aov = anova_lm(m, typ=2)
t = J["anova1"]["分散分析 — 事後テスト"]
chk("anova1 F", t[0]["F"], aov["F"].iloc[0]); chk("anova1 p", t[0]["p"], aov["PR(>F)"].iloc[0])
w = anova_oneway(df["事後テスト"], df["学級"], use_var="unequal")
chk("welch anova F", J["anova1"]["Welch の分散分析"][0]["F"], w.statistic); chk("welch anova p", J["anova1"]["Welch の分散分析"][0]["p"], w.pvalue)
chk("KW H", J["anova1"]["Kruskal-Wallis 検定"][0]["H"], stats.kruskal(*[g["事後テスト"] for _, g in df.groupby("学級")]).statistic)
tk = pairwise_tukeyhsd(df["事後テスト"], df["学級"])
ph = J["anova1"]["事後検定 — 学級"]
for (g1, g2, p) in zip(tk.groupsunique[tk._multicomp.pairindices[0]], tk.groupsunique[tk._multicomp.pairindices[1]], tk.pvalues):
    chk(f"tukey {g1}-{g2}", row(ph, a=g1, b=g2)["tukey"], p, 1e-4)
chk("levene cells", J["anova1"]["等分散性の検定（Levene）"][0]["p"], stats.levene(*[g["事後テスト"] for _, g in df.groupby("学級")], center="mean").pvalue)

# 2 要因分散分析（Type III, 効果コーディング）
m = smf.ols("事後テスト ~ C(指導法, Sum) * C(学級, Sum)", df).fit(); aov = anova_lm(m, typ=3)
t = J["anova2"]["分散分析 — 事後テスト"]
for i, name in enumerate(["C(指導法, Sum)", "C(学級, Sum)", "C(指導法, Sum):C(学級, Sum)"]):
    chk(f"anova2 SS {i}", t[i]["ss"], aov.loc[name, "sum_sq"]); chk(f"anova2 p {i}", t[i]["p"], aov.loc[name, "PR(>F)"])

# 反復測定
long = df[["番号", "事前テスト", "事後テスト", "3か月後"]].dropna().melt(id_vars="番号", var_name="時点", value_name="得点")
rm = AnovaRM(long, "得点", "番号", within=["時点"]).fit().anova_table
t = J["rm"]["被験者内効果"]
chk("rm F", t[0]["F"], rm["F Value"].iloc[0]); chk("rm p", t[0]["p"], rm["Pr > F"].iloc[0])
Y = df[["事前テスト", "事後テスト", "3か月後"]].dropna().to_numpy(); n, k = Y.shape
# GG の ε を中心化した共分散行列の固有値から独立に計算
S = np.cov(Y, rowvar=False); Cm = np.eye(k) - 1 / k; Sc = Cm @ S @ Cm; ev = np.linalg.eigvalsh(Sc)
gg = ev.sum() ** 2 / ((k - 1) * (ev ** 2).sum())
chk("rm GG eps", J["rm"]["球面性の検定"][0]["gg"], gg)
chk("friedman", J["rm"]["Friedman 検定"][0]["chi"], stats.friedmanchisquare(*Y.T).statistic)

# 相関
t = J["cor"]["相関"]
for v1, v2 in itertools.combinations(["事前テスト", "事後テスト", "学習時間"], 2):
    s = df[[v1, v2]].dropna(); r = row(t, a=v1, b=v2)
    pr = stats.pearsonr(s[v1], s[v2]); chk(f"r {v1}-{v2}", r["pearson"], pr.statistic); chk(f"r p {v1}-{v2}", r["pearsonP"], pr.pvalue)
    chk(f"r CI {v1}-{v2}", r["lo"], pr.confidence_interval().low)
    sp = stats.spearmanr(s[v1], s[v2]); chk(f"rho {v1}-{v2}", r["spearman"], sp.statistic); chk(f"rho p", r["spearmanP"], sp.pvalue)
    kt = stats.kendalltau(s[v1], s[v2]); chk(f"tau {v1}-{v2}", r["kendall"], kt.statistic); chk(f"tau p", r["kendallP"], kt.pvalue)

# 回帰（基準は最初の水準 = 協同学習）
s = df[["事後テスト", "事前テスト", "学習時間", "指導法"]].dropna()
m = smf.ols("事後テスト ~ 事前テスト + 学習時間 + C(指導法)", s).fit()
t = J["reg"]["係数"]
for i, (nm, key) in enumerate([("（切片）", "Intercept"), ("事前テスト", "事前テスト"), ("学習時間", "学習時間"), ("指導法 (従来型)", "C(指導法)[T.従来型]")]):
    r = row(t, name=nm); chk(f"reg B {nm}", r["b"], m.params[key]); chk(f"reg SE {nm}", r["se"], m.bse[key]); chk(f"reg p {nm}", r["p"], m.pvalues[key])
chk("reg R2", J["reg"]["モデルの要約 — 事後テスト"][0]["R2"], m.rsquared); chk("reg adjR2", J["reg"]["モデルの要約 — 事後テスト"][0]["adj"], m.rsquared_adj)
chk("reg F", J["reg"]["分散分析"][0]["F"], m.fvalue)
chk("reg DW", J["reg"]["モデルの要約 — 事後テスト"][0]["dw"], sm.stats.durbin_watson(m.resid))
X = m.model.exog
chk("reg VIF 事前", row(t, name="事前テスト")["vif"], variance_inflation_factor(X, m.model.exog_names.index("事前テスト")))

# 分割表
tab = pd.crosstab(df["性別"], df["合格"]).to_numpy()
t = J["ct"]["検定"]
chk("chi2", row(t, test="χ²")["v"], stats.chi2_contingency(tab, correction=False).statistic)
chk("chi2 p", row(t, test="χ²")["p"], stats.chi2_contingency(tab, correction=False).pvalue)
chk("yates p", row(t, test="χ²（連続性の補正）")["p"], stats.chi2_contingency(tab, correction=True).pvalue)
chk("G2", row(t, test="尤度比 G²")["v"], stats.chi2_contingency(tab, correction=False, lambda_="log-likelihood").statistic)
chk("fisher p", row(t, test="Fisher の正確検定")["p"], stats.fisher_exact(tab).pvalue)
chk("cramer V", row(J["ct"]["効果量"], m="Cramér の V")["v"], stats.contingency.association(tab, method="cramer"))
chk("odds ratio", row(J["ct"]["効果量"], m="オッズ比")["v"], stats.contingency.odds_ratio(tab, kind="sample").statistic)
tab3 = pd.crosstab(df["学級"], df["合格"]).to_numpy()
chk("chi2 3x2 p", row(J["ct3"]["検定"], test="χ²")["p"], stats.chi2_contingency(tab3, correction=False).pvalue)

# 二項検定
k_yes = int((df["合格"] == "はい").sum()); r = row(J["binom"]["二項検定"], lv="はい")
bt = stats.binomtest(k_yes, len(df), 0.6); chk("binom p", r["p"], bt.pvalue); chk("binom CI hi", r["hi"], bt.proportion_ci(0.95).high)

# 信頼性（逆転: 1〜5 → 6 − x）
it = df[["満足度1", "満足度2", "満足度3", "満足度4"]].dropna().copy()
lo, hi = it.to_numpy().min(), it.to_numpy().max(); it["満足度3"] = lo + hi - it["満足度3"]
kk = it.shape[1]; alpha = kk / (kk - 1) * (1 - it.var().sum() / it.sum(axis=1).var())
chk("alpha", J["rel"]["尺度の信頼性"][0]["a"], alpha)
rest = it.sum(axis=1) - it["満足度1"]; chk("item-rest r", J["rel"]["項目ごとの統計量"][0]["rir"], np.corrcoef(it["満足度1"], rest)[0, 1])

# ---------------------------------------------------------------- ベイズファクター
# 参照値は ref_bayes.py の関数（stats.js とは別の積分方法）で求める
sys.path.insert(0, str(Path(__file__).parent))
import ref_bayes as RB
def chkr(name, got, exp, tol=1e-4):  # 相対誤差で比べる
    global fails
    got = float(got); exp = float(exp)
    ok = abs(got - exp) <= tol * abs(exp)
    if not ok: fails += 1
    print(("OK " if ok else "NG ") + f"{name}: {got:.8g} / {exp:.8g}")

# t 検定（アプリの既定の幅は JASP の画面と同じ 0.707。√2/2 = 0.70711 ではない）
RT = 0.707
x = df["事後テスト"]; n = len(x); tt = stats.ttest_1samp(x, 60).statistic
chkr("BF 1サンプル", row(J["oneBF"]["1サンプルの t 検定"], test="Student")["bf"], RB.jzs_two(tt, n, n - 1, r=RT))
chkr("BF+0 1サンプル", row(J["oneBFg"]["1サンプルの t 検定"], test="Student")["bf"], RB.jzs_one(tt, n, n - 1, "greater", r=RT))
chkr("BF01 1サンプル", row(J["oneBF01"]["1サンプルの t 検定"], test="Student")["bf"], 1 / RB.jzs_two(tt, n, n - 1, r=RT))
a = df.loc[df["指導法"] == "協同学習", "事後テスト"]; b = df.loc[df["指導法"] == "従来型", "事後テスト"]
tt = stats.ttest_ind(a, b).statistic; Ne = len(a) * len(b) / (len(a) + len(b)); nu = len(a) + len(b) - 2
t = J["indBF"]["独立したサンプルの t 検定"]
chkr("BF 独立2群", row(t, test="Student")["bf"], RB.jzs_two(tt, Ne, nu, r=RT))
chk("BF は Welch・Mann-Whitney の行に出さない", sum("bf" in row(t, test=k) for k in ("Welch", "Mann-Whitney")), 0)
chkr("BF-0 独立2群 r=1", row(J["indBFl"]["独立したサンプルの t 検定"], test="Student")["bf"], RB.jzs_one(tt, Ne, nu, "less", r=1.0))
s = df[["3か月後", "事後テスト"]].dropna(); tt = stats.ttest_rel(s["3か月後"], s["事後テスト"]).statistic
chkr("log BF 対応あり", row(J["pairedBF"]["対応のあるサンプルの t 検定"], test="Student")["bf"], np.log(RB.jzs_two(tt, len(s), len(s) - 1, r=RT)), 1e-3)

# 分散分析（被験者間）
levA = sorted(df["学級"].unique()); ia = df["学級"].map(levA.index).to_numpy(); yv = df["事後テスト"].to_numpy(float)
l1 = RB.logbf_glm(RB.helmert(3)[ia], yv, [{"cols": [0, 1], "r": 0.5}])
chkr("BF 1要因（包含 = BF10）", J["anova1BF"]["分散分析 — 事後テスト"][0]["bf"], np.exp(l1))
levM = sorted(df["指導法"].unique()); im = df["指導法"].map(levM.index).to_numpy()
QA, QB = RB.helmert(2)[im], RB.helmert(3)[ia]
QAB = np.einsum("ni,nj->nij", QA, QB).reshape(len(yv), -1)
Xall = np.hstack([QA, QB, QAB])
lm = {"指導法": RB.logbf_glm(QA, yv, [{"cols": [0], "r": 0.5}]),
      "学級": RB.logbf_glm(QB, yv, [{"cols": [0, 1], "r": 0.5}]),
      "指導法 + 学級": RB.logbf_glm(np.hstack([QA, QB]), yv, [{"cols": [0], "r": 0.5}, {"cols": [1, 2], "r": 0.5}]),
      "指導法 + 学級 + 指導法 ✻ 学級": RB.logbf_glm(Xall, yv, [{"cols": [0], "r": 0.5}, {"cols": [1, 2], "r": 0.5}, {"cols": [3, 4], "r": 0.5}], qmc_m=17)}
mt = J["anova2BF"]["ベイズファクター（モデル比較）"]
for name, l in lm.items():
    chkr(f"BF モデル {name}", row(mt, model=name)["bf"], np.exp(l), 1e-4 if "✻" not in name else 5e-3)
L = np.array([0.0] + list(lm.values())); post = np.exp(L - L.max()); post /= post.sum()
chkr("P(M|データ) 最良モデル", max(r["post"] for r in mt), post.max(), 5e-3)
sets = [set(), {0}, {1}, {0, 1}, {0, 1, 2}]
main = J["anova2BF"]["分散分析 — 事後テスト"]
for j in range(3):
    inc = [p for p, st in zip(post, sets) if j in st]; exc = [p for p, st in zip(post, sets) if j not in st]
    chkr(f"BF包含 項{j}", main[j]["bf"], (sum(inc) / sum(exc)) / (len(inc) / len(exc)), 5e-3)

# 反復測定：被験者の指示変数（r = 1）＋条件の対比（r = 0.5）を一般の行列式で
for key, cols in (("rmBF", ["事前テスト", "事後テスト", "3か月後"]), ("rm2BF", ["満足度1", "満足度2", "満足度4"])):
    Y = df[cols].dropna().to_numpy(float); nn, kk = Y.shape
    subj = np.repeat(np.eye(nn), kk, axis=0); cond = np.tile(RB.helmert(kk), (nn, 1)); yy = Y.ravel()
    full = RB.logbf_glm(np.hstack([subj, cond]), yy, [{"cols": list(range(nn)), "r": 1.0}, {"cols": [nn, nn + 1], "r": 0.5}])
    null = RB.logbf_glm(subj, yy, [{"cols": list(range(nn)), "r": 1.0}])
    chkr(f"BF 反復測定 {cols[0]}…", J[key]["被験者内効果"][0]["bf"], np.exp(full - null), 1e-3)

# 相関
for v1, v2 in itertools.combinations(["事前テスト", "学習時間", "満足度1"], 2):
    s = df[[v1, v2]].dropna(); r = row(J["corBF"]["相関"], a=v1, b=v2)
    chkr(f"BF 相関 {v1}-{v2}", r["bfv"], RB.bf_cor(stats.pearsonr(s[v1], s[v2]).statistic, len(s)))

# 回帰（JZS, r = 0.354）
s = df[["事後テスト", "事前テスト", "学習時間", "学級"]].dropna(); N = len(s)
R2 = lambda f: smf.ols(f, s).fit().rsquared
full = RB.bf_reg(N, 4, R2("事後テスト ~ 事前テスト + 学習時間 + C(学級)"), r=0.354)
chkr("BF 回帰モデル", J["regBF"]["モデルの要約 — 事後テスト"][0]["bf"], full)
t = J["regBF"]["係数"]
chkr("BF 係数 事前テスト", row(t, name="事前テスト")["bf"], full / RB.bf_reg(N, 3, R2("事後テスト ~ 学習時間 + C(学級)"), r=0.354))
chkr("BF 係数 学習時間", row(t, name="学習時間")["bf"], full / RB.bf_reg(N, 3, R2("事後テスト ~ 事前テスト + C(学級)"), r=0.354))
chkr("BF 係数 学級（C組）", row(t, name="学級 (C組)")["bf"], full / RB.bf_reg(N, 2, R2("事後テスト ~ 事前テスト + 学習時間"), r=0.354))

# 分割表・二項
tab = pd.crosstab(df["性別"], df["合格"]).to_numpy()
chkr("BF 分割表 2×2（直接積分）", row(J["ctBF"]["検定"], test="ベイズファクター BF₁₀")["v"], RB.bf_ct22(tab.tolist()))
tab3 = pd.crosstab(df["学級"], df["合格"]).to_numpy()
chkr("BF 分割表 3×2 a=2", row(J["ct3BF"]["検定"], test="ベイズファクター BF₁₀")["v"], RB.bf_ct_dirichlet(tab3, 2.0))
kk = int((df["合格"] == "はい").sum()); nn = len(df)
chkr("BF 二項 はい", row(J["binomBF"]["二項検定"], lv="はい")["bf"], RB.bf_binom(kk, nn, 0.6))
chkr("BF 二項 いいえ", row(J["binomBF"]["二項検定"], lv="いいえ")["bf"], RB.bf_binom(nn - kk, nn, 0.6))
chkr("BF+0 二項 はい", row(J["binomBFg"]["二項検定"], lv="はい")["bf"], RB.bf_binom(kk, nn, 0.6, "greater"))

print(f"\n{fails} 件不一致" if fails else "\nすべて一致")
sys.exit(1 if fails else 0)
