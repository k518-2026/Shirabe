// ref_core.py の出力と stats.js の結果を突き合わせる
const S = require('../js/stats.js');
const R = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
let fail = 0;
function chk(name, got, exp, tol = 1e-6) {
  const ok = Math.abs(got - exp) <= tol * Math.max(1, Math.abs(exp));
  if (!ok) fail++;
  console.log(`${ok ? 'OK ' : 'NG '} ${name}: ${got} / ${exp}`);
}
[[-2.5, 3], [1.7, 12.4], [0.3, 100], [-8, 5]].forEach(([v, df], i) => chk(`pt ${i}`, S.pt(v, df), R.pt[i]));
[[0.975, 3], [0.995, 12.4], [0.025, 100]].forEach(([p, df], i) => chk(`qt ${i}`, S.qt(p, df), R.qt[i]));
[[3.2, 2, 27], [0.5, 4, 10], [12, 1, 100]].forEach(([v, a, b], i) => chk(`pf ${i}`, S.pfUpper(v, a, b), R.pf[i]));
[[3.84, 1], [10, 4], [40, 20]].forEach(([v, k], i) => chk(`pchisq ${i}`, S.pchisqUpper(v, k), R.pchisq[i]));
[0.001, 0.3, 0.975].forEach((p, i) => chk(`qnorm ${i}`, S.qnorm(p), R.qnorm[i]));
[[3.5, 3, 20], [4.2, 5, 12], [2.0, 2, 5], [3.0, 4, 200]].forEach(([q, k, df], i) => chk(`ptukey ${i}`, S.ptukey(q, k, df), R.ptukey[i], 1e-5));
for (const [k, arr] of [['sw_x', R.x], ['sw_small', R.small], ['sw_xi', R.xi], ['sw_5', R.small.slice(0, 5)], ['sw_4', R.small.slice(0, 4)]]) {
  const r = S.shapiroWilk(arr); chk(`${k} W`, r.W, R[k][0], 1e-4); chk(`${k} p`, r.p, R[k][1], 1e-3);
}
let r = S.mannWhitney(R.x, R.y); chk('mw W', r.W, R.mw_xy[0]); chk('mw p', r.p, R.mw_xy[1]);
r = S.mannWhitney(R.xi.slice(0, 15), R.yi.slice(0, 15)); chk('mw ties W', r.W, R.mw_ties[0]); chk('mw ties p', r.p, R.mw_ties[1]);
r = S.signedRank(R.d); chk('signed rank p', r.p, R.sr_d[1]); console.log('   V =', r.V, 'scipy stat(min) =', R.sr_d[0]);
r = S.kendall(R.x.slice(0, 17), R.y); chk('kendall tau', r.tau, R.kendall_xy[0]); chk('kendall p', r.p, R.kendall_xy[1]);
r = S.kendall(R.xi, R.yi); chk('kendall ties tau', r.tau, R.kendall_ties[0]); chk('kendall ties p', r.p, R.kendall_ties[1]);
const rs = S.spearman(R.xi, R.yi); chk('spearman r', rs, R.spearman[0]); chk('spearman p', S.corTest(rs, 30).p, R.spearman[1]);
chk('fisher', S.fisher2x2(8, 2, 1, 5).p, R.fisher);
r = S.binomTest(7, 20, 0.5, 'two', 0.95); chk('binom p', r.p, R.binom[0]); chk('binom lo', r.lo, R.binom[1]); chk('binom hi', r.hi, R.binom[2]);
r = S.levene([R.x, R.y]); chk('levene F', r.F, R.levene[0]); chk('levene p', r.p, R.levene[1]);
console.log(fail ? `\n${fail} 件不一致` : '\nすべて一致');
process.exit(fail ? 1 : 0);
