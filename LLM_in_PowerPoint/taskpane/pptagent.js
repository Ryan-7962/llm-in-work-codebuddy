// PPT 智能排版 Agent（P0-2）：读当前页形状 → AI 生成操作计划 → 预览勾选 → 逐步执行 → 可撤销。
// 一级视图（由 topnav.js 的「智能」tab 驱动，监听 llm-agent-view 事件），仅 PowerPoint 套件加载。
// 服务端 /api/ppt/plan 生成计划（固定 8 种操作 schema，服务端已校验 shapeId/参数）；
// 执行在客户端 Office.js 完成：每步单独 PowerPoint.run、单独反馈，失败即停（后续标⏸）。
// 执行前对整页形状做快照（文本/字体/字号/加粗/文字色/填充色 + 新增形状 id），「撤销全部」一键还原。
(() => {
  'use strict';
  if (window.__llm_agent_panel) return;
  window.__llm_agent_panel = true;

  const T = {
    title: '智能排版',
    read: '🔄 读取当前页', reading: '读取形状中…',
    readOk: (n) => '✓ 已读取 ' + n + ' 个形状，可以下达指令了',
    noSlide: '未找到当前幻灯片，请先在幻灯片中点击任意位置',
    insLabel: '想怎么改？（一句话描述，AI 出计划，你确认后执行）',
    insPh: '例如：把标题改成 32 号加粗；正文统一微软雅黑 16 号；标题文字改成白色、背景色块改成品牌蓝 #1F6FEB；在右下角加一个 200×60 的「谢谢观看」文本框',
    plan: '生成修改计划', planning: 'AI 正在生成计划…（约 5–20 秒）',
    needIns: '请先描述想要的修改效果',
    needRead: '请先点「读取当前页」',
    stepsLabel: '修改计划（勾选要执行的步骤）',
    exec: '执行选中步骤', execing: '执行中…', rePlan: '重新生成计划',
    execDone: (ok, skip) => '✓ 执行完成：' + ok + ' 步成功' + (skip ? '，' + skip + ' 步未执行' : '') + '。效果不满意可「撤销全部」',
    execStop: (i, err) => '✗ 第 ' + (i + 1) + ' 步失败：' + err + '，已停止（可撤销后重试）',
    undo: '撤销全部', undoing: '撤销中…', undone: '✓ 已恢复执行前状态',
    noUndo: '还没有可撤销的修改',
    stOk: '✓', stFail: '✗', stSkip: '⏸',
    planFail: '生成计划失败',
    del: '删除',
  };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const httpErr = (s) => '服务错误（HTTP ' + s + '）';
  const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, n) + '…' : String(s));

  const pptShapeApi = (() => {
    try {
      return typeof PowerPoint !== 'undefined' && PowerPoint.run &&
        Office.context.requirements.isSetSupported('PowerPointApi', '1.5');
    } catch { return false; }
  })();
  if (!pptShapeApi) return; // 仅 PowerPoint（加载项只在本套件引用此脚本）

  function stepDesc(st) {
    const id = st.shapeId != null ? '#' + st.shapeId : '';
    switch (st.op) {
      case 'setText': return '改文本 ' + id + ' →「' + trunc(st.text, 24) + '」';
      case 'setFont': return '改字体 ' + id + ' → ' + st.font;
      case 'setFontSize': return '改字号 ' + id + ' → ' + st.size + ' 磅';
      case 'setBold': return (st.bold ? '加粗 ' : '取消加粗 ') + id;
      case 'setColor': return '文字颜色 ' + id + ' → ' + st.color;
      case 'setFill': return '填充色 ' + id + ' → ' + st.color;
      case 'addTextbox': return '新增文本框「' + trunc(st.text, 16) + '」（' + Math.round(st.left) + ', ' + Math.round(st.top) + ', ' + Math.round(st.width) + '×' + Math.round(st.height) + '）';
      case 'deleteShape': return '⚠ 删除形状 ' + id;
      default: return st.op;
    }
  }

  // ---- Office.js：当前页 ----
  function getSlide(ctx) {
    return new Promise((resolve, reject) => {
      const sel = ctx.presentation.getSelectedSlides();
      sel.load('items');
      ctx.sync().then(() => {
        const slide = sel.items && sel.items[0];
        if (!slide) { reject(new Error(T.noSlide)); return; }
        slide.load('width, height');
        ctx.sync().then(() => resolve(slide)).catch(reject);
      }).catch(reject);
    });
  }

  // 读取整页形状（含文本），供计划生成
  function readSlideShapes() {
    return PowerPoint.run(async (ctx) => {
      const slide = await getSlide(ctx);
      const shapes = slide.shapes;
      shapes.load('id,shapeType,name,left,top,width,height');
      await ctx.sync();
      const items = shapes.items || [];
      for (const s of items) {
        try { s.load('textFrame/textRange/text'); } catch {}
      }
      try { await ctx.sync(); } catch {}
      const list = items.map((s) => {
        let text = '';
        try { text = (s.textFrame && s.textFrame.textRange && s.textFrame.textRange.text) || ''; } catch {}
        return {
          id: s.id, name: s.name, type: String(s.shapeType || ''),
          text, left: s.left, top: s.top, width: s.width, height: s.height,
        };
      });
      return {
        slide: { width: slide.width || 960, height: slide.height || 540 },
        shapes: list,
      };
    });
  }

  // 快照：整页形状的可还原属性（文本/字体/字号/加粗/文字色/填充）
  function snapshotSlide() {
    return PowerPoint.run(async (ctx) => {
      const slide = await getSlide(ctx);
      const shapes = slide.shapes;
      shapes.load('id');
      await ctx.sync();
      const items = shapes.items || [];
      for (const s of items) {
        try {
          s.load('textFrame/textRange/text,textFrame/textRange/font/name,textFrame/textRange/font/size,textFrame/textRange/font/bold,textFrame/textRange/font/color,fill/type,fill/foregroundColor');
        } catch {}
      }
      try { await ctx.sync(); } catch {}
      return items.map((s) => {
        const snap = { id: s.id, hadText: false };
        try {
          const tr = s.textFrame && s.textFrame.textRange;
          if (tr) {
            snap.hadText = true;
            snap.text = tr.text || '';
            snap.fontName = tr.font && tr.font.name;
            snap.fontSize = tr.font && tr.font.size;
            snap.bold = tr.font && tr.font.bold;
            snap.color = tr.font && tr.font.color;
          }
        } catch {}
        try {
          snap.fillType = s.fill && s.fill.type;
          snap.fillColor = s.fill && s.fill.foregroundColor;
        } catch {}
        return snap;
      });
    });
  }

  // 执行单步；返回 { addedId? }
  function applyStep(step) {
    return PowerPoint.run(async (ctx) => {
      const slide = await getSlide(ctx);
      if (step.op === 'addTextbox') {
        const shapes = slide.shapes;
        const box = typeof shapes.addTextbox === 'function' ? shapes.addTextbox(step.text) : shapes.addText(step.text);
        box.left = step.left; box.top = step.top; box.width = step.width; box.height = step.height;
        await ctx.sync();
        try {
          if (step.fontSize != null && box.textFrame && box.textFrame.textRange) box.textFrame.textRange.font.size = step.fontSize;
          if (step.color && box.textFrame && box.textFrame.textRange) box.textFrame.textRange.font.color = step.color;
        } catch {}
        box.load('id');
        await ctx.sync();
        return { addedId: box.id };
      }
      const shapes = slide.shapes;
      shapes.load('id');
      await ctx.sync();
      const s = (shapes.items || []).find((x) => x.id === step.shapeId);
      if (!s) throw new Error('找不到形状 #' + step.shapeId);
      const tr = s.textFrame && s.textFrame.textRange;
      switch (step.op) {
        case 'setText': if (!tr) throw new Error('该形状不支持文本'); tr.text = step.text; break;
        case 'setFont': if (!tr) throw new Error('该形状不支持文本'); tr.font.name = step.font; break;
        case 'setFontSize': if (!tr) throw new Error('该形状不支持文本'); tr.font.size = step.size; break;
        case 'setBold': if (!tr) throw new Error('该形状不支持文本'); tr.font.bold = step.bold; break;
        case 'setColor': if (!tr) throw new Error('该形状不支持文本'); tr.font.color = step.color; break;
        case 'setFill': if (!s.fill) throw new Error('该形状不支持填充'); s.fill.setSolidColor(step.color); break;
        case 'deleteShape': s.delete(); break;
        default: throw new Error('未知操作 ' + step.op);
      }
      await ctx.sync();
      return {};
    });
  }

  // 撤销：还原快照 + 删除新增形状
  function undoSnapshot(snap, addedIds) {
    return PowerPoint.run(async (ctx) => {
      const slide = await getSlide(ctx);
      // ① 删除本轮新增的形状
      if (addedIds && addedIds.length) {
        const shapes0 = slide.shapes;
        shapes0.load('id');
        await ctx.sync();
        for (const s of shapes0.items || []) {
          if (addedIds.includes(s.id)) { try { s.delete(); } catch {} }
        }
        await ctx.sync();
      }
      // ② 还原被改过的形状
      const shapes = slide.shapes;
      shapes.load('id');
      await ctx.sync();
      const byId = new Map((shapes.items || []).map((s) => [s.id, s]));
      for (const sp of snap || []) {
        const s = byId.get(sp.id);
        if (!s) continue;
        try {
          if (sp.hadText) {
            const tr = s.textFrame && s.textFrame.textRange;
            if (tr) {
              if (typeof sp.text === 'string') tr.text = sp.text;
              if (sp.fontName != null) tr.font.name = sp.fontName;
              if (sp.fontSize != null) tr.font.size = sp.fontSize;
              if (sp.bold != null) tr.font.bold = sp.bold;
              if (sp.color != null) { try { tr.font.color = sp.color; } catch {} }
            }
          }
          if (s.fill) {
            if (sp.fillType === 'Solid' && typeof sp.fillColor === 'string') { try { s.fill.setSolidColor(sp.fillColor); } catch {} }
            else if (sp.fillType === 'None') { try { s.fill.clear(); } catch {} }
          }
        } catch {}
      }
      await ctx.sync();
    });
  }

  // ---- UI ----
  function buildUI() {
    const style = document.createElement('style');
    style.textContent = [
      '#agent-view { flex:1; min-height:0; display:flex; flex-direction:column; background:var(--paper, #f7f8fa); }',
      '#agent-view.hidden { display:none !important; }',
      '.agt-vhead { flex:none; display:flex; align-items:center; gap:8px; padding:8px 12px; background:#fff; border-bottom:1px solid var(--line, #e3e6ea); }',
      '.agt-vhead b { font-size:13px; font-weight:600; }',
      '.agt-vbody { flex:1; overflow-y:auto; padding:10px 12px 16px; }',
      '.agt-panel .field { display:flex; flex-direction:column; gap:4px; margin:0 0 10px; }',
      '.agt-panel .flabel { font-size:11.5px; color:var(--muted, #6b7686); }',
      '.agt-panel textarea { width:100%; box-sizing:border-box; border:1px solid #d5d9e0; border-radius:8px; padding:8px 10px; font:inherit; resize:vertical; min-height:72px; background:#fff; color:#1c2733; line-height:1.7; }',
      '.agt-panel .img-note { font-size:12px; color:#6b7686; margin:2px 0 10px; line-height:1.7; }',
      '.agt-status { font-size:12px; color:#6b7686; min-height:18px; margin-top:8px; word-break:break-all; line-height:1.7; white-space:pre-line; }',
      '.agt-status.err { color:#b3261e; }',
      '.agt-steps { margin:10px 0 0; border:1px solid var(--line, #e3e6ea); border-radius:8px; background:#fff; overflow:hidden; }',
      '.agt-step { display:flex; align-items:flex-start; gap:8px; padding:8px 10px; border-bottom:1px solid #eef0f3; font-size:12.5px; line-height:1.6; }',
      '.agt-step:last-child { border-bottom:0; }',
      '.agt-step input[type=checkbox] { margin-top:2px; flex:none; }',
      '.agt-step .d { flex:1; min-width:0; word-break:break-all; }',
      '.agt-step .r { display:block; font-size:11px; color:var(--muted, #9aa3af); margin-top:1px; }',
      '.agt-step .st { flex:none; font-size:12px; width:16px; text-align:center; }',
      '.agt-step.done .st { color:#15803d; }',
      '.agt-step.fail .st { color:#b3261e; }',
      '.agt-step.skip { opacity:.55; }',
      '.agt-actions { display:flex; gap:8px; justify-content:center; margin-top:12px; flex-wrap:wrap; }',
    ].join('\n');
    document.head.appendChild(style);

    const panel = document.createElement('section');
    panel.id = 'agent-view';
    panel.className = 'agt-panel hidden';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', T.title);
    panel.innerHTML =
      '<div class="agt-vhead"><b>' + esc(T.title) + '</b></div>' +
      '<div class="agt-vbody">' +
      '<div class="img-row" style="margin-bottom:10px;"><button id="agt-read" class="btn" type="button">' + esc(T.read) + '</button></div>' +
      '<label class="field"><span class="flabel">' + esc(T.insLabel) + '</span>' +
      '<textarea id="agt-ins" rows="3" placeholder="' + esc(T.insPh) + '"></textarea></label>' +
      '<button id="agt-plan" class="btn btn-primary" type="button" style="width:100%;">' + esc(T.plan) + '</button>' +
      '<div id="agt-status" class="agt-status" role="status"></div>' +
      '<div id="agt-steps-wrap" class="hidden">' +
      '<div class="flabel" style="margin:12px 0 4px;">' + esc(T.stepsLabel) + '</div>' +
      '<div id="agt-steps" class="agt-steps"></div>' +
      '<div class="agt-actions">' +
      '<button id="agt-exec" class="btn btn-primary" type="button">' + esc(T.exec) + '</button>' +
      '<button id="agt-replan" class="btn" type="button">' + esc(T.rePlan) + '</button>' +
      '<button id="agt-undo" class="btn hidden" type="button">' + esc(T.undo) + '</button>' +
      '</div></div>' +
      '</div>';

    const messages = document.getElementById('messages');
    if (messages) messages.insertAdjacentElement('beforebegin', panel);
    else document.getElementById('app')?.appendChild(panel);
    return panel;
  }

  function init() {
    const panel = buildUI();
    if (!panel) return;
    const $ = (id) => document.getElementById(id);
    const readBtn = $('agt-read'), insEl = $('agt-ins'), planBtn = $('agt-plan');
    const status = $('agt-status'), stepsWrap = $('agt-steps-wrap'), stepsBox = $('agt-steps');
    const execBtn = $('agt-exec'), replanBtn = $('agt-replan'), undoBtn = $('agt-undo');

    let slideCtx = null;          // { slide:{width,height}, shapes:[…] }
    let plan = [];                // 当前计划步骤
    let undoData = null;          // { snap, addedIds }
    let executing = false;

    function setStatus(text, isErr) {
      status.textContent = text || '';
      status.classList.toggle('err', !!isErr);
    }

    function renderSteps(statePer) {
      stepsBox.innerHTML = plan.map((st, i) => {
        const sp = statePer && statePer[i];
        const cls = sp === 'done' ? ' done' : sp === 'fail' ? ' fail' : sp === 'skip' ? ' skip' : '';
        const mark = sp === 'done' ? T.stOk : sp === 'fail' ? T.stFail : sp === 'skip' ? T.stSkip : '';
        return '<label class="agt-step' + cls + '">' +
          '<input type="checkbox" data-i="' + i + '"' + (sp ? ' disabled' : ' checked') + '>' +
          '<span class="d">' + esc(stepDesc(st)) + (st.reason ? '<span class="r">' + esc(st.reason) + '</span>' : '') + '</span>' +
          '<span class="st">' + mark + '</span></label>';
      }).join('');
    }

    async function readShapes(silent) {
      readBtn.disabled = true;
      if (!silent) setStatus('读取形状中…');
      try {
        slideCtx = await readSlideShapes();
        setStatus(T.readOk(slideCtx.shapes.length));
        return true;
      } catch (e) {
        setStatus((e && e.message) ? e.message : String(e), true);
        return false;
      } finally {
        readBtn.disabled = false;
      }
    }

    // 视图显隐由 topnav.js 驱动
    document.addEventListener('llm-agent-view', (e) => {
      panel.classList.toggle('hidden', !e.detail?.show);
      if (e.detail?.show && !slideCtx) readShapes(true);
    });

    readBtn.addEventListener('click', () => readShapes(false));

    planBtn.addEventListener('click', async () => {
      const ins = insEl.value.trim();
      if (!ins) { setStatus(T.needIns, true); insEl.focus(); return; }
      if (!slideCtx) { setStatus(T.needRead, true); return; }
      planBtn.disabled = true;
      stepsWrap.classList.add('hidden');
      plan = [];
      setStatus(T.planning);
      try {
        const resp = await fetch('api/ppt/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instruction: ins, shapes: slideCtx.shapes, slide: slideCtx.slide }),
        });
        const data = await resp.json().catch(() => ({ ok: false, error: httpErr(resp.status) }));
        if (!data.ok || !Array.isArray(data.steps) || !data.steps.length) {
          throw new Error(data.error || httpErr(resp.status));
        }
        plan = data.steps;
        renderSteps(null);
        stepsWrap.classList.remove('hidden');
        setStatus('✓ 计划已生成（共 ' + plan.length + ' 步），确认勾选后点「执行选中步骤」');
      } catch (e) {
        setStatus(T.planFail + '：' + (e && e.message ? e.message : e), true);
      } finally {
        planBtn.disabled = false;
      }
    });

    replanBtn.addEventListener('click', () => planBtn.click());

    execBtn.addEventListener('click', async () => {
      if (executing || !plan.length) return;
      const checked = [...stepsBox.querySelectorAll('input[type=checkbox]:checked')].map((c) => Number(c.dataset.i));
      if (!checked.length) { setStatus('请至少勾选一个步骤', true); return; }
      executing = true;
      execBtn.disabled = true; planBtn.disabled = true; readBtn.disabled = true;
      const state = new Array(plan.length).fill(null);
      setStatus(T.execing);
      try {
        undoData = { snap: await snapshotSlide(), addedIds: [] };
      } catch (e) {
        setStatus('快照失败，已取消执行：' + (e && e.message ? e.message : e), true);
        executing = false; execBtn.disabled = false; planBtn.disabled = false; readBtn.disabled = false;
        return;
      }
      let failIdx = -1, failErr = '', okCount = 0;
      for (const i of checked) {
        try {
          const r = await applyStep(plan[i]);
          if (r && r.addedId != null) undoData.addedIds.push(r.addedId);
          state[i] = 'done'; okCount++;
        } catch (e) {
          state[i] = 'fail'; failIdx = i;
          failErr = (e && e.message) ? e.message : String(e);
          break;
        }
        renderSteps(state.slice());
      }
      for (let i = 0; i < plan.length; i++) if (state[i] === null && i > (failIdx >= 0 ? failIdx : -1)) state[i] = 'skip';
      renderSteps(state);
      if (failIdx >= 0) setStatus(T.execStop(failIdx, failErr), true);
      else setStatus(T.execDone(okCount, plan.length - okCount));
      undoBtn.classList.remove('hidden');
      executing = false;
      execBtn.disabled = false; planBtn.disabled = false; readBtn.disabled = false;
      slideCtx = null; // 页面已变，下次读取重新拉
    });

    undoBtn.addEventListener('click', async () => {
      if (!undoData) { setStatus(T.noUndo, true); return; }
      undoBtn.disabled = true;
      setStatus(T.undoing);
      try {
        await undoSnapshot(undoData.snap, undoData.addedIds);
        undoData = null;
        undoBtn.classList.add('hidden');
        setStatus(T.undone);
      } catch (e) {
        setStatus('撤销失败：' + (e && e.message ? e.message : e), true);
      } finally {
        undoBtn.disabled = false;
      }
    });

    insEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); planBtn.click(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
