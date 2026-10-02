// Shirabe が出力する R コードを、実際の R で動かして、Shirabe の表の数値と突き合わせる。
// 使い方: node tests/verify_rcode.js [ケース名の一部 ...]
// 前提: R が E:\ClaudeCode\tools\R にあり、必要なパッケージが E:\ClaudeCode\tools\R-library にある（tools\run-r.ps1 と同じ設定）。
// R が無い環境では、コード生成までで止めて「R による検証をスキップ」と表示する。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
globalThis.Stats = require('../js/stats.js');
globalThis.DataIO = require('../js/data.js');
globalThis.Plots = require('../js/plots.js');
require('../js/analyses.js');
const RCode = require('../js/rcode.js');
const A = globalThis.Analyses, D = globalThis.DataIO;

const RROOT = process.env.SHIRABE_R_ROOT || 'E:\\ClaudeCode\\tools';
const RHOME = path.join(RROOT, 'R', 'R-4.6.1');
const RSCRIPT = path.join(RHOME, 'bin', 'x64', 'Rscript.exe');
const haveR = fs.existsSync(RSCRIPT);
const OUT = path.join(__dirname, 'rcode_out');
fs.mkdirSync(OUT, { recursive: true });

const load = f => D.parseText(fs.readFileSync(path.join(__dirname, '..', 'samples', f), 'utf8').replace(/^\uFEFF/, ''), f);
const DATA = {
  sample: load('sample.csv'),
  fa: load('sample_fa.csv'),
  rm2: D.parseText(fs.readFileSync(path.join(__dirname, 'rm2_data.csv'), 'utf8').replace(/^\uFEFF/, ''), 'rm2'),
};

function defaults(def) { const o = {}; for (const op of def.options) if (op.key) o[op.key] = op.def; return o; }
function mkCase(name, data, id, sel, opt) { return { name, data, id, sel, opt }; }
const cases = [];
const C = (...a) => cases.push(mkCase(...a));
const ITEMS12 = ['意欲1', '意欲2', '意欲3', '意欲4', '不安1', '不安2', '不安3', '不安4', '自信1', '自信2', '自信3', '自信4'];

// ---- 記述統計・t 検定・分散分析
C('desc', 'sample', 'descriptives', { vars: ['事前テスト', '3か月後'] }, { median: true, mode: true, variance: true, se: true, range: true, quartiles: true, ci: true, skew: true, kurt: true, sw: true, hist: true, box: true });
C('desc-split', 'sample', 'descriptives', { vars: ['事後テスト', '学習時間'], split: ['性別'] }, { median: true, sd: true });
C('desc-cat', 'sample', 'descriptives', { vars: ['学級', '合格'] }, { freq: true, mode: true, bar: true });
C('t-one', 'sample', 'ttest-one', { vars: ['事後テスト', '学習時間'] }, { mu: 60, nonpar: true, normality: true, desc: true, bf: true });
C('t-one-greater', 'sample', 'ttest-one', { vars: ['事後テスト'] }, { mu: 60, alt: 'greater', nonpar: true, bf: true, ciLevel: 90 });
C('t-ind', 'sample', 'ttest-ind', { vars: ['事後テスト', '学習時間'], group: ['指導法'] }, { welch: true, nonpar: true, levene: true, normality: true, desc: true, bf: true });
C('t-ind-less', 'sample', 'ttest-ind', { vars: ['事後テスト'], group: ['指導法'] }, { welch: true, nonpar: true, alt: 'less', bf: true, bfPrior: 1, ciLevel: 99 });
C('t-ind-greater', 'sample', 'ttest-ind', { vars: ['事後テスト'], group: ['性別'] }, { alt: 'greater', bf: true, bfType: 'log' });
C('t-paired', 'sample', 'ttest-paired', { pairs: [['事後テスト', '事前テスト'], ['3か月後', '事後テスト']] }, { nonpar: true, normality: true, desc: true, bf: true });
C('t-paired-less', 'sample', 'ttest-paired', { pairs: [['事前テスト', '事後テスト']] }, { alt: 'less', nonpar: true, bf: true, bfType: 'bf01' });
C('anova1', 'sample', 'anova', { dv: ['事後テスト'], factors: ['学級'] }, { welch: true, kw: true, levene: true, desc: true, posthoc: true, phBonf: true, phHolm: true, phEffect: true, bf: true });
C('anova2', 'sample', 'anova', { dv: ['事後テスト'], factors: ['指導法', '学級'] }, { levene: true, desc: true, posthoc: true, phBonf: true, bf: true });

