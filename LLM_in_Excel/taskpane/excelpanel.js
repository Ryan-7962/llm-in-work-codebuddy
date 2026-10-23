// 表格工具面板（仅 Excel 套件）：公式生成 / 批量 AI 填充 / 数据清洗。
// 自包含模块（参照 imagepanel.js 架构，零改动 taskpane.js）：
//   - #excel-view 一级视图，由 topnav.js 的「表格」tab 驱动显隐
//   - Office.js 读取选区 → 服务端 /api/excel/* → 结构化结果 → Office.js 写回
// 界面固定中文。参考实现：Ai-in-Office/kimi-in-excel。
(() => {
  'use strict';
  if (window.__llm_excel_panel) return;
  window.__llm_excel_panel = true;

  const T = {
    title: '表格工具',
    tabFormula: '公式', tabFill: '填充', tabClean: '清洗',
    // 公式页
    fHint: '选中一个单元格（写公式的地方），描述你想算什么：',
    fPlaceholder: '例：计算销售额列的总和占整表合计的百分比',
    fGen: '🧮 生成公式',
    fWrite: '写入选中单元格',
    fFormula: '公式（可修改）',
    fFallback: '旧版 Excel 兼容写法',
    // 填充页
    lHint: '选中数据区域（默认首行为表头），用 {{列名}} 写模板，AI 逐行填充：',
    lRead: '📥 读取选区',
    lPlaceholder: '例：把 {{产品名}} 翻译成英文，并用一句话概括 {{卖点}}',
    lGen: '✨ 批量生成',
    lWrite: '写入右侧一列',
    lNoSel: '尚未读取选区，请先在表格里选中数据区域后点「读取选区」',
    // 清洗页
    cHint: '选中要清洗的数据区域（默认首行为表头）：',
    cRead: '📥 读取选区',
    cPlaceholder: '补充要求（可选），例：城市名统一加「市」',
    cGen: '🧹 生成清洗建议',
    cApply: '应用清洗（写回原区域）',
    cNoChange: '数据已经很干净，无需清洗',
    cChanged: '处变更',
    // 通用
    headerRow: '首行为表头',
    loading: 'AI 处理中，请稍候…',
    rows: '行', cols: '列', sheet: '工作表',
    netErr: (s) => '服务错误（HTTP ' + s + '）',
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MAX_ROWS = 200, MAX_COLS = 30;

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = [
      '#excel-view { flex:1; min-height:0; display:flex; flex-direction:column; background:var(--paper, #f7f8fa); }',
      '#excel-view.hidden { display:none !important; }',
      '.xv-head { flex:none; display:flex; align-items:center; gap:8px; padding:8px 12px; background:#fff; border-bottom:1px solid var(--line, #e3e6ea); }',
      '.xv-head b { font-size:13px; font-weight:600; }',
      '.xv-tabs { display:flex; gap:4px; margin-left:auto; }',
      '.xv-tab { border:0; background:transparent; cursor:pointer; padding:5px 12px; font:inherit; font-size:12px; color:var(--muted, #6b7686); border-radius:999px; }',
      '.xv-tab.on { background:var(--accent, #2563eb); color:#fff; font-weight:600; }',
      '.xv-body { flex:1; overflow-y:auto; padding:12px; }',
      '.xv-page { display:none; }',
      '.xv-page.on { display:block; }',
      '.xv-card { background:#fff; border:1px solid var(--line, #e3e6ea); border-radius:10px; padding:12px; margin-bottom:12px; }',
      '.xv-hint { font-size:11.5px; color:var(--muted, #6b7686); line-height:1.6; margin-bottom:8px; }',
      '.xv-input, .xv-area { width:100%; box-sizing:border-box; border:1px solid var(--line, #e3e6ea); border-radius:8px; padding:8px 10px; font:inherit; font-size:12.5px; background:#fff; color:var(--ink, #233b38); }',
      '.xv-area { min-height:64px; resize:vertical; }',
      '.xv-btn { border:0; cursor:pointer; font:inherit; font-size:12.5px; padding:8px 14px; border-radius:8px; background:var(--accent, #2563eb); color:#fff; font-weight:600; }',
      '.xv-btn:disabled { opacity:.5; cursor:default; }',
      '.xv-btn.ghost { background:#fff; color:var(--ink, #233b38); border:1px solid var(--line, #e3e6ea); font-weight:400; }',
      '.xv-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:8px; }',
      '.xv-status { font-size:11.5px; color:var(--muted, #6b7686); line-height:1.6; margin-top:8px; white-space:pre-wrap; }',
      '.xv-status.err { color:#c0392b; }',
      '.xv-chips { display:flex; gap:4px; flex-wrap:wrap; margin:6px 0 0; }',
      '.xv-chip { border:1px solid var(--line, #e3e6ea); background:#fff; border-radius:6px; padding:2px 8px; font-size:11px; cursor:pointer; color:var(--muted, #6b7686); }',
      '.xv-chip:hover { color:var(--accent, #2563eb); border-color:var(--accent, #2563eb); }',
      '.xv-selinfo { font-size:11.5px; color:var(--muted, #6b7686); background:var(--paper, #f7f8fa); border-radius:8px; padding:6px 10px; margin-top:8px; line-height:1.7; }',
      '.xv-table { width:100%; border-collapse:collapse; font-size:11.5px; margin-top:8px; }',
      '.xv-table th, .xv-table td { border:1px solid var(--line, #e3e6ea); padding:4px 7px; text-align:left; max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
      '.xv-table th { background:var(--paper, #f7f8fa); font-weight:600; }',
      '.xv-diff { border:1px solid var(--line, #e3e6ea); border-radius:8px; overflow:hidden; margin-top:8px; max-height:260px; overflow-y:auto; }',
      '.xv-diff-row { display:flex; gap:6px; padding:5px 10px; font-size:11.5px; border-bottom:1px solid var(--line, #e3e6ea); align-items:baseline; }',
      '.xv-diff-row:last-child { border-bottom:0; }',
      '.xv-diff-pos { flex:none; color:var(--muted, #6b7686); font-size:10.5px; min-width:34px; }',
      '.xv-diff-old { color:#c0392b; text-decoration:line-through; opacity:.75; max-width:40%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
      '.xv-diff-arrow { color:var(--muted, #6b7686); }',
      '.xv-diff-new { color:var(--ink, #233b38); font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
      '.xv-label { font-size:11.5px; font-weight:600; color:var(--ink, #233b38); margin:10px 0 5px; }',
      '.xv-check { display:flex; align-items:center; gap:5px; font-size:11.5px; color:var(--muted, #6b7686); }',
    ].join('\n');
    document.head.appendChild(style);
  }

  // ---- Office.js：读选区 ----
  async function readSelection() {
    if (typeof Excel === 'undefined') throw new Error('Office 尚未就绪，请稍候重试');
    return Excel.run(async (ctx) => {
      const range = ctx.workbook.getSelectedRange();
      range.load('rowCount,columnCount,rowIndex,columnIndex,values,worksheet/name');
      await ctx.sync();
      const r = {
        sheet: range.worksheet.name,
        rowIndex: range.rowIndex, columnIndex: range.columnIndex,
        rowCount: range.rowCount, columnCount: range.columnCount,
        values: range.values,
      };
      if (r.rowCount * r.columnCount > MAX_ROWS * MAX_COLS) throw new Error(`选区过大（${r.rowCount}×${r.columnCount}），单次最多约 ${MAX_ROWS} 行 × ${MAX_COLS} 列，请分批处理`);
      if (r.rowCount > MAX_ROWS) throw new Error(`选区 ${r.rowCount} 行超过单次上限 ${MAX_ROWS} 行，请分批选择`);
      return r;
    });
  }

  // ---- Office.js：写回（写前自动快照原区域，供「撤销上次写入」） ----
  let undoData = null;   // { sheetName, rowIndex, columnIndex, isFormula, snap:{values,formulas} }
  let undoCb = null;     // init() 里注册：写入成功后显示撤销按钮
  async function snapshotRange(sheetName, rowIndex, columnIndex, rowCount, columnCount) {
    return Excel.run(async (ctx) => {
      const ws = ctx.workbook.worksheets.getItem(sheetName);
      const range = ws.getRangeByIndexes(rowIndex, columnIndex, rowCount, columnCount);
      range.load('values,formulas');
      await ctx.sync();
      return { values: range.values, formulas: range.formulas };
    });
  }
  async function writeRange(sheetName, rowIndex, columnIndex, rows2d, isFormula) {
    // 先快照目标区域原内容（写入失败不记录，成功才可撤销）
    const snap = await snapshotRange(sheetName, rowIndex, columnIndex, rows2d.length, rows2d[0].length);
    await Excel.run(async (ctx) => {
      const ws = ctx.workbook.worksheets.getItem(sheetName);
      const range = ws.getRangeByIndexes(rowIndex, columnIndex, rows2d.length, rows2d[0].length);
      if (isFormula) range.formulas = rows2d;
      else range.values = rows2d;
      await ctx.sync();
    });
    undoData = { sheetName, rowIndex, columnIndex, isFormula, snap };
    if (undoCb) undoCb();
  }

  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(async (r) => {
        if (!r.ok) throw new Error(T.netErr(r.status));
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || '处理失败');
        return d;
      });
  }

  function splitSel(sel, useHeader) {
    const vals = sel.values.map((row) => row.map((c) => (c == null ? '' : String(c))));
    if (useHeader && sel.rowCount > 1) {
      return { headers: vals[0], rows: vals.slice(1), values: vals };
    }
    return { headers: vals[0].map((_, i) => '第' + colLetter(i) + '列'), rows: vals, values: vals };
  }
  function colLetter(i) { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function cellAddr(sel, r, c) { return colLetter(sel.columnIndex + c) + (sel.rowIndex + r + 1); }
  function setStatus(el, msg, isErr) { el.textContent = msg || ''; el.classList.toggle('err', !!isErr); }

  function buildUI() {
    injectStyle();
    const panel = document.createElement('section');
    panel.id = 'excel-view';
    panel.className = 'hidden';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', T.title);
    panel.innerHTML =
      '<div class="xv-head"><b>' + esc(T.title) + '</b><span class="xv-tabs">' +
      '<button id="xv-tab-f" class="xv-tab on" type="button">' + esc(T.tabFormula) + '</button>' +
      '<button id="xv-tab-l" class="xv-tab" type="button">' + esc(T.tabFill) + '</button>' +
      '<button id="xv-tab-c" class="xv-tab" type="button">' + esc(T.tabClean) + '</button>' +
      '</span><button id="xv-undo" class="xv-btn ghost" type="button" style="display:none; margin-left:4px; padding:4px 10px; font-size:11.5px; font-weight:400;">↩︎ 撤销上次写入</button></div>' +
      '<div class="xv-body">' +

      // ---- 公式页 ----
      '<div id="xv-page-f" class="xv-page on">' +
      '<div class="xv-card">' +
      '<div class="xv-hint">' + esc(T.fHint) + '</div>' +
      '<textarea id="xv-f-desc" class="xv-area" placeholder="' + esc(T.fPlaceholder) + '"></textarea>' +
      '<div class="xv-row"><button id="xv-f-gen" class="xv-btn" type="button">' + esc(T.fGen) + '</button></div>' +
      '<div id="xv-f-status" class="xv-status"></div>' +
      '</div>' +
      '<div id="xv-f-result" class="xv-card" style="display:none;">' +
      '<div class="xv-label">' + esc(T.fFormula) + '</div>' +
      '<input id="xv-f-formula" class="xv-input" spellcheck="false">' +
      '<div id="xv-f-fbwrap" style="display:none;"><div class="xv-label">' + esc(T.fFallback) + '</div>' +
      '<input id="xv-f-fallback" class="xv-input" spellcheck="false"></div>' +
      '<div id="xv-f-expl" class="xv-status"></div>' +
      '<div class="xv-row"><button id="xv-f-write" class="xv-btn" type="button">' + esc(T.fWrite) + '</button></div>' +
      '</div>' +
      '</div>' +

      // ---- 填充页 ----
      '<div id="xv-page-l" class="xv-page">' +
      '<div class="xv-card">' +
      '<div class="xv-hint">' + esc(T.lHint) + '</div>' +
      '<div class="xv-row" style="margin:0 0 8px;"><button id="xv-l-read" class="xv-btn ghost" type="button">' + esc(T.lRead) + '</button>' +
      '<label class="xv-check"><input id="xv-l-hdr" type="checkbox" checked>' + esc(T.headerRow) + '</label></div>' +
      '<div id="xv-l-selinfo" class="xv-selinfo" style="display:none;"></div>' +
      '<div id="xv-l-chips" class="xv-chips"></div>' +
      '<textarea id="xv-l-tpl" class="xv-area" placeholder="' + esc(T.lPlaceholder) + '"></textarea>' +
      '<div class="xv-row"><button id="xv-l-gen" class="xv-btn" type="button">' + esc(T.lGen) + '</button></div>' +
      '<div id="xv-l-status" class="xv-status"></div>' +
      '</div>' +
      '<div id="xv-l-result" class="xv-card" style="display:none;">' +
      '<div id="xv-l-preview"></div>' +
      '<div class="xv-row"><button id="xv-l-write" class="xv-btn" type="button">' + esc(T.lWrite) + '</button></div>' +
      '</div>' +
      '</div>' +

      // ---- 清洗页 ----
      '<div id="xv-page-c" class="xv-page">' +
      '<div class="xv-card">' +
      '<div class="xv-hint">' + esc(T.cHint) + '</div>' +
      '<div class="xv-row" style="margin:0 0 8px;"><button id="xv-c-read" class="xv-btn ghost" type="button">' + esc(T.cRead) + '</button>' +
      '<label class="xv-check"><input id="xv-c-hdr" type="checkbox" checked>' + esc(T.headerRow) + '</label></div>' +
      '<div id="xv-c-selinfo" class="xv-selinfo" style="display:none;"></div>' +
      '<input id="xv-c-instr" class="xv-input" placeholder="' + esc(T.cPlaceholder) + '"></input>' +
      '<div class="xv-row"><button id="xv-c-gen" class="xv-btn" type="button">' + esc(T.cGen) + '</button></div>' +
      '<div id="xv-c-status" class="xv-status"></div>' +
      '</div>' +
      '<div id="xv-c-result" class="xv-card" style="display:none;">' +
      '<div id="xv-c-notes" class="xv-status" style="margin-top:0;"></div>' +
      '<div id="xv-c-diff"></div>' +
      '<div class="xv-row"><button id="xv-c-apply" class="xv-btn" type="button">' + esc(T.cApply) + '</button></div>' +
      '</div>' +
      '</div>' +

      '</div>';
    return panel;
  }

  function init() {
    const panel = buildUI();
    const messages = document.getElementById('messages');
    if (messages) messages.insertAdjacentElement('beforebegin', panel);
    else document.getElementById('app')?.appendChild(panel);
    const $ = (id) => document.getElementById(id);

    // tab 切换
    const tabs = { f: $('xv-tab-f'), l: $('xv-tab-l'), c: $('xv-tab-c') };
    const pages = { f: $('xv-page-f'), l: $('xv-page-l'), c: $('xv-page-c') };
    for (const k of Object.keys(tabs)) {
      tabs[k].addEventListener('click', () => {
        for (const j of Object.keys(tabs)) {
          tabs[j].classList.toggle('on', j === k);
          pages[j].classList.toggle('on', j === k);
        }
      });
    }

    // ---- 撤销上次写入（单级：最近一次成功的 writeRange） ----
    const undoBtn = $('xv-undo');
    undoCb = () => { undoBtn.style.display = ''; };
    undoBtn.addEventListener('click', async () => {
      if (!undoData) return;
      undoBtn.disabled = true;
      const d = undoData;
      try {
        await Excel.run(async (ctx) => {
          const ws = ctx.workbook.worksheets.getItem(d.sheetName);
          const range = ws.getRangeByIndexes(d.rowIndex, d.columnIndex, d.snap.values.length, d.snap.values[0].length);
          if (d.isFormula) range.formulas = d.snap.formulas;
          else range.values = d.snap.values;
          await ctx.sync();
        });
        undoData = null;
        undoBtn.style.display = 'none';
        // 状态提示到当前激活的 tab
        const activeStatus = document.querySelector('.xv-page.on');
        const stMap = { 'xv-page-f': fStatusEl, 'xv-page-l': lStatusEl, 'xv-page-c': cStatusEl };
        const st = activeStatus && stMap[activeStatus.id];
        if (st) setStatus(st, '✓ 已撤销上次写入，恢复为原内容');
      } catch (e) {
        const activeStatus = document.querySelector('.xv-page.on');
        const stMap = { 'xv-page-f': fStatusEl, 'xv-page-l': lStatusEl, 'xv-page-c': cStatusEl };
        const st = activeStatus && stMap[activeStatus.id];
        if (st) setStatus(st, '撤销失败：' + e.message, true);
      } finally {
        undoBtn.disabled = false;
      }
    });

    // ---- ① 公式 ----
    const fDesc = $('xv-f-desc'), fGen = $('xv-f-gen'), fStatus = $('xv-f-status'), fStatusEl = fStatus;
    const fResult = $('xv-f-result'), fFormula = $('xv-f-formula'), fFallback = $('xv-f-fallback'), fFbwrap = $('xv-f-fbwrap'), fExpl = $('xv-f-expl'), fWrite = $('xv-f-write');
    fGen.addEventListener('click', async () => {
      const desc = fDesc.value.trim();
      if (!desc) { setStatus(fStatus, '请先描述要算什么', true); return; }
      let ctxSel = null;
      try { ctxSel = await readSelection(); }
      catch (e) { setStatus(fStatus, '（未读取到选区上下文，仅按描述生成：' + e.message + '）'); }
      fGen.disabled = true; fResult.style.display = 'none'; setStatus(fStatus, T.loading);
      try {
        const d = await post('/api/excel/formula', {
          desc,
          context: ctxSel ? splitSel(ctxSel, false) : {},
        });
        fFormula.value = d.formula || '';
        fFallback.value = d.fallback || '';
        fFbwrap.style.display = d.fallback ? 'block' : 'none';
        fExpl.textContent = d.explanation || '';
        fResult.style.display = 'block';
        setStatus(fStatus, '');
      } catch (e) { setStatus(fStatus, e.message, true); }
      finally { fGen.disabled = false; }
    });
    fWrite.addEventListener('click', async () => {
      const f = fFormula.value.trim();
      if (!f) return;
      try {
        const sel = await readSelection();
        await writeRange(sel.sheet, sel.rowIndex, sel.columnIndex, [[f]], true);
        setStatus(fStatus, '✓ 公式已写入 ' + cellAddr(sel, 0, 0));
      } catch (e) { setStatus(fStatus, '写入失败：' + e.message, true); }
    });

    // ---- ② 批量填充 ----
    let lSel = null;
    const lRead = $('xv-l-read'), lHdr = $('xv-l-hdr'), lSelinfo = $('xv-l-selinfo'), lChips = $('xv-l-chips');
    const lTpl = $('xv-l-tpl'), lGen = $('xv-l-gen'), lStatus = $('xv-l-status'), lResult = $('xv-l-result'), lPreview = $('xv-l-preview'), lWrite = $('xv-l-write');
    const lStatusEl = lStatus;
    let lResults = null;
    lRead.addEventListener('click', async () => {
      try {
        lSel = await readSelection();
        const s = splitSel(lSel, lHdr.checked);
        lSelinfo.style.display = 'block';
        lSelinfo.innerHTML = esc(T.sheet + '：' + lSel.sheet + ' · ' + lSel.rowCount + ' ' + T.rows + ' × ' + lSel.columnCount + ' ' + T.cols +
          (lHdr.checked && lSel.rowCount > 1 ? '（表头 ' + s.headers.length + ' 列，数据 ' + s.rows.length + ' 行）' : '')) +
          '<br>' + s.headers.slice(0, 12).map(esc).join(' ｜ ') + (s.headers.length > 12 ? ' …' : '');
        lChips.innerHTML = s.headers.filter(Boolean).slice(0, 20).map((h) => '<button class="xv-chip" type="button">{{' + esc(h) + '}}</button>').join('');
        Array.from(lChips.children).forEach((chip) => {
          chip.addEventListener('click', () => {
            const st = lTpl.selectionStart || lTpl.value.length;
            lTpl.value = lTpl.value.slice(0, st) + chip.textContent + lTpl.value.slice(lTpl.selectionEnd || st);
            lTpl.focus();
          });
        });
        setStatus(lStatus, '');
      } catch (e) { lSel = null; setStatus(lStatus, e.message, true); }
    });
    lGen.addEventListener('click', async () => {
      if (!lSel) { setStatus(lStatus, T.lNoSel, true); return; }
      const template = lTpl.value.trim();
      if (!template) { setStatus(lStatus, '请先填写填充模板', true); return; }
      const s = splitSel(lSel, lHdr.checked);
      lGen.disabled = true; lResult.style.display = 'none'; setStatus(lStatus, T.loading + '（' + s.rows.length + ' 行）');
      try {
        const d = await post('/api/excel/batchfill', { template, headers: s.headers, rows: s.rows });
        lResults = Array.isArray(d.results) ? d.results : [];
        if (!lResults.length) throw new Error('AI 未返回结果，请重试');
        // 预览表：前 3 列原数据 + 结果
        let html = '<table class="xv-table"><tr>';
        html += s.headers.slice(0, 3).map((h) => '<th>' + esc(h) + '</th>').join('') + '<th>AI 结果</th></tr>';
        const n = Math.min(6, lResults.length);
        for (let i = 0; i < n; i++) {
          html += '<tr>' + s.rows[i].slice(0, 3).map((c) => '<td>' + esc(c) + '</td>').join('') +
            '<td style="color:var(--accent,#2563eb);font-weight:500;">' + esc(lResults[i]) + '</td></tr>';
        }
        html += '</table>';
        if (lResults.length > n) html += '<div class="xv-status">…共 ' + lResults.length + ' 行，写入后可见全部</div>';
        lPreview.innerHTML = html;
        lResult.style.display = 'block';
        setStatus(lStatus, '');
      } catch (e) { setStatus(lStatus, e.message, true); }
      finally { lGen.disabled = false; }
    });
    lWrite.addEventListener('click', async () => {
      if (!lSel || !lResults) return;
      try {
        const useHdr = lHdr.checked && lSel.rowCount > 1;
        const startRow = lSel.rowIndex + (useHdr ? 1 : 0);
        await writeRange(lSel.sheet, startRow, lSel.columnIndex + lSel.columnCount, lResults.map((v) => [v]), false);
        setStatus(lStatus, '✓ 已写入右侧一列（' + lResults.length + ' 行）');
      } catch (e) { setStatus(lStatus, '写入失败：' + e.message, true); }
    });

    // ---- ③ 数据清洗 ----
    let cSel = null, cClean = null;
    const cRead = $('xv-c-read'), cHdr = $('xv-c-hdr'), cSelinfo = $('xv-c-selinfo'), cInstr = $('xv-c-instr');
    const cGen = $('xv-c-gen'), cStatus = $('xv-c-status'), cResult = $('xv-c-result'), cNotes = $('xv-c-notes'), cDiff = $('xv-c-diff'), cApply = $('xv-c-apply');
    const cStatusEl = cStatus;
    cRead.addEventListener('click', async () => {
      try {
        cSel = await readSelection();
        const s = splitSel(cSel, cHdr.checked);
        cSelinfo.style.display = 'block';
        cSelinfo.innerHTML = esc(T.sheet + '：' + cSel.sheet + ' · ' + cSel.rowCount + ' ' + T.rows + ' × ' + cSel.columnCount + ' ' + T.cols) +
          '<br>' + s.headers.map(esc).join(' ｜ ');
        setStatus(cStatus, '');
      } catch (e) { cSel = null; setStatus(cStatus, e.message, true); }
    });
    cGen.addEventListener('click', async () => {
      if (!cSel) { setStatus(cStatus, T.lNoSel, true); return; }
      const s = splitSel(cSel, cHdr.checked);
      cGen.disabled = true; cResult.style.display = 'none'; setStatus(cStatus, T.loading + '（' + s.rows.length + ' 行）');
      try {
        const d = await post('/api/excel/clean', { headers: s.headers, rows: s.rows, instruction: cInstr.value.trim() });
        cClean = Array.isArray(d.rows) ? d.rows : null;
        if (!cClean || cClean.length !== s.rows.length) throw new Error('AI 返回的行数与原数据不一致（' + (cClean ? cClean.length : 0) + '/' + s.rows.length + '），请重试');
        // diff：列出所有变更单元格
        const diffs = [];
        for (let i = 0; i < s.rows.length; i++) {
          const cols = Math.max(s.rows[i].length, cClean[i].length);
          for (let j = 0; j < cols; j++) {
            const a = String(s.rows[i][j] == null ? '' : s.rows[i][j]);
            const b = String(cClean[i][j] == null ? '' : cClean[i][j]);
            if (a !== b) diffs.push({ pos: cellAddr(cSel, i + (cHdr.checked && cSel.rowCount > 1 ? 1 : 0), j), old: a, nw: b });
          }
        }
        cNotes.textContent = (d.notes || '') + (diffs.length ? ' · ' + diffs.length + ' ' + T.cChanged : ' · ' + T.cNoChange);
        cDiff.innerHTML = diffs.length
          ? '<div class="xv-diff">' + diffs.slice(0, 100).map((d2) =>
            '<div class="xv-diff-row"><span class="xv-diff-pos">' + esc(d2.pos) + '</span>' +
            '<span class="xv-diff-old">' + esc(d2.old || '(空)') + '</span><span class="xv-diff-arrow">→</span>' +
            '<span class="xv-diff-new">' + esc(d2.nw || '(空)') + '</span></div>').join('') +
            (diffs.length > 100 ? '<div class="xv-diff-row"><span class="xv-status">…还有 ' + (diffs.length - 100) + ' 处</span></div>' : '') + '</div>'
          : '';
        cApply.style.display = diffs.length ? 'inline-block' : 'none';
        cResult.style.display = 'block';
        setStatus(cStatus, '');
      } catch (e) { setStatus(cStatus, e.message, true); }
      finally { cGen.disabled = false; }
    });
    cApply.addEventListener('click', async () => {
      if (!cSel || !cClean) return;
      try {
        const useHdr = cHdr.checked && cSel.rowCount > 1;
        const startRow = cSel.rowIndex + (useHdr ? 1 : 0);
        const width = cSel.columnCount;
        const rows2d = cClean.map((r) => { const rr = r.slice(0, width); while (rr.length < width) rr.push(''); return rr; });
        await writeRange(cSel.sheet, startRow, cSel.columnIndex, rows2d, false);
        setStatus(cStatus, '✓ 清洗结果已写回原区域（' + rows2d.length + ' 行）');
        cResult.style.display = 'none';
      } catch (e) { setStatus(cStatus, '写入失败：' + e.message, true); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
