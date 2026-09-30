/*
 * app.js — 画面（データ表・分析の設定・結果）
 * Copyright (c) 2026 K.Yamamoto — MIT License
 */
(function () {
  'use strict';
  const D = window.DataIO, A = window.Analyses;
  const $ = (s, el = document) => el.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) e.append(kid.nodeType ? kid : String(kid));
    return e;
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const TYPE_LABEL = { scale: '連続', ordinal: '順序', nominal: '名義' };
  const TYPE_ICON = { scale: '📏', ordinal: '📶', nominal: '🏷' };

  const state = { ds: null, items: [], active: null, uid: 1 };

  // ------------------------------------------------------------ 数値の書式
  function fmtNum(v, d = 3) {
    if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) return '';
    if (v === Infinity) return '∞';
    if (v === -Infinity) return '-∞';
    if (typeof v !== 'number') return String(v);
    if (v !== 0 && Math.abs(v) < 0.001 && d >= 3) return v.toExponential(2);
    if (Math.abs(v) >= 1e7) return v.toExponential(3);
    const s = v.toFixed(d);
    return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
  }
  function fmtP(p) {
    if (p === null || p === undefined || isNaN(p)) return '';
    if (p < 0.001) return '< .001';
    return p.toFixed(3).replace(/^0/, '');
  }
  function fmtCell(v, fmt) {
    switch (fmt) {
      case 'text': return v === null || v === undefined ? '' : esc(v);
      case 'int': return v === null || v === undefined || isNaN(v) ? '' : String(Math.round(v));
      case 'p': return fmtP(v);
      case 'df': return v === null || v === undefined || isNaN(v) ? '' : Number.isInteger(v) ? String(v) : fmtNum(v, 2);
      case 'num1': return fmtNum(v, 1);
      case 'star': return v ? fmtNum(v.v) + (v.s ? `<sup>${v.s}</sup>` : '') : '';
      case 'cell':
        if (!v) return '';
        if ('t' in v) return esc(v.t);
        if ('i' in v) return String(v.i);
        if ('p' in v) return fmtP(v.p);
        if ('pct' in v) return isNaN(v.pct) ? '' : `${v.pct.toFixed(1)}%`;
        return fmtNum(v.v, v.d === undefined ? 3 : v.d) + (v.s ? `<sup>${v.s}</sup>` : '');
      default: return fmtNum(v);
    }
  }

  // ------------------------------------------------------------ 結果の描画
  function renderTable(b) {
    const hasGroup = b.cols.some(c => c.group);
    let head = '';
    if (hasGroup) {
      head += '<tr>';
      for (let i = 0; i < b.cols.length;) {
        const g = b.cols[i].group; let j = i;
        while (j < b.cols.length && b.cols[j].group === g) j++;
        head += g ? `<th colspan="${j - i}" class="grp">${esc(g)}</th>` : `<th colspan="${j - i}"></th>`;
        i = j;
      }
      head += '</tr>';
    }
    head += '<tr>' + b.cols.map(c => `<th class="${c.fmt === 'text' ? 'l' : ''}">${esc(c.label)}</th>`).join('') + '</tr>';
    const body = b.rows.map(r => `<tr${r._sep ? ' class="sep"' : ''}>` + b.cols.map(c => `<td class="${c.fmt === 'text' ? 'l' : ''}">${fmtCell(r[c.key], c.fmt)}</td>`).join('') + '</tr>').join('');
    const notes = b.notes.length ? `<div class="tnote"><span>注.</span> ${b.notes.map(esc).join(' ')}</div>` : '';
    return `<div class="block"><div class="btitle">${esc(b.title)}<button class="copy" title="表をコピー（Word・Excel に貼り付けできます）">コピー</button></div><div class="twrap"><table class="apa"><thead>${head}</thead><tbody>${body}</tbody></table></div>${notes}</div>`;
  }
  function renderBlock(b) {
    if (b.type === 'table') return renderTable(b);
    if (b.type === 'plot') return `<div class="block"><div class="btitle">${esc(b.title)}<button class="savesvg" title="図を SVG で保存">保存</button></div><div class="plotwrap">${b.svg}</div></div>`;
    if (b.type === 'note') return `<div class="block msg">${esc(b.text)}</div>`;
    return `<div class="block msg err">${esc(b.text)}</div>`;
  }

  function computeItem(it) {
    if (!state.ds) return '<div class="block msg">データを読み込んでください。</div>';
    try {
      const blocks = it.def.run(state.ds, it.sel, it.opt);
      if (!blocks.length) return '<div class="block msg hint">左の欄で変数を割り当てると、ここに結果が出ます。</div>';
      return blocks.map(renderBlock).join('');
    } catch (e) {
      console.error(e);
      return `<div class="block msg err">計算中にエラーが起きました: ${esc(e.message)}</div>`;
    }
  }

  function renderResults() {
    const pane = $('#results');
    if (!state.items.length) {
      pane.innerHTML = `<div class="welcome"><h2>結果</h2><p>上のメニューから分析を選ぶと、ここに結果の表と図が出ます。設定を変えるとすぐに計算し直します。</p></div>`;
      return;
    }
    pane.innerHTML = '';
    for (const it of state.items) {
      const sec = h('section', { class: 'analysis' + (it.uid === state.active ? ' active' : ''), 'data-uid': it.uid },
        h('header', {},
          h('button', { class: 'atitle', title: '設定を開く', onclick: () => openItem(it.uid) }, it.def.title),
          h('button', { class: 'icon', title: '複製', onclick: () => duplicateItem(it.uid) }, '⧉'),
          h('button', { class: 'icon', title: 'この分析を削除', onclick: () => removeItem(it.uid) }, '✕')),
        h('div', { class: 'aout', html: computeItem(it) }));
      pane.append(sec);
    }
  }
  function refreshItem(it) {
    const sec = document.querySelector(`section.analysis[data-uid="${it.uid}"] .aout`);
    if (sec) sec.innerHTML = computeItem(it); else renderResults();
  }

  // 表のコピー・図の保存
  document.addEventListener('click', async e => {
    const btn = e.target.closest('button.copy, button.savesvg');
    if (!btn) return;
    const block = btn.closest('.block');
    if (btn.classList.contains('copy')) {
      const tbl = block.querySelector('table'), title = block.querySelector('.btitle').firstChild.textContent;
      const note = block.querySelector('.tnote');
      const html = `<p><b>${esc(title)}</b></p>${exportTable(tbl)}${note ? `<p style="font-size:10pt">${note.innerHTML}</p>` : ''}`;
      const text = [...tbl.querySelectorAll('tr')].map(r => [...r.children].map(c => c.textContent).join('\t')).join('\n');
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
      } catch (err) {
        try { await navigator.clipboard.writeText(text); } catch (err2) { toast('コピーできませんでした。'); return; }
      }
      toast('表をコピーしました。');
    } else {
      const svg = block.querySelector('svg');
      download(`${block.querySelector('.btitle').firstChild.textContent.replace(/[\\/:*?"<>|]/g, '_')}.svg`, inlineSvg(svg), 'image/svg+xml');
    }
  });
  // Word に貼っても崩れないよう、罫線を直接書いた表にする
  function exportTable(tbl) {
    const c = tbl.cloneNode(true);
    c.setAttribute('style', 'border-collapse:collapse;font-family:serif;font-size:10.5pt');
    c.querySelectorAll('th,td').forEach(x => x.setAttribute('style', `padding:2px 8px;text-align:${x.classList.contains('l') ? 'left' : 'right'}`));
    const rows = c.querySelectorAll('tr');
    rows[0].querySelectorAll('th').forEach(x => (x.style.borderTop = '1.5px solid #000'));
    rows.forEach(r => { if (r.parentNode.tagName === 'THEAD' && r === c.tHead.rows[c.tHead.rows.length - 1]) r.querySelectorAll('th').forEach(x => (x.style.borderBottom = '1px solid #000')); });
    const last = c.tBodies[0].rows[c.tBodies[0].rows.length - 1];
    if (last) last.querySelectorAll('td').forEach(x => (x.style.borderBottom = '1.5px solid #000'));
    return c.outerHTML;
  }
  // CSS 変数を実際の色に置き換えた SVG
  function inlineSvg(svg) {
    const cs = getComputedStyle(document.documentElement);
    let s = svg.outerHTML.replace(/var\((--[\w-]+)\)/g, (_, v) => cs.getPropertyValue(v).trim());
    const style = `<style>.grid{stroke:#ddd}.axis{stroke:#444}.tick{fill:#333;font:12px sans-serif}.lab{fill:#222;font:13px sans-serif}.bar{fill:${cs.getPropertyValue('--plot-1').trim()};fill-opacity:.8}.dot{fill:${cs.getPropertyValue('--plot-1').trim()};fill-opacity:.7}.fitline{stroke:${cs.getPropertyValue('--plot-2').trim()};stroke-width:2}.whisker{stroke:#555}.outlier{fill:none;stroke:#555}</style>`;
    return s.replace(/^<svg([^>]*)>/, `<svg$1>${style}`);
  }
  function download(name, content, type) {
    const a = h('a', { href: URL.createObjectURL(new Blob([content], { type })), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ------------------------------------------------------------ 分析の追加・編集
  function defaultOpts(def) {
    const o = {};
    for (const op of def.options) if (op.key) o[op.key] = op.def;
    return o;
  }
  function addAnalysis(id) {
    if (!state.ds) { toast('先にデータを読み込んでください。'); return; }
    const def = A.find(a => a.id === id);
    const sel = {};
    for (const s of def.slots) sel[s.key] = s.pairs ? [[null, null]] : [];
    const it = { uid: state.uid++, def, sel, opt: defaultOpts(def) };
    state.items.push(it);
    state.active = it.uid;
    renderResults();
    renderLeft();
    scrollToItem(it.uid);
  }
  function openItem(uid) { state.active = uid; renderLeft(); markActive(); }
  function removeItem(uid) {
    state.items = state.items.filter(i => i.uid !== uid);
    if (state.active === uid) state.active = null;
    renderResults(); renderLeft();
  }
  function duplicateItem(uid) {
    const src = state.items.find(i => i.uid === uid);
    const it = { uid: state.uid++, def: src.def, sel: JSON.parse(JSON.stringify(src.sel)), opt: { ...src.opt } };
    state.items.splice(state.items.indexOf(src) + 1, 0, it);
    state.active = it.uid; renderResults(); renderLeft(); scrollToItem(it.uid);
  }
  function markActive() {
    document.querySelectorAll('section.analysis').forEach(s => s.classList.toggle('active', +s.dataset.uid === state.active));
  }
  function scrollToItem(uid) {
    const s = document.querySelector(`section.analysis[data-uid="${uid}"]`);
    if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ------------------------------------------------------------ 左の欄
  function renderLeft() {
    const it = state.items.find(i => i.uid === state.active);
    const pane = $('#left');
    pane.innerHTML = '';
    if (it) pane.append(renderOptions(it));
    else pane.append(renderData());
  }

  function renderData() {
    const wrap = h('div', { class: 'datapane' });
    if (!state.ds) {
      wrap.append(h('div', { class: 'welcome' },
        h('h2', {}, 'データを読み込む'),
        h('p', {}, 'CSV・TSV ファイルを開くか、Excel などからコピーした表を貼り付けてください。1行目は変数名にします。'),
        h('div', { class: 'bigbtns' },
          h('button', { class: 'primary', onclick: () => $('#file').click() }, 'ファイルを開く'),
          h('button', { onclick: openPaste }, '貼り付け'),
          h('button', { onclick: loadSample }, 'サンプルデータ')),
        h('div', { class: 'drop' }, 'ここにファイルをドロップしても読み込めます'),
        h('p', { class: 'small' }, 'データはこのブラウザーの中だけで処理され、どこにも送信されません。文字コードは UTF-8 と Shift_JIS に対応しています。')));
      return wrap;
    }
    const ds = state.ds;
    wrap.append(h('div', { class: 'dsbar' },
      h('span', { class: 'dsname' }, ds.name), h('span', { class: 'small' }, `${ds.n} 行 × ${ds.columns.length} 列`),
      h('span', { class: 'small hint' }, '見出しのアイコンで尺度（連続・順序・名義）を切り替えられます')));
    const limit = 1000;
    const tbl = h('table', { class: 'grid' });
    const trh = h('tr', {}, h('th', { class: 'rn' }, ''));
    ds.columns.forEach(c => {
      trh.append(h('th', {},
        h('button', { class: `type t-${c.type}`, title: `尺度: ${TYPE_LABEL[c.type]}（クリックで変更）`, onclick: () => cycleType(c) }, TYPE_ICON[c.type]),
        ' ', c.name));
    });
    tbl.append(h('thead', {}, trh));
    const tb = h('tbody');
    let html = '';
    for (let i = 0; i < Math.min(ds.n, limit); i++) {
      html += `<tr><td class="rn">${i + 1}</td>` + ds.columns.map(c => (c.missing[i] ? '<td class="na"></td>' : `<td class="${c.type === 'nominal' ? 'l' : ''}">${esc(c.raw[i])}</td>`)).join('') + '</tr>';
    }
    tb.innerHTML = html;
    tbl.append(tb);
    wrap.append(h('div', { class: 'gridwrap' }, tbl));
    if (ds.n > limit) wrap.append(h('p', { class: 'small' }, `表示は先頭 ${limit} 行までです（分析には全 ${ds.n} 行を使います）。`));
    return wrap;
  }
  function cycleType(c) {
    const order = ['scale', 'ordinal', 'nominal'];
    let t = order[(order.indexOf(c.type) + 1) % 3];
    while (!D.canSetType(c, t)) t = order[(order.indexOf(t) + 1) % 3];
    if (t === c.type) { toast(`「${c.name}」は数値でない値を含むので名義尺度だけです。`); return; }
    c.type = t;
    toast(`「${c.name}」を${TYPE_LABEL[t]}尺度にしました。`);
    renderLeft(); renderResults();
  }

  // 変数の割り当てとオプション
  function renderOptions(it) {
    const def = it.def, ds = state.ds;
    const box = h('div', { class: 'optpane' });
    box.append(h('div', { class: 'opthead' },
      h('h2', {}, def.title),
      h('button', { class: 'ok', title: '設定を閉じてデータ表に戻る', onclick: () => { state.active = null; renderLeft(); markActive(); } }, 'OK')));
    const chosen = new Set();
    const avail = h('ul', { class: 'varlist', 'aria-label': '変数の一覧' });
    const allowed = (slot, c) => slot.types.includes(c.type);
    const usedNames = () => new Set(def.slots.flatMap(s => (s.pairs ? it.sel[s.key].flat() : it.sel[s.key])).filter(Boolean));
    const assign = (slot, names) => {
      const bad = names.filter(n => !allowed(slot, D.byName(ds, n)));
      if (bad.length) toast(`「${bad.join('、')}」はこの欄に入れられません（${slot.types.map(t => TYPE_LABEL[t]).join('・')}尺度の変数だけ）。データ表の見出しで尺度を変えられます。`);
      const ok = names.filter(n => !bad.includes(n));
      if (slot.pairs) {
        const list = it.sel[slot.key];
        for (const n of ok) {
          let p = list.find(q => !q[0] || !q[1]);
          if (!p) { p = [null, null]; list.push(p); }
          if (!p[0]) p[0] = n; else p[1] = n;
        }
        if (list.every(q => q[0] && q[1])) list.push([null, null]);
      } else if (slot.multi) {
        for (const n of ok) if (!it.sel[slot.key].includes(n) && !(slot.max && it.sel[slot.key].length >= slot.max)) it.sel[slot.key].push(n);
      } else if (ok.length) it.sel[slot.key] = [ok[0]];
      update();
    };
    const update = () => { renderLeftKeepScroll(); refreshItem(it); };

    const inUse = usedNames();
    for (const c of ds.columns) {
      const li = h('li', { class: `var t-${c.type}${inUse.has(c.name) ? ' used' : ''}`, draggable: 'true', tabindex: '0', title: `${c.name}（${TYPE_LABEL[c.type]}）` },
        h('span', { class: 'ti' }, TYPE_ICON[c.type]), c.name);
      li.addEventListener('click', e => {
        if (!(e.ctrlKey || e.metaKey || e.shiftKey)) { chosen.clear(); avail.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); }
        if (chosen.has(c.name)) { chosen.delete(c.name); li.classList.remove('sel'); } else { chosen.add(c.name); li.classList.add('sel'); }
      });
      li.addEventListener('dblclick', () => {
        const s = def.slots.find(s2 => allowed(s2, c) && (s2.pairs || s2.multi || !it.sel[s2.key].length)) || def.slots.find(s2 => allowed(s2, c));
        if (s) assign(s, [c.name]); else toast(`「${c.name}」を入れられる欄がありません。`);
      });
      li.addEventListener('keydown', e => { if (e.key === 'Enter') li.dispatchEvent(new MouseEvent('dblclick')); });
      li.addEventListener('dragstart', e => {
        const names = chosen.has(c.name) ? [...chosen] : [c.name];
        e.dataTransfer.setData('text/plain', JSON.stringify(names));
      });
      avail.append(li);
    }
    const slotsEl = h('div', { class: 'slots' });
    for (const slot of def.slots) {
      const list = h('ul', { class: 'target' + (slot.multi || slot.pairs ? ' multi' : '') });
      if (slot.pairs) {
        it.sel[slot.key].forEach((p, k) => {
          const row = h('li', { class: 'pair' },
            ...[0, 1].map(j => h('span', { class: 'pv' + (p[j] ? '' : ' empty') }, p[j] || (j === 0 ? '変数1' : '変数2'))),
            h('button', { class: 'rm', title: 'このペアを外す', onclick: () => { it.sel[slot.key].splice(k, 1); if (!it.sel[slot.key].some(q => !q[0] || !q[1])) it.sel[slot.key].push([null, null]); update(); } }, '✕'));
          list.append(row);
        });
      } else {
        for (const n of it.sel[slot.key]) {
          const c = D.byName(ds, n);
          list.append(h('li', { class: `var t-${c ? c.type : ''}` }, h('span', { class: 'ti' }, c ? TYPE_ICON[c.type] : '?'), n,
            h('button', { class: 'rm', title: '外す', onclick: () => { it.sel[slot.key] = it.sel[slot.key].filter(x => x !== n); update(); } }, '✕')));
        }
        if (!it.sel[slot.key].length) list.append(h('li', { class: 'placeholder' }, slot.optional ? '（任意）' : 'ここへ入れる'));
      }
      list.addEventListener('dragover', e => { e.preventDefault(); list.classList.add('over'); });
      list.addEventListener('dragleave', () => list.classList.remove('over'));
      list.addEventListener('drop', e => { e.preventDefault(); list.classList.remove('over'); try { assign(slot, JSON.parse(e.dataTransfer.getData('text/plain'))); } catch (x) { /* 無視 */ } });
      slotsEl.append(h('div', { class: 'slot' },
        h('div', { class: 'slothead' },
          h('button', { class: 'arrow', title: '選んだ変数をこの欄へ', onclick: () => { if (!chosen.size) toast('左の一覧で変数をクリックして選んでから押してください。'); else assign(slot, [...chosen]); } }, '→'),
          h('span', {}, slot.label), h('span', { class: 'types' }, slot.types.map(t => TYPE_ICON[t]).join(''))),
        list));
    }
    box.append(h('div', { class: 'assign' }, h('div', { class: 'availwrap' }, h('div', { class: 'small' }, '変数（クリックで選択、ダブルクリック・ドラッグで割り当て）'), avail), slotsEl));

    // オプション
    const opts = h('div', { class: 'opts' });
    let group = null;
    for (const op of def.options) {
      if (op.type === 'heading') { group = h('fieldset', {}, h('legend', {}, op.label)); opts.append(group); continue; }
      const target = group || opts;
      const id = `o-${it.uid}-${op.key}`;
      if (op.type === 'check') {
        target.append(h('label', { class: 'chk', for: id },
          h('input', { type: 'checkbox', id, checked: !!it.opt[op.key], onchange: e => { it.opt[op.key] = e.target.checked; refreshItem(it); } }), op.label));
      } else if (op.type === 'number') {
        target.append(h('label', { class: 'num', for: id }, op.label,
          h('input', { type: 'number', id, value: it.opt[op.key], min: op.min, max: op.max, step: op.step || 'any',
            oninput: e => { if (e.target.value !== '' && !isNaN(+e.target.value)) { it.opt[op.key] = +e.target.value; refreshItem(it); } } })));
      } else if (op.type === 'radio') {
        const g = h('div', { class: 'radios', role: 'radiogroup' });
        op.options.forEach(([v, l]) => g.append(h('label', { class: 'chk' },
          h('input', { type: 'radio', name: id, value: v, checked: it.opt[op.key] === v, onchange: () => { it.opt[op.key] = v; refreshItem(it); } }), l)));
        target.append(g);
      }
    }
    box.append(opts);
    return box;
  }
  function renderLeftKeepScroll() {
    const pane = $('#left'), y = pane.scrollTop;
    renderLeft(); pane.scrollTop = y;
  }

  // ------------------------------------------------------------ データの読み込み
  function setData(ds) {
    state.ds = ds;
    // 変数名が消えた割り当ては外す
    for (const it of state.items) for (const s of it.def.slots) {
      if (s.pairs) it.sel[s.key] = it.sel[s.key].map(p => p.map(n => (n && D.byName(ds, n) ? n : null)));
      else it.sel[s.key] = it.sel[s.key].filter(n => D.byName(ds, n));
    }
    document.title = `${ds.name} — Shirabe`;
    renderLeft(); renderResults();
    toast(`${ds.n} 行 × ${ds.columns.length} 列を読み込みました。`);
  }
  async function loadFile(file) {
    try {
      const buf = await file.arrayBuffer();
      if (/\.xlsx?$/i.test(file.name)) { toast('Excel ファイルは直接読めません。CSV で保存するか、表をコピーして「貼り付け」を使ってください。'); return; }
      setData(D.parseText(D.decode(buf), file.name.replace(/\.[^.]+$/, '')));
    } catch (e) { toast(`読み込めませんでした: ${e.message}`); }
  }
  function loadSample() {
    try { setData(D.parseText(window.SAMPLE_CSV, 'サンプル（架空の授業データ）')); }
    catch (e) { toast(e.message); }
  }
  function openPaste() {
    const dlg = $('#pasteDlg');
    $('#pasteText').value = '';
    dlg.showModal();
    setTimeout(() => $('#pasteText').focus(), 50);
  }

  // ------------------------------------------------------------ メニュー
  function buildMenu() {
    const nav = $('#menu');
    const groups = [...new Set(A.map(a => a.group))];
    for (const g of groups) {
      const items = A.filter(a => a.group === g);
      const btn = h('button', { class: 'mbtn', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, g, h('span', { class: 'caret' }, '▾'));
      const dd = h('div', { class: 'dropdown', role: 'menu' }, ...items.map(a => h('button', { role: 'menuitem', onclick: () => { closeMenus(); addAnalysis(a.id); } }, a.title)));
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const open = dd.classList.contains('open');
        closeMenus();
        if (!open) { dd.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
      });
      nav.append(h('div', { class: 'mgroup' }, btn, dd));
    }
    document.addEventListener('click', closeMenus);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });
  }
  function closeMenus() {
    document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
    document.querySelectorAll('.mbtn[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }

  // 結果全体を1つの HTML に書き出す
  function exportResults() {
    if (!state.items.length) { toast('書き出す結果がありません。'); return; }
    const parts = [...document.querySelectorAll('section.analysis')].map(sec => {
      const title = sec.querySelector('.atitle').textContent;
      const blocks = [...sec.querySelectorAll('.block')].map(b => {
        const t = b.querySelector('.btitle'), tbl = b.querySelector('table'), svg = b.querySelector('svg'), note = b.querySelector('.tnote');
        const bt = t ? `<h3>${esc(t.firstChild.textContent)}</h3>` : '';
        if (tbl) return bt + exportTable(tbl) + (note ? `<p class="note">${note.innerHTML}</p>` : '');
        if (svg) return bt + inlineSvg(svg);
        return `<p class="note">${esc(b.textContent)}</p>`;
      }).join('\n');
      return `<h2>${esc(title)}</h2>\n${blocks}`;
    }).join('\n<hr>\n');
    const doc = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>分析結果</title><style>body{font-family:serif;max-width:900px;margin:2em auto;padding:0 16px;color:#111;background:#fff}h2{font-size:15pt;border-bottom:1px solid #999}h3{font-size:11pt;margin:1.4em 0 .3em}.note{font-size:9.5pt;color:#333}svg{max-width:520px;width:100%;height:auto}</style></head><body><p style="font-size:9pt;color:#555">Shirabe で作成 — ${esc(state.ds ? state.ds.name : '')} — ${new Date().toLocaleString('ja-JP')}</p>${parts}</body></html>`;
    download('分析結果.html', doc, 'text/html');
  }

  // ------------------------------------------------------------ 起動
  function init() {
    buildMenu();
    $('#btnOpen').addEventListener('click', () => $('#file').click());
    $('#file').addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; });
    $('#btnPaste').addEventListener('click', openPaste);
    $('#btnSample').addEventListener('click', loadSample);
    $('#btnData').addEventListener('click', () => { state.active = null; renderLeft(); markActive(); });
    $('#btnExport').addEventListener('click', exportResults);
    $('#btnPrint').addEventListener('click', () => window.print());
    $('#btnSaveCsv').addEventListener('click', () => { if (state.ds) download(`${state.ds.name}.csv`, '﻿' + D.toCSV(state.ds), 'text/csv'); else toast('データがありません。'); });
    $('#pasteOk').addEventListener('click', e => {
      e.preventDefault();
      const t = $('#pasteText').value;
      if (!t.trim()) { toast('貼り付けた内容が空です。'); return; }
      try { setData(D.parseText(t, '貼り付けたデータ')); $('#pasteDlg').close(); } catch (x) { toast(x.message); }
    });
    $('#pasteCancel').addEventListener('click', e => { e.preventDefault(); $('#pasteDlg').close(); });
    $('#btnAbout').addEventListener('click', () => $('#aboutDlg').showModal());
    $('#aboutClose').addEventListener('click', () => $('#aboutDlg').close());
    const left = $('#left');
    left.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); left.classList.add('filedrop'); } });
    left.addEventListener('dragleave', () => left.classList.remove('filedrop'));
    left.addEventListener('drop', e => { left.classList.remove('filedrop'); if (e.dataTransfer.files.length) { e.preventDefault(); loadFile(e.dataTransfer.files[0]); } });
    // 左右の幅を変える
    const split = $('#splitter');
    split.addEventListener('pointerdown', e => {
      split.setPointerCapture(e.pointerId);
      const move = ev => { const w = Math.min(Math.max(280, ev.clientX), window.innerWidth - 320); document.documentElement.style.setProperty('--left-w', `${w}px`); };
      const up = () => { split.removeEventListener('pointermove', move); split.removeEventListener('pointerup', up); };
      split.addEventListener('pointermove', move); split.addEventListener('pointerup', up);
    });
    renderLeft(); renderResults();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