// ---- 反復測定・相関・回帰・度数・信頼性
const SAT = ['満足度1', '満足度2', '満足度3', '満足度4'];
const TIMES = ['事前テスト', '事後テスト', '3か月後'];
C('rm1', 'sample', 'rmanova', { vars: TIMES }, { mauchly: true, gg: true, hf: true, friedman: true, posthoc: true, phBonf: true, desc: true, bf: true });
C('rm1-k2', 'sample', 'rmanova', { vars: ['事前テスト', '事後テスト'] }, { friedman: true, posthoc: true, bf: true });
C('rm2-mixed', 'sample', 'rmanova2', { cells: TIMES, between: ['指導法'] }, { w1name: '時点', mauchly: true, gg: true, hf: true, peta: true, posthoc: true, phBonf: true, phTukey: true, desc: true, bf: true });
C('rm2-mixed3', 'sample', 'rmanova2', { cells: TIMES, between: ['学級'] }, { w1name: '時点', gg: true, posthoc: true, phTukey: true });
C('rm2-ww', 'rm2', 'rmanova2', { cells: ['A1B1', 'A1B2', 'A1B3', 'A2B1', 'A2B2', 'A2B3'] }, { w1name: 'A', w2name: 'B', w2levels: 'B1, B2, B3', mauchly: true, gg: true, hf: true, peta: true, posthoc: true, phBonf: true, desc: true, bf: true });
C('cor', 'sample', 'correlation', { vars: ['事前テスト', '事後テスト', '学習時間'] }, { spearman: true, kendall: true, ci: true, n: true, layout: 'pairs', bf: true, ciLevel: 90 });
C('cor-ties', 'sample', 'correlation', { vars: ['満足度1', '満足度2', '満足度4'] }, { spearman: true, kendall: true, layout: 'pairs', bf: true });
C('reg', 'sample', 'regression', { dv: ['事後テスト'], covs: ['事前テスト', '学習時間'], factors: ['指導法'] }, { vif: true, dw: true, desc: true, bf: true, ciLevel: 90 });
C('reg-fac', 'sample', 'regression', { dv: ['事後テスト'], covs: ['事前テスト'], factors: ['学級', '性別'] }, { vif: true, bf: true, bfType: 'log' });
C('ct22', 'sample', 'contingency', { rows: ['性別'], cols: ['合格'] }, { expected: true, rowPct: true, colPct: true, totPct: true, resid: true, yates: true, lr: true, fisher: true, cramer: true, or: true, bf: true });
C('ct32', 'sample', 'contingency', { rows: ['学級'], cols: ['合格'] }, { cramer: true, lr: true, bf: true, bfPrior: 2 });
C('binom', 'sample', 'binomial', { vars: ['合格'] }, { p0: 0.6, bf: true });
C('binom-g', 'sample', 'binomial', { vars: ['合格', '性別'] }, { p0: 0.5, alt: 'greater', bf: true, ciLevel: 99 });
C('rel', 'sample', 'reliability', { items: SAT, reverse: ['満足度3'] }, { std: true, meanr: true, scaleStats: true, omega: true, loadings: true, omegaCI: true });
C('rel-3', 'sample', 'reliability', { items: ['満足度1', '満足度2', '満足度4'] }, { omega: true });
// ---- 因子分析
const F3 = { f1: ITEMS12.slice(0, 4), f2: ITEMS12.slice(4, 8), f3: ITEMS12.slice(8, 12) };
const EFA_ALL = { eigen: true, pa: true, kmo: true, resid: true, struct: true, cut: 0 };
C('efa-default', 'fa', 'efa', { items: ITEMS12 }, { ...EFA_ALL });
C('efa-ml-promax', 'fa', 'efa', { items: ITEMS12 }, { ...EFA_ALL, method: 'ml', rotation: 'promax', nfMethod: 'fixed', nf: 3 });
C('efa-paf-varimax', 'fa', 'efa', { items: ITEMS12 }, { ...EFA_ALL, method: 'paf', rotation: 'varimax', nfMethod: 'kaiser' });
C('efa-ml-2', 'fa', 'efa', { items: ITEMS12 }, { method: 'ml', rotation: 'oblimin', nfMethod: 'fixed', nf: 2, cut: 0 });
C('efa-none', 'fa', 'efa', { items: ITEMS12 }, { rotation: 'none', nfMethod: 'fixed', nf: 3, sort: true, cut: 0 });
C('efa-quartimax-pafa', 'fa', 'efa', { items: ITEMS12 }, { ...EFA_ALL, rotation: 'quartimax', paBase: 'fa' });
C('efa-1', 'fa', 'efa', { items: ITEMS12.slice(0, 4) }, { method: 'ml', nfMethod: 'fixed', nf: 1, cut: 0 });
C('cfa-marker', 'fa', 'cfa', F3, { fname1: '意欲', fname2: '不安', fname3: '自信', reliab: true, resid: true, stdSE: true });
C('cfa-std', 'fa', 'cfa', F3, { scaling: 'std', fname1: '意欲', fname2: '不安', fname3: '自信', stdSE: true, ciLevel: 90 });
C('cfa-orth', 'fa', 'cfa', F3, { orth: true });
C('cfa-cross', 'fa', 'cfa', { ...F3, f3: [...ITEMS12.slice(8, 12), '意欲4'] }, { stdSE: true });
C('cfa-1', 'fa', 'cfa', { f1: ITEMS12.slice(0, 4) }, { stdSE: true });
C('cfa-2f', 'fa', 'cfa', { f1: ITEMS12.slice(0, 3), f2: ITEMS12.slice(4, 7) }, { scaling: 'std', stdSE: true });

