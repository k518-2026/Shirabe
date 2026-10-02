/*
 * rcode.js — 分析を R で再現するためのコード（データ込み）を作る
 * 画面の設定（変数・オプション）をそのまま R の関数呼び出しに写す。使う列のデータも埋め込むので、
 * 生成したコードを R（または JASP の R コンソール）に貼り付けるだけで同じ分析ができる。
 * 検証用の chk(...) 行は forTest = true のときだけ出す（利用者が見るコードには入らない）。
 * Copyright (c) 2026 K.Yamamoto — MIT License
 */
(function (root) {
  'use strict';
  const RC = {};

  // ------------------------------------------------------------ 文字列・名前
  const q = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '') + '"';
  const RESERVED = new Set(['if', 'else', 'repeat', 'while', 'function', 'for', 'next', 'break', 'TRUE', 'FALSE', 'NULL', 'Inf', 'NaN', 'NA', 'in', 'T', 'F']);
  const SYN = /^(?:[A-Za-z]|[ぁ-ゖァ-ヺー一-鿿])(?:[A-Za-z0-9._]|[ぁ-ゖァ-ヺー一-鿿])*$/;
  // 式の中で使う名前（R の構文に合わなければバッククォートで囲む）
  const nm = n => (SYN.test(n) && !RESERVED.has(n) ? n : '`' + String(n).replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`');
  const vecS = a => 'c(' + a.map(q).join(', ') + ')';
  const num = x => (typeof x === 'number' && isFinite(x) ? String(+x.toPrecision(15)) : 'NA');
  const NL = '\\n';                                   // R のコードに書く \n（JS の文字列では二重にする）
  const level = o => Math.min(99.9, Math.max(50, Number(o.ciLevel) || 95)) / 100;
  const ALTR = { two: 'two.sided', greater: 'greater', less: 'less' };
  const ALTJ = { two: '両側', greater: '片側（>）', less: '片側（<）' };
  const priorOf = (o, def) => (Number(o.bfPrior) > 0 ? Number(o.bfPrior) : def);
  const bfShowR = (o, v) => (o.bfType === 'bf01' ? `1 / (${v})` : o.bfType === 'log' ? `log(${v})` : v);   // 画面と同じ表示（BF₁₀ / BF₀₁ / log）

  // ------------------------------------------------------------ 組み立て用の入れ物
  class Builder {
    constructor(ctx) { this.ctx = ctx; this.lines = []; this.pkgs = new Set(); this.cols = new Set(); this.facs = new Set(); this.test = !!ctx.forTest; this.helpers = new Set(); }
    add(...ls) { for (const l of ls) this.lines.push(l); return this; }
    head(t) { this.add('', `# ---- ${t} ${'-'.repeat(Math.max(4, 60 - [...t].length * 2))}`); return this; }
    num(...ns) { ns.forEach(n => this.cols.add(n)); return this; }
    cat(...ns) { ns.forEach(n => { this.cols.add(n); this.facs.add(n); }); return this; }
    pkg(...ps) { ps.forEach(p => this.pkgs.add(p)); return this; }
    helper(name) { this.helpers.add(name); return this; }
    // 検証用: 画面の表のセルに対応する値を出す。key = 表の題|行の指定|列
    chk(title, row, colKey, expr) { if (this.test) this.add(`chk(${q(title + '|' + row + '|' + colKey)}, ${expr})`); return this; }
    // R の中で行の指定を組み立てる版（ループ内で使う）。rowExpr は R の式（文字列を返す）
    chkR(title, rowExpr, colKey, expr) { if (this.test) this.add(`chk(paste0(${q(title + '|')}, ${rowExpr}, ${q('|' + colKey)}), ${expr})`); return this; }
  }

  // ------------------------------------------------------------ データの埋め込み
  function csvCell(s) { const t = String(s); return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }
  function dataBlock(ds, names, facs, D) {
    const cols = names.map(n => D.byName(ds, n));
    const out = [];
    out.push('dat <- read.csv(text = c(');
    const rows = [names.map(csvCell).join(',')];
    for (let i = 0; i < ds.n; i++) rows.push(cols.map(c => (c.missing[i] ? 'NA' : c.numeric ? String(c.nums[i]) : csvCell(c.raw[i]))).join(','));
    rows.forEach((r, i) => out.push(`  ${q(r)}${i < rows.length - 1 ? ',' : ''}`));
    out.push('), check.names = FALSE, na.strings = "NA", stringsAsFactors = FALSE)');
    cols.forEach(c => { if (facs.has(c.name)) out.push(`dat[[${q(c.name)}]] <- factor(dat[[${q(c.name)}]], levels = ${vecS(c.levels)})`); });
    return out;
  }

  // ------------------------------------------------------------ 分析ごとのコード
  const gen = {};

  // ---- 記述統計
  gen.descriptives = (b, c) => {
    const { sel, o, ds, D } = c, lv = level(o);
    const vs = sel.vars.map(n => D.byName(ds, n));
    const isNum = v => v.type !== 'nominal' && v.numeric;
    const numV = vs.filter(isNum).map(v => v.name), catV = vs.filter(v => !isNum(v)).map(v => v.name);
    const split = sel.split[0] || null;
    numV.forEach(n => b.num(n)); catV.forEach(n => b.cat(n)); if (split) b.cat(split);
    b.head('記述統計');
    const T = '記述統計';
    if (numV.length) {
      if (o.skew || o.kurt) {
        b.add('# 歪度・尖度は標本サイズで補正した推定量（SPSS と同じ。psych::skew(type = 2) と同じ）');
        if (o.skew) b.add('skew_g1 <- function(x) { n <- length(x); m <- mean(x); m2 <- mean((x - m)^2); m3 <- mean((x - m)^3); sqrt(n * (n - 1)) / (n - 2) * m3 / m2^1.5 }',
          'se_skew <- function(n) sqrt(6 * n * (n - 1) / ((n - 2) * (n + 1) * (n + 3)))');
        if (o.kurt) b.add('kurt_g2 <- function(x) { n <- length(x); m <- mean(x); m2 <- mean((x - m)^2); m4 <- mean((x - m)^4); ((n + 1) * (m4 / m2^2 - 3) + 6) * (n - 1) / ((n - 2) * (n - 3)) }',
          'se_kurt <- function(n) 2 * sqrt(6 * n * (n - 1) / ((n - 2) * (n + 1) * (n + 3))) * sqrt((n^2 - 1) / ((n - 3) * (n + 5)))');
      }
      const f = [['有効', 'n', 'n'], ['欠損', 'miss', 'miss']];
      if (o.mean) f.push(['平均値', 'mean', 'mean(x)']);
      if (o.ci) f.push(['下限', 'lo', `mean(x) - qt(1 - (1 - ${lv}) / 2, n - 1) * sd(x) / sqrt(n)`], ['上限', 'hi', `mean(x) + qt(1 - (1 - ${lv}) / 2, n - 1) * sd(x) / sqrt(n)`]);
      if (o.median) f.push(['中央値', 'median', 'median(x)']);
      if (o.mode) f.push(['最頻値', 'mode', 'min(as.numeric(names(tb)[tb == max(tb)]))']);
      if (o.sd) f.push(['標準偏差', 'sd', 'sd(x)']);
      if (o.variance) f.push(['分散', 'var2', 'var(x)']);
      if (o.se) f.push(['標準誤差', 'se', 'sd(x) / sqrt(n)']);
      if (o.range) f.push(['範囲', 'range', 'diff(range(x))']);
      if (o.minmax) f.push(['最小値', 'min', 'min(x)'], ['最大値', 'max', 'max(x)']);
      if (o.quartiles) f.push(['25%', 'q1', 'qs[1]'], ['50%', 'q2', 'qs[2]'], ['75%', 'q3', 'qs[3]']);
      if (o.skew) f.push(['歪度', 'skew', 'skew_g1(x)'], ['歪度の SE', 'seskew', 'se_skew(n)']);
      if (o.kurt) f.push(['尖度', 'kurt', 'kurt_g2(x)'], ['尖度の SE', 'sekurt', 'se_kurt(n)']);
      if (o.sw) f.push(['Shapiro-Wilk W', 'W', 'unname(sw$statistic)'], ['Shapiro-Wilk p', 'swp', 'sw$p.value']);
      b.add(...['describe <- function(x) {',
        '  n <- sum(!is.na(x)); miss <- sum(is.na(x)); x <- x[!is.na(x)]',
        o.mode ? '  tb <- table(x)' : null,
        o.quartiles ? '  qs <- unname(quantile(x, c(0.25, 0.5, 0.75), type = 7))' : null,
        o.sw ? '  sw <- shapiro.test(x)' : null,
        `  c(${f.map(([lab, , e]) => `${q(lab)} = ${e}`).join(', ')})`,
        '}'].filter(l => l !== null));
      b.add(`vars <- ${vecS(numV)}`);
      if (!split) {
        b.add('res_list <- lapply(setNames(vars, vars), function(v) t(as.matrix(describe(dat[[v]]))))',
          'for (v in vars) { cat("' + NL + '---", v, "---' + NL + '"); print(res_list[[v]]) }');
        if (b.test) numV.forEach(v => f.forEach(([lab, key]) => b.chk(T, `var=${v}`, key, `res_list[[${q(v)}]][1, ${q(lab)}]`)));
      } else {
        b.add(`grp <- dat[[${q(split)}]]`,
          'res_list <- lapply(setNames(vars, vars), function(v) t(sapply(split(dat[[v]], grp), describe)))',
          'for (v in vars) { cat("' + NL + '---", v, "---' + NL + '"); print(res_list[[v]]) }');
        if (b.test) numV.forEach(v => { const lvs = D.byName(ds, split).levels; lvs.forEach(l => f.forEach(([lab, key]) => b.chk(T, `var=${v},grp=${l}`, key, `res_list[[${q(v)}]][${q(l)}, ${q(lab)}]`))); });
      }
      if (o.hist || o.box) {
        b.add('for (v in vars) {');
        if (o.hist) b.add(split ? '  for (l in levels(grp)) hist(dat[[v]][grp %in% l], main = paste(v, "（", l, "）"), xlab = v)' : '  hist(dat[[v]], main = v, xlab = v)');
        if (o.box) b.add(split ? '  boxplot(dat[[v]] ~ grp, main = v, ylab = v)' : '  boxplot(dat[[v]], main = v, ylab = v)');
        b.add('}');
      }
    }
    if (catV.length) {
      b.add('', `cat_vars <- ${vecS(catV)}`);
      b.add('for (v in cat_vars) {',
        `  cat("${NL}---", v, "---${NL}")`,
        '  x <- dat[[v]]',
        `  cat("有効", sum(!is.na(x)), " 欠損", sum(is.na(x)), "${NL}")`);
      if (o.mode) b.add('  xs <- x[!is.na(x)]; cat("最頻値:", names(which.max(table(factor(xs, levels = unique(xs))))), "' + NL + '")');
      if (o.freq) {
        b.add('  tb <- table(x)',
          '  print(cbind("度数" = tb, "%" = round(100 * tb / length(x), 1), "有効 %" = round(100 * prop.table(tb), 1), "累積 %" = round(cumsum(100 * prop.table(tb)), 1)))');
        if (split) b.add('  print(table(x, dat[[' + q(split) + ']]))');
      }
      if (o.bar) b.add('  barplot(table(x), main = v, ylab = "度数")');
      b.add('}');
    }
  };

  // ---- t 検定の共通部分
  const tHead = (b, o, extra) => {
    const lv = level(o);
    b.add(`# 設定: 対立仮説 = ${ALTJ[o.alt]}、信頼水準 = ${+(lv * 100).toFixed(1)}%${extra || ''}`);
    return lv;
  };
  const bfTail = (b, o, titleKey, callPrefix, isPaired) => {
    // callPrefix: BayesFactor::ttestBF( の引数部分（rscale と nullInterval は後ろに付ける）
    const r = priorOf(o, 0.707);
    const ni = o.alt === 'greater' ? ', nullInterval = c(0, Inf)' : o.alt === 'less' ? ', nullInterval = c(-Inf, 0)' : '';
    b.add(`  bf <- BayesFactor::ttestBF(${callPrefix}, rscale = ${r}${ni})`,
      '  bf10 <- BayesFactor::extractBF(bf)$bf[1]',
      `  cat("BF10 =", bf10, "  BF01 =", 1 / bf10, "  log(BF10) =", log(bf10), "${NL}")`);
  };

  gen['ttest-one'] = (b, c) => {
    const { sel, o } = c, mu = Number(o.mu) || 0, lv = level(o), T = '1サンプルの t 検定';
    sel.vars.forEach(n => b.num(n));
    b.head('1サンプルの t 検定');
    tHead(b, o, `、検定値 = ${mu}`);
    if (o.bf) b.pkg('BayesFactor');
    b.add(`vars <- ${vecS(sel.vars)}`, `mu <- ${num(mu)}`,
      'for (v in vars) {',
      '  x <- dat[[v]]; x <- x[!is.na(x)]; n <- length(x)',
      `  cat("${NL}====", v, "====  N =", n, "${NL}")`);
    if (o.student) {
      b.add('  # Student の t 検定', `  r <- t.test(x, mu = mu, alternative = ${q(ALTR[o.alt])}, conf.level = ${lv})`, '  print(r)');
      if (o.effect) b.add(`  cat("Cohen の d =", (mean(x) - mu) / sd(x), "${NL}")`);
      b.chkR(T, 'paste0("var=", v, ",test=Student")', 'stat', 'unname(r$statistic)')
        .chkR(T, 'paste0("var=", v, ",test=Student")', 'df', 'unname(r$parameter)')
        .chkR(T, 'paste0("var=", v, ",test=Student")', 'p', 'r$p.value')
        .chkR(T, 'paste0("var=", v, ",test=Student")', 'md', 'mean(x) - mu')
        .chkR(T, 'paste0("var=", v, ",test=Student")', 'sed', 'sd(x) / sqrt(n)')
        .chkR(T, 'paste0("var=", v, ",test=Student")', 'lo', 'r$conf.int[1] - mu')
        .chkR(T, 'paste0("var=", v, ",test=Student")', 'hi', 'r$conf.int[2] - mu')
        .chkR(T, 'paste0("var=", v, ",test=Student")', 'es', '(mean(x) - mu) / sd(x)');
    }
    if (o.nonpar) {

      b.add('  # Wilcoxon の符号付き順位検定');
      b.add('  # exact は Shirabe と同じ規則（同順位や差 0 がなく n < 50 のときだけ厳密、ほかは連続性の補正つき正規近似）。R 4.5 以降は同順位があっても厳密検定になるので明示している', `  d0 <- x - mu; w <- wilcox.test(x, mu = mu, alternative = ${q(ALTR[o.alt])}, exact = (n < 50 && all(d0 != 0) && !anyDuplicated(abs(d0))))`, '  print(w)',
        '  nz <- sum(x != mu); V <- unname(w$statistic)',
        `  cat("順位双列相関 =", 2 * V / (nz * (nz + 1) / 2) - 1, "${NL}")`);
      b.chkR(T, 'paste0("var=", v, ",test=Wilcoxon")', 'stat', 'unname(w$statistic)')
        .chkR(T, 'paste0("var=", v, ",test=Wilcoxon")', 'p', 'w$p.value')
        .chkR(T, 'paste0("var=", v, ",test=Wilcoxon")', 'es', '2 * V / (nz * (nz + 1) / 2) - 1')
        .chkR(T, 'paste0("var=", v, ",test=Wilcoxon")', 'md', 'median(x) - mu');
    }

    if (o.normality) b.add('  # 正規性（Shapiro-Wilk）');
    if (o.normality) b.add('  print(shapiro.test(x))');

    if (o.desc) b.add('  # 記述統計');
    if (o.desc) b.add(`  cat("平均値", mean(x), " SD", sd(x), " SE", sd(x) / sqrt(n), " 中央値", median(x), "${NL}")`);
    if (o.bf) {
      bfTail(b, o, T, 'x = x, mu = mu');
      b.chkR(T, 'paste0("var=", v, ",test=Student")', 'bf', bfShowR(o, 'bf10'));
    }
    b.add('}');
  };

  gen['ttest-ind'] = (b, c) => {
    const { sel, o, ds, D } = c, lv = level(o), T = '独立したサンプルの t 検定', g = sel.group[0];
    sel.vars.forEach(n => b.num(n)); b.cat(g);
    b.head('独立したサンプルの t 検定');
    tHead(b, o, '。平均値の差は 群1 − 群2');
    if (o.bf) b.pkg('BayesFactor');
    if (o.levene) b.pkg('car');
    b.add(`vars <- ${vecS(sel.vars)}`, `g <- ${q(g)}`,
      'for (v in vars) {',
      '  d <- droplevels(dat[complete.cases(dat[c(v, g)]), c(v, g)])',
      '  x <- d[[v]]; grp <- d[[g]]',
      '  x1 <- x[grp == levels(grp)[1]]; x2 <- x[grp == levels(grp)[2]]; n1 <- length(x1); n2 <- length(x2)',
      `  cat("${NL}====", v, "（", g, "）====  群1 =", levels(grp)[1], " 群2 =", levels(grp)[2], "${NL}")`);
    const key = 'paste0("var=", v, ",test=%s")';
    if (o.student) {

      b.add('  # Student の t 検定');
      b.add(`  r <- t.test(x ~ grp, var.equal = TRUE, alternative = ${q(ALTR[o.alt])}, conf.level = ${lv})`, '  print(r)',
        '  md <- mean(x1) - mean(x2); sp <- sqrt(((n1 - 1) * var(x1) + (n2 - 1) * var(x2)) / (n1 + n2 - 2))');
      if (o.effect) b.add(`  cat("Cohen の d =", md / sp, "${NL}")`);
      const k = key.replace('%s', 'Student');
      b.chkR(T, k, 'stat', 'unname(r$statistic)').chkR(T, k, 'df', 'unname(r$parameter)').chkR(T, k, 'p', 'r$p.value')
        .chkR(T, k, 'md', 'md').chkR(T, k, 'sed', 'unname(r$stderr)').chkR(T, k, 'lo', 'r$conf.int[1]').chkR(T, k, 'hi', 'r$conf.int[2]').chkR(T, k, 'es', 'md / sp');
    }
    if (o.welch) {

      b.add('  # Welch の t 検定');
      b.add(`  rw <- t.test(x ~ grp, var.equal = FALSE, alternative = ${q(ALTR[o.alt])}, conf.level = ${lv})`, '  print(rw)');
      if (o.effect) b.add(`  cat("Cohen の d（Welch）=", (mean(x1) - mean(x2)) / sqrt((var(x1) + var(x2)) / 2), "${NL}")`);
      const k = key.replace('%s', 'Welch');
      b.chkR(T, k, 'stat', 'unname(rw$statistic)').chkR(T, k, 'df', 'unname(rw$parameter)').chkR(T, k, 'p', 'rw$p.value')
        .chkR(T, k, 'sed', 'unname(rw$stderr)').chkR(T, k, 'lo', 'rw$conf.int[1]').chkR(T, k, 'hi', 'rw$conf.int[2]')
        .chkR(T, k, 'es', '(mean(x1) - mean(x2)) / sqrt((var(x1) + var(x2)) / 2)');
    }
    if (o.nonpar) {

      b.add('  # Mann-Whitney の U 検定');
      b.add('  # exact は Shirabe と同じ規則（同順位や差 0 がなく n < 50 のときだけ厳密、ほかは連続性の補正つき正規近似）。R 4.5 以降は同順位があっても厳密検定になるので明示している', `  w <- wilcox.test(x ~ grp, alternative = ${q(ALTR[o.alt])}, exact = (n1 < 50 && n2 < 50 && !anyDuplicated(x)))`, '  print(w)',
        `  cat("順位双列相関 =", 2 * unname(w$statistic) / (n1 * n2) - 1, "${NL}")`);
      const k = key.replace('%s', 'Mann-Whitney');
      b.chkR(T, k, 'stat', 'unname(w$statistic)').chkR(T, k, 'p', 'w$p.value').chkR(T, k, 'es', '2 * unname(w$statistic) / (n1 * n2) - 1').chkR(T, k, 'md', 'median(x1) - median(x2)');
    }

    if (o.levene) b.add('  # 等分散性の検定（Levene。平均からの絶対偏差による）');
    if (o.levene) { b.add('  lt <- car::leveneTest(x, grp, center = mean); print(lt)');
      b.chkR('等分散性の検定（Levene）', 'paste0("var=", v)', 'F', 'lt[["F value"]][1]').chkR('等分散性の検定（Levene）', 'paste0("var=", v)', 'p', 'lt[["Pr(>F)"]][1]'); }

    if (o.normality) b.add('  # 群ごとの正規性（Shapiro-Wilk）');
    if (o.normality) b.add('  print(tapply(x, grp, function(z) shapiro.test(z)$p.value))');

    if (o.desc) b.add('  # 群ごとの記述統計');
    if (o.desc) b.add(`  print(t(sapply(split(x, grp), function(z) c(N = length(z), 平均値 = mean(z), SD = sd(z), SE = sd(z) / sqrt(length(z)),
    下限 = mean(z) - qt(1 - (1 - ${lv}) / 2, length(z) - 1) * sd(z) / sqrt(length(z)), 上限 = mean(z) + qt(1 - (1 - ${lv}) / 2, length(z) - 1) * sd(z) / sqrt(length(z))))))`);
    if (o.bf) {
      b.add(`  bf <- BayesFactor::ttestBF(formula = x ~ grp, data = data.frame(x = x, grp = grp), rscale = ${priorOf(o, 0.707)}${o.alt === 'greater' ? ', nullInterval = c(0, Inf)' : o.alt === 'less' ? ', nullInterval = c(-Inf, 0)' : ''})`,
        '  bf10 <- BayesFactor::extractBF(bf)$bf[1]',
        `  cat("BF10 =", bf10, "  BF01 =", 1 / bf10, "  log(BF10) =", log(bf10), "${NL}")`);
      b.chkR(T, key.replace('%s', 'Student'), 'bf', bfShowR(o, 'bf10'));
    }
    b.add('}');
  };

  gen['ttest-paired'] = (b, c) => {
    const { sel, o } = c, lv = level(o), T = '対応のあるサンプルの t 検定';
    const pairs = sel.pairs.filter(p => p[0] && p[1]);
    pairs.forEach(p => b.num(p[0], p[1]));
    b.head('対応のあるサンプルの t 検定');
    tHead(b, o, '。差は 変数1 − 変数2');
    if (o.bf) b.pkg('BayesFactor');
    b.add(`pairs_list <- list(${pairs.map(p => `c(${q(p[0])}, ${q(p[1])})`).join(', ')})`,
      'for (p in pairs_list) {',
      '  d <- dat[complete.cases(dat[p]), p]; x <- d[[p[1]]]; y <- d[[p[2]]]; dif <- x - y; n <- length(dif)',
      '  lab <- paste(p[1], "−", p[2])',
      `  cat("${NL}====", lab, "====  N =", n, "${NL}")`);
    const key = 'paste0("var=", lab, ",test=%s")';
    if (o.student) {

      b.add('  # Student（対応のある）t 検定');
      b.add(`  r <- t.test(x, y, paired = TRUE, alternative = ${q(ALTR[o.alt])}, conf.level = ${lv})`, '  print(r)');
      if (o.effect) b.add(`  cat("Cohen の d（dz）=", mean(dif) / sd(dif), "${NL}")`);
      const k = key.replace('%s', 'Student');
      b.chkR(T, k, 'stat', 'unname(r$statistic)').chkR(T, k, 'df', 'unname(r$parameter)').chkR(T, k, 'p', 'r$p.value').chkR(T, k, 'md', 'mean(dif)')
        .chkR(T, k, 'sed', 'sd(dif) / sqrt(n)').chkR(T, k, 'lo', 'r$conf.int[1]').chkR(T, k, 'hi', 'r$conf.int[2]').chkR(T, k, 'es', 'mean(dif) / sd(dif)');
    }
    if (o.nonpar) {

      b.add('  # Wilcoxon の符号付き順位検定');
      b.add('  # exact は Shirabe と同じ規則（同順位や差 0 がなく n < 50 のときだけ厳密、ほかは連続性の補正つき正規近似）。R 4.5 以降は同順位があっても厳密検定になるので明示している', `  w <- wilcox.test(x, y, paired = TRUE, alternative = ${q(ALTR[o.alt])}, exact = (n < 50 && all(dif != 0) && !anyDuplicated(abs(dif))))`, '  print(w)',
        '  nz <- sum(dif != 0); V <- unname(w$statistic)',
        `  cat("順位双列相関 =", 2 * V / (nz * (nz + 1) / 2) - 1, "${NL}")`);
      const k = key.replace('%s', 'Wilcoxon');
      b.chkR(T, k, 'stat', 'unname(w$statistic)').chkR(T, k, 'p', 'w$p.value').chkR(T, k, 'es', '2 * V / (nz * (nz + 1) / 2) - 1').chkR(T, k, 'md', 'median(dif)');
    }

    if (o.normality) b.add('  # 差の正規性（Shapiro-Wilk）');
    if (o.normality) b.add('  print(shapiro.test(dif))');

    if (o.desc) b.add('  # 記述統計');
    if (o.desc) b.add(`  print(rbind(sapply(list(x = x, y = y), function(z) c(N = length(z), 平均値 = mean(z), SD = sd(z), SE = sd(z) / sqrt(length(z))))))`);
    if (o.bf) {
      b.add(`  bf <- BayesFactor::ttestBF(x = x, y = y, paired = TRUE, rscale = ${priorOf(o, 0.707)}${o.alt === 'greater' ? ', nullInterval = c(0, Inf)' : o.alt === 'less' ? ', nullInterval = c(-Inf, 0)' : ''})`,
        '  bf10 <- BayesFactor::extractBF(bf)$bf[1]',
        `  cat("BF10 =", bf10, "  BF01 =", 1 / bf10, "  log(BF10) =", log(bf10), "${NL}")`);
      b.chkR(T, key.replace('%s', 'Student'), 'bf', bfShowR(o, 'bf10'));
    }
    b.add('}');
  };

  // ---- 分散分析（被験者間）
  gen.anova = (b, c) => {
    const { sel, o, ds, D } = c, lv = level(o), dv = sel.dv[0], fs = sel.factors;
    b.num(dv); fs.forEach(f => b.cat(f));
    b.pkg('car');
    if (o.posthoc) b.pkg('emmeans');
    if (o.levene) b.pkg('car');
    if (o.bf) b.pkg('BayesFactor');
    const T = `分散分析 — ${dv}`, one = fs.length === 1;
    const rhs = fs.map(nm).join(' * ');
    b.head('分散分析（被験者間）');
    b.add('# 平方和は Type III（効果コーディング contr.sum で car::Anova を使う）',
      `dv <- ${q(dv)}; fac <- ${vecS(fs)}`,
      'd <- droplevels(dat[complete.cases(dat[c(dv, fac)]), c(dv, fac)])',
      'op <- options(contrasts = c("contr.sum", "contr.poly"))',
      `fit <- lm(${nm(dv)} ~ ${rhs}, data = d)`,
      'at <- car::Anova(fit, type = 3); print(at)',
      'tab <- at[setdiff(rownames(at), "(Intercept)"), ]; ne <- nrow(tab)',
      'ss <- tab[["Sum Sq"]]; dfs <- tab[["Df"]]; sse <- ss[ne]; dfe <- dfs[ne]; mse <- sse / dfe',
      'sst <- sum((d[[dv]] - mean(d[[dv]]))^2)',
      'eff <- data.frame(項 = rownames(tab)[-ne], 平方和 = ss[-ne], 自由度 = dfs[-ne], F = tab[["F value"]][-ne], p = tab[["Pr(>F)"]][-ne], row.names = NULL)',
      'eff$"η²" <- ss[-ne] / sst; eff$"偏η²" <- ss[-ne] / (ss[-ne] + sse); eff$"ω²" <- (ss[-ne] - dfs[-ne] * mse) / (sst + mse)',
      'print(eff)');
    const termsJ = fs.length === 1 ? [fs[0]] : [fs[0], fs[1], `${fs[0]} ✻ ${fs[1]}`];
    const termsR = fs.length === 1 ? [fs[0]] : [fs[0], fs[1], `${fs[0]}:${fs[1]}`];
    if (b.test) termsJ.forEach((tj, i) => {
      const r = `term=${tj}`;
      b.chk(T, r, 'ss', `ss[${i + 1}]`).chk(T, r, 'df', `dfs[${i + 1}]`).chk(T, r, 'F', `tab[["F value"]][${i + 1}]`).chk(T, r, 'p', `tab[["Pr(>F)"]][${i + 1}]`)
        .chk(T, r, 'eta', `eff[[${i + 1}, "η²"]]`).chk(T, r, 'peta', `eff[[${i + 1}, "偏η²"]]`).chk(T, r, 'omega', `eff[[${i + 1}, "ω²"]]`);
    });
    if (b.test) b.chk(T, 'term=残差', 'ss', 'sse').chk(T, 'term=残差', 'df', 'dfe');
    if (one && o.welch) { b.add(`wt <- oneway.test(${nm(dv)} ~ ${nm(fs[0])}, data = d, var.equal = FALSE); print(wt)`);
      b.chk('Welch の分散分析', `term=${fs[0]}`, 'F', 'unname(wt$statistic)').chk('Welch の分散分析', `term=${fs[0]}`, 'df2', 'unname(wt$parameter[2])').chk('Welch の分散分析', `term=${fs[0]}`, 'p', 'wt$p.value'); }
    if (one && o.kw) { b.add(`kt <- kruskal.test(${nm(dv)} ~ ${nm(fs[0])}, data = d); print(kt)`);
      b.chk('Kruskal-Wallis 検定', `term=${fs[0]}`, 'H', 'unname(kt$statistic)').chk('Kruskal-Wallis 検定', `term=${fs[0]}`, 'p', 'kt$p.value'); }
    if (o.desc) b.add(`print(aggregate(${nm(dv)} ~ ${rhs.replace(/ \* /g, ' + ')}, data = d, FUN = function(z) c(N = length(z), 平均値 = mean(z), SD = sd(z), SE = sd(z) / sqrt(length(z)))))`);
    if (o.levene) { b.add(`lt <- car::leveneTest(${nm(dv)} ~ ${rhs}, data = d, center = mean); print(lt)`);
      b.chk('等分散性の検定（Levene）', '', 'F', 'lt[["F value"]][1]').chk('等分散性の検定（Levene）', '', 'p', 'lt[["Pr(>F)"]][1]'); }
    if (o.posthoc) {
      const adj = [o.phTukey ? 'tukey' : null, o.phBonf ? 'bonferroni' : null, o.phHolm ? 'holm' : null].filter(Boolean);
      b.add('# 事後検定: 推定周辺平均（他の要因の水準を等しく重みづけ）の対比較');
      fs.forEach((f, i) => {
        b.add(`emm <- emmeans::emmeans(fit, specs = ${q(f)})`);
        adj.forEach(a => b.add(`ph_${a} <- as.data.frame(pairs(emm, adjust = ${q(a)})); print(ph_${a})`));
        if (o.phEffect) b.add('cat("Cohen の d:", ph_' + (adj[0] || 'tukey') + '$estimate / sigma(fit), "' + NL + '")');
        if (b.test) {
          const Tp = `事後検定 — ${f}`;
          b.add(`for (i in seq_len(nrow(ph_${adj[0]}))) { ab <- strsplit(as.character(ph_${adj[0]}$contrast[i]), " - ", fixed = TRUE)[[1]]`);
          b.add(`  rk <- paste0("a=", ab[1], ",b=", ab[2])`);
          b.add(`  chk(paste0(${q(Tp + '|')}, rk, "|md"), ph_${adj[0]}$estimate[i]); chk(paste0(${q(Tp + '|')}, rk, "|se"), ph_${adj[0]}$SE[i]); chk(paste0(${q(Tp + '|')}, rk, "|t"), ph_${adj[0]}$t.ratio[i])`);
          adj.forEach(a => b.add(`  chk(paste0(${q(Tp + '|')}, rk, "|${a === 'tukey' ? 'tukey' : a === 'bonferroni' ? 'bonf' : 'holm'}"), ph_${a}$p.value[i])`));
          if (o.phEffect) b.add(`  chk(paste0(${q(Tp + '|')}, rk, "|d"), ph_${adj[0]}$estimate[i] / sigma(fit))`);
          b.add('}');
        }
      });
    }
    b.add('options(op)   # 対比の設定をもとに戻す');
    if (o.bf) {
      const r = priorOf(o, 0.5);
      b.add('', '# BayesFactor には、列名を単純にした別のデータ枠を渡す（日本語や空白を含む列名を避けるため）',
        `bfd <- data.frame(y = d[[dv]], ${fs.map((_, i) => `g${i + 1} = d[[fac[${i + 1}]]]`).join(', ')})`);
      bfModelBlock(b, o, { r, random: false, call: `BayesFactor::anovaBF(y ~ ${fs.length === 1 ? 'g1' : 'g1 * g2'}, data = bfd, rscaleFixed = ${r}, whichModels = "withmain", iterations = 100000)`,
        nullName: '帰無モデル', termNames: termsJ, termKeys: fs.length === 1 ? ['g1'] : ['g1', 'g2', 'g1:g2'], title: 'ベイズファクター（モデル比較）', mcNote: fs.length > 1 });
      if (b.test) termsJ.forEach((tj, i) => b.chk(T, `term=${tj}`, fs.length > 1 ? 'bf~mc' : 'bf', bfShowR(o, `incl[${i + 1}]`)));
    }
  };

  // ------------------------------------------------------------ 共通部品（ベイズファクターのモデル比較）
  // R で anovaBF の結果から「モデルごとの BF・事後確率・包含ベイズファクター」を出す。
  // BayesFactor が返すモデルの並びや項の書き方（A:B など）に頼らず、モデル名を項に分解して項ごとに突き合わせる。
  // termKeys: データの列名（BayesFactor に見える名前, 例 "g1", "g1:g2"）、termNames: 画面での項の名前
  function bfModelBlock(b, o, opt) {
    const { call, nullName, termNames, termKeys, mcNote, r, random, title } = opt;
    b.add('', `# ベイズファクター: 固定効果の事前分布の幅 r = ${r}${random ? '、被験者は変量効果（幅 1）' : ''}。モデルの事前確率はすべて等しい`,
      'set.seed(1)   # モンテカルロ法で近似するモデル（効果が 2 つ以上）の結果を再現できるように',
      `bf <- ${call}`,
      'print(bf)   # ± は近似の誤差。Shirabe は数値積分で求めるので、効果が 2 つ以上のモデルは ±1% ほどずれることがある',
      'ebf <- BayesFactor::extractBF(bf)',
      `mnames <- ${random ? 'sub(" \\\\+ id$", "", rownames(ebf))' : 'rownames(ebf)'}   # モデルを構成する項`,
      `tkeys <- ${vecS(termKeys)}; tnames <- ${vecS(termNames)}`,
      'same_term <- function(a, b) setequal(strsplit(a, ":", fixed = TRUE)[[1]], strsplit(b, ":", fixed = TRUE)[[1]])',
      'member <- t(sapply(mnames, function(mn) sapply(tkeys, function(tk) any(sapply(strsplit(mn, " + ", fixed = TRUE)[[1]], same_term, b = tk)))))   # 行: 各モデル、列: 各項を含むか',
      `bfv <- c(1, ebf$bf); names(bfv) <- c(${q(nullName)}, apply(member, 1, function(r_) paste(tnames[r_], collapse = " + ")))`,
      'post <- bfv / sum(bfv)      # 事後のモデル確率',
      'print(data.frame(BF10 = bfv, "P(M|データ)" = post, BF_M = post / (1 - post) / ((1 / length(bfv)) / (1 - 1 / length(bfv))), check.names = FALSE))',
      'member <- rbind(FALSE, member)   # 帰無モデルは、どの項も含まない',
      'incl <- sapply(seq_along(tkeys), function(j) { inc <- member[, j]; (sum(post[inc]) / sum(post[!inc])) / (sum(inc) / sum(!inc)) }); names(incl) <- tnames',
      'print(incl)   # 包含ベイズファクター（その項を含むモデル全体と含まないモデル全体の比）');
    if (b.test) {
      b.add('chk("ERR||mc", max(ebf$error))');   // BayesFactor が報告する近似誤差（検証の許容誤差に使う）
      b.add(`for (i in seq_along(bfv)) { chk(paste0(${q(title + '|model=')}, names(bfv)[i], "|${mcNote ? 'bf~mc' : 'bf'}"), bfv[i]); chk(paste0(${q(title + '|model=')}, names(bfv)[i], "|${mcNote ? 'post~mc' : 'post'}"), post[i]) }`);
    }
  }
  // ---- 反復測定の分散分析（1要因）
  gen.rmanova = (b, c) => {
    const { sel, o, ds, D } = c, vars = sel.vars, lv = level(o);
    if (vars.length < 2) { b.add('# 水準にあたる列を 2 つ以上入れてください。'); return; }
    vars.forEach(n => b.num(n));
    b.pkg('car'); if (o.bf) b.pkg('BayesFactor');
    const T = '被験者内効果', F = '反復測定', k = vars.length;
    b.head('反復測定の分散分析（1要因）');
    b.add(`vars <- ${vecS(vars)}`,
      'd <- dat[complete.cases(dat[vars]), vars]; Y <- as.matrix(d); n <- nrow(Y); k <- ncol(Y)',
      `idata <- data.frame(${nm(F)} = factor(vars, levels = vars))`,
      'fit <- lm(Y ~ 1)',
      `av <- car::Anova(fit, idata = idata, idesign = ~${nm(F)}, type = 3)`,
      'sm <- summary(av, multivariate = FALSE); print(sm)   # 球面性の検定と、Greenhouse-Geisser / Huynh-Feldt の補正も含む',
      `ut <- sm$univariate.tests[${q(F)}, ]`,
      'ss <- ut[["Sum Sq"]]; df1 <- ut[["num Df"]]; sse <- ut[["Error SS"]]; df2 <- ut[["den Df"]]; Fv <- ut[["F value"]]',
      'gm <- mean(Y); sst <- sum((Y - gm)^2); sss <- k * sum((rowMeans(Y) - gm)^2)',
      `cat("η² =", ss / sst, "  偏η² =", ss / (ss + sse), "${NL}")`);
    const rowI = (corr, term) => `term=${term},corr=${corr}`;
    b.chk(T, rowI('なし', F), 'ss', 'ss').chk(T, rowI('なし', F), 'df', 'df1').chk(T, rowI('なし', F), 'ms', 'ss / df1').chk(T, rowI('なし', F), 'F', 'Fv')
      .chk(T, rowI('なし', F), 'p', 'ut[["Pr(>F)"]]').chk(T, rowI('なし', F), 'eta', 'ss / sst').chk(T, rowI('なし', F), 'peta', 'ss / (ss + sse)')
      .chk(T, rowI('なし', '残差'), 'ss', 'sse').chk(T, rowI('なし', '残差'), 'df', 'df2').chk(T, rowI('なし', '残差'), 'ms', 'sse / df2');
    b.chk('被験者間効果', 'term=残差（被験者）', 'ss', 'sss').chk('被験者間効果', 'term=残差（被験者）', 'df', 'n - 1').chk('被験者間効果', 'term=残差（被験者）', 'ms', 'sss / (n - 1)');
    if (k >= 3) {
      b.add(`pa <- sm$pval.adjustments[${q(F)}, ]; gg <- pa[["GG eps"]]; hf <- min(1, pa[["HF eps"]])`,
        `mt <- sm$sphericity.tests[${q(F)}, ]`,
        `cat("Mauchly の W =", mt[["Test statistic"]], " p =", mt[["p-value"]], "${NL}GG ε =", gg, " 補正後の p =", pa[["Pr(>F[GG])"]], "${NL}HF ε =", hf, " 補正後の p =", pa[["Pr(>F[HF])"]], "${NL}")`);
      b.chk('球面性の検定', `term=${F}`, 'W', 'mt[["Test statistic"]]').chk('球面性の検定', `term=${F}`, 'p', 'mt[["p-value"]]').chk('球面性の検定', `term=${F}`, 'gg', 'gg').chk('球面性の検定', `term=${F}`, 'hf', 'hf');
      [['Greenhouse-Geisser', 'gg', 'Pr(>F[GG])', o.gg], ['Huynh-Feldt', 'hf', 'Pr(>F[HF])', o.hf]].forEach(([cn, ev, pc, on]) => {
        if (!on) return;
        b.chk(T, rowI(cn, F), 'df', `df1 * ${ev}`).chk(T, rowI(cn, F), 'ms', `ss / (df1 * ${ev})`).chk(T, rowI(cn, F), 'F', 'Fv').chk(T, rowI(cn, F), 'p', `pa[[${q(pc)}]]`)
          .chk(T, rowI(cn, '残差'), 'df', `df2 * ${ev}`).chk(T, rowI(cn, '残差'), 'ms', `sse / (df2 * ${ev})`);
      });
    }
    if (o.desc) b.add('print(rbind(N = rep(n, k), 平均値 = colMeans(Y), SD = apply(Y, 2, sd), SE = apply(Y, 2, sd) / sqrt(n)))');
    if (o.friedman) {
      b.add('fr <- friedman.test(Y); print(fr)', `cat("Kendall の W =", unname(fr$statistic) / (n * (k - 1)), "${NL}")`);
      b.chk('Friedman 検定', `term=${F}`, 'chi', 'unname(fr$statistic)').chk('Friedman 検定', `term=${F}`, 'df', 'unname(fr$parameter)').chk('Friedman 検定', `term=${F}`, 'p', 'fr$p.value').chk('Friedman 検定', `term=${F}`, 'w', 'unname(fr$statistic) / (n * (k - 1))');
    }
    if (o.posthoc) {
      b.add('', '# 事後検定: 水準どうしを対応のある t 検定で比べ、p 値を補正する',
        'cmb <- combn(k, 2)',
        'ph <- do.call(rbind, lapply(seq_len(ncol(cmb)), function(i) { z <- t.test(Y[, cmb[1, i]], Y[, cmb[2, i]], paired = TRUE)',
        '  data.frame(a = vars[cmb[1, i]], b = vars[cmb[2, i]], md = unname(z$estimate), se = unname(z$estimate) / unname(z$statistic), t = unname(z$statistic), df = unname(z$parameter), p = z$p.value) }))',
        'ph$holm <- p.adjust(ph$p, "holm"); ph$bonf <- p.adjust(ph$p, "bonferroni"); print(ph)');
      if (b.test) b.add('for (i in seq_len(nrow(ph))) { rk <- paste0("a=", ph$a[i], ",b=", ph$b[i])',
        '  for (cc in c("md", "se", "t", "df", "p", "holm", "bonf")) chk(paste0("事後検定|", rk, "|", cc), ph[[cc]][i]) }');
    }
    if (o.bf) {
      b.add('', '# ベイズファクター: 条件の固定効果の事前分布の幅 r = ' + priorOf(o, 0.5) + '、被験者は変量効果（幅 1）。H0 は被験者の効果だけのモデル',
        'long <- data.frame(y = as.vector(Y), cond = factor(rep(vars, each = n), levels = vars), id = factor(rep(seq_len(n), times = k)))',
        'set.seed(1)',
        `bf <- BayesFactor::anovaBF(y ~ cond + id, data = long, whichRandom = "id", rscaleFixed = ${priorOf(o, 0.5)}, rscaleRandom = 1, iterations = 100000)`,
        'print(bf)', 'bf10 <- BayesFactor::extractBF(bf)$bf[1]',
        `cat("BF10 =", bf10, "  BF01 =", 1 / bf10, "  log(BF10) =", log(bf10), "${NL}")`);
      b.chk(T, rowI('なし', F), 'bf~mc', bfShowR(o, 'bf10'));
    }
  };

  // 反復測定 2 要因の設定（analyses.js と同じ規則）
  const parseLevels = (s, fallback) => {
    const t = String(s === undefined || s === null ? '' : s).trim();
    if (!t) return fallback;
    if (/^\d+$/.test(t)) return Array.from({ length: +t }, (_, i) => String(i + 1));
    return t.split(/[,、，]/).map(v => v.trim()).filter(Boolean);
  };
  gen.rmanova2 = (b, c) => {
    const { sel, o, ds, D } = c, cs = sel.cells, bc = sel.between[0] || null, k = cs.length;
    const w1 = String(o.w1name || '').trim() || '要因1', w2 = String(o.w2name || '').trim() || '要因2';
    const L2 = parseLevels(o.w2levels, []);
    const L1 = parseLevels(o.w1levels, L2.length ? (k % L2.length ? [] : Array.from({ length: k / L2.length }, (_, i) => String(i + 1))) : cs.slice());
    if ((L2.length && bc) || (!L2.length && !bc) || L1.length < 2 || L2.length === 1) { b.add('# この設定では R のコードを作れません（要因の指定を確かめてください）。'); return; }
    cs.forEach(n => b.num(n)); if (bc) b.cat(bc);
    b.pkg('car'); if (o.posthoc) b.pkg('car'); if (o.bf) b.pkg('BayesFactor');
    const T = '被験者内効果', mixed = !!bc;
    b.head('反復測定の分散分析（2要因）');
    b.add(`cells <- ${vecS(cs)}`);
    let effects;   // R の univariate.tests の行名 と 画面の名前
    if (!mixed) {
      b.add(`lev1 <- ${vecS(L1)}; lev2 <- ${vecS(L2)}   # 列は「要因1の水準ごとに要因2の水準を順に」並べる`,
        'd <- dat[complete.cases(dat[cells]), cells]; Y <- as.matrix(d); n <- nrow(Y)',
        `idata <- data.frame(factor(rep(lev1, each = length(lev2)), levels = lev1), factor(rep(lev2, times = length(lev1)), levels = lev2)); names(idata) <- c(${q(w1)}, ${q(w2)})`,
        'fit <- lm(Y ~ 1)',
        `av <- car::Anova(fit, idata = idata, idesign = ~${nm(w1)} * ${nm(w2)}, type = 3)`);
      effects = [{ r: w1, j: w1 }, { r: w2, j: w2 }, { r: `${w1}:${w2}`, j: `${w1} ✻ ${w2}` }];
    } else {
      b.add(`gname <- ${q(bc)}; lev1 <- ${vecS(L1)}`,
        'd <- droplevels(dat[complete.cases(dat[c(cells, gname)]), c(cells, gname)]); Y <- as.matrix(d[cells]); n <- nrow(Y)',
        `idata <- data.frame(${nm(w1)} = factor(lev1, levels = lev1))`,
        'op <- options(contrasts = c("contr.sum", "contr.poly"))   # 被験者間の要因は効果コーディング（Type III のため）',
        `fit <- lm(Y ~ ${nm(bc)}, data = d)`,
        `av <- car::Anova(fit, idata = idata, idesign = ~${nm(w1)}, type = 3)`);
      effects = [{ r: w1, j: w1 }, { r: `${bc}:${w1}`, j: `${w1} ✻ ${bc}` }];
    }
    b.add('sm <- summary(av, multivariate = FALSE); print(sm)   # 球面性の検定と、Greenhouse-Geisser / Huynh-Feldt の補正も含む',
      'ut <- as.data.frame(unclass(sm$univariate.tests)); ut <- ut[rownames(ut) != "(Intercept)", ]',
      'gm <- mean(Y); sst <- sum((Y - gm)^2)',
      'ut$"η²" <- ut[["Sum Sq"]] / sst; ut$"偏η²" <- ut[["Sum Sq"]] / (ut[["Sum Sq"]] + ut[["Error SS"]]); print(ut)');
    const rowI = (term, corr) => `term=${term},corr=${corr}`;
    const rowOf = r_ => `ut[${q(r_)}, `;
    effects.forEach(e => {
      b.chk(T, rowI(e.j, 'なし'), 'ss', `${rowOf(e.r)}"Sum Sq"]`).chk(T, rowI(e.j, 'なし'), 'df', `${rowOf(e.r)}"num Df"]`).chk(T, rowI(e.j, 'なし'), 'ms', `${rowOf(e.r)}"Sum Sq"] / ${rowOf(e.r)}"num Df"]`)
        .chk(T, rowI(e.j, 'なし'), 'F', `${rowOf(e.r)}"F value"]`).chk(T, rowI(e.j, 'なし'), 'p', `${rowOf(e.r)}"Pr(>F)"]`).chk(T, rowI(e.j, 'なし'), 'eta', `${rowOf(e.r)}"η²"]`).chk(T, rowI(e.j, 'なし'), 'peta', `${rowOf(e.r)}"偏η²"]`);
    });
    if (mixed) {
      b.add(`bt <- ut[${q(bc)}, ]; print(bt)`);
      const B_ = '被験者間効果';
      b.chk(B_, `term=${bc}`, 'ss', 'bt[["Sum Sq"]]').chk(B_, `term=${bc}`, 'df', 'bt[["num Df"]]').chk(B_, `term=${bc}`, 'ms', 'bt[["Sum Sq"]] / bt[["num Df"]]').chk(B_, `term=${bc}`, 'F', 'bt[["F value"]]')
        .chk(B_, `term=${bc}`, 'p', 'bt[["Pr(>F)"]]').chk(B_, `term=${bc}`, 'eta', 'bt[["η²"]]').chk(B_, `term=${bc}`, 'peta', 'bt[["偏η²"]]')
        .chk(B_, 'term=残差', 'ss', 'bt[["Error SS"]]').chk(B_, 'term=残差', 'df', 'bt[["den Df"]]');
    }
    // 球面性（水準が 3 つ以上の効果だけ）
    b.add('sph <- sm$sphericity.tests; adj <- sm$pval.adjustments',
      'if (!is.null(sph)) { print(sph); print(adj) }');
    if (b.test) effects.forEach(e => {
      // Shirabe の「球面性の検定」の表は、被験者内の効果ごとの行だけ（混合計画では被験者間の要因との交互作用の行は無い）
      const inSphTable = !mixed || e === effects[0];
      b.add(`if (!is.null(sph) && ${q(e.r)} %in% rownames(sph)) {`);
      if (o.mauchly && inSphTable) b.add(`  chk(${q('球面性の検定|term=' + e.j + '|W')}, sph[${q(e.r)}, "Test statistic"]); chk(${q('球面性の検定|term=' + e.j + '|p')}, sph[${q(e.r)}, "p-value"])`,
        `  chk(${q('球面性の検定|term=' + e.j + '|gg')}, adj[${q(e.r)}, "GG eps"]); chk(${q('球面性の検定|term=' + e.j + '|hf')}, min(1, adj[${q(e.r)}, "HF eps"]))`);
      if (o.gg) b.add(`  chk(${q(T + '|term=' + e.j + ',corr=Greenhouse-Geisser|p')}, adj[${q(e.r)}, "Pr(>F[GG])"]); chk(${q(T + '|term=' + e.j + ',corr=Greenhouse-Geisser|df')}, ut[${q(e.r)}, "num Df"] * adj[${q(e.r)}, "GG eps"])`);
      if (o.hf) b.add(`  chk(${q(T + '|term=' + e.j + ',corr=Huynh-Feldt|p')}, adj[${q(e.r)}, "Pr(>F[HF])"]); chk(${q(T + '|term=' + e.j + ',corr=Huynh-Feldt|df')}, ut[${q(e.r)}, "num Df"] * min(1, adj[${q(e.r)}, "HF eps"]))`);
      b.add('}');
    });
    if (o.desc) {
      b.add(mixed ? 'print(aggregate(Y, list(g = d[[gname]]), mean))' : 'print(rbind(平均値 = colMeans(Y), SD = apply(Y, 2, sd)))');
    }
    if (o.posthoc) {
      b.add('', '# 事後検定: 被験者ごとに水準の平均（ほかの要因の水準で平均）を求め、対応のある t 検定で比べて p 値を補正する',
        'pw_paired <- function(M) { cmb <- combn(ncol(M), 2); lv_ <- colnames(M)',
        '  ph <- do.call(rbind, lapply(seq_len(ncol(cmb)), function(i) { z <- t.test(M[, cmb[1, i]], M[, cmb[2, i]], paired = TRUE)',
        '    data.frame(a = lv_[cmb[1, i]], b = lv_[cmb[2, i]], md = unname(z$estimate), se = unname(z$estimate) / unname(z$statistic), t = unname(z$statistic), df = unname(z$parameter), p = z$p.value) }))',
        '  ph$holm <- p.adjust(ph$p, "holm"); ph$bonf <- p.adjust(ph$p, "bonferroni"); ph }');
      const phCheck = (varName, title) => { if (b.test) b.add(`for (i in seq_len(nrow(${varName}))) { rk <- paste0("a=", ${varName}$a[i], ",b=", ${varName}$b[i])`,
        `  for (cc in c("md", "se", "t", "df", "p", "holm", "bonf")) chk(paste0(${q(title + '|')}, rk, "|", cc), ${varName}[[cc]][i]) }`); };
      if (!mixed) {
        b.add('nB <- length(lev2); nA <- length(lev1)',
          `mA <- sapply(seq_along(lev1), function(i) rowMeans(Y[, (i - 1) * nB + seq_len(nB), drop = FALSE])); colnames(mA) <- lev1`,
          `mB <- sapply(seq_along(lev2), function(j) rowMeans(Y[, (seq_len(nA) - 1) * nB + j, drop = FALSE])); colnames(mB) <- lev2`,
          `phA <- pw_paired(mA); print(phA)`, `phB <- pw_paired(mB); print(phB)`);
        phCheck('phA', `事後検定 — ${w1}`); phCheck('phB', `事後検定 — ${w2}`);
      } else {
        b.add('mA <- sapply(seq_along(lev1), function(i) Y[, i]); colnames(mA) <- lev1',
          'phA <- pw_paired(mA); print(phA)');
        phCheck('phA', `事後検定 — ${w1}`);
        b.add('', '# 被験者間の要因: 各被験者の全セルの平均を、被験者間の誤差で比べる（Tukey は ptukey で）',
          'sm_mean <- rowMeans(Y); G_ <- d[[gname]]; gl <- levels(G_); fit_m <- lm(sm_mean ~ G_); mse_m <- sum(residuals(fit_m)^2) / df.residual(fit_m)',
          'gcmb <- combn(length(gl), 2); gn <- as.vector(table(G_)); gm_ <- tapply(sm_mean, G_, mean)',
          'phG <- do.call(rbind, lapply(seq_len(ncol(gcmb)), function(i) { a <- gcmb[1, i]; bb <- gcmb[2, i]; md <- unname(gm_[a] - gm_[bb]); se <- sqrt(mse_m * (1 / gn[a] + 1 / gn[bb]))',
          '  data.frame(a = gl[a], b = gl[bb], md = md, se = se, t = md / se, df = df.residual(fit_m), p = 2 * pt(-abs(md / se), df.residual(fit_m)), tukey = ptukey(abs(md / se) * sqrt(2), length(gl), df.residual(fit_m), lower.tail = FALSE)) }))',
          'phG$holm <- p.adjust(phG$p, "holm"); phG$bonf <- p.adjust(phG$p, "bonferroni"); print(phG)');
        if (b.test) b.add('for (i in seq_len(nrow(phG))) { rk <- paste0("a=", phG$a[i], ",b=", phG$b[i])',
          `  for (cc in c("md", "se", "t", "df", "p", "tukey", "holm", "bonf")) chk(paste0(${q('事後検定 — ' + bc + '|')}, rk, "|", cc), phG[[cc]][i]) }`);
      }
    }
    if (mixed) b.add('options(op)   # 対比の設定をもとに戻す');
    if (o.bf) {
      const r = priorOf(o, 0.5);
      b.add('', '# ベイズファクター用に縦長のデータにする（列名は g1, g2, id の単純な名前にする）',
        mixed ? 'long <- data.frame(y = as.vector(Y), g1 = rep(d[[gname]], times = ncol(Y)), g2 = factor(rep(lev1, each = n), levels = lev1), id = factor(rep(seq_len(n), times = ncol(Y))))   # g1: 被験者間の要因、g2: 反復測定の水準'
          : 'long <- data.frame(y = as.vector(Y), g1 = factor(rep(rep(lev1, each = length(lev2)), each = n), levels = lev1), g2 = factor(rep(rep(lev2, times = length(lev1)), each = n), levels = lev2), id = factor(rep(seq_len(n), times = ncol(Y))))   # g1: 要因1、g2: 要因2');
      const names3 = mixed ? [bc, w1, `${w1} ✻ ${bc}`] : [w1, w2, `${w1} ✻ ${w2}`];
      bfModelBlock(b, o, { r, random: true, call: `BayesFactor::anovaBF(y ~ g1 * g2 + id, data = long, whichRandom = "id", rscaleFixed = ${r}, rscaleRandom = 1, whichModels = "withmain", iterations = 100000)`,
        nullName: '帰無モデル（被験者だけ）', termNames: names3, termKeys: ['g1', 'g2', 'g1:g2'], title: 'ベイズファクター（モデル比較）', mcNote: true });
      // 画面では、包含ベイズファクターを効果の表の BF包含 列にも載せる
      if (b.test) {
        names3.forEach((tn, j) => {
          const isBetween = mixed && j === 0;
          const tab = isBetween ? '被験者間効果' : T, row = isBetween ? `term=${tn}` : `term=${tn},corr=なし`;
          b.chk(tab, row, 'bf~mc', bfShowR(o, `incl[${j + 1}]`));
        });
      }
    }
  };

  // ---- 相関
  gen.correlation = (b, c) => {
    const { sel, o } = c, lv = level(o), T = '相関';
    const vars = sel.vars; if (vars.length < 2) return;
    vars.forEach(n => b.num(n));
    b.head('相関');
    const methods = [o.pearson ? 'pearson' : null, o.spearman ? 'spearman' : null, o.kendall ? 'kendall' : null].filter(Boolean);
    if (o.bf && o.pearson) {
      b.add('# ベイズファクター（Ly, Verhagen & Wagenmakers, 2016）: r の正確な尤度と、ρ の伸長ベータ事前分布（幅 κ）で数値積分する',
        'hyp2f1_half <- function(cc, z) { term <- 1; s <- 1; k <- 0; repeat { term <- term * (0.5 + k)^2 / ((cc + k) * (k + 1)) * z; s <- s + term; k <- k + 1; if (abs(term) < 1e-15 * abs(s) || k > 100000) break }; s }',
        'bf_cor <- function(r, n, kappa = 1) {',
        '  a <- 1 / kappa; cc <- n - 0.5',
        '  lf <- function(rho) (a - 1) * (log1p(rho) + log1p(-rho)) - (2 * a - 1) * log(2) - (2 * lgamma(a) - lgamma(2 * a)) + (n - 1) / 2 * log1p(-rho^2) + (1.5 - n) * log1p(-rho * r) + log(vapply(rho, function(z) hyp2f1_half(cc, (1 + z * r) / 2), 0))',
        '  l0 <- log(hyp2f1_half(cc, 0.5))',
        '  integrate(function(rho) exp(lf(rho) - l0), -1, 1, subdivisions = 2000, rel.tol = 1e-10)$value',
        '}');
    }
    b.add(`vars <- ${vecS(vars)}`,
      'for (p in combn(vars, 2, simplify = FALSE)) {',
      '  d <- dat[complete.cases(dat[p]), p]; x <- d[[1]]; y <- d[[2]]; n <- length(x)',
      `  cat("${NL}====", p[1], "と", p[2], "====  N =", n, "${NL}")`,
      '  rk_ <- paste0("a=", p[1], ",b=", p[2])');
    if (methods.includes('pearson')) {
      b.add(`  rp <- cor.test(x, y, method = "pearson", conf.level = ${lv}); print(rp)`);
      b.chkR(T, 'rk_', 'pearson', 'unname(rp$estimate)').chkR(T, 'rk_', 'pearsonP', 'rp$p.value').chkR(T, 'rk_', 'lo', 'rp$conf.int[1]').chkR(T, 'rk_', 'hi', 'rp$conf.int[2]').chkR(T, 'rk_', 'n', 'n');
    }
    if (methods.includes('spearman')) {
      b.add('  rs <- cor.test(x, y, method = "spearman", exact = FALSE); print(rs)   # p は t 分布による近似（Shirabe と同じ）');
      b.chkR(T, 'rk_', 'spearman', 'unname(rs$estimate)').chkR(T, 'rk_', 'spearmanP', 'rs$p.value');
    }
    if (methods.includes('kendall')) {
      b.add('  rk <- cor.test(x, y, method = "kendall", exact = (n < 50 && !anyDuplicated(x) && !anyDuplicated(y))); print(rk)   # 同順位がなく n < 50 なら正確な分布');
      b.chkR(T, 'rk_', 'kendall', 'unname(rk$estimate)').chkR(T, 'rk_', 'kendallP', 'rk$p.value');
    }
    if (o.bf && o.pearson) {
      b.add(`  bf10 <- bf_cor(unname(rp$estimate), n, ${priorOf(o, 1)})`, `  cat("BF10 =", bf10, "  BF01 =", 1 / bf10, "  log(BF10) =", log(bf10), "${NL}")`);
      b.chkR(T, 'rk_', 'bfv', bfShowR(o, 'bf10'));
    }
    b.add('}');
    if (o.scatter) b.add('pairs(dat[vars])   # 散布図行列');
  };

  // ---- 線形回帰
  gen.regression = (b, c) => {
    const { sel, o, ds, D } = c, lv = level(o), dv = sel.dv[0], covs = sel.covs, facs = sel.factors;
    b.num(dv); covs.forEach(n => b.num(n)); facs.forEach(n => b.cat(n));
    const all = [dv, ...covs, ...facs];
    b.head('線形回帰');
    const rhs = [...covs.map(nm), ...facs.map(nm)].join(' + ');
    if (o.bf) {
      b.add('# ベイズファクター（Liang et al., 2008）: 回帰係数に Zellner-Siow（JZS）事前分布、g の事前分布は逆ガンマ(1/2, N r²/2)。',
        '# 説明変数の数 p とそのモデルの決定係数 R² から、切片だけのモデルに対する BF10 を数値積分で求める',
        `bf_reg <- function(N, p, R2, r = ${priorOf(o, Math.SQRT2 / 4)}) {`,
        '  if (p == 0) return(1)',
        '  bb <- N * r^2 / 2',
        '  lf <- function(t) { g <- exp(t); (N - p - 1) / 2 * log1p(g) - (N - 1) / 2 * log1p(g * (1 - R2)) + 0.5 * log(bb / pi) - t / 2 - bb / g }   # g = e^t の変数変換を含む',
        '  m <- optimize(lf, c(-20, 30), maximum = TRUE)$objective',
        '  exp(m) * integrate(function(t) exp(lf(t) - m), -30, 60, rel.tol = 1e-10, subdivisions = 2000)$value',
        '}');
    }
    b.add(`dv <- ${q(dv)}; covs <- ${covs.length ? vecS(covs) : 'character(0)'}; facs <- ${facs.length ? vecS(facs) : 'character(0)'}`,
      'd <- droplevels(dat[complete.cases(dat[c(dv, covs, facs)]), c(dv, covs, facs)]); N <- nrow(d)',
      'op <- options(contrasts = c("contr.treatment", "contr.poly"))   # カテゴリ変数は最初の水準を基準にしたダミー変数',
      `fit <- lm(${nm(dv)} ~ ${rhs}, data = d)`,
      'sf <- summary(fit); print(sf)',
      `ci <- confint(fit, level = ${lv}); print(ci)`,
      'X <- model.matrix(fit); Xp <- X[, -1, drop = FALSE]; asg <- attr(X, "assign")[-1]',
      'sst <- sum((d[[dv]] - mean(d[[dv]]))^2); sse <- sum(residuals(fit)^2); dfe <- fit$df.residual; p <- ncol(Xp); R2 <- sf$r.squared',
      `cat("R =", sqrt(R2), "  R² =", R2, "  調整済み R² =", sf$adj.r.squared, "  RMSE =", sf$sigma, "${NL}")`);
    if (o.anova) b.add(`cat("回帰: 平方和", sst - sse, " 自由度", p, " F =", sf$fstatistic[1], "${NL}")`);
    if (o.dw) b.add('dw <- sum(diff(residuals(fit))^2) / sum(residuals(fit)^2); cat("Durbin-Watson 比 =", dw, "' + NL + '")');
    b.add('beta <- coef(fit)[-1] * apply(Xp, 2, sd) / sd(d[[dv]])   # 標準化係数 β',
      'tol_vif <- if (p >= 2) diag(solve(cor(Xp))) else rep(1, p)',
      'coefs <- data.frame(B = coef(fit), SE = sf$coefficients[, 2], beta = c(NA, beta), t = sf$coefficients[, 3], p = sf$coefficients[, 4], 下限 = ci[, 1], 上限 = ci[, 2], VIF = c(NA, tol_vif), "許容度" = c(NA, 1 / tol_vif))',
      'print(coefs)');
    if (o.bf) {
      b.add('bf_full <- bf_reg(N, p, R2)',
        'bf_drop <- sapply(unique(asg), function(tm) { keep <- asg != tm; Xk <- cbind(1, Xp[, keep, drop = FALSE]); r2 <- 1 - sum(lm.fit(Xk, d[[dv]])$residuals^2) / sst; bf_full / bf_reg(N, sum(keep), r2) })',
        `cat("モデル全体の BF10 =", bf_full, "${NL}"); print(setNames(bf_drop, c(covs, facs)))   # 各説明変数（カテゴリ変数はダミー変数一式）を除いたモデルとの比`);
    }
    if (o.desc) b.add('print(sapply(d[c(dv, covs)], function(z) c(N = length(z), 平均値 = mean(z), SD = sd(z), SE = sd(z) / sqrt(length(z)))))');
    if (o.residPlot) b.add('plot(fitted(fit), residuals(fit), xlab = "予測値", ylab = "残差"); abline(h = 0, lty = 2)');
    if (o.qq) b.add('qqnorm(residuals(fit)); qqline(residuals(fit))');
    b.add('options(op)');
    if (b.test) {
      const idx = D.complete(ds, all.map(n => D.byName(ds, n)));
      const names = ['（切片）', ...covs, ...facs.flatMap(f => { const col = D.byName(ds, f); return col.levels.filter(l => idx.some(i => col.raw[i] === l)).slice(1).map(l => `${f} (${l})`); })];
      const S_ = `モデルの要約 — ${dv}`;
      b.chk(S_, '', 'R', 'sqrt(R2)').chk(S_, '', 'R2', 'R2').chk(S_, '', 'adj', 'sf$adj.r.squared').chk(S_, '', 'rmse', 'sf$sigma');
      if (o.dw) b.chk(S_, '', 'dw', 'dw');
      if (o.anova) b.chk('分散分析', 'src=回帰', 'ss', 'sst - sse').chk('分散分析', 'src=回帰', 'F', 'sf$fstatistic[1]').chk('分散分析', 'src=残差', 'ss', 'sse');
      names.forEach((nmj, i) => {
        const r_ = `name=${nmj}`;
        b.chk('係数', r_, 'b', `coefs$B[${i + 1}]`).chk('係数', r_, 'se', `coefs$SE[${i + 1}]`).chk('係数', r_, 't', `coefs$t[${i + 1}]`).chk('係数', r_, 'p', `coefs$p[${i + 1}]`)
          .chk('係数', r_, 'lo', `coefs[[${i + 1}, "下限"]]`).chk('係数', r_, 'hi', `coefs[[${i + 1}, "上限"]]`);
        if (i > 0 && o.beta) b.chk('係数', r_, 'beta', `coefs$beta[${i + 1}]`);
        if (i > 0 && o.vif) b.chk('係数', r_, 'vif', `coefs$VIF[${i + 1}]`).chk('係数', r_, 'tol', `coefs[[${i + 1}, "許容度"]]`);
        if (i > 0 && o.bf) b.add(`chk(${q('係数|' + r_ + '|bf')}, ${bfShowR(o, 'bf_drop[asg[' + i + ']]')})`);
      });
      if (o.bf) b.add(`chk(${q(S_ + '||bf')}, ${bfShowR(o, 'bf_full')})`);
    }
  };

  // ---- 分割表
  gen.contingency = (b, c) => {
    const { sel, o, ds, D } = c, rv = sel.rows[0], cv = sel.cols[0], lv = level(o);
    b.cat(rv, cv);
    if (o.bf) b.pkg('BayesFactor');
    b.head('分割表（クロス集計）');
    b.add(`rv <- ${q(rv)}; cv <- ${q(cv)}`,
      'd <- droplevels(dat[complete.cases(dat[c(rv, cv)]), c(rv, cv)])',
      'tab <- table(d[[rv]], d[[cv]]); N <- sum(tab); I <- nrow(tab); J <- ncol(tab); print(addmargins(tab))',
      'ct <- chisq.test(tab, correct = FALSE)   # 期待度数が小さいと警告が出る');
    if (o.expected) b.add('print(round(ct$expected, 2))   # 期待度数');
    if (o.rowPct) b.add('print(round(100 * prop.table(tab, 1), 2))   # 行 %');
    if (o.colPct) b.add('print(round(100 * prop.table(tab, 2), 2))   # 列 %');
    if (o.totPct) b.add('print(round(100 * prop.table(tab), 2))   # 全体 %');
    if (o.resid) b.add('print(round(ct$stdres, 2))   # 調整済み標準化残差');
    const T = '検定';
    if (o.chi) { b.add('print(ct)'); b.chk(T, 'test=χ²', 'v', 'unname(ct$statistic)').chk(T, 'test=χ²', 'df', 'unname(ct$parameter)').chk(T, 'test=χ²', 'p', 'ct$p.value'); }
    if (o.yates) { b.add('if (I == 2 && J == 2) { cy <- chisq.test(tab, correct = TRUE); print(cy) }');
      if (b.test && ds && true) b.add(`if (I == 2 && J == 2) { chk(${q(T + '|test=χ²（連続性の補正）|v')}, unname(cy$statistic)); chk(${q(T + '|test=χ²（連続性の補正）|p')}, cy$p.value) }`); }
    if (o.lr) { b.add('g2 <- 2 * sum(ifelse(tab > 0, tab * log(tab / ct$expected), 0)); cat("尤度比 G² =", g2, " p =", pchisq(g2, (I - 1) * (J - 1), lower.tail = FALSE), "' + NL + '")');
      b.chk(T, 'test=尤度比 G²', 'v', 'g2').chk(T, 'test=尤度比 G²', 'p', 'pchisq(g2, (I - 1) * (J - 1), lower.tail = FALSE)'); }
    if (o.fisher) { b.add('if (I == 2 && J == 2) { ft <- fisher.test(tab); print(ft) }');
      if (b.test) b.add(`if (I == 2 && J == 2) chk(${q(T + '|test=Fisher の正確検定|p')}, ft$p.value)`); }
    if (o.cramer) {
      b.add('v_cramer <- sqrt(unname(ct$statistic) / (N * (min(I, J) - 1))); cat("Cramér の V =", v_cramer, "' + NL + '")',
        'if (I == 2 && J == 2) { phi <- (tab[1, 1] * tab[2, 2] - tab[1, 2] * tab[2, 1]) / sqrt(prod(rowSums(tab)) * prod(colSums(tab))); cat("φ =", phi, "' + NL + '") }');
      b.chk('効果量', 'm=Cramér の V', 'v', 'v_cramer');
      if (b.test) b.add(`if (I == 2 && J == 2) chk(${q('効果量|m=φ|v')}, phi)`);
    }
    if (o.or) {
      b.add('if (I == 2 && J == 2 && all(tab > 0)) {',
        '  or <- tab[1, 1] * tab[2, 2] / (tab[1, 2] * tab[2, 1]); se_l <- sqrt(sum(1 / tab))',
        `  cat("オッズ比 =", or, "  ${+(lv * 100).toFixed(1)}% 信頼区間 [", exp(log(or) - qnorm(1 - (1 - ${lv}) / 2) * se_l), ",", exp(log(or) + qnorm(1 - (1 - ${lv}) / 2) * se_l), "]（Woolf 法）${NL}")`,
        '}');
      if (b.test) b.add('if (I == 2 && J == 2 && all(tab > 0)) {',
        `  chk(${q('効果量|m=オッズ比|v')}, or); chk(${q('効果量|m=オッズ比|lo')}, exp(log(or) - qnorm(1 - (1 - ${lv}) / 2) * se_l)); chk(${q('効果量|m=オッズ比|hi')}, exp(log(or) + qnorm(1 - (1 - ${lv}) / 2) * se_l))`, '}');
    }
    if (o.bf) {
      const a = priorOf(o, 1);
      b.add(`bf <- BayesFactor::contingencyTableBF(tab, sampleType = "jointMulti", priorConcentration = ${a}); print(bf)   # 同時多項分布の Gunel-Dickey ベイズファクター`,
        'bf10 <- BayesFactor::extractBF(bf)$bf[1]',
        `cat("BF10 =", bf10, "  BF01 =", 1 / bf10, "  log(BF10) =", log(bf10), "${NL}")`);
      const lab = o.bfType === 'bf01' ? 'BF₀₁' : o.bfType === 'log' ? 'log(BF₁₀)' : 'BF₁₀';
      b.chk(T, `test=ベイズファクター ${lab}`, 'v', bfShowR(o, 'bf10'));
    }
  };

  // ---- 二項検定
  gen.binomial = (b, c) => {
    const { sel, o, ds, D } = c, lv = level(o), p0 = Math.min(1, Math.max(0, Number(o.p0))), T = '二項検定';
    sel.vars.forEach(n => b.cat(n));
    b.head('二項検定');
    if (o.bf && p0 > 0 && p0 < 1) {
      b.add('# ベイズファクター: 比率の事前分布は一様分布 Beta(1, 1)（片側は検定する比率で切断）。BF10 = 周辺尤度 ÷ H0 の尤度',
        'bf_binom <- function(x, n, p0, alt = "two.sided") {',
        '  l0 <- x * log(p0) + (n - x) * log1p(-p0); lb <- lbeta(x + 1, n - x + 1)',
        '  if (alt == "greater") exp(lb - l0) * pbeta(p0, x + 1, n - x + 1, lower.tail = FALSE) / (1 - p0)',
        '  else if (alt == "less") exp(lb - l0) * pbeta(p0, x + 1, n - x + 1) / p0',
        '  else exp(lb - l0)',
        '}');
    }
    b.add(`vars <- ${vecS(sel.vars)}; p0 <- ${num(p0)}`,
      'for (v in vars) {',
      '  x_ <- dat[[v]]; x_ <- x_[!is.na(x_)]; n <- length(x_)',
      '  for (l in levels(droplevels(factor(x_)))) {',
      '    x <- sum(x_ == l)',
      `    bt <- binom.test(x, n, p = p0, alternative = ${q(ALTR[o.alt])}, conf.level = ${lv}); print(bt)`,
      `    cat(v, "=", l, ": 度数", x, "/", n, " 比率", x / n, "${NL}")`,
      '    rk_ <- paste0("var=", v, ",lv=", l)');
    b.chkR(T, 'rk_', 'x', 'x').chkR(T, 'rk_', 'prop', 'x / n').chkR(T, 'rk_', 'p', 'bt$p.value').chkR(T, 'rk_', 'lo', 'bt$conf.int[1]').chkR(T, 'rk_', 'hi', 'bt$conf.int[2]');
    if (o.bf && p0 > 0 && p0 < 1) {
      b.add(`    bf10 <- bf_binom(x, n, p0, ${q(ALTR[o.alt])}); cat("BF10 =", bf10, "  BF01 =", 1 / bf10, "  log(BF10) =", log(bf10), "${NL}")`);
      b.chkR(T, 'rk_', 'bf', bfShowR(o, 'bf10'));
    }
    b.add('  }', '}');
  };

  // ---- 信頼性分析
  gen.reliability = (b, c) => {
    const { sel, o, ds, D } = c, lv = level(o), items = sel.items, rev = sel.reverse.filter(r_ => items.includes(r_)), T = '尺度の信頼性', k = items.length;
    if (k < 2) return;
    items.forEach(n => b.num(n));
    const useOmega = (o.omega || o.loadings || o.omegaCI) && k >= 3;
    if (useOmega) b.pkg('lavaan');
    b.head('信頼性分析');
    b.add(`items <- ${vecS(items)}; rev_items <- ${rev.length ? vecS(rev) : 'character(0)'}`,
      'd <- dat[complete.cases(dat[items]), items]; n <- nrow(d); k <- ncol(d)',
      'lo <- min(as.matrix(d)); hi <- max(as.matrix(d))',
      'for (r in rev_items) d[[r]] <- lo + hi - d[[r]]   # 逆転項目: (最小値 + 最大値) − 値',
      'alpha_fun <- function(m) { kk <- ncol(m); kk / (kk - 1) * (1 - sum(apply(m, 2, var)) / var(rowSums(m))) }',
      'a <- alpha_fun(d); R <- cor(d); rbar <- mean(R[lower.tri(R)]); tot <- rowSums(d)',
      `cat("Cronbach の α =", a, "  標準化 α =", k * rbar / (1 + (k - 1) * rbar), "  項目間相関の平均 =", rbar, "${NL}")`,
      'cat("合計得点の平均 =", mean(tot), "  SD =", sd(tot), "' + NL + '")');
    b.chk(T, '', 'a', 'a').chk(T, '', 's', 'k * rbar / (1 + (k - 1) * rbar)').chk(T, '', 'r', 'rbar').chk(T, '', 'm', 'mean(tot)').chk(T, '', 'sd', 'sd(tot)');
    b.pkg('psych');
    b.add('print(psych::alpha(d, check.keys = FALSE))   # 同じ値を psych で確かめる（raw_alpha、std.alpha、average_r、r.drop、alpha-if-dropped）');
    if (o.itemStats) {
      b.add('item_stats <- do.call(rbind, lapply(seq_len(k), function(j) data.frame(項目 = items[j], 平均値 = mean(d[[j]]), SD = sd(d[[j]]), "項目-残余相関" = cor(d[[j]], tot - d[[j]]), "項目を除いたα" = if (k > 2) alpha_fun(d[-j]) else NA, check.names = FALSE)))',
        'print(item_stats)');
      if (b.test) items.forEach((it, j) => {
        const lab = it + (rev.includes(it) ? '（逆転）' : '');
        b.chk('項目ごとの統計量', `name=${lab}`, 'mean', `item_stats[[${j + 1}, "平均値"]]`).chk('項目ごとの統計量', `name=${lab}`, 'sd', `item_stats[[${j + 1}, "SD"]]`)
          .chk('項目ごとの統計量', `name=${lab}`, 'rir', `item_stats[[${j + 1}, "項目-残余相関"]]`);
        if (k > 2) b.chk('項目ごとの統計量', `name=${lab}`, 'del', `item_stats[[${j + 1}, "項目を除いたα"]]`);
      });
    }
    if (useOmega) {
      b.add('', '# McDonald の ω: 1 因子モデルを最尤法（lavaan）であてはめ、(Σλ)² / ((Σλ)² + Σθ) を求める（共分散行列のまま。因子の分散は 1 に固定）',
        'omega_fit <- function(S_, n_) { v <- paste0("v", seq_len(ncol(S_))); dimnames(S_) <- list(v, v)',
        '  f <- lavaan::cfa(paste("F =~", paste(v, collapse = " + ")), sample.cov = S_, sample.nobs = n_, std.lv = TRUE)',
        '  pe <- lavaan::parameterEstimates(f); lam <- pe$est[pe$op == "=~"]; th <- pe$est[pe$op == "~~" & pe$lhs == pe$rhs & pe$lhs %in% v]',
        '  list(omega = sum(lam)^2 / (sum(lam)^2 + sum(th)), lambda = lam, theta = th, fit = f) }',
        '# lavaan に sample.cov を渡すときは n − 1 で割った共分散行列にする（lavaan が内部で n で割る形に直す）',
        'om <- omega_fit(cov(d), n); cat("McDonald の ω =", om$omega, "' + NL + '")');
      if (o.omega) b.chk(T, '', 'w', 'om$omega');
      if (o.loadings) {
        b.add('Sd <- sqrt(diag(cov(d)) * (n - 1) / n)   # 標準化には n で割った分散を使う', 'print(data.frame(項目 = items, "負荷量" = om$lambda, "標準化した負荷量" = om$lambda / Sd, "独自分散" = om$theta, check.names = FALSE))');
        if (b.test) items.forEach((it, j) => { const lab = it + (rev.includes(it) ? '（逆転）' : ''); b.chk('因子負荷量（1因子モデル）', `name=${lab}`, 'l', `om$lambda[${j + 1}]`).chk('因子負荷量（1因子モデル）', `name=${lab}`, 'ls', `om$lambda[${j + 1}] / Sd[${j + 1}]`).chk('因子負荷量（1因子モデル）', `name=${lab}`, 'psi', `om$theta[${j + 1}]`); });
      }
      if (o.itemStats && o.omega && k > 3) {
        b.add('w_del <- sapply(seq_len(k), function(j) omega_fit(cov(d)[-j, -j], n)$omega); print(data.frame(項目 = items, "項目を除いたω" = w_del, check.names = FALSE))');
        if (b.test) items.forEach((it, j) => b.chk('項目ごとの統計量', `name=${it + (rev.includes(it) ? '（逆転）' : '')}`, 'wdel', `w_del[${j + 1}]`));
      }
      if (o.omegaCI) {
        b.add('', '# ω のブートストラップ信頼区間（行を復元抽出、1000 回、パーセンタイル法）。Shirabe と同じ乱数列（線形合同法）で同じ行を引くので、同じ区間になる',
          'seed_ <- 20261001',
          'rnd <- function() { seed_ <<- (seed_ * 1664525 + 1013904223) %% 4294967296; seed_ / 4294967296 }',
          'wb <- numeric(1000)',
          'for (bi in seq_len(1000)) { pick <- vapply(seq_len(n), function(i) floor(rnd() * n) + 1, 1); db <- as.matrix(d)[pick, ]',
          '  wb[bi] <- tryCatch(omega_fit(cov(db), n)$omega, error = function(e) NA, warning = function(w) suppressWarnings(omega_fit(cov(db), n)$omega)) }',
          `ci_w <- quantile(wb, c((1 - ${lv}) / 2, 1 - (1 - ${lv}) / 2), na.rm = TRUE, type = 7); print(ci_w)`);
        b.chk(T, '', 'wlo', 'ci_w[1]').chk(T, '', 'whi', 'ci_w[2]');
      }
    }
  };

  // ---- 探索的因子分析
  gen.efa = (b, c) => {
    const { sel, o, ds, D } = c, items = sel.items, p = items.length;
    if (p < 3) return;
    items.forEach(n => b.num(n));
    b.pkg('psych', 'GPArotation');
    b.head('探索的因子分析');
    const fm = { minres: 'minres', paf: 'pa', ml: 'ml' }[o.method] || 'minres';
    const rot = o.rotation || 'oblimin', paType = o.paBase === 'fa' ? 'fa' : 'pc', cut = Math.max(0, Number(o.cut) || 0);
    const needPA = o.nfMethod === 'parallel' || o.pa;
    b.add(`items <- ${vecS(items)}`,
      'd <- dat[complete.cases(dat[items]), items]; n <- nrow(d); p <- ncol(d)',
      'R <- cor(d)   # Pearson の相関行列',
      'ev <- eigen(R)$values');
    if (needPA) {
      b.add('', `# 平行分析: 同じ人数・項目数の正規乱数 500 組の固有値の平均（Shirabe と同じ乱数列: 線形合同法 + Box-Muller）。psych::fa.parallel() でも同様にできる`,
        'seed_ <- 20261002',
        'lcg <- function(len) { out <- numeric(len); for (i in seq_len(len)) { seed_ <<- (seed_ * 1664525 + 1013904223) %% 4294967296; out[i] <- seed_ / 4294967296 }; out }',
        'smc_ <- function(Rm) pmin(0.995, pmax(0.005, 1 - 1 / diag(solve(Rm))))',
        `pa_type <- ${q(paType)}   # "pc": 相関行列の固有値 / "fa": 対角に重相関の二乗を入れた固有値`,
        'sim <- t(sapply(seq_len(500), function(s) { u <- lcg(2 * n * p); z <- sqrt(-2 * log(u[seq(1, 2 * n * p, 2)] + 1e-12)) * cos(2 * pi * u[seq(2, 2 * n * p, 2)])',
        '  Rs <- cor(matrix(z, n, p)); if (pa_type == "fa") diag(Rs) <- smc_(Rs); sort(eigen(Rs, symmetric = TRUE, only.values = TRUE)$values, decreasing = TRUE) }))',
        'pa_mean <- colMeans(sim); pa_p95 <- apply(sim, 2, quantile, 0.95, type = 7)',
        'Rr <- R; if (pa_type == "fa") diag(Rr) <- smc_(R); obs <- sort(eigen(Rr, symmetric = TRUE, only.values = TRUE)$values, decreasing = TRUE)',
        'print(data.frame(成分 = seq_len(p), 固有値 = ev, 観測 = obs, 乱数の平均 = pa_mean, 乱数の95 = pa_p95, check.names = FALSE))');
    }
    if (o.nfMethod === 'fixed') b.add(`m <- ${Math.max(1, Math.round(Number(o.nf) || 1))}   # 因子数（指定）`);
    else if (o.nfMethod === 'kaiser') b.add('m <- max(1, sum(ev > 1))   # 因子数: 固有値が 1 より大きい数');
    else b.add('m <- max(1, sum(cumprod(obs > pa_mean)))   # 因子数: 観測の固有値が乱数の平均を上回る間');
    const faArgs = ['R', 'nfactors = m', 'n.obs = n', `fm = ${q(fm)}`, `rotate = ${q(rot)}`];
    if (fm === 'pa') faArgs.push('min.err = 1e-12', 'max.iter = 5000');   // 主因子法の収束判定を厳しくして、Shirabe と同じ解にそろえる
    b.add('cat("因子数 =", m, "' + NL + '")',
      `fa_res <- psych::fa(${faArgs.join(', ')})`,
      `print(fa_res$loadings, cutoff = ${cut}, sort = ${o.sort ? 'TRUE' : 'FALSE'})   # 因子負荷量（斜交回転ではパターン行列）`,
      'h2 <- fa_res$communality; cat("独自性（1 − 共通性）:", round(1 - h2, 3), "' + NL + '")');
    if (o.chars) b.add('print(fa_res$Vaccounted)   # SS 負荷量と寄与率');
    if (o.phi) b.add('if (!is.null(fa_res$Phi)) print(round(fa_res$Phi, 3))   # 因子間相関（斜交回転のとき）');
    if (o.struct) b.add('if (!is.null(fa_res$Structure)) print(round(unclass(fa_res$Structure), 3))   # 構造行列');
    if (o.fit && o.method === 'ml') b.add(`cat("χ² =", fa_res$STATISTIC, " df =", fa_res$dof, " p =", fa_res$PVAL, "${NL}RMSEA =", fa_res$RMSEA[1], " [", fa_res$RMSEA[2], ",", fa_res$RMSEA[3], "]  TLI =", fa_res$TLI, "  BIC =", fa_res$BIC, "${NL}")`);
    if (o.resid) b.add('print(round(fa_res$residual, 3)); cat("RMSR =", fa_res$rms, "' + NL + '")');
    if (o.eigen) b.add(needPA ? '# 固有値は上の平行分析の表を見る' : 'print(data.frame(成分 = seq_len(p), 固有値 = ev, 寄与率 = ev / p, 累積寄与率 = cumsum(ev) / p))');
    if (o.scree) b.add('plot(ev, type = "b", xlab = "成分の番号", ylab = "固有値", main = "スクリープロット"); abline(h = 1, lty = 2)' + (needPA ? '; lines(pa_mean, type = "b", lty = 2, col = 2)' : ''));
    if (o.kmo) b.add('print(psych::KMO(R))', 'print(psych::cortest.bartlett(R, n = n))');
    if (b.test) {
      const T = 'x';
      // 因子数 m は R 側で決まる。表の行は項目名で引く
      b.add('Lm <- unclass(fa_res$loadings)');
      items.forEach((it, j) => {
        b.add(`for (k_ in seq_len(m)) chk(paste0("LOAD|item=", ${q(it)}, "|f", k_ - 1), Lm[${j + 1}, k_])`);
        b.add(`chk(${q('LOAD|item=' + it + '|u')}, 1 - h2[${j + 1}])`);
      });
      b.add('for (k_ in seq_len(m)) chk(paste0("SS|f=因子", k_, "|ss"), fa_res$Vaccounted["SS loadings", k_])');
      b.add('if (!is.null(fa_res$Phi)) for (i_ in seq_len(m)) for (j_ in seq_len(i_)) chk(paste0("PHI|f=因子", i_, "|c", j_ - 1), fa_res$Phi[i_, j_])');
      if (o.fit && o.method === 'ml') b.add('chk("FIT||chi", fa_res$STATISTIC); chk("FIT||df", fa_res$dof); chk("FIT||p", fa_res$PVAL); chk("FIT||rmsea", fa_res$RMSEA[1]); chk("FIT||lo", fa_res$RMSEA[2]); chk("FIT||hi", fa_res$RMSEA[3]); chk("FIT||tli", fa_res$TLI); chk("FIT||bic", fa_res$BIC)');
      if (o.eigen) b.add('for (i_ in seq_len(p)) chk(paste0("固有値|k=", i_, "|v"), ev[i_])');
      if (o.eigen && needPA) b.add('for (i_ in seq_len(p)) { chk(paste0("固有値|k=", i_, "|o2"), obs[i_]); chk(paste0("固有値|k=", i_, "|pm"), pa_mean[i_]); chk(paste0("固有値|k=", i_, "|p95"), pa_p95[i_]) }');
      b.add('chk("NF||m", m)');
      if (o.kmo) { b.add('km <- psych::KMO(R); bt <- psych::cortest.bartlett(R, n = n)', 'chk("KMO（標本妥当性）|item=全体|v", km$MSA)');
        items.forEach((it, j) => b.add(`chk(${q('KMO（標本妥当性）|item=' + it + '|v')}, km$MSAi[${j + 1}])`));
        b.add('chk("Bartlett の球面性検定||chi", bt$chisq); chk("Bartlett の球面性検定||p", bt$p.value)'); }
    }
  };

  // ---- 確認的因子分析
  gen.cfa = (b, c) => {
    const { sel, o, ds, D } = c, lv = level(o);
    const defs = [];
    for (let k = 1; k <= 6; k++) { const its = sel[`f${k}`] || []; if (its.length) defs.push({ name: String(o[`fname${k}`] || '').trim() || `因子${k}`, items: its }); }
    if (!defs.length || defs.some(d_ => d_.items.length < 2)) { b.add('# 各因子に 2 つ以上の項目を入れてください。'); return; }
    const seen = new Set(); defs.forEach(d_ => { let n_ = d_.name, cc = 2; while (seen.has(n_)) n_ = `${d_.name}_${cc++}`; d_.name = n_; seen.add(n_); });
    const names = [...new Set(defs.flatMap(d_ => d_.items))], nf = defs.length, p = names.length;
    names.forEach(n => b.num(n));
    b.pkg('lavaan');
    b.head('確認的因子分析');
    const std = o.scaling === 'std';
    b.add(`items <- ${vecS(names)}`,
      `fnames <- ${vecS(defs.map(d_ => d_.name))}`,
      'd <- dat[complete.cases(dat[items]), items]; n <- nrow(d)',
      '# lavaan の式では、日本語や数字で始まる名前を避けるため別名を使う（v1, v2, … と F1, F2, …）。結果は最後に元の名前へ戻す',
      'dd <- d; names(dd) <- paste0("v", seq_along(items)); fid <- paste0("F", seq_along(fnames))',
      'model <- "');
    defs.forEach((d_, k) => b.add(`F${k + 1} =~ ${d_.items.map(i => 'v' + (names.indexOf(i) + 1)).join(' + ')}      # ${d_.name}`));
    b.add('"',
      `fit <- lavaan::cfa(model, data = dd, estimator = "ML", std.lv = ${std ? 'TRUE' : 'FALSE'}, orthogonal = ${o.orth ? 'TRUE' : 'FALSE'})   # ${std ? '因子の分散を 1 に固定' : '各因子の最初の項目の負荷量を 1 に固定（マーカー変数法）'}`,
      'print(summary(fit, fit.measures = TRUE, standardized = TRUE))',
      'back <- function(x) { x <- as.character(x); x[x %in% names(dd)] <- items[match(x[x %in% names(dd)], names(dd))]; x[x %in% fid] <- fnames[match(x[x %in% fid], fid)]; x }',
      'fm <- lavaan::fitMeasures(fit, c("chisq", "df", "pvalue", "baseline.chisq", "baseline.df", "baseline.pvalue", "cfi", "tli", "rmsea", "rmsea.ci.lower", "rmsea.ci.upper", "srmr"))',
      'print(round(fm, 4))   # χ²、適合度指標（RMSEA は 90% 信頼区間）',
      `pe <- lavaan::parameterEstimates(fit, standardized = TRUE, level = ${lv}); pe$lhs <- back(pe$lhs); pe$rhs <- back(pe$rhs); print(pe)`);
    const T = '因子負荷量';
    if (b.test) {
      b.add('KEYS <- c(est = "est", se = "se", z = "z", pvalue = "p", ci.lower = "lo", ci.upper = "hi", std.all = "std")   # lavaan の列 → Shirabe の表の列',
        'chk("モデルの検定（χ²）|m=因子モデル|chi", fm[["chisq"]]); chk("モデルの検定（χ²）|m=因子モデル|df", fm[["df"]])',
        'chk("モデルの検定（χ²）|m=ベースラインモデル（項目どうしが無相関）|chi", fm[["baseline.chisq"]]); chk("モデルの検定（χ²）|m=ベースラインモデル（項目どうしが無相関）|df", fm[["baseline.df"]])',
        'if (fm[["df"]] > 0) chk("モデルの検定（χ²）|m=因子モデル|p", fm[["pvalue"]])');
      if (o.fit) b.add('chk("適合度指標||cfi", fm[["cfi"]]); chk("適合度指標||rmsea", fm[["rmsea"]]); chk("適合度指標||lo", fm[["rmsea.ci.lower"]]); chk("適合度指標||hi", fm[["rmsea.ci.upper"]]); chk("適合度指標||srmr", fm[["srmr"]])',
        'if (fm[["df"]] > 0) chk("適合度指標||tli", fm[["tli"]])');
      // lavaan は固定した値の標準誤差を 0 と出す。固定した値は推定値と標準化だけを比べる
      b.add('ld <- pe[pe$op == "=~", ]',
        'for (i_ in seq_len(nrow(ld))) { rk <- paste0("f=", ld$lhs[i_], ",item=", ld$rhs[i_]); cols_ <- if (ld$se[i_] > 0) names(KEYS) else c("est", "std.all")',
        `  for (cc in cols_) chk(paste0(${q(T + '|')}, rk, "|", KEYS[[cc]]), ld[[cc]][i_]) }`,
        'cv <- pe[pe$op == "~~" & pe$lhs != pe$rhs & pe$lhs %in% fnames & pe$se > 0, ]',
        'for (i_ in seq_len(nrow(cv))) { rk <- paste0("a=", cv$lhs[i_], ",b=", cv$rhs[i_]); for (cc in names(KEYS)) chk(paste0("因子の分散・共分散|", rk, "|", KEYS[[cc]]), cv[[cc]][i_]) }',
        'fv <- pe[pe$op == "~~" & pe$lhs == pe$rhs & pe$lhs %in% fnames & pe$se > 0, ]',
        'for (i_ in seq_len(nrow(fv))) { rk <- paste0("a=", fv$lhs[i_], ",b=（分散）"); for (cc in setdiff(names(KEYS), "std.all")) chk(paste0("因子の分散・共分散|", rk, "|", KEYS[[cc]]), fv[[cc]][i_]) }',
        'ev_ <- pe[pe$op == "~~" & pe$lhs == pe$rhs & pe$lhs %in% items, ]',
        'for (i_ in seq_len(nrow(ev_))) { rk <- paste0("item=", ev_$lhs[i_]); for (cc in names(KEYS)) chk(paste0("項目の独自分散（誤差分散）|", rk, "|", KEYS[[cc]]), ev_[[cc]][i_]) }');
    }
    if (o.stdSE) {
      b.add('', `ss_ <- lavaan::standardizedSolution(fit, level = ${lv}); ss_$lhs <- back(ss_$lhs); ss_$rhs <- back(ss_$rhs); print(ss_)   # 標準化した推定値と、デルタ法の標準誤差・信頼区間`);
      if (b.test) b.add('sl <- ss_[ss_$op == "=~", ]',
        'for (i_ in seq_len(nrow(sl))) { rk <- paste0("f=", sl$lhs[i_], ",item=", sl$rhs[i_]); for (cc in c("est.std", "se", "z", "pvalue", "ci.lower", "ci.upper")) chk(paste0("標準化した因子負荷量|", rk, "|", c(est.std = "est", se = "se", z = "z", pvalue = "p", ci.lower = "lo", ci.upper = "hi")[[cc]]), sl[[cc]][i_]) }',
          'sv <- ss_[ss_$op == "~~" & ss_$lhs == ss_$rhs & ss_$lhs %in% items, ]',
          'for (i_ in seq_len(nrow(sv))) { rk <- paste0("item=", sv$lhs[i_]); for (cc in c("est.std", "se", "z", "pvalue", "ci.lower", "ci.upper")) chk(paste0("標準化した独自分散|", rk, "|", c(est.std = "est", se = "se", z = "z", pvalue = "p", ci.lower = "lo", ci.upper = "hi")[[cc]]), sv[[cc]][i_]) }');
    }
    if (o.reliab) {
      b.add('', '# 因子ごとの信頼性: 標準化した負荷量 λ と標準化した独自分散 θ から ω = (Σλ)² / ((Σλ)² + Σθ)、AVE = λ² の平均',
        'sl_ <- lavaan::standardizedSolution(fit); lam_ <- sl_[sl_$op == "=~", ]; th_ <- sl_[sl_$op == "~~" & sl_$lhs == sl_$rhs & sl_$lhs %in% names(dd), ]',
        'rel <- do.call(rbind, lapply(seq_along(fnames), function(k) { l <- lam_[lam_$lhs == fid[k], ]; t <- th_$est.std[match(l$rhs, th_$lhs)]; data.frame(因子 = fnames[k], 項目数 = nrow(l), omega = sum(l$est.std)^2 / (sum(l$est.std)^2 + sum(t)), AVE = mean(l$est.std^2)) }))',
        'print(rel)');
      if (b.test) defs.forEach((d_, k) => b.chk('因子ごとの信頼性', `f=${d_.name}`, 'w', `rel$omega[${k + 1}]`).chk('因子ごとの信頼性', `f=${d_.name}`, 'ave', `rel$AVE[${k + 1}]`));
    }
    if (o.resid) b.add('', 'rs <- lavaan::resid(fit, type = "cor")$cov; dimnames(rs) <- list(items, items); print(round(rs, 3))   # 観測の相関 − モデルから再現した相関');
    if (b.test && o.resid) {
      names.forEach((nmi, i) => { if (i > 0) names.slice(0, i).forEach((nmj, j) => b.add(`chk(${q('残差相関（観測の相関 − モデルから再現した相関）|item=' + nmi + '|c' + j)}, rs[${i + 1}, ${j + 1}])`)); });
    }
  };

  // ------------------------------------------------------------ 組み立て
  const gens = gen;
  RC.supported = id => !!gens[id];

  function header(title, settings, pkgs, n, cells) {
    const d = new Date(), ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const L = ['# =====================================================================',
      `# Shirabe の「${title}」を R で再現するためのコード（データ込み）`,
      `# 作成: ${ymd}  https://k518-2026.github.io/Shirabe/`,
      '# 使い方: 全体をコピーして R（または JASP の R コンソール）に貼り付けて実行します。',
      `# データ: ${n} 行の中で、この分析に使う列だけを埋め込んでいます（欠損は NA）。`,
      '# 欠損値は、分析ごとに使う変数のどれかが欠けている行を除きます（Shirabe と同じ）。'];
    if (settings) L.push(...settings.map(s => '# ' + s));
    if (pkgs.length) L.push(`# 必要なパッケージ: ${pkgs.join(', ')}（無い場合は install.packages("名前")）`);
    L.push('# 文字コード: 日本語の変数名・水準名を含むので、UTF-8 の R（R 4.2 以降の Windows など）で実行してください。',
      '# 数値は Shirabe の画面（小数 3 桁）と見比べてください。R の出力は桁数が多く、丸め方も少し違います。',
      '# =====================================================================');
    return L;
  }
  function pkgCheck(pkgs) {
    if (!pkgs.length) return [];
    return ['', `need <- ${vecS(pkgs)}`,
      'miss <- need[!vapply(need, requireNamespace, logical(1), quietly = TRUE)]',
      'if (length(miss)) stop("次のパッケージが必要です: ", paste(miss, collapse = ", "), "  → install.packages(c(", paste0(\'"\', miss, \'"\', collapse = ", "), "))")'];
  }

  // items: [{ def, sel, opt }]。複数を渡すと、データを 1 回だけ埋め込んだ 1 本のスクリプトになる
  RC.build = function (ds, items, ctx) {
    const D = ctx.D, forTest = !!ctx.forTest;
    const bs = items.map(it => {
      const b = new Builder({ forTest });
      if (!gens[it.def.id]) { b.add('', `# ---- ${it.def.title} ----`, '# この分析の R コードにはまだ対応していません。'); return { b, it }; }
      try { gens[it.def.id](b, { sel: it.sel, o: it.opt, ds, D }); }
      catch (e) {
        if (forTest) throw e;
        const eb = new Builder({ forTest });
        eb.add('', `# ---- ${it.def.title} ----`, '# この分析の R コードを作れませんでした（変数の割り当てを確かめてください）。');
        return { b: eb, it };
      }
      if (!forTest && (!b.cols.size || [...b.cols].some(n => !D.byName(ds, n)))) {
        const eb = new Builder({ forTest });
        eb.add('', `# ---- ${it.def.title} ----`, '# 変数がまだ割り当てられていないので、R コードを作れませんでした。');
        return { b: eb, it };
      }
      return { b, it };
    });
    const cols = [], facs = new Set(), pkgs = new Set();
    bs.forEach(({ b }) => { b.cols.forEach(n => { if (!cols.includes(n)) cols.push(n); }); b.facs.forEach(n => facs.add(n)); b.pkgs.forEach(p => pkgs.add(p)); });
    const title = items.length === 1 ? items[0].def.title : `${items.length} つの分析`;
    const out = header(title, ctx.settings, [...pkgs], ds.n);
    out.push(...pkgCheck([...pkgs]));
    if (forTest) out.push('', 'chk <- function(key, x) cat("CHK\\t", key, "\\t", paste(format(as.numeric(x), digits = 15), collapse = " "), "\\n", sep = "")');
    out.push('', '# ---- データ ' + '-'.repeat(50));
    if (cols.length) out.push(...dataBlock(ds, cols, facs, D));
    else out.push('# （使う変数がまだ割り当てられていないので、データはありません）');
    bs.forEach(({ b }) => out.push(...b.lines));
    out.push('');
    return out.join('\n');
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RC;
  else root.RCode = RC;
})(typeof window !== 'undefined' ? window : globalThis);
