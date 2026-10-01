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
out.one = run('ttest-one', { vars: ['事後テスト'] }, { mu: 60, nonpar: true, diff: true, plot: true, rain: true, normality: true, desc: true });
out.oneGreater = run('ttest-one', { vars: ['事後テスト'] }, { mu: 60, nonpar: true, diff: true, alt: 'greater' });
out.ind = run('ttest-ind', { vars: ['事後テスト'], group: ['指導法'] }, { welch: true, nonpar: true, levene: true, diff: true, plot: true, rain: true });
out.indLess = run('ttest-ind', { vars: ['事後テスト'], group: ['指導法'] }, { welch: true, nonpar: true, alt: 'less', diff: true });
out.paired = run('ttest-paired', { pairs: [['事後テスト', '事前テスト']] }, { nonpar: true, diff: true, normality: true, plot: true, rain: true });
out.anova1 = run('anova', { dv: ['事後テスト'], factors: ['学級'] }, { welch: true, kw: true, posthoc: true, phBonf: true, phHolm: true, levene: true, omega: true, peta: true, desc: true, plot: true, rain: true });
out.anova2 = run('anova', { dv: ['事後テスト'], factors: ['指導法', '学級'] }, { posthoc: true, omega: true, peta: true, plot: true, rain: true });
out.rm = run('rmanova', { vars: ['事前テスト', '事後テスト', '3か月後'] }, { mauchly: true, gg: true, hf: true, peta: true, friedman: true, posthoc: true, phBonf: true, plot: true, rain: true, desc: true });
out.cor = run('correlation', { vars: ['事前テスト', '事後テスト', '学習時間'] }, { spearman: true, kendall: true, ci: true, n: true, layout: 'pairs', scatter: true });
run('correlation', { vars: ['事前テスト', '事後テスト', '学習時間'] }, { spearman: true, kendall: true, ci: true, n: true, flag: true });
out.reg = run('regression', { dv: ['事後テスト'], covs: ['事前テスト', '学習時間'], factors: ['指導法'] }, { vif: true, dw: true, desc: true, residPlot: true, qq: true });
out.ct = run('contingency', { rows: ['性別'], cols: ['合格'] }, { expected: true, rowPct: true, colPct: true, totPct: true, resid: true, yates: true, lr: true, fisher: true, cramer: true, or: true });
out.ct3 = run('contingency', { rows: ['学級'], cols: ['合格'] }, { cramer: true, lr: true });
out.binom = run('binomial', { vars: ['合格'] }, { p0: 0.6 });
out.rel = run('reliability', { items: ['満足度1', '満足度2', '満足度3', '満足度4'], reverse: ['満足度3'] }, { std: true, meanr: true, scaleStats: true });
// ベイズファクター（既定は表示しないので、上の実行結果は従来どおり）
const timed = (label, f) => { const t0 = Date.now(); const r = f(); console.log(`  ${label}: ${Date.now() - t0} ms`); return r; };
out.oneBF = run('ttest-one', { vars: ['事後テスト'] }, { mu: 60, bf: true });
out.oneBFg = run('ttest-one', { vars: ['事後テスト'] }, { mu: 60, bf: true, alt: 'greater' });
out.oneBF01 = run('ttest-one', { vars: ['事後テスト'] }, { mu: 60, bf: true, bfType: 'bf01' });
out.indBF = run('ttest-ind', { vars: ['事後テスト'], group: ['指導法'] }, { welch: true, nonpar: true, bf: true });
out.indBFl = run('ttest-ind', { vars: ['事後テスト'], group: ['指導法'] }, { bf: true, alt: 'less', bfPrior: 1 });
out.pairedBF = run('ttest-paired', { pairs: [['3か月後', '事後テスト']] }, { bf: true, bfType: 'log' });
out.anova1BF = timed('分散分析 1要因', () => run('anova', { dv: ['事後テスト'], factors: ['学級'] }, { bf: true }));
out.anova2BF = timed('分散分析 2要因', () => run('anova', { dv: ['事後テスト'], factors: ['指導法', '学級'] }, { bf: true }));
out.rmBF = timed('反復測定', () => run('rmanova', { vars: ['事前テスト', '事後テスト', '3か月後'] }, { bf: true, gg: true }));
out.rm2BF = run('rmanova', { vars: ['満足度1', '満足度2', '満足度4'] }, { bf: true });
out.corBF = run('correlation', { vars: ['事前テスト', '学習時間', '満足度1'] }, { bf: true, layout: 'pairs' });
run('correlation', { vars: ['事前テスト', '学習時間', '満足度1'] }, { bf: true, flag: true });
out.regBF = run('regression', { dv: ['事後テスト'], covs: ['事前テスト', '学習時間'], factors: ['学級'] }, { bf: true });
out.ctBF = run('contingency', { rows: ['性別'], cols: ['合格'] }, { bf: true });
out.ct3BF = run('contingency', { rows: ['学級'], cols: ['合格'] }, { bf: true, bfPrior: 2 });
out.binomBF = run('binomial', { vars: ['合格'] }, { p0: 0.6, bf: true });
out.binomBFg = run('binomial', { vars: ['合格'] }, { p0: 0.6, bf: true, alt: 'greater' });
// ω 係数
out.relW = timed('信頼性 ω＋ブートストラップ', () => run('reliability', { items: ['満足度1', '満足度2', '満足度3', '満足度4'], reverse: ['満足度3'] }, { omega: true, loadings: true, omegaCI: true }));
out.relW3 = run('reliability', { items: ['満足度1', '満足度2', '満足度4'] }, { omega: true });
out.relW2 = run('reliability', { items: ['満足度1', '満足度2'] }, { omega: true, loadings: true });
// 反復測定の分散分析（2要因）
// 混合計画：サンプルの 指導法 × 時点（事前・事後・3か月後）
out.mixed = timed('混合計画', () => run('rmanova2', { cells: ['事前テスト', '事後テスト', '3か月後'], between: ['指導法'] },
  { w1name: '時点', mauchly: true, gg: true, hf: true, peta: true, desc: true, posthoc: true, phBonf: true, phTukey: true, plot: true, rain: true }));