const only = process.argv.slice(2);
const selected = cases.filter(c => !only.length || only.some(s => c.name.includes(s)));

// ---- 表から値を引く
// 因子数で表題が変わる表は別名で引く
const ALIAS = { LOAD: t => t.title.startsWith('因子負荷量（'), SS: t => t.title === '因子の特性', PHI: t => t.title === '因子間相関', FIT: t => t.title === 'モデルの適合度（最尤法）' };
function lookup(blocks, title, rowSpec, col) {
  if (title === 'NF') { const lt = blocks.find(b => b.type === 'table' && ALIAS.LOAD(b)); return { v: lt ? Object.keys(lt.rows[0]).filter(k => /^f\d+$/.test(k)).length : NaN, has: true }; }
  const t = blocks.find(b => b.type === 'table' && (ALIAS[title] ? ALIAS[title](b) : b.title === title));
  if (!t) return { err: `表が無い: ${title}` };
  const conds = rowSpec ? rowSpec.split(',').map(s => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; }) : [];
  // 行ラベルが空の行（先頭の変数名だけ書く表）に対応するため、直前の非空ラベルを引き継いで探す
  let carry = {};
  for (const r of t.rows) {
    const eff = { ...r };
    for (const k of ['var', 'f', 'a', 'item', 'term', 'name']) { if (r[k] !== '' && r[k] !== undefined) carry[k] = r[k]; else if (k in r) eff[k] = carry[k]; }
    if (conds.every(([k, v]) => String(eff[k]) === v)) return { v: r[col], has: col in r };
  }
  return { err: `行が無い: ${title} | ${rowSpec}` };
}
// 許容誤差。p は相対、ほかは max(1, |値|) に対する相対。既定 5e-6
// mc: BayesFactor がモンテカルロで近似する値（報告される誤差の 4 倍か 4% の大きいほう）、ld: 因子分析の負荷量など（psych の回転は eps = 1e-5 で打ち切るため）
const TOL = { bf: 2e-3, tukey: 2e-4, bonf: 1e-5, holm: 1e-5, post: 2e-3, p: 1e-4, ld: 3e-4, fit: 1e-4 };
function parseR(s) { const t = s.trim(); if (t === 'NA' || t === 'NaN') return NaN; if (t === 'Inf') return Infinity; if (t === '-Inf') return -Infinity; return Number(t); }
function same(got, exp, col, mcTol) {
  if (typeof exp === 'string') exp = exp === 'Infinity' ? Infinity : exp === '-Infinity' ? -Infinity : Number(exp);
  if (!isFinite(exp) || !isFinite(got)) return (isNaN(exp) && isNaN(got)) || exp === got;
  const tol = col === 'mc' ? mcTol : (TOL[col] || 5e-6);
  if (col === 'p' || col === 'tukey' || col === 'bonf' || col === 'holm') return Math.abs(got - exp) <= tol * Math.max(Math.abs(exp), 1e-12) || Math.abs(got - exp) < 1e-12;
  return Math.abs(got - exp) <= tol * Math.max(1, Math.abs(exp));
}

