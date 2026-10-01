// 因子分析用のサンプルデータ（架空の質問紙）を作る。乱数の種を固定しているので毎回同じになる。
// 意欲・不安・自信の3因子 × 各4項目、5件法、300人。因子どうしは相関し、意欲4 は自信にも少し負荷する
// 使い方: node scripts/make_sample_fa.js   → samples/sample_fa.csv と samples/sample_fa.js を書き出す
const fs = require('fs');
const path = require('path');

let seed = 20261002;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const normal = () => { let u = 0; while (!u) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };

const names = ['意欲1', '意欲2', '意欲3', '意欲4', '不安1', '不安2', '不安3', '不安4', '自信1', '自信2', '自信3', '自信4'];
// 因子間の相関（意欲・不安・自信）。不安は意欲・自信と負の相関
const Phi = [[1, -0.25, 0.5], [-0.25, 1, -0.4], [0.5, -0.4, 1]];
// 因子負荷量（行 = 項目, 列 = 因子）
const Lam = [
  [0.80, 0, 0], [0.75, 0, 0], [0.70, 0, 0], [0.60, 0, 0.25],
  [0, 0.85, 0], [0, 0.80, 0], [0, 0.70, 0], [0, 0.65, 0],
  [0, 0, 0.75], [0, 0, 0.70], [0, 0, 0.80], [0, 0, 0.65],
];
// Phi のコレスキー分解
const Lc = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
for (let i = 0; i < 3; i++) for (let j = 0; j <= i; j++) {
  let s = Phi[i][j]; for (let k = 0; k < j; k++) s -= Lc[i][k] * Lc[j][k];
  Lc[i][j] = i === j ? Math.sqrt(s) : s / Lc[j][j];
}
// 各項目の潜在変数の分散が 1 になるよう、独自分散を決める
const uniq = Lam.map(l => {
  let v = 0; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) v += l[a] * Phi[a][b] * l[b];
  return Math.sqrt(1 - v);
});
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const rows = [['番号', ...names].join(',')];
const N = 300;
for (let i = 1; i <= N; i++) {
  const z = [normal(), normal(), normal()];
  const f = [0, 1, 2].map(a => { let s = 0; for (let k = 0; k <= a; k++) s += Lc[a][k] * z[k]; return s; });
  const cells = Lam.map((l, j) => {
    const lat = l[0] * f[0] + l[1] * f[1] + l[2] * f[2] + uniq[j] * normal();
    return String(clamp(Math.round(3 + 0.95 * lat), 1, 5));
  });
  // 欠損値を少し入れる（リストワイズで除かれる）
  if (i === 41) cells[2] = 'NA';
  if (i === 133) cells[9] = 'NA';
  if (i === 250) cells[5] = 'NA';
  rows.push([i, ...cells].join(','));
}
const csv = rows.join('\n') + '\n';
const dir = path.join(__dirname, '..', 'samples');
fs.writeFileSync(path.join(dir, 'sample_fa.csv'), '﻿' + csv);
fs.writeFileSync(path.join(dir, 'sample_fa.js'), `// scripts/make_sample_fa.js で生成（架空のデータ）。file:// でも読めるように JS に埋め込んでいる\nwindow.SAMPLE_FA_CSV = ${JSON.stringify(csv)};\n`);
console.log(`${N} 行を書き出しました`);
