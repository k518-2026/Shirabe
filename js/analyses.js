/*
 * analyses.js — 分析の定義（入力欄の仕様と計算・出力）
 * 各分析は { id, group, title, slots, options, run(ds, sel, opt) } の形。
 * run は出力ブロックの配列を返す:
 *   { type:'table', title, cols:[{key,label,fmt,group}], rows:[{...}], notes:[] }
 *   { type:'plot', title, svg }   { type:'note', text }   { type:'error', text }
 * Copyright (c) 2026 K.Yamamoto — MIT License
 */
(function (root) {
  'use strict';
  const S = root.Stats, D = root.DataIO, P = root.Plots;
  const A = [];

  // ------------------------------------------------------------ 共通の部品
  const col = (ds, name) => D.byName(ds, name);
  const vals = (c, idx) => idx.map(i => c.nums[i]);
  const levelsIn = (c, idx) => c.levels.filter(l => idx.some(i => c.raw[i] === l));
  const err = text => ({ type: 'error', text });
  const note = text => ({ type: 'note', text });
  const table = (title, cols, rows, notes) => ({ type: 'table', title, cols, rows, notes: notes || [] });
  const plot = (title, svg) => ({ type: 'plot', title, svg });
  const ciLabel = o => `${o.ciLevel}% 信頼区間`;
  const level = o => Math.min(99.9, Math.max(50, Number(o.ciLevel) || 95)) / 100;
  const ALT = [['two', '両側（≠）'], ['greater', '片側（>）'], ['less', '片側（<）']];
  const altNote = (o, a, b) => o.alt === 'two' ? null : `対立仮説は片側: ${a} ${o.alt === 'greater' ? '>' : '<'} ${b}`;
  // t 統計量から対立仮説に応じた p
  const tP = (t, df, alt) => alt === 'greater' ? S.ptUpper(t, df) : alt === 'less' ? 1 - S.ptUpper(t, df) : S.ptTwo(t, df);
  // 平均差の信頼区間（片側なら片側区間）
  function tCI(est, se, df, alt, lv) {
    if (alt === 'greater') return [est - S.qt(lv, df) * se, Infinity];
    if (alt === 'less') return [-Infinity, est + S.qt(lv, df) * se];
    const q = S.qt(1 - (1 - lv) / 2, df);
    return [est - q * se, est + q * se];
  }
  const meanCI = (x, lv) => {
    const n = x.length; if (n < 2) return [NaN, NaN];
    const m = S.mean(x), se = S.sd(x) / Math.sqrt(n), q = S.qt(1 - (1 - lv) / 2, n - 1);
    return [m - q * se, m + q * se];
  };
  function groupsBy(ds, gcol, idx) {
    const lv = levelsIn(gcol, idx);
    return lv.map(l => ({ level: l, idx: idx.filter(i => gcol.raw[i] === l) }));
  }
  const excluded = (ds, idx) => ds.n - idx.length > 0 ? `欠損値のある ${ds.n - idx.length} 行を除外しました。` : null;
  const clean = a => a.filter(Boolean);

  // ------------------------------------------------------------ 記述統計
  A.push({
    id: 'descriptives', group: '記述統計', title: '記述統計',
    slots: [
      { key: 'vars', label: '変数', multi: true, types: ['scale', 'ordinal', 'nominal'] },
      { key: 'split', label: '分割（グループ化変数）', multi: false, types: ['nominal', 'ordinal'], optional: true },
    ],
    options: [
      { type: 'heading', label: '中心傾向' },
      { type: 'check', key: 'mean', label: '平均値', def: true },
      { type: 'check', key: 'median', label: '中央値', def: false },
      { type: 'check', key: 'mode', label: '最頻値', def: false },
      { type: 'heading', label: '散らばり' },
      { type: 'check', key: 'sd', label: '標準偏差', def: true },
      { type: 'check', key: 'variance', label: '分散', def: false },
      { type: 'check', key: 'se', label: '平均値の標準誤差', def: false },
      { type: 'check', key: 'range', label: '範囲', def: false },
      { type: 'check', key: 'minmax', label: '最小値・最大値', def: true },
      { type: 'check', key: 'quartiles', label: '四分位数', def: false },
      { type: 'check', key: 'ci', label: '平均値の信頼区間', def: false },
      { type: 'number', key: 'ciLevel', label: '信頼水準 %', def: 95, min: 50, max: 99.9, step: 0.1 },
      { type: 'heading', label: '分布' },
      { type: 'check', key: 'skew', label: '歪度', def: false },
      { type: 'check', key: 'kurt', label: '尖度', def: false },
      { type: 'check', key: 'sw', label: 'Shapiro-Wilk 検定', def: false },
      { type: 'heading', label: '表と図' },
      { type: 'check', key: 'freq', label: '度数分布表（名義・順序尺度）', def: false },
      { type: 'check', key: 'hist', label: 'ヒストグラム', def: false },
      { type: 'check', key: 'box', label: '箱ひげ図', def: false },
      { type: 'check', key: 'bar', label: '棒グラフ（名義・順序尺度）', def: false },
    ],
    run(ds, sel, o) {
      if (!sel.vars.length) return [];
      const split = sel.split[0] ? col(ds, sel.split[0]) : null;
      const lv = level(o);
      const out = [], rows = [];
      const cols = [{ key: 'var', label: '変数', fmt: 'text' }];
      if (split) cols.push({ key: 'grp', label: split.name, fmt: 'text' });
      cols.push({ key: 'n', label: '有効', fmt: 'int' }, { key: 'miss', label: '欠損', fmt: 'int' });
      if (o.mean) cols.push({ key: 'mean', label: '平均値' });
      if (o.ci) cols.push({ key: 'lo', label: '下限', group: ciLabel(o) }, { key: 'hi', label: '上限', group: ciLabel(o) });
      if (o.median) cols.push({ key: 'median', label: '中央値' });
      if (o.mode) cols.push({ key: 'mode', label: '最頻値' });
      if (o.sd) cols.push({ key: 'sd', label: '標準偏差' });
      if (o.variance) cols.push({ key: 'var2', label: '分散' });
      if (o.se) cols.push({ key: 'se', label: '標準誤差' });
      if (o.range) cols.push({ key: 'range', label: '範囲' });
      if (o.minmax) cols.push({ key: 'min', label: '最小値' }, { key: 'max', label: '最大値' });
      if (o.quartiles) cols.push({ key: 'q1', label: '25%' }, { key: 'q2', label: '50%' }, { key: 'q3', label: '75%' });
      if (o.skew) cols.push({ key: 'skew', label: '歪度' }, { key: 'seskew', label: '歪度の SE' });
      if (o.kurt) cols.push({ key: 'kurt', label: '尖度' }, { key: 'sekurt', label: '尖度の SE' });
      if (o.sw) cols.push({ key: 'W', label: 'Shapiro-Wilk W' }, { key: 'swp', label: 'p', fmt: 'p' });
      let modeTie = false;
      const groups = split ? [...levelsIn(split, [...Array(ds.n).keys()].filter(i => !split.missing[i])).map(l => ({ l, idx: [...Array(ds.n).keys()].filter(i => !split.missing[i] && split.raw[i] === l) }))]
        : [{ l: null, idx: [...Array(ds.n).keys()] }];
      for (const name of sel.vars) {
        const c = col(ds, name);
        for (const g of groups) {
          const valid = g.idx.filter(i => !c.missing[i]);
          const row = { var: name, grp: g.l, n: valid.length, miss: g.idx.length - valid.length };
          if (c.type !== 'nominal' && c.numeric && valid.length) {
            const x = vals(c, valid), s = S.sorted(x), n = x.length;
            row.mean = S.mean(x); row.sd = S.sd(x); row.var2 = S.variance(x); row.se = row.sd / Math.sqrt(n);
            row.median = S.quantile(s, 0.5, true); row.min = s[0]; row.max = s[n - 1]; row.range = s[n - 1] - s[0];
            row.q1 = S.quantile(s, 0.25, true); row.q2 = row.median; row.q3 = S.quantile(s, 0.75, true);
            [row.lo, row.hi] = meanCI(x, lv);
            row.skew = S.skewness(x); row.seskew = n > 2 ? S.seSkewness(n) : NaN;
            row.kurt = S.kurtosis(x); row.sekurt = n > 3 ? S.seKurtosis(n) : NaN;
            const cnt = new Map(); for (const v of x) cnt.set(v, (cnt.get(v) || 0) + 1);
            const mx = Math.max(...cnt.values()), modes = [...cnt].filter(([, k]) => k === mx).map(([v]) => v);
            row.mode = Math.min(...modes); if (modes.length > 1) modeTie = true;
            if (o.sw) { const r = S.shapiroWilk(x); if (r) { row.W = r.W; row.swp = r.p; } }
          } else if (valid.length && o.mode) {
            const cnt = new Map(); for (const i of valid) cnt.set(c.raw[i], (cnt.get(c.raw[i]) || 0) + 1);
            const mx = Math.max(...cnt.values()), modes = [...cnt].filter(([, k]) => k === mx).map(([v]) => v);
            row.mode = modes[0]; if (modes.length > 1) modeTie = true;
          }
          rows.push(row);
        }
      }
      out.push(table('記述統計', cols, rows, clean([
        o.mode && modeTie ? '最頻値が複数ある場合は最小の値を示しています。' : null,
        o.skew || o.kurt ? '歪度・尖度は標本サイズで補正した推定量（SPSS と同じ定義）です。' : null,
        o.quartiles ? '四分位数は R の type 7（Excel の QUARTILE.INC と同じ）で計算しています。' : null,
        '名義尺度の変数は有効・欠損の数だけを示します。'])));

      if (o.freq) {
        for (const name of sel.vars) {
          const c = col(ds, name);
          if (c.type === 'scale') continue;
          for (const g of groups) {
            const valid = g.idx.filter(i => !c.missing[i]);
            const miss = g.idx.length - valid.length;
            let cum = 0; const fr = [];
            for (const l of c.levels) {
              const k = valid.filter(i => c.raw[i] === l).length; if (!k) continue;
              cum += k;
              fr.push({ lv: l, k, pct: 100 * k / g.idx.length, vpct: 100 * k / valid.length, cum: 100 * cum / valid.length });
            }
            if (miss) fr.push({ lv: '欠損', k: miss, pct: 100 * miss / g.idx.length });
            fr.push({ lv: '合計', k: g.idx.length, pct: 100, _total: true });
            out.push(table(`度数分布表 — ${name}${g.l !== null ? `（${split.name} = ${g.l}）` : ''}`,
              [{ key: 'lv', label: name, fmt: 'text' }, { key: 'k', label: '度数', fmt: 'int' }, { key: 'pct', label: '%', fmt: 'num1' },
                { key: 'vpct', label: '有効 %', fmt: 'num1' }, { key: 'cum', label: '累積 %', fmt: 'num1' }], fr));
          }
        }
      }
      for (const name of sel.vars) {
        const c = col(ds, name);
        if (c.type !== 'nominal' && c.numeric) {
          const gs = groups.map(g => vals(c, g.idx.filter(i => !c.missing[i])));
          if (o.hist) groups.forEach((g, k) => { if (gs[k].length) out.push(plot(`ヒストグラム — ${name}${g.l !== null ? `（${g.l}）` : ''}`, P.histogram(gs[k], name))); });
          if (o.box) out.push(plot(`箱ひげ図 — ${name}`, P.boxplot(gs, groups.map(g => g.l === null ? name : g.l), name)));
        } else if (o.bar) {
          groups.forEach(g => {
            const valid = g.idx.filter(i => !c.missing[i]);
            const lv2 = c.levels.filter(l => valid.some(i => c.raw[i] === l));
            out.push(plot(`棒グラフ — ${name}${g.l !== null ? `（${g.l}）` : ''}`, P.bars(lv2, lv2.map(l => valid.filter(i => c.raw[i] === l).length), name)));
          });
        }
      }
      return out;
    },
  });

  // ------------------------------------------------------------ ベイズファクターの共通部品
  // 事前分布の幅（prior）は分析ごとに JASP と同じ既定値を使う
  const bayesOptions = (priorLabel, def) => [
    { type: 'heading', label: 'ベイズファクター' },
    { type: 'check', key: 'bf', label: 'ベイズファクターを表示', def: false },
    { type: 'radio', key: 'bfType', options: [['bf10', 'BF₁₀（H₁ ÷ H₀）'], ['bf01', 'BF₀₁（H₀ ÷ H₁）'], ['log', 'log(BF₁₀)']], def: 'bf10' },
    ...(priorLabel ? [{ type: 'number', key: 'bfPrior', label: priorLabel, def, min: 0.01, step: 0.001 }] : []),
  ];
  const priorOf = (o, def) => (Number(o.bfPrior) > 0 ? Number(o.bfPrior) : def);
  const SUB = { two: '₁', greater: '₊', less: '₋' };
  // 見出し：両側は BF₁₀、片側は BF₊₀ / BF₋₀
  const bfLabel = (o, alt) => { const h = SUB[alt || 'two']; return o.bfType === 'bf01' ? `BF₀${h}` : o.bfType === 'log' ? `log(BF${h}₀)` : `BF${h}₀`; };
  const bfShow = (bf10, o) => (!isFinite(bf10) && !(bf10 === Infinity) ? NaN : o.bfType === 'bf01' ? 1 / bf10 : o.bfType === 'log' ? Math.log(bf10) : bf10);
  // 証拠の強さ（Lee & Wagenmakers, 2013 の目安）
  function bfEvidence(bf10) {
    if (!(bf10 > 0) || !isFinite(bf10) && bf10 !== Infinity) return '';
    const b = bf10 >= 1 ? bf10 : 1 / bf10, h = bf10 >= 1 ? 'H₁' : 'H₀';
    return `${h} を${b < 3 ? 'わずかに' : b < 10 ? '中程度に' : b < 30 ? '強く' : b < 100 ? '非常に強く' : '極めて強く'}支持`;
  }
  const bfCols = (o, alt) => [{ key: 'bf', label: bfLabel(o, alt) }, { key: 'ev', label: '証拠の強さ', fmt: 'text' }];
  const bfCells = (bf10, o) => ({ bf: bfShow(bf10, o), ev: bfEvidence(bf10) });
  const bfNote = (o, prior) => `ベイズファクター BF₁₀ は、データが H₀（効果なし）より H₁（効果あり）のもとで何倍起こりやすいかを示します`
    + `${o.bfType === 'bf01' ? '（BF₀₁ = 1 ÷ BF₁₀）' : o.bfType === 'log' ? '（表は自然対数）' : ''}。`
    + `証拠の強さの目安は Lee & Wagenmakers (2013)：1–3 わずか、3–10 中程度、10–30 強い、30–100 非常に強い、100 超 極めて強い。事前分布：${prior}。`;

  // ------------------------------------------------------------ t 検定の共通オプション
  const tOptions = (extra) => [
    { type: 'heading', label: '検定' },
    { type: 'check', key: 'student', label: 'Student の t 検定', def: true },
    ...(extra.welch ? [{ type: 'check', key: 'welch', label: 'Welch の t 検定', def: false }] : []),
    { type: 'check', key: 'nonpar', label: extra.nonparLabel, def: false },
    ...(extra.testValue ? [{ type: 'number', key: 'mu', label: '検定値', def: 0, step: 'any' }] : []),
    { type: 'heading', label: '対立仮説' },
    { type: 'radio', key: 'alt', options: ALT.map(([v, l]) => [v, v === 'two' ? l : `${l}: ${extra.altLabels[v]}`]), def: 'two' },
    { type: 'heading', label: '追加の統計量' },
    { type: 'check', key: 'diff', label: '平均値の差と信頼区間', def: false },
    { type: 'check', key: 'effect', label: '効果量', def: true },
    { type: 'number', key: 'ciLevel', label: '信頼水準 %', def: 95, min: 50, max: 99.9, step: 0.1 },
    { type: 'check', key: 'desc', label: '記述統計', def: false },
    ...bayesOptions('事前分布の幅（Cauchy の r）', 0.707),
    { type: 'heading', label: '前提の確認' },
    { type: 'check', key: 'normality', label: '正規性（Shapiro-Wilk）', def: false },
    ...(extra.welch ? [{ type: 'check', key: 'levene', label: '等分散性（Levene）', def: false }] : []),
    { type: 'heading', label: '図' },
    { type: 'check', key: 'plot', label: '平均値と信頼区間の図', def: false },
    { type: 'check', key: 'rain', label: '雨雲プロット', def: false },
  ];
  const RAIN_NOTE = '雨雲プロット：右の雲はデータの分布（カーネル密度）、中央は箱ひげ図、左の点は一人ひとりの値です。';
  const tCols = (o, hasDF) => {
    const c = [{ key: 'var', label: '', fmt: 'text' }, { key: 'test', label: '検定', fmt: 'text' },
      { key: 'stat', label: '統計量' }, { key: 'df', label: '自由度', fmt: 'df' }, { key: 'p', label: 'p', fmt: 'p' }];
    if (o.diff) c.push({ key: 'md', label: '平均値の差' }, { key: 'sed', label: '差の SE' },
      { key: 'lo', label: '下限', group: ciLabel(o) }, { key: 'hi', label: '上限', group: ciLabel(o) });
    if (o.effect) c.push({ key: 'es', label: '効果量' }, { key: 'esType', label: '', fmt: 'text' });
    if (o.bf && o.student) c.push(...bfCols(o, o.alt));
    void hasDF;
    return c;
  };
  // t 検定のベイズファクター（Student の行だけ。N は有効サンプルサイズ）
  const tBF = (o, t, N, nu) => (o.bf ? bfCells(S.bfT(t, N, nu, priorOf(o, 0.707), o.alt), o) : {});
  const tBFNote = o => (o.bf && o.student ? bfNote(o, `効果量 δ に Cauchy 分布（幅 r = ${priorOf(o, 0.707)}）${o.alt !== 'two' ? '、片側は δ の符号で切断' : ''}。Student の t 検定の行にだけ示します`) : null);

  // ------------------------------------------------------------ 1サンプルの t 検定
  A.push({
    id: 'ttest-one', group: 't 検定', title: '1サンプルの t 検定',
    slots: [{ key: 'vars', label: '変数', multi: true, types: ['scale', 'ordinal'] }],
    options: tOptions({ nonparLabel: 'Wilcoxon の符号付き順位検定', testValue: true, altLabels: { greater: '平均 > 検定値', less: '平均 < 検定値' } }),
    run(ds, sel, o) {
      if (!sel.vars.length) return [];
      const lv = level(o), mu = Number(o.mu) || 0;
      const rows = [], desc = [], norm = [], out = [];
      let anyTest = false;
      for (const name of sel.vars) {
        const c = col(ds, name), idx = D.complete(ds, [c]), x = vals(c, idx), n = x.length;
        if (n < 2) { out.push(err(`${name}: 有効な値が2つ未満です。`)); continue; }
        const m = S.mean(x), sd = S.sd(x), se = sd / Math.sqrt(n);
        if (o.student) {
          anyTest = true;
          const t = (m - mu) / se, [lo, hi] = tCI(m - mu, se, n - 1, o.alt, lv);
          rows.push({ var: name, test: 'Student', stat: t, df: n - 1, p: tP(t, n - 1, o.alt), md: m - mu, sed: se, lo, hi, es: (m - mu) / sd, esType: 'Cohen の d', ...tBF(o, t, n, n - 1) });
        }
        if (o.nonpar) {
          anyTest = true;
          const r = S.signedRank(x.map(v => v - mu), o.alt);
          if (r) rows.push({ var: name, test: 'Wilcoxon', stat: r.V, df: null, p: r.p, md: S.median(x) - mu, es: r.rankBiserial, esType: '順位双列相関', _method: r.method });
        }
        desc.push({ var: name, n, mean: m, sd, se, median: S.median(x), lo: meanCI(x, lv)[0], hi: meanCI(x, lv)[1] });
        const sw = S.shapiroWilk(x); if (sw) norm.push({ var: name, W: sw.W, p: sw.p });
      }
      if (anyTest) out.push(table('1サンプルの t 検定', tCols(o), rows, clean([
        `検定値は ${mu} です。`, altNote(o, '平均', mu),
        o.nonpar ? 'Wilcoxon の統計量 V は正の順位の和です。' + (rows.some(r => r._method === 'normal') ? '同順位・ゼロを含むか n ≥ 50 のため、連続性補正つきの正規近似で p を求めています。' : '') : null,
        o.diff && o.nonpar ? 'Wilcoxon の行の「平均値の差」は中央値と検定値の差です。' : null, tBFNote(o)])));
      if (o.desc) out.push(table('記述統計', [{ key: 'var', label: '', fmt: 'text' }, { key: 'n', label: 'N', fmt: 'int' }, { key: 'mean', label: '平均値' },
        { key: 'sd', label: '標準偏差' }, { key: 'se', label: '標準誤差' }, { key: 'median', label: '中央値' }, { key: 'lo', label: '下限', group: ciLabel(o) }, { key: 'hi', label: '上限', group: ciLabel(o) }], desc));
      if (o.normality) out.push(table('正規性の検定（Shapiro-Wilk）', [{ key: 'var', label: '', fmt: 'text' }, { key: 'W', label: 'W' }, { key: 'p', label: 'p', fmt: 'p' }], norm, ['p が小さいと正規分布から外れていることを示します。']));
      if (o.plot) for (const d of desc) out.push(plot(`平均値 — ${d.var}`, P.means([d.var], [''], [{ x: 0, s: 0, m: d.mean, lo: d.lo, hi: d.hi }], '', d.var)));
      if (o.rain) for (const d of desc) {
        const c = col(ds, d.var), x = vals(c, D.complete(ds, [c]));
        out.push(plot(`雨雲プロット — ${d.var}`, P.raincloud([{ x: 0, s: 0, v: x }], [d.var], [''], '', d.var)));
      }
      if (o.rain && desc.length) out.push(note(RAIN_NOTE));
      return out;
    },
  });

  // ------------------------------------------------------------ 独立したサンプルの t 検定
  A.push({
    id: 'ttest-ind', group: 't 検定', title: '独立したサンプルの t 検定',
    slots: [
      { key: 'vars', label: '従属変数', multi: true, types: ['scale', 'ordinal'] },
      { key: 'group', label: 'グループ化変数（2水準）', multi: false, types: ['nominal', 'ordinal'] },
    ],
    options: tOptions({ nonparLabel: 'Mann-Whitney の U 検定', welch: true, altLabels: { greater: '群1 > 群2', less: '群1 < 群2' } }),
    run(ds, sel, o) {
      if (!sel.vars.length || !sel.group.length) return [];
      const g = col(ds, sel.group[0]), lv = level(o);
      const rows = [], desc = [], norm = [], lev = [], out = [], plots = [], rains = [];
      let g1, g2, anyTest = false;
      for (const name of sel.vars) {
        const c = col(ds, name), idx = D.complete(ds, [c, g]);
        const gs = groupsBy(ds, g, idx);
        if (gs.length !== 2) { out.push(err(`グループ化変数「${g.name}」の水準が ${gs.length} 個です。ちょうど2個のときに使えます。3個以上なら分散分析を使ってください。`)); return out; }
        [g1, g2] = gs.map(x => x.level);
        const x = vals(c, gs[0].idx), y = vals(c, gs[1].idx), n1 = x.length, n2 = y.length;
        if (n1 < 2 || n2 < 2) { out.push(err(`${name}: 各群に2つ以上の値が必要です。`)); continue; }
        const m1 = S.mean(x), m2 = S.mean(y), v1 = S.variance(x), v2 = S.variance(y), md = m1 - m2;
        if (o.student) {
          anyTest = true;
          const df = n1 + n2 - 2, sp = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / df), se = sp * Math.sqrt(1 / n1 + 1 / n2), t = md / se;
          const [lo, hi] = tCI(md, se, df, o.alt, lv);
          rows.push({ var: name, test: 'Student', stat: t, df, p: tP(t, df, o.alt), md, sed: se, lo, hi, es: md / sp, esType: 'Cohen の d', ...tBF(o, t, n1 * n2 / (n1 + n2), df) });
        }
        if (o.welch) {
          anyTest = true;
          const se = Math.sqrt(v1 / n1 + v2 / n2), t = md / se;
          const df = (v1 / n1 + v2 / n2) ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));
          const [lo, hi] = tCI(md, se, df, o.alt, lv);
          rows.push({ var: name, test: 'Welch', stat: t, df, p: tP(t, df, o.alt), md, sed: se, lo, hi, es: md / Math.sqrt((v1 + v2) / 2), esType: 'Cohen の d' });
        }
        if (o.nonpar) {
          anyTest = true;
          const r = S.mannWhitney(x, y, o.alt);
          rows.push({ var: name, test: 'Mann-Whitney', stat: r.W, df: null, p: r.p, md: S.median(x) - S.median(y), es: r.rankBiserial, esType: '順位双列相関', _method: r.method });
        }
        for (const [l, a] of [[g1, x], [g2, y]]) {
          const [lo, hi] = meanCI(a, lv);
          desc.push({ var: name, grp: l, n: a.length, mean: S.mean(a), sd: S.sd(a), se: S.sd(a) / Math.sqrt(a.length), lo, hi });
          const sw = S.shapiroWilk(a); norm.push({ var: name, grp: l, W: sw ? sw.W : NaN, p: sw ? sw.p : NaN });
        }
        const L = S.levene([x, y]); if (L) lev.push({ var: name, F: L.F, df1: L.df1, df2: L.df2, p: L.p });
        const d2 = desc.slice(-2);
        plots.push(plot(`平均値 — ${name}`, P.means([g1, g2], [''], d2.map((d, k) => ({ x: k, s: 0, m: d.mean, lo: d.lo, hi: d.hi })), g.name, name)));
        rains.push(plot(`雨雲プロット — ${name}`, P.raincloud([{ x: 0, s: 0, v: x }, { x: 1, s: 0, v: y }], [g1, g2], [''], g.name, name)));
      }
      if (anyTest) out.push(table('独立したサンプルの t 検定', tCols(o), rows, clean([
        `群1 = ${g1}、群2 = ${g2}。平均値の差は 群1 − 群2 です。`, altNote(o, '群1', '群2'),
        o.welch && o.effect ? 'Welch の d は2群の分散の平均を分母にしています。' : null,
        o.nonpar ? 'Mann-Whitney の統計量 W は群1の U です。' + (rows.some(r => r._method === 'normal') ? '同順位があるか n ≥ 50 のため、連続性補正つきの正規近似で p を求めています。' : '') : null,
        o.diff && o.nonpar ? 'Mann-Whitney の行の「平均値の差」は中央値の差です。' : null, tBFNote(o)])));
      if (o.desc) out.push(table('群ごとの記述統計', [{ key: 'var', label: '', fmt: 'text' }, { key: 'grp', label: '群', fmt: 'text' }, { key: 'n', label: 'N', fmt: 'int' },
        { key: 'mean', label: '平均値' }, { key: 'sd', label: '標準偏差' }, { key: 'se', label: '標準誤差' }, { key: 'lo', label: '下限', group: ciLabel(o) }, { key: 'hi', label: '上限', group: ciLabel(o) }], desc));
      if (o.normality) out.push(table('正規性の検定（Shapiro-Wilk）', [{ key: 'var', label: '', fmt: 'text' }, { key: 'grp', label: '群', fmt: 'text' }, { key: 'W', label: 'W' }, { key: 'p', label: 'p', fmt: 'p' }], norm, ['p が小さいと正規分布から外れていることを示します。']));
      if (o.levene) out.push(table('等分散性の検定（Levene）', [{ key: 'var', label: '', fmt: 'text' }, { key: 'F', label: 'F' }, { key: 'df1', label: '自由度1', fmt: 'df' }, { key: 'df2', label: '自由度2', fmt: 'df' }, { key: 'p', label: 'p', fmt: 'p' }], lev,
        ['平均値からの絶対偏差を使う Levene 検定です。p が小さいときは Welch の t 検定を使ってください。']));
      if (o.plot) out.push(...plots);
      if (o.rain && rains.length) out.push(...rains, note(RAIN_NOTE));
      return out;
    },
  });

  // ------------------------------------------------------------ 対応のあるサンプルの t 検定
  A.push({
    id: 'ttest-paired', group: 't 検定', title: '対応のあるサンプルの t 検定',
    slots: [{ key: 'pairs', label: '変数のペア', pairs: true, types: ['scale', 'ordinal'] }],
    options: tOptions({ nonparLabel: 'Wilcoxon の符号付き順位検定', altLabels: { greater: '変数1 > 変数2', less: '変数1 < 変数2' } }),
    run(ds, sel, o) {
      const pairs = sel.pairs.filter(p => p[0] && p[1]);
      if (!pairs.length) return [];
      const lv = level(o);
      const rows = [], desc = [], norm = [], out = [], plots = [], rains = [];
      let anyTest = false;
      for (const [a, b] of pairs) {
        const ca = col(ds, a), cb = col(ds, b), idx = D.complete(ds, [ca, cb]);
        const x = vals(ca, idx), y = vals(cb, idx), n = x.length, label = `${a} − ${b}`;
        if (a === b) { out.push(err(`${label}: 同じ変数どうしは比べられません。`)); continue; }
        if (n < 2) { out.push(err(`${label}: そろった値が2組未満です。`)); continue; }
        const d = x.map((v, i) => v - y[i]), md = S.mean(d), sd = S.sd(d), se = sd / Math.sqrt(n);
        if (o.student) {
          anyTest = true;
          const t = md / se, [lo, hi] = tCI(md, se, n - 1, o.alt, lv);
          rows.push({ var: label, test: 'Student', stat: t, df: n - 1, p: tP(t, n - 1, o.alt), md, sed: se, lo, hi, es: md / sd, esType: 'Cohen の d', ...tBF(o, t, n, n - 1) });
        }
        if (o.nonpar) {
          anyTest = true;
          const r = S.signedRank(d, o.alt);
          if (r) rows.push({ var: label, test: 'Wilcoxon', stat: r.V, df: null, p: r.p, md: S.median(d), es: r.rankBiserial, esType: '順位双列相関', _method: r.method });
        }
        const pd = [];
        for (const [nm, v] of [[a, x], [b, y]]) {
          const [lo, hi] = meanCI(v, lv);
          desc.push({ var: nm, n, mean: S.mean(v), sd: S.sd(v), se: S.sd(v) / Math.sqrt(n), lo, hi }); pd.push({ m: S.mean(v), lo, hi });
        }
        const sw = S.shapiroWilk(d); norm.push({ var: label, W: sw ? sw.W : NaN, p: sw ? sw.p : NaN });
        plots.push(plot(`平均値 — ${label}`, P.means([a, b], [''], pd.map((q, k) => ({ x: k, s: 0, ...q })), '', '平均値')));
        rains.push(plot(`雨雲プロット — ${label}`, P.raincloud([{ x: 0, s: 0, v: x }, { x: 1, s: 0, v: y }], [a, b], [''], '', '値', { paired: true })));
      }
      if (anyTest) out.push(table('対応のあるサンプルの t 検定', tCols(o), rows, clean([
        '差は 変数1 − 変数2 です。効果量は差の標準偏差を分母にした d（dz）です。', altNote(o, '変数1', '変数2'),
        o.nonpar ? 'Wilcoxon の統計量 V は正の順位の和です。差が0の組は除きます。' + (rows.some(r => r._method === 'normal') ? '同順位・ゼロを含むか n ≥ 50 のため、連続性補正つきの正規近似で p を求めています。' : '') : null,
        o.diff && o.nonpar ? 'Wilcoxon の行の「平均値の差」は差の中央値です。' : null, tBFNote(o)])));
      if (o.desc) out.push(table('記述統計', [{ key: 'var', label: '', fmt: 'text' }, { key: 'n', label: 'N', fmt: 'int' }, { key: 'mean', label: '平均値' },
        { key: 'sd', label: '標準偏差' }, { key: 'se', label: '標準誤差' }, { key: 'lo', label: '下限', group: ciLabel(o) }, { key: 'hi', label: '上限', group: ciLabel(o) }], desc));
      if (o.normality) out.push(table('差の正規性の検定（Shapiro-Wilk）', [{ key: 'var', label: '', fmt: 'text' }, { key: 'W', label: 'W' }, { key: 'p', label: 'p', fmt: 'p' }], norm));
      if (o.plot) out.push(...plots);
      if (o.rain && rains.length) out.push(...rains, note(RAIN_NOTE + '灰色の線は同じ人の2つの値をつないでいます。'));
      return out;
    },
  });

  // ------------------------------------------------------------ 分散分析（被験者間, 1〜2要因）
  // 和が0の空間の正規直交基底（Helmert 型、k × (k−1)）。ベイズの分散分析で水準を対称に扱うために使う
  function helmertQ(k) {
    const Q = Array.from({ length: k }, () => new Array(k - 1).fill(0));
    for (let j = 1; j < k; j++) {
      const norm = Math.sqrt(j + j * j);
      for (let i = 0; i < j; i++) Q[i][j - 1] = 1 / norm;
      Q[j][j - 1] = -j / norm;
    }
    return Q;
  }
  function centerCols(X) {
    const m = X[0].map((_, j) => S.mean(X.map(r => r[j])));
    return X.map(r => r.map((v, j) => v - m[j]));
  }
  // 効果コーディングの一般線形モデルで平方和 Type III を求める
  function effectCodes(levels, value) {
    const k = levels.length, j = levels.indexOf(value);
    return Array.from({ length: k - 1 }, (_, c) => (j === k - 1 ? -1 : j === c ? 1 : 0));
  }
  function posthocTable(title, comps, o, k, dfE, note2) {
    const ps = comps.map(c => S.ptTwo(c.t, dfE));
    const bonf = S.adjust(ps, 'bonferroni'), holm = S.adjust(ps, 'holm');
    const rows = comps.map((c, i) => ({
      a: c.a, b: c.b, md: c.md, se: c.se, t: c.t, d: c.d,
      tukey: 1 - S.ptukey(Math.abs(c.t) * Math.SQRT2, k, dfE), bonf: bonf[i], holm: holm[i],
    }));
    const cols = [{ key: 'a', label: '', fmt: 'text' }, { key: 'b', label: '', fmt: 'text' }, { key: 'md', label: '平均値の差' }, { key: 'se', label: 'SE' }, { key: 't', label: 't' }];
    if (o.phEffect) cols.push({ key: 'd', label: 'Cohen の d' });
    if (o.phTukey) cols.push({ key: 'tukey', label: 'p（Tukey）', fmt: 'p' });
    if (o.phBonf) cols.push({ key: 'bonf', label: 'p（Bonferroni）', fmt: 'p' });
    if (o.phHolm) cols.push({ key: 'holm', label: 'p（Holm）', fmt: 'p' });
    return table(title, cols, rows, clean([`誤差項の自由度は ${dfE} です。`, note2]));
  }
  A.push({
    id: 'anova', group: '分散分析', title: '分散分析（被験者間）',
    slots: [
      { key: 'dv', label: '従属変数', multi: false, types: ['scale', 'ordinal'] },
      { key: 'factors', label: '要因（固定, 2つまで）', multi: true, max: 2, types: ['nominal', 'ordinal'] },
    ],
    options: [
      { type: 'heading', label: '効果量' },
      { type: 'check', key: 'eta', label: 'η²', def: true },
      { type: 'check', key: 'peta', label: '偏 η²', def: false },
      { type: 'check', key: 'omega', label: 'ω²', def: false },
      { type: 'heading', label: '表示' },
      { type: 'check', key: 'desc', label: 'セルごとの記述統計', def: false },
      { type: 'check', key: 'levene', label: '等分散性の検定（Levene）', def: false },
      { type: 'check', key: 'welch', label: 'Welch の分散分析（1要因のとき）', def: false },
      { type: 'check', key: 'kw', label: 'Kruskal-Wallis 検定（1要因のとき）', def: false },
      { type: 'heading', label: '事後検定（各要因の水準間）' },
      { type: 'check', key: 'posthoc', label: '事後検定を行う', def: false },
      { type: 'check', key: 'phTukey', label: 'Tukey', def: true },
      { type: 'check', key: 'phBonf', label: 'Bonferroni', def: false },
      { type: 'check', key: 'phHolm', label: 'Holm', def: false },
      { type: 'check', key: 'phEffect', label: '効果量（Cohen の d）', def: false },
      ...bayesOptions('事前分布の幅（固定効果の r）', 0.5),
      { type: 'heading', label: '図' },
      { type: 'check', key: 'plot', label: '平均値と信頼区間の図', def: false },
      { type: 'check', key: 'rain', label: '雨雲プロット', def: false },
      { type: 'number', key: 'ciLevel', label: '信頼水準 %', def: 95, min: 50, max: 99.9, step: 0.1 },
    ],
    run(ds, sel, o) {
      if (!sel.dv.length || !sel.factors.length) return [];
      const y = col(ds, sel.dv[0]), fs = sel.factors.map(n => col(ds, n));
      const idx = D.complete(ds, [y, ...fs]);
      const lvls = fs.map(f => levelsIn(f, idx));
      const out = [];
      if (lvls.some(l => l.length < 2)) return [err('各要因に2つ以上の水準が必要です。')];
      const yv = vals(y, idx), N = yv.length;
      // セル
      const cellKey = i => fs.map(f => f.raw[i]).join('\u0001');
      const cells = new Map();
      idx.forEach((i, r) => { const k = cellKey(i); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(yv[r]); });
      const nCells = lvls.reduce((a, l) => a * l.length, 1);
      if (cells.size < nCells) return [err(`空のセルがあります（${nCells} セル中 ${cells.size} セルにデータ）。すべての水準の組み合わせにデータが必要です。`)];
      // 計画行列
      const terms = fs.map((f, t) => ({ name: f.name, cols: [] }));
      if (fs.length === 2) terms.push({ name: `${fs[0].name} ✻ ${fs[1].name}`, cols: [] });
      const X = idx.map(i => {
        const row = [1];
        const codes = fs.map((f, t) => effectCodes(lvls[t], f.raw[i]));
        codes.forEach((c, t) => { terms[t].cols = c.map((_, j) => row.length + j); row.push(...c); });
        if (fs.length === 2) {
          const start = row.length, inter = [];
          for (const a of codes[0]) for (const b of codes[1]) inter.push(a * b);
          terms[2].cols = inter.map((_, j) => start + j); row.push(...inter);
        }
        return row;
      });
      const full = S.ols(X, yv);
      if (!full) return [err('モデルを推定できませんでした（計画行列が特異）。')];
      const dfE = full.dfResid, mse = full.sse / dfE;
      if (dfE < 1) return [err('誤差の自由度が0です。データが少なすぎます。')];
      const gm = S.mean(yv); let sst = 0; for (const v of yv) sst += (v - gm) ** 2;
      const rows = [];
      for (const t of terms) {
        const keep = X[0].map((_, j) => j).filter(j => !t.cols.includes(j));
        const red = S.ols(X.map(r => keep.map(j => r[j])), yv);
        const ss = red.sse - full.sse, df = t.cols.length, F = (ss / df) / mse;
        rows.push({ term: t.name, ss, df, ms: ss / df, F, p: S.pfUpper(F, df, dfE),
          eta: ss / sst, peta: ss / (ss + full.sse), omega: (ss - df * mse) / (sst + mse) });
      }
      rows.push({ term: '残差', ss: full.sse, df: dfE, ms: mse });
      const cols = [{ key: 'term', label: '要因', fmt: 'text' }, { key: 'ss', label: '平方和' }, { key: 'df', label: '自由度', fmt: 'df' },
        { key: 'ms', label: '平均平方' }, { key: 'F', label: 'F' }, { key: 'p', label: 'p', fmt: 'p' }];
      if (o.eta) cols.push({ key: 'eta', label: 'η²' });
      if (o.peta) cols.push({ key: 'peta', label: '偏 η²' });
      if (o.omega) cols.push({ key: 'omega', label: 'ω²' });
      // ベイズファクター：モデルどうしを比べ、効果ごとの包含ベイズファクターを主表にも載せる
      let bfTables = [];
      if (o.bf) {
        const r = priorOf(o, 0.5);
        const Qs = lvls.map(l => helmertQ(l.length));
        const blocksAll = [], Xb = idx.map(() => []);
        const addBlock = (name, rowsOf) => {
          const start = Xb[0].length, part = idx.map(rowsOf);
          part.forEach((p, i) => Xb[i].push(...p));
          blocksAll.push({ name, cols: part[0].map((_, j) => start + j) });
        };
        fs.forEach((f, t) => addBlock(f.name, i => Qs[t][lvls[t].indexOf(f.raw[i])]));
        if (fs.length === 2) addBlock(terms[2].name, i => {
          const a = Qs[0][lvls[0].indexOf(fs[0].raw[i])], b = Qs[1][lvls[1].indexOf(fs[1].raw[i])];
          return a.flatMap(u => b.map(v => u * v));
        });
        const Xc = centerCols(Xb), yc = yv.map(v => v - gm);
        // 主効果のない交互作用モデルは考えない（周辺性の原則）
        const sets = fs.length === 1 ? [[], [0]] : [[], [0], [1], [0, 1], [0, 1, 2]];
        const models = sets.map(set => {
          if (!set.length) return { set, name: '帰無モデル', lbf: 0 };
          const cols = set.flatMap(j => blocksAll[j].cols);
          const X = Xc.map(row => cols.map(c => row[c]));
          let off = 0;
          const blocks = set.map(j => { const bl = { cols: blocksAll[j].cols.map((_, q) => off + q), r }; off += blocksAll[j].cols.length; return bl; });
          return { set, name: set.map(j => blocksAll[j].name).join(' + '), lbf: S.logBfGLM(X, yc, blocks) };
        });
        const lz = S.logSumExp(models.map(m => m.lbf)), pm = 1 / models.length;
        const mrows = models.map(m => {
          const post = Math.exp(m.lbf - lz);
          const row = { model: m.name, prior: pm, post, bfm: post / (1 - post) / (pm / (1 - pm)), ...bfCells(Math.exp(m.lbf), o) };
          if (!m.set.length) row.ev = '（比較の基準）';
          return row;
        });
        // 包含ベイズファクター：その項を含むモデル全体と含まないモデル全体の事後オッズ ÷ 事前オッズ
        blocksAll.forEach((bl, j) => {
          const inc = models.filter(m => m.set.includes(j)), exc = models.filter(m => !m.set.includes(j));
          const po = S.sum(inc.map(m => Math.exp(m.lbf - lz))) / S.sum(exc.map(m => Math.exp(m.lbf - lz)));
          const bfi = po / (inc.length / exc.length);
          Object.assign(rows[j], { bf: bfShow(bfi, o), ev: bfEvidence(bfi) });
        });
        cols.push({ key: 'bf', label: o.bfType === 'bf01' ? 'BF₀₁（包含）' : o.bfType === 'log' ? 'log(BF包含)' : 'BF包含' }, { key: 'ev', label: '証拠の強さ', fmt: 'text' });
        bfTables.push(table('ベイズファクター（モデル比較）', [{ key: 'model', label: 'モデル', fmt: 'text' }, { key: 'prior', label: 'P(M)' }, { key: 'post', label: 'P(M | データ)' },
          { key: 'bfm', label: 'BF_M' }, { key: 'bf', label: bfLabel(o) + '（帰無モデルと比較）' }, { key: 'ev', label: '証拠の強さ', fmt: 'text' }], mrows,
        ['どのモデルも事前確率は等しいとしています。BF_M はそのモデルの事前オッズが事後オッズに何倍変わったかです。',
          '主表の「BF包含」は、その効果を含むモデル全体と含まないモデル全体を比べたベイズファクターです。',
          bfNote(o, `効果の大きさに JZS 事前分布（固定効果の幅 r = ${r}；Rouder et al., 2012）`)]));
      }
      out.push(table(`分散分析 — ${y.name}`, cols, rows, clean(['平方和は Type III です。', excluded(ds, idx)])));
      out.push(...bfTables);

      // 1要因の補足
      const oneF = fs.length === 1;
      const byLevel = lvls[0].map(l => yv.filter((v, r) => fs[0].raw[idx[r]] === l));
      if (oneF && o.welch) {
        const k = byLevel.length;
        const w = byLevel.map(g => g.length / S.variance(g)), Wt = S.sum(w);
        const ms = byLevel.map(S.mean), mstar = S.sum(ms.map((m, i) => w[i] * m)) / Wt;
        const Aa = S.sum(ms.map((m, i) => w[i] * (m - mstar) ** 2)) / (k - 1);
        const tmp = S.sum(w.map((wi, i) => (1 - wi / Wt) ** 2 / (byLevel[i].length - 1)));
        const F = Aa / (1 + 2 * (k - 2) / (k * k - 1) * tmp), df2 = (k * k - 1) / (3 * tmp);
        out.push(table('Welch の分散分析', [{ key: 'term', label: '要因', fmt: 'text' }, { key: 'F', label: 'F' }, { key: 'df1', label: '自由度1', fmt: 'df' }, { key: 'df2', label: '自由度2', fmt: 'df' }, { key: 'p', label: 'p', fmt: 'p' }],
          [{ term: fs[0].name, F, df1: k - 1, df2, p: S.pfUpper(F, k - 1, df2) }], ['等分散を仮定しない検定です。']));
      }
      if (oneF && o.kw) {
        const rk = S.rank(yv), k = byLevel.length;
        let H = 0;
        lvls[0].forEach(l => {
          const rr = rk.ranks.filter((_, r) => fs[0].raw[idx[r]] === l);
          H += S.sum(rr) ** 2 / rr.length;
        });
        H = 12 / (N * (N + 1)) * H - 3 * (N + 1);
        const C = 1 - rk.ties.reduce((s, t) => s + t ** 3 - t, 0) / (N ** 3 - N);
        H /= C;
        out.push(table('Kruskal-Wallis 検定', [{ key: 'term', label: '要因', fmt: 'text' }, { key: 'H', label: 'H（χ²）' }, { key: 'df', label: '自由度', fmt: 'df' }, { key: 'p', label: 'p', fmt: 'p' }],
          [{ term: fs[0].name, H, df: k - 1, p: S.pchisqUpper(H, k - 1) }], ['同順位の補正をしています。']));
      }
      const lv = level(o);
      const cellList = [];
      const combos = fs.length === 1 ? lvls[0].map(a => [a]) : lvls[0].flatMap(a => lvls[1].map(b => [a, b]));
      for (const cmb of combos) {
        const v = cells.get(cmb.join('\u0001')) || [];
        const [lo, hi] = meanCI(v, lv);
        cellList.push({ f1: cmb[0], f2: cmb[1], n: v.length, mean: S.mean(v), sd: S.sd(v), se: S.sd(v) / Math.sqrt(v.length), lo, hi });
      }
      if (o.desc) {
        const c = [{ key: 'f1', label: fs[0].name, fmt: 'text' }];
        if (fs.length === 2) c.push({ key: 'f2', label: fs[1].name, fmt: 'text' });
        c.push({ key: 'n', label: 'N', fmt: 'int' }, { key: 'mean', label: '平均値' }, { key: 'sd', label: '標準偏差' }, { key: 'se', label: '標準誤差' });
        out.push(table(`記述統計 — ${y.name}`, c, cellList));
      }
      if (o.levene) {
        const L = S.levene([...cells.values()]);
        if (L) out.push(table('等分散性の検定（Levene）', [{ key: 'F', label: 'F' }, { key: 'df1', label: '自由度1', fmt: 'df' }, { key: 'df2', label: '自由度2', fmt: 'df' }, { key: 'p', label: 'p', fmt: 'p' }],
          [{ F: L.F, df1: L.df1, df2: L.df2, p: L.p }], ['セルごとの平均からの絶対偏差を使っています。']));
      }
      if (o.posthoc) {
        // 推定周辺平均（他の要因の水準を等しく重みづけ）の対比較
        fs.forEach((f, t) => {
          const L = lvls[t], other = fs.length === 2 ? lvls[1 - t] : [null];
          const nb = other.length;
          const cellOf = (a, b) => cells.get((fs.length === 1 ? [a] : t === 0 ? [a, b] : [b, a]).join('\u0001'));
          const emm = L.map(a => S.mean(other.map(b => S.mean(cellOf(a, b)))));
          const inv = L.map(a => S.sum(other.map(b => 1 / cellOf(a, b).length)));
          const comps = [];
          for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
            const md = emm[i] - emm[j], se = Math.sqrt(mse / (nb * nb) * (inv[i] + inv[j]));
            comps.push({ a: L[i], b: L[j], md, se, t: md / se, d: md / Math.sqrt(mse) });
          }
          out.push(posthocTable(`事後検定 — ${f.name}`, comps, o, L.length, dfE,
            fs.length === 2 ? 'もう一方の要因の水準を等しく重みづけた推定周辺平均を比べています。' : null));
        });
      }
      if (o.plot) {
        const xs = lvls[0], ser = fs.length === 2 ? lvls[1] : [''];
        const pc = cellList.map(c => ({ x: xs.indexOf(c.f1), s: fs.length === 2 ? ser.indexOf(c.f2) : 0, m: c.mean, lo: c.lo, hi: c.hi }));
        out.push(plot(`平均値 — ${y.name}`, P.means(xs, ser, pc, fs[0].name, y.name)));
      }
      if (o.rain) {
        const xs = lvls[0], ser = fs.length === 2 ? lvls[1] : [''];
        const gs = combos.map(cmb => ({ x: xs.indexOf(cmb[0]), s: fs.length === 2 ? ser.indexOf(cmb[1]) : 0, v: cells.get(cmb.join('\u0001')) || [] }));
        out.push(plot(`雨雲プロット — ${y.name}`, P.raincloud(gs, xs, ser, fs[0].name, y.name)), note(RAIN_NOTE));
      }
      return out;
    },
  });

  // ------------------------------------------------------------ 反復測定の分散分析（1要因）
  A.push({
    id: 'rmanova', group: '分散分析', title: '反復測定の分散分析（1要因）',
    slots: [{ key: 'vars', label: '反復測定の水準（列を2つ以上）', multi: true, types: ['scale', 'ordinal'] }],
    options: [
      { type: 'heading', label: '球面性' },
      { type: 'check', key: 'mauchly', label: 'Mauchly の球面性検定', def: false },
      { type: 'check', key: 'gg', label: 'Greenhouse-Geisser の補正', def: false },
      { type: 'check', key: 'hf', label: 'Huynh-Feldt の補正', def: false },
      { type: 'heading', label: '効果量' },
      { type: 'check', key: 'eta', label: 'η²', def: true },
      { type: 'check', key: 'peta', label: '偏 η²', def: false },
      { type: 'heading', label: '表示' },
      { type: 'check', key: 'desc', label: '記述統計', def: false },
      { type: 'check', key: 'friedman', label: 'Friedman 検定', def: false },
      ...bayesOptions('事前分布の幅（固定効果の r）', 0.5),
      { type: 'heading', label: '事後検定（対応のある t 検定）' },
      { type: 'check', key: 'posthoc', label: '事後検定を行う', def: false },
      { type: 'check', key: 'phHolm', label: 'Holm', def: true },
      { type: 'check', key: 'phBonf', label: 'Bonferroni', def: false },
      { type: 'heading', label: '図' },
      { type: 'check', key: 'plot', label: '平均値と信頼区間の図', def: false },
      { type: 'check', key: 'rain', label: '雨雲プロット', def: false },
      { type: 'number', key: 'ciLevel', label: '信頼水準 %', def: 95, min: 50, max: 99.9, step: 0.1 },
    ],
    run(ds, sel, o) {
      if (sel.vars.length < 2) return sel.vars.length ? [note('水準にあたる列を2つ以上入れてください。')] : [];
      const cs = sel.vars.map(n => col(ds, n)), idx = D.complete(ds, cs);
      const k = cs.length, n = idx.length;
      if (n < 2) return [err('すべての列がそろった行が2行未満です。')];
      const Y = idx.map(i => cs.map(c => c.nums[i]));
      const all = Y.flat(), gm = S.mean(all);
      const cm = cs.map((_, j) => S.mean(Y.map(r => r[j]))), sm = Y.map(r => S.mean(r));
      let sst = 0; for (const v of all) sst += (v - gm) ** 2;
      const ssc = n * S.sum(cm.map(m => (m - gm) ** 2)), sss = k * S.sum(sm.map(m => (m - gm) ** 2));
      const sse = sst - ssc - sss, df1 = k - 1, df2 = (k - 1) * (n - 1);
      const F = (ssc / df1) / (sse / df2);
      // 球面性：正規直交対比で共分散行列を変換
      const C = []; // Helmert 型の正規直交対比 k × (k-1)
      for (let j = 1; j < k; j++) {
        const v = new Array(k).fill(0);
        for (let i = 0; i < j; i++) v[i] = 1; v[j] = -j;
        const norm = Math.sqrt(j + j * j); C.push(v.map(x => x / norm));
      }
      const cov = cs.map((_, a) => cs.map((_, b) => {
        let s = 0; for (const r of Y) s += (r[a] - cm[a]) * (r[b] - cm[b]); return s / (n - 1);
      }));
      const M = C.map(u => C.map(v => { let s = 0; for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) s += u[a] * cov[a][b] * v[b]; return s; }));
      const p = k - 1, tr = M.reduce((s, r, i) => s + r[i], 0);
      let tr2 = 0; for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) tr2 += M[i][j] * M[j][i];
      const gg = tr * tr / (p * tr2);
      const hf = Math.min(1, (n * p * gg - 2) / (p * (n - 1 - p * gg)));
      const rows = [], name = '反復測定';
      const eta = ssc / sst, peta = ssc / (ssc + sse);
      const addRow = (label, eps) => rows.push({ term: name, corr: label, ss: ssc, df: df1 * eps, ms: ssc / (df1 * eps), F, p: S.pfUpper(F, df1 * eps, df2 * eps), eta, peta, _e: eps });
      addRow('なし', 1);
      if (o.gg) addRow('Greenhouse-Geisser', gg);
      if (o.hf) addRow('Huynh-Feldt', hf);
      const resid = [{ term: '残差', corr: 'なし', ss: sse, df: df2, ms: sse / df2 }];
      if (o.gg) resid.push({ term: '残差', corr: 'Greenhouse-Geisser', ss: sse, df: df2 * gg, ms: sse / (df2 * gg) });
      if (o.hf) resid.push({ term: '残差', corr: 'Huynh-Feldt', ss: sse, df: df2 * hf, ms: sse / (df2 * hf) });
      const cols = [{ key: 'term', label: '要因', fmt: 'text' }, { key: 'corr', label: '球面性の補正', fmt: 'text' }, { key: 'ss', label: '平方和' }, { key: 'df', label: '自由度', fmt: 'df' },
        { key: 'ms', label: '平均平方' }, { key: 'F', label: 'F' }, { key: 'p', label: 'p', fmt: 'p' }];
      if (o.eta) cols.push({ key: 'eta', label: 'η²' });
      if (o.peta) cols.push({ key: 'peta', label: '偏 η²' });
      // ベイズファクター：被験者＋条件のモデルと被験者だけのモデルの比（球面性の補正には左右されないので1行目だけ）
      let bfN = null;
      if (o.bf) {
        const r = priorOf(o, 0.5);
        Object.assign(rows[0], bfCells(S.bfRM(n, k, sss, ssc, sst, r, 1), o));
        cols.push(...bfCols(o));
        bfN = bfNote(o, `条件の効果に JZS 事前分布（固定効果の幅 r = ${r}）、被験者の効果は変量（幅 1）。H₀ は被験者の効果だけのモデル。球面性の補正とは無関係なので「なし」の行にだけ示します`);
      }
      const out = [table('被験者内効果', cols, rows.concat(resid), clean([`水準: ${sel.vars.join(', ')}`, excluded(ds, idx),
        o.eta ? 'η² の分母は全平方和（被験者間の平方和を含む）です。' : null, bfN]))];
      out.push(table('被験者間効果', [{ key: 'term', label: '要因', fmt: 'text' }, { key: 'ss', label: '平方和' }, { key: 'df', label: '自由度', fmt: 'df' }, { key: 'ms', label: '平均平方' }],
        [{ term: '残差（被験者）', ss: sss, df: n - 1, ms: sss / (n - 1) }]));
      if (o.mauchly) {
        if (k < 3) out.push(note('水準が2つのときは球面性の仮定は常に満たされます。'));
        else if (n <= p) out.push(err('Mauchly の検定には水準数より多い被験者が必要です。'));
        else {
          const Wm = S.det(M) / Math.pow(tr / p, p);
          const d = 1 - (2 * p * p + p + 2) / (6 * p * (n - 1));
          const chi = -(n - 1) * d * Math.log(Wm), dfc = p * (p + 1) / 2 - 1;
          out.push(table('球面性の検定', [{ key: 'term', label: '', fmt: 'text' }, { key: 'W', label: 'Mauchly の W' }, { key: 'chi', label: 'χ²' }, { key: 'df', label: '自由度', fmt: 'df' }, { key: 'p', label: 'p', fmt: 'p' },
            { key: 'gg', label: 'GG ε' }, { key: 'hf', label: 'HF ε' }], [{ term: name, W: Wm, chi, df: dfc, p: S.pchisqUpper(chi, dfc), gg, hf }]));
        }
      }
      const lv = level(o);
      const desc = cs.map((c, j) => { const v = Y.map(r => r[j]); const [lo, hi] = meanCI(v, lv); return { var: c.name, n, mean: cm[j], sd: S.sd(v), se: S.sd(v) / Math.sqrt(n), lo, hi }; });
      if (o.desc) out.push(table('記述統計', [{ key: 'var', label: '水準', fmt: 'text' }, { key: 'n', label: 'N', fmt: 'int' }, { key: 'mean', label: '平均値' }, { key: 'sd', label: '標準偏差' }, { key: 'se', label: '標準誤差' }], desc));
      if (o.friedman) {
        let sr = new Array(k).fill(0), tieSum = 0;
        for (const r of Y) { const rk = S.rank(r); rk.ranks.forEach((v, j) => { sr[j] += v; }); tieSum += rk.ties.reduce((s, t) => s + t ** 3 - t, 0); }
        const chi = (12 * S.sum(sr.map(v => v * v)) - 3 * n * n * k * (k + 1) ** 2) / (n * k * (k + 1) - tieSum / (k - 1));
        out.push(table('Friedman 検定', [{ key: 'term', label: '要因', fmt: 'text' }, { key: 'chi', label: 'χ²' }, { key: 'df', label: '自由度', fmt: 'df' }, { key: 'p', label: 'p', fmt: 'p' }, { key: 'w', label: 'Kendall の W' }],
          [{ term: name, chi, df: k - 1, p: S.pchisqUpper(chi, k - 1), w: chi / (n * (k - 1)) }], ['同順位の補正をしています。']));
      }
      if (o.posthoc) {
        const comps = [];
        for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) {
          const d = Y.map(r => r[a] - r[b]), md = S.mean(d), se = S.sd(d) / Math.sqrt(n), t = md / se;
          comps.push({ a: cs[a].name, b: cs[b].name, md, se, t, df: n - 1, p: S.ptTwo(t, n - 1) });
        }
        const ps = comps.map(c => c.p), holm = S.adjust(ps, 'holm'), bonf = S.adjust(ps, 'bonferroni');
        comps.forEach((c, i) => { c.holm = holm[i]; c.bonf = bonf[i]; });
        const cc = [{ key: 'a', label: '', fmt: 'text' }, { key: 'b', label: '', fmt: 'text' }, { key: 'md', label: '平均値の差' }, { key: 'se', label: 'SE' }, { key: 't', label: 't' }, { key: 'df', label: '自由度', fmt: 'df' }];
        if (o.phHolm) cc.push({ key: 'holm', label: 'p（Holm）', fmt: 'p' });
        if (o.phBonf) cc.push({ key: 'bonf', label: 'p（Bonferroni）', fmt: 'p' });
        out.push(table('事後検定', cc, comps, ['各対を対応のある t 検定で比べ、p 値を補正しています。']));
      }
      if (o.plot) out.push(plot('平均値', P.means(cs.map(c => c.name), [''], desc.map((d, j) => ({ x: j, s: 0, m: d.mean, lo: d.lo, hi: d.hi })), '', '平均値')));
      if (o.rain) out.push(plot('雨雲プロット', P.raincloud(cs.map((c, j) => ({ x: j, s: 0, v: Y.map(r => r[j]) })), cs.map(c => c.name), [''], '', '値', { paired: true })),
        note(RAIN_NOTE + '灰色の線は同じ人の隣り合う水準の値をつないでいます。'));
      return out;
    },
  });

  // ------------------------------------------------------------ 相関
  A.push({
    id: 'correlation', group: '相関・回帰', title: '相関',
    slots: [{ key: 'vars', label: '変数（2つ以上）', multi: true, types: ['scale', 'ordinal'] }],
    options: [
      { type: 'heading', label: '相関係数' },
      { type: 'check', key: 'pearson', label: 'Pearson の r', def: true },
      { type: 'check', key: 'spearman', label: 'Spearman の ρ', def: false },
      { type: 'check', key: 'kendall', label: 'Kendall の τb', def: false },
      { type: 'heading', label: '表示' },
      { type: 'radio', key: 'layout', options: [['matrix', '相関行列'], ['pairs', 'ペアごとの一覧']], def: 'matrix' },
      { type: 'check', key: 'sig', label: 'p 値', def: true },
      { type: 'check', key: 'n', label: 'N', def: false },
      { type: 'check', key: 'ci', label: '信頼区間（Pearson）', def: false },
      { type: 'number', key: 'ciLevel', label: '信頼水準 %', def: 95, min: 50, max: 99.9, step: 0.1 },
      { type: 'check', key: 'flag', label: '有意な相関に印をつける', def: false },
      ...bayesOptions('事前分布の幅（伸長ベータの κ）', 1),
      { type: 'heading', label: '図' },
      { type: 'check', key: 'scatter', label: '散布図', def: false },
    ],
    run(ds, sel, o) {
      if (sel.vars.length < 2) return sel.vars.length ? [note('変数を2つ以上入れてください。')] : [];
      const cs = sel.vars.map(n => col(ds, n)), lv = level(o);
      const methods = [];
      if (o.pearson) methods.push(['pearson', 'Pearson の r']);
      if (o.spearman) methods.push(['spearman', 'Spearman の ρ']);
      if (o.kendall) methods.push(['kendall', 'Kendall の τb']);
      if (!methods.length) return [note('相関係数を1つ以上選んでください。')];
      const res = {};
      const pairs = [];
      for (let a = 0; a < cs.length; a++) for (let b = a + 1; b < cs.length; b++) {
        const idx = D.complete(ds, [cs[a], cs[b]]), x = vals(cs[a], idx), y = vals(cs[b], idx), n = x.length;
        const r = { n, a: cs[a].name, b: cs[b].name, x, y };
        if (n >= 3) {
          const rp = S.pearson(x, y); r.pearson = rp; r.pearsonP = S.corTest(rp, n).p; [r.lo, r.hi] = S.fisherCI(rp, n, lv);
          if (o.bf && o.pearson) { const bf = S.bfCor(rp, n, priorOf(o, 1)); r.bfv = bfShow(bf, o); r.ev = bfEvidence(bf); }
          const rs = S.spearman(x, y); r.spearman = rs; r.spearmanP = S.corTest(rs, n).p;
          if (o.kendall) { const k = S.kendall(x, y); r.kendall = k.tau; r.kendallP = k.p; }
        }
        res[`${a},${b}`] = r; pairs.push(r);
      }
      const star = p => !o.flag || !isFinite(p) ? '' : p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : '';
      const out = [];
      const notes = clean([
        '欠損値はペアごとに除外しています。',
        o.flag ? '* p < .05, ** p < .01, *** p < .001' : null,
        o.spearman && o.sig ? 'Spearman の p は t 分布による近似です。' : null,
        o.kendall && o.sig ? 'Kendall の p は、同順位がなく n < 50 なら正確な分布、そうでなければ正規近似です。' : null,
        o.ci ? 'Pearson の信頼区間は Fisher の z 変換によります。' : null,
        o.bf && o.pearson ? bfNote(o, `相関係数 ρ に幅 κ = ${priorOf(o, 1)} の伸長ベータ分布（κ = 1 は −1〜1 の一様分布）。r の正確な尤度を使っています（Ly et al., 2016）。Pearson の相関にだけ示します`) : null,
        o.bf && !o.pearson ? 'ベイズファクターは Pearson の相関にだけ示します。Pearson の r を選んでください。' : null,
      ]);
      if (o.layout === 'pairs') {
        const cols = [{ key: 'a', label: '', fmt: 'text' }, { key: 'dash', label: '', fmt: 'text' }, { key: 'b', label: '', fmt: 'text' }];
        if (o.n) cols.push({ key: 'n', label: 'N', fmt: 'int' });
        for (const [m, l] of methods) {
          cols.push({ key: m, label: l, group: l, fmt: o.flag ? 'star' : 'num' });
          if (o.sig) cols.push({ key: `${m}P`, label: 'p', group: l, fmt: 'p' });
          if (m === 'pearson' && o.ci) cols.push({ key: 'lo', label: '下限', group: l }, { key: 'hi', label: '上限', group: l });
          if (m === 'pearson' && o.bf) cols.push({ key: 'bfv', label: bfLabel(o), group: l }, { key: 'ev', label: '証拠の強さ', group: l, fmt: 'text' });
        }
        out.push(table('相関', cols, pairs.map(r => {
          const row = { ...r, dash: '—' };
          for (const [m] of methods) row[m] = o.flag ? { v: r[m], s: star(r[`${m}P`]) } : r[m];
          return row;
        }), notes));
      } else {
        const cols = [{ key: 'var', label: '変数', fmt: 'text' }, { key: 'stat', label: '', fmt: 'text' }];
        cs.forEach((c, j) => cols.push({ key: `c${j}`, label: c.name, fmt: 'cell' }));
        const rows = [];
        cs.forEach((c, i) => {
          const push = (label, fn) => {
            const first = !(rows.length && rows[rows.length - 1]._v === i);
            const row = { var: first ? c.name : '', stat: label, _v: i, _sep: first && i > 0 };
            cs.forEach((_, j) => { row[`c${j}`] = j >= i ? { t: j === i && first ? '—' : '' } : fn(res[`${j},${i}`]); });
            rows.push(row);
          };
          for (const [m, l] of methods) {
            push(l, r => ({ v: r[m], s: star(r[`${m}P`]) }));
            if (o.sig) push('p', r => ({ p: r[`${m}P`] }));
            if (m === 'pearson' && o.ci) { push('下限', r => ({ v: r.lo })); push('上限', r => ({ v: r.hi })); }
            if (m === 'pearson' && o.bf) push(bfLabel(o), r => ({ v: r.bfv }));
          }
          if (o.n) push('N', r => ({ i: r.n }));
        });
        out.push(table('相関行列', cols, rows, notes));
      }
      if (o.scatter) {
        if (pairs.length > 15) out.push(note('散布図は最初の15組だけを示します。'));
        for (const r of pairs.slice(0, 15)) out.push(plot(`散布図 — ${r.a} と ${r.b}`, P.scatter(r.x, r.y, r.a, r.b, true)));
      }
      return out;
    },
  });

  // ------------------------------------------------------------ 線形回帰
  A.push({
    id: 'regression', group: '相関・回帰', title: '線形回帰',
    slots: [
      { key: 'dv', label: '従属変数', multi: false, types: ['scale', 'ordinal'] },
      { key: 'covs', label: '説明変数（量的）', multi: true, types: ['scale', 'ordinal'], optional: true },
      { key: 'factors', label: '説明変数（カテゴリ）', multi: true, types: ['nominal', 'ordinal'], optional: true },
    ],
    options: [
      { type: 'heading', label: '係数' },
      { type: 'check', key: 'ci', label: '信頼区間', def: true },
      { type: 'number', key: 'ciLevel', label: '信頼水準 %', def: 95, min: 50, max: 99.9, step: 0.1 },
      { type: 'check', key: 'beta', label: '標準化係数 β', def: true },
      { type: 'check', key: 'vif', label: '多重共線性（VIF・許容度）', def: false },
      { type: 'heading', label: 'モデル' },
      { type: 'check', key: 'anova', label: '分散分析表', def: true },
      { type: 'check', key: 'dw', label: 'Durbin-Watson 比', def: false },
      { type: 'check', key: 'desc', label: '記述統計', def: false },
      ...bayesOptions('事前分布の幅（JZS の r）', 0.354),
      { type: 'heading', label: '残差の図' },
      { type: 'check', key: 'residPlot', label: '残差と予測値の散布図', def: false },
      { type: 'check', key: 'qq', label: '残差の Q-Q プロット', def: false },
    ],
    run(ds, sel, o) {
      if (!sel.dv.length || (!sel.covs.length && !sel.factors.length)) return [];
      const y = col(ds, sel.dv[0]), xs = sel.covs.map(n => col(ds, n)), fs = sel.factors.map(n => col(ds, n));
      if ([...sel.covs, ...sel.factors].includes(y.name)) return [err('従属変数を説明変数にも入れています。')];
      const idx = D.complete(ds, [y, ...xs, ...fs]);
      const yv = vals(y, idx), n = yv.length;
      const flv = fs.map(f => levelsIn(f, idx));
      const names = ['（切片）'], kinds = [null];
      xs.forEach(c => { names.push(c.name); kinds.push(c); });
      fs.forEach((f, t) => flv[t].slice(1).forEach(l => { names.push(`${f.name} (${l})`); kinds.push(null); }));
      const X = idx.map((i, r) => {
        const row = [1];
        xs.forEach(c => row.push(c.nums[i]));
        fs.forEach((f, t) => flv[t].slice(1).forEach(l => row.push(f.raw[i] === l ? 1 : 0)));
        return row;
      });
      const p = names.length;
      if (n <= p) return [err(`データ（${n} 行）が推定する係数の数（${p}）以下です。`)];
      const fit = S.ols(X, yv);
      if (!fit) return [err('係数を推定できませんでした。説明変数どうしが完全に相関している可能性があります。')];
      const my = S.mean(yv); let sst = 0; for (const v of yv) sst += (v - my) ** 2;
      const ssr = sst - fit.sse, dfR = p - 1, dfE = fit.dfResid, mse = fit.sse / dfE;
      const R2 = ssr / sst, adj = 1 - (1 - R2) * (n - 1) / dfE;
      const out = [];
      const fitRow = { R: Math.sqrt(Math.max(0, R2)), R2, adj, rmse: Math.sqrt(mse) };
      if (o.dw) { let s = 0; for (let i = 1; i < n; i++) s += (fit.resid[i] - fit.resid[i - 1]) ** 2; fitRow.dw = s / fit.sse; }
      const fc = [{ key: 'R', label: 'R' }, { key: 'R2', label: 'R²' }, { key: 'adj', label: '調整済み R²' }, { key: 'rmse', label: 'RMSE' }];
      if (o.dw) fc.push({ key: 'dw', label: 'Durbin-Watson' });
      // ベイズファクター（Zellner-Siow 事前分布）：モデル全体は切片だけのモデルと、
      // 各説明変数はその変数（カテゴリ変数ならダミー変数一式）を除いたモデルと比べる
      const rReg = priorOf(o, Math.SQRT2 / 4);
      const bfVar = new Map();
      if (o.bf) {
        const bfFull = S.bfRegR2(n, p - 1, R2, rReg);
        Object.assign(fitRow, bfCells(bfFull, o));
        fc.push(...bfCols(o));
        const groupsOfCols = [...xs.map((c, k) => ({ key: c.name, cols: [1 + k] })),
          ...fs.map((f, t) => ({ key: f.name, cols: flv[t].slice(1).map((_, q) => 1 + xs.length + flv.slice(0, t).reduce((s, l) => s + l.length - 1, 0) + q) }))];
        for (const g of groupsOfCols) {
          const keep = X[0].map((_, j) => j).filter(j => !g.cols.includes(j));
          let bfRed = 1;
          if (keep.length > 1) {
            const red = S.ols(X.map(r => keep.map(j => r[j])), yv);
            bfRed = red ? S.bfRegR2(n, keep.length - 1, 1 - red.sse / sst, rReg) : NaN;
          }
          g.cols.forEach(c => bfVar.set(c, bfFull / bfRed));
        }
      }
      out.push(table(`モデルの要約 — ${y.name}`, fc, [fitRow], clean([excluded(ds, idx), fs.length ? `カテゴリ変数は最初の水準（${fs.map((f, t) => `${f.name} = ${flv[t][0]}`).join('、')}）を基準にしたダミー変数です。` : null,
        o.bf ? bfNote(o, `回帰係数に Zellner-Siow（JZS）事前分布（幅 r = ${+rReg.toFixed(4)}；Liang et al., 2008）。ここでは H₀ は切片だけのモデル`) : null])));
      if (o.anova) {
        const F = (ssr / dfR) / mse;
        out.push(table('分散分析', [{ key: 'src', label: '', fmt: 'text' }, { key: 'ss', label: '平方和' }, { key: 'df', label: '自由度', fmt: 'df' }, { key: 'ms', label: '平均平方' }, { key: 'F', label: 'F' }, { key: 'p', label: 'p', fmt: 'p' }],
          [{ src: '回帰', ss: ssr, df: dfR, ms: ssr / dfR, F, p: S.pfUpper(F, dfR, dfE) }, { src: '残差', ss: fit.sse, df: dfE, ms: mse }, { src: '全体', ss: sst, df: n - 1 }]));
      }
      const lv = level(o), q = S.qt(1 - (1 - lv) / 2, dfE), sdy = S.sd(yv);
      // VIF：説明変数どうしの相関行列の逆行列の対角
      let vif = null;
      if (o.vif && p > 2) {
        const Z = X.map(r => r.slice(1)), m = p - 1;
        const zc = Array.from({ length: m }, (_, j) => Z.map(r => r[j]));
        const Rm = zc.map(a => zc.map(b => S.pearson(a, b)));
        const inv = S.inverse(Rm); if (inv) vif = inv.map((r, j) => r[j]);
      }
      const rows = fit.b.map((b, j) => {
        const se = Math.sqrt(fit.inv[j][j] * mse), t = b / se;
        const row = { name: names[j], b, se, t, p: S.ptTwo(t, dfE), lo: b - q * se, hi: b + q * se };
        if (j > 0) row.beta = b * S.sd(X.map(r => r[j])) / sdy;
        if (j > 0 && o.vif) { row.vif = p === 2 ? 1 : vif ? vif[j - 1] : NaN; row.tol = 1 / row.vif; }
        if (j > 0 && o.bf) Object.assign(row, bfCells(bfVar.get(j), o));
        return row;
      });
      const cc = [{ key: 'name', label: '', fmt: 'text' }, { key: 'b', label: 'B' }, { key: 'se', label: 'SE' }];
      if (o.beta) cc.push({ key: 'beta', label: 'β' });
      cc.push({ key: 't', label: 't' }, { key: 'p', label: 'p', fmt: 'p' });
      if (o.ci) cc.push({ key: 'lo', label: '下限', group: ciLabel(o) }, { key: 'hi', label: '上限', group: ciLabel(o) });
      if (o.vif) cc.push({ key: 'tol', label: '許容度' }, { key: 'vif', label: 'VIF' });
      if (o.bf) cc.push(...bfCols(o));
      out.push(table('係数', cc, rows, clean([o.beta && fs.length ? 'ダミー変数の β は 0/1 の標準偏差で標準化した値です。' : null,
        o.bf ? `係数のベイズファクターは、すべての説明変数を含むモデルと、その変数${fs.length ? '（カテゴリ変数ならダミー変数一式）' : ''}だけを除いたモデルとの比です（H₀ = 除いたモデル）。事前分布はモデルの要約と同じです。` : null])));
      if (o.desc) {
        const dr = [y, ...xs].map(c => { const v = vals(c, idx); return { name: c.name, n: v.length, mean: S.mean(v), sd: S.sd(v), se: S.sd(v) / Math.sqrt(v.length) }; });
        out.push(table('記述統計', [{ key: 'name', label: '', fmt: 'text' }, { key: 'n', label: 'N', fmt: 'int' }, { key: 'mean', label: '平均値' }, { key: 'sd', label: '標準偏差' }, { key: 'se', label: '標準誤差' }], dr));
      }
      if (o.residPlot) out.push(plot('残差と予測値', P.scatter(fit.fitted, fit.resid, '予測値', '残差', false)));
      if (o.qq) out.push(plot('残差の Q-Q プロット', P.qq(fit.resid, '残差')));
      void kinds;
      return out;
    },
  });

  // ------------------------------------------------------------ 分割表（クロス集計）
  A.push({
    id: 'contingency', group: '度数', title: '分割表（クロス集計）',
    slots: [
      { key: 'rows', label: '行', multi: false, types: ['nominal', 'ordinal'] },
      { key: 'cols', label: '列', multi: false, types: ['nominal', 'ordinal'] },
    ],
    options: [
      { type: 'heading', label: 'セルの表示' },
      { type: 'check', key: 'expected', label: '期待度数', def: false },
      { type: 'check', key: 'rowPct', label: '行 %', def: false },
      { type: 'check', key: 'colPct', label: '列 %', def: false },
      { type: 'check', key: 'totPct', label: '全体 %', def: false },
      { type: 'check', key: 'resid', label: '調整済み標準化残差', def: false },
      { type: 'heading', label: '検定' },
      { type: 'check', key: 'chi', label: 'χ² 検定', def: true },
      { type: 'check', key: 'yates', label: '連続性の補正（2×2 のとき）', def: false },
      { type: 'check', key: 'lr', label: '尤度比 χ²（G²）', def: false },
      { type: 'check', key: 'fisher', label: 'Fisher の正確検定（2×2 のとき）', def: false },
      { type: 'heading', label: '効果量' },
      { type: 'check', key: 'cramer', label: 'Cramér の V（2×2 は φ も）', def: false },
      { type: 'check', key: 'or', label: 'オッズ比（2×2 のとき）', def: false },
      { type: 'number', key: 'ciLevel', label: '信頼水準 %', def: 95, min: 50, max: 99.9, step: 0.1 },
      ...bayesOptions('事前分布の集中度 a', 1),
    ],
    run(ds, sel, o) {
      if (!sel.rows.length || !sel.cols.length) return [];
      const rc = col(ds, sel.rows[0]), cc = col(ds, sel.cols[0]);
      if (rc === cc) return [err('行と列に同じ変数が入っています。')];
      const idx = D.complete(ds, [rc, cc]);
      const RL = levelsIn(rc, idx), CL = levelsIn(cc, idx), I = RL.length, J = CL.length, N = idx.length;
      if (I < 2 || J < 2) return [err('行・列とも2つ以上の水準が必要です。')];
      const O = RL.map(() => new Array(J).fill(0));
      for (const i of idx) O[RL.indexOf(rc.raw[i])][CL.indexOf(cc.raw[i])]++;
      const rs = O.map(r => S.sum(r)), cs = CL.map((_, j) => S.sum(O.map(r => r[j])));
      const E = O.map((r, i) => r.map((_, j) => rs[i] * cs[j] / N));
      const lines = [['count', '度数']];
      if (o.expected) lines.push(['exp', '期待度数']);
      if (o.rowPct) lines.push(['row', '行 %']);
      if (o.colPct) lines.push(['col', '列 %']);
      if (o.totPct) lines.push(['tot', '全体 %']);
      if (o.resid) lines.push(['res', '調整済み残差']);
      const fmtCell = (kind, i, j) => {
        const oo = i < I && j < J ? O[i][j] : i < I ? rs[i] : j < J ? cs[j] : N;
        const ee = i < I && j < J ? E[i][j] : oo;
        const rr = i < I ? rs[i] : N, ccc = j < J ? cs[j] : N;
        switch (kind) {
          case 'count': return { i: oo };
          case 'exp': return { v: ee, d: 2 };
          case 'row': return { pct: 100 * oo / rr };
          case 'col': return { pct: 100 * oo / ccc };
          case 'tot': return { pct: 100 * oo / N };
          case 'res': return i < I && j < J ? { v: (oo - ee) / Math.sqrt(ee * (1 - rs[i] / N) * (1 - cs[j] / N)), d: 2 } : { t: '' };
        }
      };
      const cols = [{ key: 'r', label: rc.name, fmt: 'text' }];
      if (lines.length > 1) cols.push({ key: 'k', label: '', fmt: 'text' });
      CL.forEach((l, j) => cols.push({ key: `c${j}`, label: l, fmt: 'cell', group: cc.name }));
      cols.push({ key: 'tot', label: '合計', fmt: 'cell' });
      const rows = [];
      for (let i = 0; i <= I; i++) {
        lines.forEach(([kind, label], li) => {
          const row = { r: li === 0 ? (i < I ? RL[i] : '合計') : '', k: label, _sep: li === 0 && i > 0 };
          for (let j = 0; j <= J; j++) row[j < J ? `c${j}` : 'tot'] = fmtCell(kind, i, j);
          rows.push(row);
        });
      }
      const out = [table('分割表', cols, rows, clean([excluded(ds, idx)]))];
      const minE = Math.min(...E.flat());
      const tests = [];
      let chi = 0; for (let i = 0; i < I; i++) for (let j = 0; j < J; j++) chi += (O[i][j] - E[i][j]) ** 2 / E[i][j];
      const df = (I - 1) * (J - 1);
      const is22 = I === 2 && J === 2;
      if (o.chi) tests.push({ test: 'χ²', v: chi, df, p: S.pchisqUpper(chi, df) });
      if (o.yates && is22) {
        let y2 = 0; for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) y2 += Math.max(0, Math.abs(O[i][j] - E[i][j]) - 0.5) ** 2 / E[i][j];
        tests.push({ test: 'χ²（連続性の補正）', v: y2, df, p: S.pchisqUpper(y2, df) });
      }
      if (o.lr) {
        let g = 0; for (let i = 0; i < I; i++) for (let j = 0; j < J; j++) if (O[i][j] > 0) g += 2 * O[i][j] * Math.log(O[i][j] / E[i][j]);
        tests.push({ test: '尤度比 G²', v: g, df, p: S.pchisqUpper(g, df) });
      }
      if (o.fisher && is22) { const f = S.fisher2x2(O[0][0], O[0][1], O[1][0], O[1][1]); tests.push({ test: 'Fisher の正確検定', v: null, df: null, p: f.p }); }
      const aPrior = priorOf(o, 1);
      if (o.bf) { const bf = S.bfContingency(O, aPrior); tests.push({ test: `ベイズファクター ${bfLabel(o)}`, v: bfShow(bf, o), df: null, p: null, ev: bfEvidence(bf) }); }
      const tcols = [{ key: 'test', label: '', fmt: 'text' }, { key: 'v', label: '値' }, { key: 'df', label: '自由度', fmt: 'df' }, { key: 'p', label: 'p', fmt: 'p' }];
      if (o.bf) tcols.push({ key: 'ev', label: '証拠の強さ', fmt: 'text' });
      if (tests.length) out.push(table('検定', tcols, tests,
        clean([`N = ${N}`, minE < 5 ? `期待度数が5未満のセルがあります（最小 ${minE.toFixed(2)}）。χ² 近似が不正確になるおそれがあります。${is22 ? 'Fisher の正確検定も確認してください。' : ''}` : null,
          (o.yates || o.fisher) && !is22 ? '連続性の補正と Fisher の正確検定は 2×2 の表だけで計算します。' : null,
          o.bf ? bfNote(o, `H₀ は行と列が独立。同時多項分布のもとで、セルの確率に集中度 a = ${aPrior} の Dirichlet 分布（Gunel & Dickey, 1974）`) : null])));
      if (o.cramer || (o.or && is22)) {
        const es = [];
        if (o.cramer) {
          if (is22) { const ph = (O[0][0] * O[1][1] - O[0][1] * O[1][0]) / Math.sqrt(rs[0] * rs[1] * cs[0] * cs[1]); es.push({ m: 'φ', v: ph }); }
          es.push({ m: 'Cramér の V', v: Math.sqrt(chi / (N * (Math.min(I, J) - 1))) });
        }
        if (o.or && is22) {
          const [a, b] = O[0], [c, d] = O[1];
          if (a * b * c * d > 0) {
            const lor = Math.log(a * d / (b * c)), se = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d), z = S.qnorm(1 - (1 - level(o)) / 2);
            es.push({ m: 'オッズ比', v: Math.exp(lor), lo: Math.exp(lor - z * se), hi: Math.exp(lor + z * se) });
          } else es.push({ m: 'オッズ比（0 のセルがあり計算できません）', v: NaN });
        }
        const ecols = [{ key: 'm', label: '', fmt: 'text' }, { key: 'v', label: '値' }];
        if (es.some(e => 'lo' in e)) ecols.push({ key: 'lo', label: '下限', group: ciLabel(o) }, { key: 'hi', label: '上限', group: ciLabel(o) });
        out.push(table('効果量', ecols, es, clean([o.or && is22 ? `オッズ比は (${RL[0]}, ${CL[0]}) を基準にした (a·d)/(b·c) です。信頼区間は対数オッズ比の正規近似（Woolf 法）です。` : null])));
      }
      return out;
    },
  });

  // ------------------------------------------------------------ 二項検定
  A.push({
    id: 'binomial', group: '度数', title: '二項検定',
    slots: [{ key: 'vars', label: '変数', multi: true, types: ['nominal', 'ordinal'] }],
    options: [
      { type: 'number', key: 'p0', label: '検定する比率', def: 0.5, min: 0, max: 1, step: 0.01 },
      { type: 'heading', label: '対立仮説' },
      { type: 'radio', key: 'alt', options: [['two', '両側（≠ 検定比率）'], ['greater', '片側（> 検定比率）'], ['less', '片側（< 検定比率）']], def: 'two' },
      { type: 'check', key: 'ci', label: '信頼区間（Clopper-Pearson）', def: true },
      { type: 'number', key: 'ciLevel', label: '信頼水準 %', def: 95, min: 50, max: 99.9, step: 0.1 },
      ...bayesOptions(null),
    ],
    run(ds, sel, o) {
      if (!sel.vars.length) return [];
      const p0 = Math.min(1, Math.max(0, Number(o.p0))), rows = [];
      for (const name of sel.vars) {
        const c = col(ds, name), idx = D.complete(ds, [c]), n = idx.length;
        levelsIn(c, idx).forEach((l, k) => {
          const x = idx.filter(i => c.raw[i] === l).length;
          const r = S.binomTest(x, n, p0, o.alt, level(o));
          rows.push({ var: k === 0 ? name : '', lv: l, x, n, prop: x / n, p: r.p, lo: r.lo, hi: r.hi,
            ...(o.bf && p0 > 0 && p0 < 1 ? bfCells(S.bfBinom(x, n, p0, o.alt), o) : {}) });
        });
      }
      const cols = [{ key: 'var', label: '変数', fmt: 'text' }, { key: 'lv', label: '水準', fmt: 'text' }, { key: 'x', label: '度数', fmt: 'int' }, { key: 'n', label: '合計', fmt: 'int' },
        { key: 'prop', label: '比率' }, { key: 'p', label: 'p', fmt: 'p' }];
      if (o.ci) cols.push({ key: 'lo', label: '下限', group: ciLabel(o) }, { key: 'hi', label: '上限', group: ciLabel(o) });
      if (o.bf) cols.push(...bfCols(o, o.alt));
      return [table('二項検定', cols, rows, clean([`検定する比率は ${p0} です。`, o.alt !== 'two' ? `対立仮説は片側: 比率 ${o.alt === 'greater' ? '>' : '<'} ${p0}` : null,
        o.bf ? bfNote(o, `比率に一様分布 Beta(1, 1)${o.alt !== 'two' ? '（片側は検定比率で切断）' : ''}。H₀ は比率 = ${p0}`) : null,
        o.bf && !(p0 > 0 && p0 < 1) ? 'ベイズファクターは検定する比率が 0 と 1 の間のときだけ計算します。' : null]))];
    },
  });

  // ------------------------------------------------------------ 信頼性分析
  A.push({
    id: 'reliability', group: '尺度', title: '信頼性分析（α 係数）',
    slots: [
      { key: 'items', label: '項目（2つ以上）', multi: true, types: ['scale', 'ordinal'] },
      { key: 'reverse', label: '逆転項目（上の項目のうち）', multi: true, types: ['scale', 'ordinal'], optional: true },
    ],
    options: [
      { type: 'check', key: 'std', label: '標準化 α', def: false },
      { type: 'check', key: 'meanr', label: '項目間相関の平均', def: false },
      { type: 'check', key: 'itemStats', label: '項目ごとの統計量', def: true },
      { type: 'check', key: 'scaleStats', label: '合計得点の平均・標準偏差', def: false },
    ],
    run(ds, sel, o) {
      if (sel.items.length < 2) return sel.items.length ? [note('項目を2つ以上入れてください。')] : [];
      const cs = sel.items.map(n => col(ds, n)), idx = D.complete(ds, cs), n = idx.length, k = cs.length;
      if (n < 3) return [err('すべての項目がそろった行が3行未満です。')];
      const rev = new Set(sel.reverse.filter(r => sel.items.includes(r)));
      let lo = Infinity, hi = -Infinity;
      cs.forEach(c => idx.forEach(i => { lo = Math.min(lo, c.nums[i]); hi = Math.max(hi, c.nums[i]); }));
      const items = cs.map(c => idx.map(i => (rev.has(c.name) ? lo + hi - c.nums[i] : c.nums[i])));
      const alpha = its => {
        const kk = its.length, tot = its[0].map((_, r) => S.sum(its.map(v => v[r])));
        return kk / (kk - 1) * (1 - S.sum(its.map(S.variance)) / S.variance(tot));
      };
      const R = items.map(a => items.map(b => S.pearson(a, b)));
      let rs = 0; for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) rs += R[a][b];
      const rbar = rs / (k * (k - 1) / 2);
      const total = items[0].map((_, r) => S.sum(items.map(v => v[r])));
      const sc = [{ key: 'a', label: 'Cronbach の α' }];
      const row = { a: alpha(items) };
      if (o.std) { sc.push({ key: 's', label: '標準化 α' }); row.s = k * rbar / (1 + (k - 1) * rbar); }
      if (o.meanr) { sc.push({ key: 'r', label: '項目間相関の平均' }); row.r = rbar; }
      if (o.scaleStats) { sc.push({ key: 'm', label: '合計の平均値' }, { key: 'sd', label: '合計の標準偏差' }); row.m = S.mean(total); row.sd = S.sd(total); }
      sc.push({ key: 'n', label: 'N', fmt: 'int' }, { key: 'k', label: '項目数', fmt: 'int' }); row.n = n; row.k = k;
      const out = [table('尺度の信頼性', sc, [row], clean([excluded(ds, idx), rev.size ? `逆転項目（${[...rev].join('、')}）は (最小値 ${lo} + 最大値 ${hi}) − 値 で反転しています。` : null]))];
      if (o.itemStats) {
        const ir = items.map((v, j) => {
          const rest = total.map((t, r) => t - v[r]);
          return { name: cs[j].name + (rev.has(cs[j].name) ? '（逆転）' : ''), mean: S.mean(v), sd: S.sd(v), rir: S.pearson(v, rest), del: k > 2 ? alpha(items.filter((_, q) => q !== j)) : NaN };
        });
        out.push(table('項目ごとの統計量', [{ key: 'name', label: '項目', fmt: 'text' }, { key: 'mean', label: '平均値' }, { key: 'sd', label: '標準偏差' },
          { key: 'rir', label: '項目－残余相関' }, { key: 'del', label: '項目を除いた α' }], ir, ['項目－残余相関は、その項目と残りの項目の合計との相関です。']));
      }
      return out;
    },
  });

  root.Analyses = A;
})(typeof window !== 'undefined' ? window : globalThis);