function runR(file) {
  const env = { ...process.env, R_HOME: RHOME, R_USER: path.join(RROOT, 'R-home'), R_LIBS_USER: path.join(RROOT, 'R-library'), R_LIBS_SITE: '', R_PROFILE_USER: '',
    TMPDIR: 'E:\\ClaudeCode\\data\\claude\\tmp\\rtemp', TMP: 'E:\\ClaudeCode\\data\\claude\\tmp\\rtemp', TEMP: 'E:\\ClaudeCode\\data\\claude\\tmp\\rtemp', LANG: 'ja_JP.UTF-8' };
  fs.mkdirSync(env.TMPDIR, { recursive: true });
  return spawnSync(RSCRIPT, [path.basename(file)], { cwd: path.dirname(file), env, encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 28 });
}

let total = 0, bad = 0, errs = 0, shown = 0;
for (const cs of selected) {
  const ds = DATA[cs.data], def = A.find(a => a.id === cs.id);
  const sel = {}; for (const sl of def.slots) sel[sl.key] = [];
  Object.assign(sel, cs.sel);
  const opt = Object.assign(defaults(def), cs.opt);
  const blocks = def.run(ds, sel, opt);
  for (const bl of blocks) if (bl.type === 'error') { console.log(`!! ${cs.name}: Shirabe がエラー: ${bl.text}`); }
  const code = RCode.build(ds, [{ def, sel, opt }], { D, forTest: true });
  const file = path.join(OUT, `${cs.name}.R`);
  fs.writeFileSync(file, code, 'utf8');
  fs.writeFileSync(path.join(OUT, `${cs.name}.user.R`), RCode.build(ds, [{ def, sel, opt }], { D, forTest: false }), 'utf8');   // 利用者が見る版も残す
  if (!haveR) { console.log(`-- ${cs.name}: R が無いのでスキップ（コード生成のみ）`); continue; }
  const t0 = Date.now(), r = runR(file), sec = ((Date.now() - t0) / 1000).toFixed(1);
  const lines = (r.stdout || '').split(/\r?\n/);
  const chks = lines.filter(l => l.startsWith('CHK\t')).map(l => l.split('\t'));
  fs.writeFileSync(path.join(OUT, `${cs.name}.out.txt`), (r.stdout || '') + '\n--- stderr ---\n' + (r.stderr || ''), 'utf8');
  if (r.status !== 0) { errs++; console.log(`✗ ${cs.name}: R がエラー終了 (${sec}s)\n${(r.stderr || '').split(/\r?\n/).filter(Boolean).slice(-6).join('\n')}`); continue; }
  let nOK = 0, nBad = 0;
  const errLine = chks.find(c_ => c_[1] === 'ERR||mc'), mcTol = Math.max(4e-2, 4 * (errLine ? parseR(errLine[2].split(' ')[0]) : 0));   // BayesFactor が報告する近似誤差の 4 倍か 4% の大きいほう
  for (const [, key, val] of chks) {
    if (key === 'ERR||mc') continue;
    const [title, rowSpec, colRaw] = key.split('|'); const [col, cls] = colRaw.split('~');   // ~mc: BayesFactor がモンテカルロで近似する値（誤差が大きい）
    const lk = lookup(blocks, title, rowSpec, col);
    total++;
    if (lk.err) { nBad++; bad++; if (shown++ < 40) console.log(`  NG ${cs.name}: ${lk.err}`); continue; }
    const got = parseR(val.split(' ')[0]);
    if (lk.v === null || lk.v === undefined) { if (isNaN(got) || !lk.has) { nOK++; continue; } }
    const tcls = cls === 'mc' ? 'mc' : (['LOAD', 'SS', 'PHI'].includes(title) ? 'ld' : title === 'FIT' ? 'fit' : col);
    if (same(got, lk.v, tcls, mcTol)) nOK++;
    else { nBad++; bad++; if (shown++ < 40) console.log(`  NG ${cs.name}: ${title} | ${rowSpec} | ${col}: R=${val} / Shirabe=${lk.v}`); }
  }
  console.log(`${nBad ? '✗' : '✓'} ${cs.name}: ${nOK}/${nOK + nBad} 件一致 (${sec}s, R コード ${code.split('\n').length} 行)`);
}
console.log(haveR ? `\n合計 ${total} 件中 ${total - bad} 件一致、不一致 ${bad}、R のエラー終了 ${errs}` : '\nR が見つからないため、R による検証をスキップしました（コード生成は成功）');
process.exit(bad || errs ? 1 : 0);