out.mixedBF = timed('混合計画 BF', () => run('rmanova2', { cells: ['事前テスト', '事後テスト', '3か月後'], between: ['指導法'] }, { w1name: '時点', bf: true }));
out.mixed3 = run('rmanova2', { cells: ['事前テスト', '事後テスト', '3か月後'], between: ['学級'] }, { w1name: '時点', w1levels: '事前, 事後, 3か月後', gg: true, posthoc: true, phTukey: true });
// 被験者内×被験者内：tests/rm2_data.csv（2 × 3）
{
  const ds2 = D.parseText(fs.readFileSync(path.join(__dirname, 'rm2_data.csv'), 'utf8'), 'rm2');
  const run2 = (id, sel, opt) => {
    const def = A.find(a => a.id === id), o = {}, s = {};
    for (const op of def.options) if (op.key) o[op.key] = op.def;
    for (const sl of def.slots) s[sl.key] = [];
    const blocks = def.run(ds2, Object.assign(s, sel), Object.assign(o, opt));
    for (const b of blocks) if (b.type === 'error') throw new Error(`${id}: ${b.text}`);
    for (const b of blocks) if (b.type === 'plot' && !/^<svg[\s\S]*<\/svg>$/.test(b.svg)) throw new Error(`${id}: 図が空`);
    return Object.fromEntries(blocks.filter(b => b.type === 'table').map(b => [b.title, b.rows]));
  };
  const cells = ['A1B1', 'A1B2', 'A1B3', 'A2B1', 'A2B2', 'A2B3'];
  out.ww = timed('被験者内×被験者内', () => run2('rmanova2', { cells }, { w1name: 'A', w2name: 'B', w2levels: '3', mauchly: true, gg: true, hf: true, peta: true, desc: true, posthoc: true, phBonf: true, plot: true, rain: true }));
  out.wwBF = timed('被験者内×被験者内 BF', () => run2('rmanova2', { cells }, { w1name: 'A', w2name: 'B', w2levels: 'B1, B2, B3', bf: true }));
  // 1要因（混合でも被験者内×被験者内でもない）は案内だけを出し、エラーにしない
  const def = A.find(a => a.id === 'rmanova2'); const o = {}; for (const op of def.options) if (op.key) o[op.key] = op.def;
  const msg = def.run(ds2, { cells, between: [] }, o);
  if (!(msg.length === 1 && msg[0].type === 'note')) throw new Error('rmanova2: 1要因の案内が出ない');
  // 1要因の既存の分析と、要因2を「混合計画の群が1つもない形」にできないので、同じ F を別経路で比べる
  out.ww1 = run2('rmanova', { vars: ['A1B1', 'A1B2', 'A1B3'] }, { gg: true });
}
// 因子分析（samples/sample_fa.csv：意欲・不安・自信の3因子 × 4項目, 300 人）
{
  const dsFA = D.parseText(fs.readFileSync(path.join(__dirname, '..', 'samples', 'sample_fa.csv'), 'utf8').replace(/^﻿/, ''), 'fa');
  const runFA = (id, sel, opt) => {
    const def = A.find(a => a.id === id), o = {}, s = {};
    for (const op of def.options) if (op.key) o[op.key] = op.def;
    for (const sl of def.slots) s[sl.key] = [];
    const blocks = def.run(dsFA, Object.assign(s, sel), Object.assign(o, opt));
    for (const b of blocks) if (b.type === 'error') throw new Error(`${id}: ${b.text}`);
    for (const b of blocks) if (b.type === 'plot' && !/^<svg[\s\S]*<\/svg>$/.test(b.svg)) throw new Error(`${id}: 図が空`);
    return Object.fromEntries(blocks.filter(b => b.type === 'table').map(b => [b.title, b.rows]));
  };
  const items12 = ['意欲1', '意欲2', '意欲3', '意欲4', '不安1', '不安2', '不安3', '不安4', '自信1', '自信2', '自信3', '自信4'];
  const efaAll = { eigen: true, pa: true, scree: true, kmo: true, resid: true, struct: true, cut: 0 };
  // 因子数は平行分析（既定）。抽出法 3 × 回転 5 の組み合わせをすべて動かす
  out.fa = {};
  for (const method of ['minres', 'paf', 'ml']) for (const rotation of ['oblimin', 'promax', 'varimax', 'quartimax', 'none']) {
    out.fa[`${method}-${rotation}`] = runFA('efa', { items: items12 }, { ...efaAll, method, rotation, nfMethod: 'fixed', nf: 3 });
  }
  out.faPA = timed('EFA 平行分析（pc）', () => runFA('efa', { items: items12 }, { ...efaAll, nfMethod: 'parallel' }));
  out.faPAfa = runFA('efa', { items: items12 }, { ...efaAll, nfMethod: 'parallel', paBase: 'fa' });
  out.faKaiser = runFA('efa', { items: items12 }, { nfMethod: 'kaiser', rotation: 'varimax', sort: true });
  out.fa2 = runFA('efa', { items: items12 }, { nfMethod: 'fixed', nf: 2, method: 'ml', rotation: 'oblimin' });
  out.fa1 = runFA('efa', { items: items12.slice(0, 4) }, { nfMethod: 'fixed', nf: 1, method: 'ml' });
  // 確認的因子分析
  const f3 = { f1: items12.slice(0, 4), f2: items12.slice(4, 8), f3: items12.slice(8, 12) };
  const cfaAll = { reliab: true, resid: true, path: true, stdSE: true };
  out.cfaMarker = timed('CFA マーカー', () => runFA('cfa', f3, { ...cfaAll, fname1: '意欲', fname2: '不安', fname3: '自信' }));
  out.cfaStd = runFA('cfa', f3, { ...cfaAll, scaling: 'std', fname1: '意欲', fname2: '不安', fname3: '自信' });
  out.cfaOrth = runFA('cfa', f3, { orth: true, stdSE: true });
  out.cfaCross = runFA('cfa', { ...f3, f3: [...items12.slice(8, 12), '意欲4'] }, { path: true, ciLevel: 90, stdSE: true });   // 意欲4 が自信にも負荷（交差負荷）
  out.cfa1 = runFA('cfa', { f1: items12.slice(0, 4) }, { stdSE: true });
  out.cfa2f = runFA('cfa', { f1: items12.slice(0, 3), f2: items12.slice(4, 7) }, { scaling: 'std', stdSE: true });
  // 1 項目だけの因子はエラー、項目が足りないときは案内になる
  for (const bad of [{ f1: ['意欲1'], f2: items12.slice(4, 8) }]) {
    const def = A.find(a => a.id === 'cfa'), o = {}, s = {};
    for (const op of def.options) if (op.key) o[op.key] = op.def;
    for (const sl of def.slots) s[sl.key] = [];
    const bl = def.run(dsFA, Object.assign(s, bad), o);
    if (!(bl.length === 1 && bl[0].type === 'error')) throw new Error('cfa: 1項目の因子がエラーにならない');
  }
}
fs.writeFileSync(process.argv[2], JSON.stringify(out, (k, v) => (typeof v === 'number' && !isFinite(v) ? String(v) : v), 1));
console.log('分析を実行しました:', Object.keys(out).length, '件');
