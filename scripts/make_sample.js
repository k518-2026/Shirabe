// サンプルデータ（架空の授業データ）を作る。乱数の種を固定しているので毎回同じになる。
// 使い方: node scripts/make_sample.js   → samples/sample.csv と samples/sample.js を書き出す
const fs = require('fs');
const path = require('path');

let seed = 20260930;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const normal = () => { let u = 0; while (!u) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const likert = v => clamp(Math.round(v), 1, 5);

const rows = [['番号', '学級', '性別', '指導法', '事前テスト', '事後テスト', '3か月後', '学習時間', '満足度1', '満足度2', '満足度3', '満足度4', '合格']];
const classes = ['A組', 'B組', 'C組'];
for (let i = 1; i <= 90; i++) {
  const cls = classes[(i - 1) % 3];
  const sex = rand() < 0.5 ? '男' : '女';
  const method = i % 2 ? '従来型' : '協同学習';
  const ability = normal();
  const hours = Math.round(clamp(5 + 1.6 * ability + 2 * normal(), 0, 15) * 10) / 10;
  const pre = Math.round(clamp(55 + 10 * ability + 6 * normal(), 0, 100));
  const gain = (method === '協同学習' ? 9 : 4) + (cls === 'C組' ? 3 : 0) + 0.6 * hours + 5 * normal();
  const post = Math.round(clamp(pre + gain, 0, 100));
  const later = Math.round(clamp(post - 4 + 5 * normal(), 0, 100));
  const sat = 3 + (method === '協同学習' ? 0.4 : -0.2) + 0.8 * normal() + 0.2 * ability;
  const s1 = likert(sat + 0.55 * normal()), s2 = likert(sat + 0.55 * normal());
  const s3 = likert(6 - (sat + 0.6 * normal())); // 逆転項目
  const s4 = likert(sat + 0.7 * normal());
  const pass = post >= 65 ? 'はい' : 'いいえ';
  const row = [i, cls, sex, method, pre, post, later, hours, s1, s2, s3, s4, pass];
  // 欠損値を少し入れる
  if (i === 17) row[6] = 'NA';
  if (i === 52) row[7] = '';
  if (i === 71) row[10] = 'NA';
  rows.push(row);
}
const csv = rows.map(r => r.join(',')).join('\n') + '\n';
const dir = path.join(__dirname, '..', 'samples');
fs.writeFileSync(path.join(dir, 'sample.csv'), '﻿' + csv);
fs.writeFileSync(path.join(dir, 'sample.js'), `// scripts/make_sample.js で生成（架空のデータ）。file:// でも読めるように JS に埋め込んでいる\nwindow.SAMPLE_CSV = ${JSON.stringify(csv)};\n`);
console.log(`${rows.length - 1} 行を書き出しました`);
