// すべての分析をサンプルデータで実行し、主要な数値を JSON で書き出す（verify_analyses.py が照合する）
const fs = require('fs');
const path = require('path');
globalThis.Stats = require('../js/stats.js');
globalThis.DataIO = require('../js/data.js');
globalThis.Plots = require('../js/plots.js');
require('../js/analyses.js');
const A = globalThis.Analyses, D = globalThis.DataIO;

const csv = fs.readFileSync(path.join(__dirname, '..', 'samples', 'sample.csv'), 'utf8').replace(/^﻿/, '');
const ds = D.parseText(csv, 'sample');
const run = (id, sel, opt) => {
  const def = A.find(a => a.id === id);
  const o = {};
  for (const op of def.options) if (op.key) o[op.key] = op.def;
  const s = {};
  for (const sl of def.slots) s[sl.key] = [];
  const blocks = def.run(ds, Object.assign(s, sel), Object.assign(o, opt));
  for (const b of blocks) if (b.type === 'error') throw new Error(`${id}: ${b.text}`);
  // SVG が壊れていないかも確かめる
  for (const b of blocks) if (b.type === 'plot' && !/^<svg[\s\S]*<\/svg>$/.test(b.svg)) throw new Error(`${id}: 図が空`);
  return Object.fromEntries(blocks.filter(b => b.type === 'table').map(b => [b.title, b.rows]));
};
const all = opts => Object.fromEntries(Object.entries(opts));
const out = {};
out.desc = run('descriptives', { vars: ['事前テスト', '3か月後'] }, all({ skew: true, kurt: true, sw: true, quartiles: true, hist: true, box: true }));
out.descSplit = run('descriptives', { vars: ['事後テスト', '学級'], split: ['性別'] }, { freq: true, bar: true, mode: true });
out.one = run('ttest-one', { vars: ['事後テスト'] }, { mu: 60, nonpar: true, diff: true, plot: true, normality: true, desc: true });
out.oneGreater = run('ttest-one', { vars: ['事後テスト'] }, { mu: 60, nonpar: true, diff: true, alt: 'greater' });
out.ind = run('ttest-ind', { vars: ['事後テスト'], group: ['指導法'] }, { welch: true, nonpar: true, levene: true, diff: true, plot: true });
out.indLess = run('ttest-ind', { vars: ['事後テスト'], group: ['指導法'] }, { welch: true, nonpar: true, alt: 'less', diff: true });
out.paired = run('ttest-paired', { pairs: [['事後テスト', '事前テスト']] }, { nonpar: true, diff: true, normality: true, plot: true });
out.anova1 = run('anova', { dv: ['事後テスト'], factors: ['学級'] }, { welch: true, kw: true, posthoc: true, phBonf: true, phHolm: true, levene: true, omega: true, peta: true, desc: true, plot: true });
out.anova2 = run('anova', { dv: ['事後テスト'], factors: ['指導法', '学級'] }, { posthoc: true, omega: true, peta: true, plot: true });
out.rm = run('rmanova', { vars: ['事前テスト', '事後テスト', '3か月後'] }, { mauchly: true, gg: true, hf: true, peta: true, friedman: true, posthoc: true, phBonf: true, plot: true, desc: true });
out.cor = run('correlation', { vars: ['事前テスト', '事後テスト', '学習時間'] }, { spearman: true, kendall: true, ci: true, n: true, layout: 'pairs', scatter: true });
run('correlation', { vars: ['事前テスト', '事後テスト', '学習時間'] }, { spearman: true, kendall: true, ci: true, n: true, flag: true });
out.reg = run('regression', { dv: ['事後テスト'], covs: ['事前テスト', '学習時間'], factors: ['指導法'] }, { vif: true, dw: true, desc: true, residPlot: true, qq: true });
out.ct = run('contingency', { rows: ['性別'], cols: ['合格'] }, { expected: true, rowPct: true, colPct: true, totPct: true, resid: true, yates: true, lr: true, fisher: true, cramer: true, or: true });
out.ct3 = run('contingency', { rows: ['学級'], cols: ['合格'] }, { cramer: true, lr: true });
out.binom = run('binomial', { vars: ['合格'] }, { p0: 0.6 });
out.rel = run('reliability', { items: ['満足度1', '満足度2', '満足度3', '満足度4'], reverse: ['満足度3'] }, { std: true, meanr: true, scaleStats: true });
fs.writeFileSync(process.argv[2], JSON.stringify(out, (k, v) => (typeof v === 'number' && !isFinite(v) ? String(v) : v), 1));
console.log('分析を実行しました:', Object.keys(out).length, '件');
