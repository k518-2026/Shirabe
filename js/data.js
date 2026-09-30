/*
 * data.js — データの読み込み（CSV / TSV / 貼り付け）と変数の型
 * Copyright (c) 2026 K.Yamamoto — MIT License
 */
(function (root) {
  'use strict';
  const D = {};
  const MISSING = new Set(['', 'NA', 'NaN', 'na', 'N/A', '.', '-', '#N/A', 'null', 'NULL', '欠損', '＊', '*']);

  // バイト列を文字列に。UTF-8 として不正なら Shift_JIS とみなす
  D.decode = function (buf) {
    const bytes = new Uint8Array(buf);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
    } catch (e) {
      return new TextDecoder('shift_jis').decode(bytes);
    }
  };

  // 区切り文字を推定（1行目で最も多いもの）
  function guessDelimiter(text) {
    const line = text.split(/\r?\n/, 1)[0] || '';
    const cand = ['\t', ',', ';'];
    let best = ',', n = -1;
    for (const c of cand) { const k = line.split(c).length; if (k > n) { n = k; best = c; } }
    return best;
  }

  // RFC 4180 に沿った CSV の分解（引用符・改行入りセルに対応）
  D.parseDelimited = function (text, delim) {
    delim = delim || guessDelimiter(text);
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ''));
  };

  const toNumber = s => {
    const t = s.trim().replace(/[０-９．－]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return NaN;
    return Number(t);
  };

  // 表から Dataset を作る。1行目は変数名
  D.fromRows = function (rows, name) {
    if (rows.length < 2) throw new Error('データが2行未満です（1行目は変数名）。');
    const width = Math.max(...rows.map(r => r.length));
    const header = rows[0].slice();
    const used = new Set();
    for (let j = 0; j < width; j++) {
      let h = (header[j] || '').trim() || `V${j + 1}`, base = h, k = 2;
      while (used.has(h)) h = `${base}_${k++}`;
      used.add(h); header[j] = h;
    }
    const body = rows.slice(1);
    const columns = header.map((h, j) => {
      const raw = body.map(r => (r[j] === undefined ? '' : String(r[j]).trim()));
      return makeColumn(h, raw);
    });
    return { name: name || 'データ', columns, n: body.length };
  };

  function makeColumn(name, raw) {
    const isMiss = raw.map(s => MISSING.has(s));
    const nums = raw.map((s, i) => (isMiss[i] ? NaN : toNumber(s)));
    const numeric = raw.every((s, i) => isMiss[i] || !isNaN(nums[i]));
    const col = { name, raw, missing: isMiss, numeric, nums };
    const distinct = new Set(raw.filter((s, i) => !isMiss[i]));
    // 数値なら連続尺度。ただし 0/1 などの2値は名義尺度にしておく
    col.type = numeric ? (distinct.size <= 2 ? 'nominal' : 'scale') : 'nominal';
    col.levels = levelOrder(raw.filter((s, i) => !isMiss[i]), numeric);
    return col;
  }

  function levelOrder(vals, numeric) {
    const u = Array.from(new Set(vals));
    if (numeric) return u.sort((a, b) => toNumber(a) - toNumber(b));
    return u.sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
  }

  D.parseText = (text, name) => D.fromRows(D.parseDelimited(text), name);

  // 変数の型を変えられるか（数値でない列は連続・順序にできない）
  D.canSetType = (col, type) => type === 'nominal' || col.numeric;

  // 分析用：指定した列が全部そろっている行だけを取り出す（リストワイズ）
  D.complete = function (ds, cols) {
    const idx = [];
    for (let i = 0; i < ds.n; i++) if (cols.every(c => !c.missing[i] && (c.type === 'nominal' || !isNaN(c.nums[i])))) idx.push(i);
    return idx;
  };
  D.byName = (ds, name) => ds.columns.find(c => c.name === name);

  D.toCSV = function (ds) {
    const esc = s => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [ds.columns.map(c => esc(c.name)).join(',')];
    for (let i = 0; i < ds.n; i++) lines.push(ds.columns.map(c => esc(c.raw[i])).join(','));
    return lines.join('\r\n');
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = D;
  else root.DataIO = D;
})(typeof window !== 'undefined' ? window : globalThis);
