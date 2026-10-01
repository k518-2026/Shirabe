// ref_omega.py の参照値と stats.js の ω（1因子モデルの最尤推定）を突き合わせる
const S = require('../js/stats.js');
const R = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
let fail = 0;
function chk(name, got, exp, tol = 1e-6) {
  const ok = Math.abs(got - exp) <= tol * Math.max(1, Math.abs(exp));
  if (!ok) fail++;
  console.log(`${ok ? 'OK ' : 'NG '} ${name}: ${got.toFixed(10)} / ${exp.toFixed(10)}`);
}
// 最尤推定の共分散行列（分母 n）。ω は分母によらないが、λ・Ψ の比較のため参照と同じにする
const covML = X => {
  const n = X.length, p = X[0].length, m = Array.from({ length: p }, (_, j) => S.mean(X.map(r => r[j])));
  return Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => S.sum(X.map(r => (r[a] - m[a]) * (r[b] - m[b]))) / n));
};
for (const set of R.sets) {
  const t0 = Date.now(), r = S.omega(covML(set.X)), ms = Date.now() - t0;
  chk(`${set.name} ω（直接最小化）`, r.omega, set.omega_direct);
  chk(`${set.name} ω（sklearn）`, r.omega, set.omega_sklearn, 1e-5);
  r.lambda.forEach((l, j) => chk(`  λ${j + 1}`, l, set.lambda[j], 1e-4));
  console.log(`   反復 ${r.iterations} 回, ${ms} ms${r.heywood ? '（Heywood）' : ''}`);
  set.omega_drop.forEach((w, j) => { if (w !== null) chk(`  項目${j + 1}を除いた ω`, S.omega(covML(set.X.map(row => row.filter((_, q) => q !== j)))).omega, w); });
}
console.log(fail ? `\n${fail} 件不一致` : '\nすべて一致');
process.exit(fail ? 1 : 0);
