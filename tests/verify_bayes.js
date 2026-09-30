// ref_bayes.py の参照値と stats.js のベイズファクターを突き合わせる
const S = require('../js/stats.js');
const R = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
let fail = 0;
function chk(name, got, exp, tol = 1e-4) {
  const ok = Math.abs(got - exp) <= tol * Math.max(1e-300, Math.abs(exp));
  if (!ok) fail++;
  console.log(`${ok ? 'OK ' : 'NG '} ${name}: ${got.toPrecision(8)} / ${exp.toPrecision(8)}`);
}
for (const [t, N, nu, bf] of R.t_two) chk(`t 両側 t=${t} N=${N}`, S.bfT(t, N, nu), bf);
for (const [t, N, nu, bf] of R.t_two_r1) chk(`t 両側 r=1`, S.bfT(t, N, nu, 1), bf);
for (const [t, N, nu, a, bf] of R.t_one) chk(`t ${a} t=${t}`, S.bfT(t, N, nu, undefined, a), bf);
for (const [r, n, bf] of R.cor) chk(`相関 r=${r} n=${n}`, S.bfCor(r, n), bf);
for (const [r, n, bf] of R.cor_k05) chk(`相関 κ=0.5`, S.bfCor(r, n, 0.5), bf);
for (const [r, n, a, bf] of R.cor_one) chk(`相関 ${a}`, S.bfCor(r, n, 1, a), bf);
for (const [N, p, R2, bf] of R.reg) chk(`回帰 N=${N} p=${p} R²=${R2}`, S.bfRegR2(N, p, R2), bf);
const center = M => { const m = M[0].map((_, j) => S.mean(M.map(r => r[j]))); return M.map(r => r.map((v, j) => v - m[j])); };
const cy = y => { const m = S.mean(y); return y.map(v => v - m); };
chk('分散分析 1要因（不つり合い）log BF', S.logBfGLM(center(R.glm1.X), cy(R.glm1.y), [{ cols: [0, 1], r: 0.5 }]), R.glm1.logbf, 1e-3);
chk('分散分析 2要因 加法 log BF', S.logBfGLM(center(R.glm2.X), cy(R.glm2.y), [{ cols: [0], r: 0.5 }, { cols: [1, 2], r: 0.5 }]), R.glm2.logbf, 1e-3);
chk('分散分析 2要因＋交互作用（3次元）log BF', S.logBfGLM(center(R.glm3.X), cy(R.glm3.y), [{ cols: [0], r: 0.5 }, { cols: [1, 2], r: 0.5 }, { cols: [3, 4], r: 0.5 }]), R.glm3.logbf, 5e-3);
for (const [O, bf] of R.ct) chk(`分割表 ${JSON.stringify(O)}`, S.bfContingency(O), bf);
for (const [O, a, bf] of R.ct_a) chk(`分割表 a=${a} ${JSON.stringify(O)}`, S.bfContingency(O, a), bf);
for (const [x, n, p0, a, bf] of R.binom) chk(`二項 ${x}/${n} p0=${p0} ${a}`, S.bfBinom(x, n, p0, a), bf);

// 反復測定の閉じた式を、一般の行列版（被験者の指示変数＋条件の対比）と突き合わせる
{
  let seed = 3; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const nrm = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const n = 12, k = 3, Y = [];
  for (let i = 0; i < n; i++) { const s = nrm(); Y.push([0, 0.4, 0.7].map(m => s + m + 0.8 * nrm())); }
  const all = Y.flat(), gm = S.mean(all);
  const sst = S.sum(all.map(v => (v - gm) ** 2));
  const ssS = k * S.sum(Y.map(r => (S.mean(r) - gm) ** 2)), ssC = n * S.sum([0, 1, 2].map(j => (S.mean(Y.map(r => r[j])) - gm) ** 2));
  const closed = Math.log(S.bfRM(n, k, ssS, ssC, sst));
  const Q = [[1 / Math.SQRT2, 1 / Math.sqrt(6)], [-1 / Math.SQRT2, 1 / Math.sqrt(6)], [0, -2 / Math.sqrt(6)]];
  const X = [], y = [];
  Y.forEach((r, i) => r.forEach((v, j) => { X.push([...Array.from({ length: n }, (_, q) => (q === i ? 1 : 0)), ...Q[j]]); y.push(v); }));
  const Xc = center(X), yc = cy(y);
  const full = S.logBfGLM(Xc, yc, [{ cols: [...Array(n).keys()], r: 1 }, { cols: [n, n + 1], r: 0.5 }]);
  const nul = S.logBfGLM(Xc.map(r => r.slice(0, n)), yc, [{ cols: [...Array(n).keys()], r: 1 }]);
  chk('反復測定 閉じた式 = 行列版', closed, full - nul, 1e-3);
}
console.log(fail ? `\n${fail} 件不一致` : '\nすべて一致');
process.exit(fail ? 1 : 0);
