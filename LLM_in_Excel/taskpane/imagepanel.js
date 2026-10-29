// AI 图像模块（CodeBuddy · WorkBuddy）：文生图 + 上下文配图 + AI 修图 + 抠图。
// v3：从弹窗升级为一级视图（由 topnav.js 的「图像」tab 驱动，监听 llm-image-view 事件）。
// v4（2026-10-23）：多生图引擎——默认混元（hy），检测到即梦 CLI 或自定义引擎时出现下拉切换。
// - 插图：读选中文字 → AI 生成中文画面描述（六要素、120–200 字，可修改）→ 风格 chips →
//         多候选（默认 2 张，点选后插入）→ 会话内历史缩略图
// - 抠图：PPT 选中图片自动载入；完成后可「替换原图」（同位置同尺寸）或「插入为新图」
// - PPT 插入尺寸受控（按幻灯片宽度等比缩放，不超出页面）；Word/Excel 走光标处插入
// - 中文提示词直连混元生图（原生支持中文，无需翻译）；界面固定中文
(() => {
  'use strict';
  if (window.__llm_image_panel) return;
  window.__llm_image_panel = true;

  const SIZES = [
    ['1280x720', '横版 1280 × 720'],
    ['1024x1024', '方形 1024 × 1024'],
    ['720x1280', '竖版 720 × 1280'],
  ];
  const STYLES = [
    ['', '不限风格'],
    ['扁平商务插画', '扁平商务'],
    ['极简线条插画', '极简线条'],
    ['写实摄影', '写实摄影'],
    ['3D 渲染', '3D 渲染'],
    ['水彩手绘', '水彩手绘'],
    ['科技感插画', '科技感'],
  ];
  const EST_CREDIT = 5.7;
  const T = {
    title: 'AI 图像工具',
    tabGen: '🖼 插图', tabEdit: '✨ 修图', tabMat: '✂ 抠图',
    // 插图
    fromSel: '✨ 为选中内容配图', readingSel: '读取选中内容…',
    noSel: '没有读到选中的文字，请先在幻灯片/文档里选中一段内容再试',
    selLabel: '选中内容', promptLabel: '画面描述（中文，可直接修改）',
    promptPh: '描述想要的插图，例如：一株茂盛的薰衣草与薄荷叶交叠的植物插画，扁平商务插画风，薄荷绿与淡紫主色调，浅米白背景，构图居中留白…也可以先选中文字，点上方按钮自动生成描述',
    styleLabel: '风格', sizeLabel: '尺寸', countLabel: '候选', engineLabel: '引擎',
    engineNoteHy: '每张约 5.7 点额度（CodeBuddy 账户）；生成后先预览，满意再插入。',
    engineNoteJimeng: '即梦生图按即梦积分计费（单张上限可在 ~/.codebuddy/image-engines.json 的 jimeng.creditCeiling 配置）；服务端会自动把分辨率调到模型支持的档位。',
    engineNoteCustom: '走自定义图片 API 计费（配置见 ~/.codebuddy/image-engines.json）。',
    engineLoadFail: '引擎列表获取失败，默认使用混元',
    gen: '生成预览', gening: '生成中…（约 10–30 秒）', regen: '重新生成',
    insert: '插入选中图片', inserting: '插入中…', inserted: '已插入 ✓',
    needPrompt: '请先填写画面描述，或选中文字后点「为选中内容配图」',
    failed: '生成失败', insertFailed: '插入失败',
    pickCandidate: '点击图片选择要插入的一张',
    cost: '每张约 5.7 点额度（CodeBuddy 账户）；生成后先预览，满意再插入。',
    historyLabel: '本次会话生成的图（点击载入）', historyEmpty: '还没有生成记录',
    // 抠图
    reRead: '重新读取选中图片', readingShape: '正在读取选中的图片…',
    noShape: '没有读到选中的图片。请在幻灯片中选中一个图片形状，再点「重新读取选中图片」',
    autoLoaded: '✓ 已自动载入选中的图片，直接点「开始抠图」即可',
    autoNone: '未检测到选中的图片。可复制图片后按 ⌘V 粘贴、点「从剪贴板读取」、拖入或上传文件',
    hostUnavail: '当前应用不支持自动读取选中的图片（仅 PowerPoint 支持）。可复制图片后按 ⌘V 粘贴、点「从剪贴板读取」、拖入或上传文件',
    clipRead: '📋 从剪贴板读取', clipReading: '正在读取剪贴板…',
    clipFail: '剪贴板里没有图片或读取失败。请先复制图片（选中图片后按 ⌘C），再点「从剪贴板读取」',
    clipOk: '✓ 已读取剪贴板中的图片', pasted: '✓ 已接收粘贴的图片',
    pasteHint: '也可复制图片后按 ⌘V 粘贴、拖入图片文件，或',
    pickFile: '选择图片文件',
    matBtn: '开始抠图', matting: '抠图中…（约 15–30 秒）',
    matNeed: '请先提供原图（选中图片 / 粘贴 / 上传）',
    matDone: '抠图完成（背景已移除，透明 PNG）', matCost: '每次约消耗 5.7 点额度',
    matHint: '抠图会移除背景、保留主体，输出透明背景 PNG。「替换原图」会保留原位置与尺寸。',
    // 修图
    editPromptLabel: '修改描述（用文字 brief 告诉 AI 怎么改）',
    editPromptPh: '例如：把背景换成海边，保留人物和主体不变，光线自然，整体写实摄影风格…',
    editBtn: '开始修图', editing: '修图中…（约 15–60 秒）', editDone: '修图完成',
    editNeedPrompt: '请先描述想要的修改，例如「把背景换成海边，主体保持不变」',
    editHint: '默认使用混元修图；即梦仅在检测到 CLI 时可选。建议明确写出「要改什么」和「哪些保持不变」。',
    editAutoLoaded: '✓ 已载入选中的图片，填写修改描述后即可开始修图',
    editCostHy: '混元修图按 CodeBuddy 账户额度计费；先生成预览，确认后再替换或插入。',
    editCostJimeng: '即梦修图按即梦积分计费；使用独立的「LLM_in_Work 修图」画布。',
    replace: '替换原图', replaced: '已替换原图 ✓', replaceNeed: '替换原图需要先在幻灯片中选中那个图片形状',
    replaceUnavail: '「替换原图」仅 PowerPoint 支持',
    imgTooBig: '图片过大（上限 4MB），请压缩后再试',
    clickZoom: '点击图片可放大查看',
    zoomTitle: '图片预览（点击任意处关闭）',
    httpErr: '服务错误（HTTP ',
    unsupported: '不支持的图片格式', readFail: '文件读取失败',
    noSlide: '未找到当前幻灯片，请先在幻灯片中点击任意位置再插入',
  };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const httpErr = (s) => T.httpErr + s + '）';

  // ---- 宿主能力检测 ----
  function detectHost() {
    try {
      if (typeof PowerPoint !== 'undefined' && PowerPoint.run) return 'ppt';
      if (typeof Excel !== 'undefined' && Excel.run) return 'excel';
      return 'word';
    } catch { return 'word'; }
  }
  let pptShapeApi = false, pptSlideApi = false; // 1.10（图片读写）/ 1.5（slide 定位）
  try {
    if (typeof PowerPoint !== 'undefined') {
      pptShapeApi = Office.context.requirements.isSetSupported('PowerPointApi', '1.10');
      pptSlideApi = Office.context.requirements.isSetSupported('PowerPointApi', '1.5');
    }
  } catch {}

  // ---- PNG 原始像素尺寸（IHDR 头解析，用于等比缩放） ----
  function pngSize(b64) {
    try {
      const bin = atob(b64.slice(0, 64));
      if (bin.length < 24) return null;
      const w = (bin.charCodeAt(16) << 24) | (bin.charCodeAt(17) << 16) | (bin.charCodeAt(18) << 8) | bin.charCodeAt(19);
      const h = (bin.charCodeAt(20) << 24) | (bin.charCodeAt(21) << 16) | (bin.charCodeAt(22) << 8) | bin.charCodeAt(23);
      return (w > 0 && h > 0) ? { w, h } : null;
    } catch { return null; }
  }

  // ---- 读取选中文本（三宿主通用 API） ----
  function readSelectedText() {
    return new Promise((resolve) => {
      try {
        Office.context.document.getSelectedDataAsync(Office.CoercionType.Text, (r) => {
          if (r.status === Office.AsyncResultStatus.Succeeded) resolve((r.value || '').toString().trim());
          else resolve('');
        });
      } catch { resolve(''); }
    });
  }

  // ---- PPT：读取选中的图片形状（1.10） ----
  function readSelectedImageShape() {
    return new Promise((resolve, reject) => {
      if (!pptShapeApi) { reject(new Error(T.hostUnavail)); return; }
      PowerPoint.run(async (ctx) => {
        try {
          const shapes = ctx.presentation.getSelectedShapes();
          shapes.load('items/id,items/type');
          await ctx.sync();
          if (!shapes.items.length) { reject(new Error(T.noShape)); return; }
          const target = shapes.items.find((s) => s.type === 'Image');
          if (!target) { reject(new Error(T.noShape)); return; }
          const img = target.getImageAsBase64();
          await ctx.sync();
          const b64 = img.value || '';
          if (!b64) { reject(new Error(T.noShape)); return; }
          resolve({ b64: b64.replace(/^data:image\/[a-z+]+;base64,/, ''), mime: 'image/png', shapeId: target.id });
        } catch (e) { reject(e); }
      }).catch(reject);
    });
  }

  // ---- PPT：用抠图结果替换选中的图片形状（保位置保尺寸，1.5+） ----
  function replaceSelectedImageShape(b64, expectedShapeId) {
    return new Promise((resolve, reject) => {
      if (!pptSlideApi) { reject(new Error(T.replaceUnavail)); return; }
      PowerPoint.run(async (ctx) => {
        try {
          const shapes = ctx.presentation.getSelectedShapes();
          shapes.load('items/id,items/type');
          await ctx.sync();
          if (!shapes.items.length) { reject(new Error(T.replaceNeed)); return; }
          const target = shapes.items.find((s) => s.type === 'Image');
          if (!target || (expectedShapeId && target.id !== expectedShapeId)) { reject(new Error(T.replaceNeed)); return; }
          target.load('left, top, width, height, rotation, name');
          const slide = target.getParentSlide();
          await ctx.sync();
          const pic = slide.shapes.addImage(b64);
          pic.left = target.left; pic.top = target.top;
          pic.width = target.width; pic.height = target.height;
          pic.rotation = target.rotation;
          if (target.name) pic.name = target.name;
          target.delete();
          await ctx.sync();
          resolve();
        } catch (e) { reject(e); }
      }).catch(reject);
    });
  }

  // ---- PPT：受控插入当前幻灯片（等比缩放至幻灯片宽 55%，水平居中，1.5+） ----
  function pptInsertImage(b64) {
    return new Promise((resolve, reject) => {
      if (!pptSlideApi) { reject(new Error('fallback')); return; }
      PowerPoint.run(async (ctx) => {
        try {
          const sel = ctx.presentation.getSelectedSlides();
          sel.load('items');
          await ctx.sync();
          const slide = sel.items && sel.items[0];
          if (!slide) { reject(new Error(T.noSlide)); return; }
          let sw = 960, sh = 540; // 16:9 默认值兜底
          // Slide 没有 width/height 属性（load 会抛 0x80070057）；
          // 真实画布尺寸在 presentation.pageWidth/pageHeight，读不到再用默认值
          try {
            ctx.presentation.load('pageWidth,pageHeight');
            await ctx.sync();
            if (ctx.presentation.pageWidth > 0) { sw = ctx.presentation.pageWidth; sh = ctx.presentation.pageHeight; }
          } catch {}
          const pic = slide.shapes.addImage(b64);
          const px = pngSize(b64);
          const ratio = px ? px.h / px.w : 0.5625;
          const w = sw * 0.55;
          pic.width = w; pic.height = w * ratio;
          pic.left = (sw - w) / 2; pic.top = (sh - pic.height) / 2;
          await ctx.sync();
          resolve();
        } catch (e) { reject(e); }
      }).catch(reject);
    });
  }

  // ---- 通用插入：PPT 走受控插入（失败退回光标处），Word/Excel 光标处 ----
  function insertImage(img) {
    const b64 = img.b64.replace(/^data:[^,]+,/, '');
    if (detectHost() === 'ppt') {
      return pptInsertImage(b64).catch(() => legacyInsert(b64)); // 旧版 Office 无 1.5 API 时退回
    }
    return legacyInsert(b64);
  }
  function legacyInsert(b64) {
    return new Promise((resolve, reject) => {
      try {
        Office.context.document.setSelectedDataAsync(b64, { coercionType: Office.CoercionType.Image }, (r) => {
          if (r.status === Office.AsyncResultStatus.Failed) reject(new Error(r.error?.message || r.error?.name || '未知错误'));
          else resolve();
        });
      } catch (e) { reject(e); }
    });
  }

  // ---- UI ----
  function buildUI() {
    const style = document.createElement('style');
    style.textContent = [
      '#img-view { flex:1; min-height:0; display:flex; flex-direction:column; background:var(--paper, #f7f8fa); }',
      '.img-vhead { flex:none; display:flex; align-items:center; gap:8px; padding:8px 12px; background:#fff; border-bottom:1px solid var(--line, #e3e6ea); }',
      '.img-vhead b { font-size:13px; font-weight:600; }',
      '.img-vbody { flex:1; overflow-y:auto; padding:10px 12px 16px; }',
      '.img-panel .field { display:flex; flex-direction:column; gap:4px; margin:0 0 10px; }',
      '.img-panel .flabel { font-size:11.5px; color:var(--muted, #6b7686); display:flex; align-items:center; gap:6px; }',
      '.img-panel .flabel .mini { font-size:11px; color:var(--muted, #9aa3af); font-weight:400; }',
      '.img-panel textarea { width:100%; box-sizing:border-box; border:1px solid #d5d9e0; border-radius:8px; padding:8px 10px; font:inherit; resize:vertical; min-height:96px; background:#fff; color:#1c2733; line-height:1.7; }',
      '.img-panel .img-note { font-size:12px; color:#6b7686; margin:2px 0 10px; line-height:1.7; }',
      '.img-panel .img-tabs { display:flex; gap:6px; }',
      '.img-panel .img-tab { padding:5px 16px; text-align:center; border:1px solid #d5d9e0; border-radius:8px; background:#fff; cursor:pointer; font-size:12.5px; color:#1c2733; }',
      '.img-panel .img-tab.on { background:var(--accent, #1f6feb); border-color:var(--accent, #1f6feb); color:#fff; font-weight:600; }',
      '.img-panel .style-chips { display:flex; flex-wrap:wrap; gap:5px; }',
      '.img-panel .schip { border:1px solid #d5d9e0; background:#fff; border-radius:999px; padding:3px 11px; font-size:12px; cursor:pointer; color:#374151; }',
      '.img-panel .schip.on { border-color:var(--accent, #1f6feb); color:var(--accent, #1f6feb); background:var(--paper, #f0f6ff); font-weight:600; }',
      '.img-panel select { padding:4px 6px; font-size:12px; border:1px solid #d5d9e0; border-radius:6px; background:#fff; color:inherit; }',
      '.img-panel .img-cands { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:12px; }',
      '.img-panel .img-cands.c1 { grid-template-columns:1fr; }',
      '.img-panel .cand { position:relative; border:2px solid transparent; border-radius:8px; overflow:hidden; cursor:pointer; background:#fff; }',
      '.img-panel .cand img { display:block; width:100%; height:auto; }',
      '.img-panel .cand.on { border-color:var(--accent, #1f6feb); }',
      '.img-panel .cand .tag { position:absolute; top:5px; left:5px; background:var(--accent, #1f6feb); color:#fff; font-size:10px; border-radius:4px; padding:1px 6px; display:none; }',
      '.img-panel .cand.on .tag { display:block; }',
      '.img-panel .img-preview { margin-top:12px; text-align:center; }',
      '.img-panel .img-preview img { max-width:100%; max-height:260px; height:auto; border-radius:8px; border:1px solid #e3e7ee; cursor:zoom-in; }',
      '.img-panel .img-preview.checker img { background:repeating-conic-gradient(#e8e8e8 0% 25%, #fff 0% 50%) 50% / 16px 16px; }',
      '.img-panel .img-src { margin-top:8px; text-align:center; }',
      '.img-panel .img-src img { max-width:100%; max-height:120px; border-radius:6px; border:1px dashed #c5cbd4; cursor:zoom-in; }',
      '.img-panel .img-status { font-size:12px; color:#6b7686; min-height:18px; margin-top:8px; word-break:break-all; line-height:1.7; white-space:pre-line; }',
      '.img-panel .img-status.err { color:#b3261e; }',
      '.img-panel .img-actions { display:flex; gap:8px; justify-content:center; margin-top:10px; flex-wrap:wrap; }',
      '.img-panel .img-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:10px; }',
      '.img-panel .img-row .btn { flex:0 0 auto; }',
      '.img-panel .img-drop { border:1.5px dashed #b8c0cc; border-radius:8px; padding:14px 10px; text-align:center; font-size:12px; color:#6b7686; margin:8px 0 10px; transition:all .15s; }',
      '.img-panel .img-drop.on { border-color:var(--accent, #1f6feb); background:var(--paper, #f0f6ff); }',
      '.img-panel .hist-strip { display:flex; gap:6px; overflow-x:auto; padding:6px 0 2px; margin-top:6px; }',
      '.img-panel .hist-strip img { height:52px; width:auto; border-radius:6px; border:1px solid #e3e7ee; cursor:pointer; flex:none; }',
      '.img-panel .hist-strip img:hover { border-color:var(--accent, #1f6feb); }',
      '.img-panel .hist-strip img.cur { border-color:var(--accent, #1f6feb); box-shadow:0 0 0 1px var(--accent, #1f6feb); }',
      '.img-lightbox { position:fixed; inset:0; z-index:99999; background:rgba(0,0,0,.82); display:flex; align-items:center; justify-content:center; cursor:zoom-out; }',
      '.img-lightbox img { max-width:94vw; max-height:92vh; border-radius:6px; }',
      '#img-view.hidden { display:none !important; }',
    ].join('\n');
    document.head.appendChild(style);

    const panel = document.createElement('section');
    panel.id = 'img-view';
    panel.className = 'img-panel hidden';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', T.title);
    panel.innerHTML =
      '<div class="img-vhead"><b>' + esc(T.title) + '</b><span class="img-tabs">' +
      '<button id="img-tab-gen" class="img-tab on" type="button">' + esc(T.tabGen) + '</button>' +
      '<button id="img-tab-edit" class="img-tab" type="button">' + esc(T.tabEdit) + '</button>' +
      '<button id="img-tab-mat" class="img-tab" type="button">' + esc(T.tabMat) + '</button>' +
      '</span></div>' +
      '<div class="img-vbody">' +
      // ---- 插图页 ----
      '<div id="img-page-gen">' +
      '<div class="img-row"><button id="img-fromsel" class="btn" type="button">' + esc(T.fromSel) + '</button></div>' +
      '<div id="img-selcard" class="hidden" style="border:1px solid var(--line,#e3e6ea); background:#fff; border-radius:8px; padding:8px 10px; margin:0 0 10px; font-size:11.5px; color:#6b7686; line-height:1.6;"></div>' +
      '<label class="field"><span class="flabel">' + esc(T.promptLabel) + '</span>' +
      '<textarea id="img-prompt" rows="5" placeholder="' + esc(T.promptPh) + '"></textarea></label>' +
      '<label class="field"><span class="flabel">' + esc(T.styleLabel) + '</span><span class="style-chips" id="img-styles">' +
      STYLES.map(([v, l], i) => '<button type="button" class="schip' + (i === 0 ? ' on' : '') + '" data-v="' + esc(v) + '">' + esc(l) + '</button>').join('') +
      '</span></label>' +
      '<div class="img-row" style="gap:14px;">' +
      '<label class="flabel" id="img-engine-wrap" style="display:none;">' + esc(T.engineLabel) + ' <select id="img-engine"></select></label>' +
      '<label class="flabel">' + esc(T.sizeLabel) + ' <select id="img-size">' + SIZES.map(([v, l]) => '<option value="' + v + '">' + esc(l) + '</option>').join('') + '</select></label>' +
      '<label class="flabel">' + esc(T.countLabel) + ' <select id="img-count"><option value="1">1 张</option><option value="2" selected>2 张</option><option value="3">3 张</option></select></label>' +
      '<span class="flabel mini" id="img-cost"></span>' +
      '</div>' +
      '<p class="img-note">' + esc(T.cost) + '</p>' +
      '<button id="img-gen" class="btn btn-primary" type="button" style="width:100%;">' + esc(T.gen) + '</button>' +
      '<div id="img-status" class="img-status" role="status"></div>' +
      '<div id="img-preview" class="img-preview"></div>' +
      '<div class="img-actions">' +
      '<button id="img-insert" class="btn btn-primary hidden" type="button">' + esc(T.insert) + '</button>' +
      '<button id="img-regen" class="btn hidden" type="button">' + esc(T.regen) + '</button>' +
      '</div>' +
      '<div id="img-hist-wrap" class="hidden" style="margin-top:14px;">' +
      '<div class="flabel" style="margin-bottom:2px;">' + esc(T.historyLabel) + '</div>' +
      '<div id="img-hist" class="hist-strip"></div>' +
      '</div></div>' +
      // ---- 抠图页 ----
      '<div id="img-page-mat" class="hidden">' +
      '<div class="img-row"><button id="img-clip" class="btn" type="button">' + esc(T.clipRead) + '</button><button id="img-fromshape" class="btn" type="button">' + esc(T.reRead) + '</button></div>' +
      '<div id="img-drop" class="img-drop">' + esc(T.pasteHint) + ' <button id="img-pick" class="btn" type="button" style="padding:2px 10px;font-size:12px;">' + esc(T.pickFile) + '</button><input id="img-file" type="file" accept="image/*" class="hidden"></div>' +
      '<div id="img-src" class="img-src"></div>' +
      '<p class="img-note">' + esc(T.matCost) + ' · ' + esc(T.matHint) + '</p>' +
      '<button id="img-mat" class="btn btn-primary" type="button" style="width:100%;">' + esc(T.matBtn) + '</button>' +
      '<div id="img-mat-status" class="img-status" role="status"></div>' +
      '<div id="img-mat-preview" class="img-preview checker"></div>' +
      '<div class="img-actions">' +
      '<button id="img-mat-replace" class="btn btn-primary hidden" type="button">' + esc(T.replace) + '</button>' +
      '<button id="img-mat-insert" class="btn hidden" type="button">插入为新图</button>' +
      '</div></div>' +
      // ---- 修图页（与抠图共享原图，避免重复读取/上传） ----
      '<div id="img-page-edit" class="hidden">' +
      '<div class="img-row"><button id="img-edit-clip" class="btn" type="button">' + esc(T.clipRead) + '</button><button id="img-edit-fromshape" class="btn" type="button">' + esc(T.reRead) + '</button></div>' +
      '<div id="img-edit-drop" class="img-drop">' + esc(T.pasteHint) + ' <button id="img-edit-pick" class="btn" type="button" style="padding:2px 10px;font-size:12px;">' + esc(T.pickFile) + '</button><input id="img-edit-file" type="file" accept="image/*" class="hidden"></div>' +
      '<div id="img-edit-src" class="img-src"></div>' +
      '<label class="field"><span class="flabel">' + esc(T.editPromptLabel) + '</span><textarea id="img-edit-prompt" rows="4" placeholder="' + esc(T.editPromptPh) + '"></textarea></label>' +
      '<div class="img-row" style="gap:14px;">' +
      '<label class="flabel" id="img-edit-engine-wrap" style="display:none;">' + esc(T.engineLabel) + ' <select id="img-edit-engine"></select></label>' +
      '<label class="flabel">' + esc(T.countLabel) + ' <select id="img-edit-count"><option value="1" selected>1 张</option><option value="2">2 张</option><option value="3">3 张</option></select></label>' +
      '<span class="flabel mini" id="img-edit-cost"></span></div>' +
      '<p class="img-note" id="img-edit-note">' + esc(T.editCostHy) + ' ' + esc(T.editHint) + '</p>' +
      '<button id="img-edit" class="btn btn-primary" type="button" style="width:100%;">' + esc(T.editBtn) + '</button>' +
      '<div id="img-edit-status" class="img-status" role="status"></div>' +
      '<div id="img-edit-preview" class="img-preview"></div>' +
      '<div class="img-actions"><button id="img-edit-replace" class="btn btn-primary hidden" type="button">' + esc(T.replace) + '</button><button id="img-edit-insert" class="btn hidden" type="button">插入为新图</button></div>' +
      '</div></div>';

    const messages = document.getElementById('messages');
    if (messages) messages.insertAdjacentElement('beforebegin', panel);
    else document.getElementById('app')?.appendChild(panel);

    // lightbox（点击放大）
    const lightbox = document.createElement('div');
    lightbox.className = 'img-lightbox hidden';
    lightbox.title = T.zoomTitle;
    lightbox.innerHTML = '<img alt="zoom">';
    document.body.appendChild(lightbox);
    lightbox.addEventListener('click', () => lightbox.classList.add('hidden'));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') lightbox.classList.add('hidden'); });
    panel._zoom = (src) => { lightbox.querySelector('img').src = src; lightbox.classList.remove('hidden'); };

    return panel;
  }

  function blobToB64(blob) {
    return new Promise((resolve, reject) => {
      if (blob.size > 4 * 1024 * 1024) { reject(new Error(T.imgTooBig)); return; }
      const fr = new FileReader();
      fr.onload = () => {
        const r = String(fr.result || '');
        const m = r.match(/^data:(image\/[a-z+]+);base64,(.*)$/);
        if (!m) { reject(new Error(T.unsupported)); return; }
        resolve({ b64: m[2], mime: m[1] });
      };
      fr.onerror = () => reject(new Error(T.readFail));
      fr.readAsDataURL(blob);
    });
  }

  function init() {
    const panel = buildUI();
    if (!panel) return;
    const $ = (id) => document.getElementById(id);
    const tabGen = $('img-tab-gen'), tabEdit = $('img-tab-edit'), tabMat = $('img-tab-mat');
    const pageGen = $('img-page-gen'), pageEdit = $('img-page-edit'), pageMat = $('img-page-mat');
    const promptEl = $('img-prompt'), sizeEl = $('img-size'), countEl = $('img-count'), costEl = $('img-cost');
    const engineWrap = $('img-engine-wrap'), engineSel = $('img-engine');
    const costNote = panel.querySelector('.img-note'); // 引擎说明（首段）
    const fromSel = $('img-fromsel'), gen = $('img-gen'), insert = $('img-insert'), regen = $('img-regen');
    const status = $('img-status'), preview = $('img-preview'), selCard = $('img-selcard');
    const clipBtn = $('img-clip'), fromShape = $('img-fromshape'), drop = $('img-drop'), pick = $('img-pick'), fileInput = $('img-file');
    const srcBox = $('img-src'), matBtn = $('img-mat'), matStatus = $('img-mat-status'), matPreview = $('img-mat-preview');
    const matReplace = $('img-mat-replace'), matInsert = $('img-mat-insert');
    const editClip = $('img-edit-clip'), editFromShape = $('img-edit-fromshape'), editDrop = $('img-edit-drop');
    const editPick = $('img-edit-pick'), editFile = $('img-edit-file'), editSrcBox = $('img-edit-src');
    const editPrompt = $('img-edit-prompt'), editCount = $('img-edit-count'), editCost = $('img-edit-cost');
    const editEngineWrap = $('img-edit-engine-wrap'), editEngineSel = $('img-edit-engine'), editNote = $('img-edit-note');
    const editBtn = $('img-edit'), editStatus = $('img-edit-status'), editPreview = $('img-edit-preview');
    const editReplace = $('img-edit-replace'), editInsert = $('img-edit-insert');
    const histWrap = $('img-hist-wrap'), histStrip = $('img-hist');
    const host = detectHost();
    let candidates = [];         // 本轮候选 [{ b64, mime }]
    let selectedIdx = -1;       // 选中的候选
    let lastSelText = '';       // 最近一次读取的选中内容
    let curStyle = '';          // 当前风格
    let matSource = null, matResult = null; // 原图由抠图与修图共享
    let editResults = [], editSelectedIdx = -1, editCurEngine = 'hy';
    const history = [];         // 会话内生成历史 [{ b64, mime }]
    let curEngine = 'hy';       // 当前生图引擎（hy / jimeng / custom:*）
    let enginesLoaded = false;

    if (host !== 'ppt') { fromShape.classList.add('hidden'); editFromShape.classList.add('hidden'); } // 读取选中图片仅 PPT

    // ---- 引擎列表：GET api/image/engines，多于 1 个可选时才显示下拉 ----
    async function loadEngines() {
      let data;
      try {
        const resp = await fetch('api/image/engines');
        data = await resp.json();
        if (!data.ok || !Array.isArray(data.engines)) throw new Error(data.error || 'bad');
      } catch {
        if (!enginesLoaded) costNote.textContent = T.engineLoadFail;
        return;
      }
      const engines = data.engines;
      const selectable = engines.filter((e) => e && e.available);
      // 只有混元一个可用引擎时隐藏下拉，保持界面干净
      if (selectable.length <= 1 && engines.every((e) => e.id === 'hy')) {
        engineWrap.style.display = 'none';
        editEngineWrap.style.display = 'none';
        editCurEngine = 'hy';
        enginesLoaded = true;
        updateEditEngineNote();
        return;
      }
      engineWrap.style.display = '';
      engineSel.innerHTML = engines.map((e) => {
        const label = esc(e.name || e.id) + (e.model ? ' · ' + esc(e.model) : '');
        return '<option value="' + esc(e.id) + '"' + (e.available ? '' : ' disabled') + '>' + label + (e.available ? '' : '（不可用）') + '</option>';
      }).join('');
      // 默认选混元；不可用时选第一个可用引擎
      const def = engines.find((e) => e.id === 'hy' && e.available) || selectable[0];
      if (def) { engineSel.value = def.id; curEngine = def.id; }
      // 修图只开放混元和即梦；自定义文生图 API 不一定支持图生图。
      const editEngines = engines.filter((e) => e.id === 'hy' || e.id === 'jimeng');
      const editSelectable = editEngines.filter((e) => e.available);
      editEngineWrap.style.display = editSelectable.length > 1 ? '' : 'none';
      editEngineSel.innerHTML = editEngines.map((e) =>
        '<option value="' + esc(e.id) + '"' + (e.available ? '' : ' disabled') + '>' + esc(e.name || e.id) + (e.available ? '' : '（不可用）') + '</option>').join('');
      const editDef = editEngines.find((e) => e.id === 'hy' && e.available) || editSelectable[0];
      if (editDef) { editEngineSel.value = editDef.id; editCurEngine = editDef.id; }
      enginesLoaded = true;
      updateEngineNote();
      updateEditEngineNote();
    }
    function updateEngineNote() {
      const n = Number(countEl.value) || 1;
      if (curEngine === 'jimeng') {
        costEl.textContent = '按即梦积分计费';
        costNote.textContent = T.engineNoteJimeng;
      } else if (curEngine.startsWith('custom:')) {
        costEl.textContent = 'API 计费';
        costNote.textContent = T.engineNoteCustom;
      } else {
        costEl.textContent = '约 ' + (n * EST_CREDIT).toFixed(1) + ' 点/次';
        costNote.textContent = T.engineNoteHy;
      }
    }
    function updateEditEngineNote() {
      const n = Number(editCount.value) || 1;
      if (editCurEngine === 'jimeng') {
        editCost.textContent = '按即梦积分计费';
        editNote.textContent = T.editCostJimeng + ' ' + T.editHint;
      } else {
        editCost.textContent = '约 ' + (n * EST_CREDIT).toFixed(1) + ' 点/次';
        editNote.textContent = T.editCostHy + ' ' + T.editHint;
      }
    }
    engineSel.addEventListener('change', () => { curEngine = engineSel.value; updateEngineNote(); });
    editEngineSel.addEventListener('change', () => { editCurEngine = editEngineSel.value; updateEditEngineNote(); });
    editCount.addEventListener('change', updateEditEngineNote);
    loadEngines();
    updateEditEngineNote();

    function setStatus(el, text, isErr) {
      el.textContent = text || '';
      el.classList.toggle('err', !!isErr);
    }
    function updateCost() {
      updateEngineNote();
    }
    countEl.addEventListener('change', updateCost);
    updateEngineNote();

    // tab 切换
    function switchTab(name) {
      tabGen.classList.toggle('on', name === 'gen');
      tabEdit.classList.toggle('on', name === 'edit');
      tabMat.classList.toggle('on', name === 'mat');
      pageGen.classList.toggle('hidden', name !== 'gen');
      pageEdit.classList.toggle('hidden', name !== 'edit');
      pageMat.classList.toggle('hidden', name !== 'mat');
    }
    tabGen.addEventListener('click', () => switchTab('gen'));

    // 视图显隐由 topnav.js 驱动（llm-image-view 事件）
    document.addEventListener('llm-image-view', (e) => {
      panel.classList.toggle('hidden', !e.detail?.show);
      if (e.detail?.show) {
        loadEngines(); // 重新拉一次，即梦登录态/自定义配置可能刚变化
        if (host === 'ppt') {
          autoDetect(true).then((ok) => { if (ok) { switchTab('mat'); setStatus(matStatus, T.autoLoaded); } });
        }
      }
    });

    // 图片点击放大（委托）
    [preview, matPreview, srcBox, editPreview, editSrcBox].forEach((box) => {
      box.addEventListener('click', (e) => {
        if (e.target && e.target.tagName === 'IMG' && !e.target.closest('.cand')) panel._zoom(e.target.src);
      });
    });

    // ---- 风格 chips ----
    $('img-styles').addEventListener('click', (e) => {
      const b = e.target.closest('.schip');
      if (!b) return;
      curStyle = b.dataset.v || '';
      $('img-styles').querySelectorAll('.schip').forEach((c) => c.classList.toggle('on', c === b));
    });

    // ---- 历史 ----
    function pushHistory(img) {
      if (history[0] && history[0].b64 === img.b64) return;
      history.unshift(img);
      if (history.length > 6) history.length = 6;
      renderHistory();
    }
    function renderHistory() {
      histWrap.classList.toggle('hidden', !history.length);
      histStrip.innerHTML = history.map((h, i) =>
        '<img src="data:' + esc(h.mime) + ';base64,' + h.b64 + '" data-i="' + i + '" alt="hist" title="' + esc(T.clickZoom) + '">').join('');
    }
    histStrip.addEventListener('click', (e) => {
      if (e.target.tagName !== 'IMG') return;
      const idx = Number(e.target.dataset.i);
      const img = history[idx];
      if (!img) return;
      candidates = [img]; selectedIdx = 0;
      preview.innerHTML = '<div class="img-cands c1"><div class="cand on"><span class="tag">✓</span><img src="data:' + esc(img.mime) + ';base64,' + img.b64 + '"></div></div>';
      setStatus(status, '✓ 已载入历史图片，可直接插入');
      insert.classList.remove('hidden');
    });

    // ---- 候选渲染与点选 ----
    function renderCandidates(imgs) {
      candidates = imgs;
      selectedIdx = imgs.length ? 0 : -1;
      preview.innerHTML = imgs.length
        ? '<div class="img-cands' + (imgs.length === 1 ? ' c1' : '') + '">' + imgs.map((im, i) =>
            '<div class="cand' + (i === 0 ? ' on' : '') + '" data-i="' + i + '"><span class="tag">✓ 已选</span><img src="data:' + esc(im.mime) + ';base64,' + im.b64 + '"></div>').join('') + '</div>' +
          '<p class="img-note" style="text-align:center;">' + esc(T.pickCandidate) + '</p>'
        : '';
    }
    preview.addEventListener('click', (e) => {
      const cand = e.target.closest('.cand');
      if (!cand) return;
      selectedIdx = Number(cand.dataset.i);
      preview.querySelectorAll('.cand').forEach((c) => c.classList.toggle('on', c === cand));
    });

    // ---- 抠图：来源管理 ----
    function setMatSource(img) {
      if (!img || !img.b64) return false;
      if (img.b64.length > 5600000) { setStatus(matStatus, T.imgTooBig, true); return false; }
      matSource = img;
      matResult = null;
      matPreview.innerHTML = '';
      matReplace.classList.add('hidden');
      matInsert.classList.add('hidden');
      editResults = []; editSelectedIdx = -1;
      editPreview.innerHTML = '';
      editReplace.classList.add('hidden');
      editInsert.classList.add('hidden');
      const srcHtml = '<img src="data:' + esc(img.mime) + ';base64,' + img.b64 + '" alt="source" title="' + esc(T.clickZoom) + '">';
      srcBox.innerHTML = srcHtml;
      editSrcBox.innerHTML = srcHtml;
      setStatus(matStatus, '');
      setStatus(editStatus, '');
      return true;
    }

    // 自动探测 PPT 选中的图片
    let detecting = false;
    async function autoDetect(silent) {
      if (host !== 'ppt' || !pptShapeApi || detecting) return false;
      detecting = true;
      try {
        const img = await readSelectedImageShape();
        if (setMatSource(img)) {
          if (!silent) setStatus(matStatus, T.autoLoaded);
          return true;
        }
        return false;
      } catch {
        if (!silent) setStatus(matStatus, T.autoNone);
        return false;
      } finally { detecting = false; }
    }

    // 切到抠图页：无图时自动探测一次
    tabMat.addEventListener('click', () => {
      switchTab('mat');
      if (matSource) return;
      if (host === 'ppt') autoDetect(false);
      else setStatus(matStatus, T.hostUnavail);
    });

    // 切到修图页：复用已读原图；没有时自动读取 PPT 选中图片
    tabEdit.addEventListener('click', async () => {
      switchTab('edit');
      if (matSource) { setStatus(editStatus, T.editAutoLoaded); return; }
      if (host !== 'ppt') { setStatus(editStatus, T.hostUnavail); return; }
      if (detecting) return;
      detecting = true;
      setStatus(editStatus, T.readingShape);
      try {
        const img = await readSelectedImageShape();
        if (setMatSource(img)) setStatus(editStatus, T.editAutoLoaded);
      } catch {
        setStatus(editStatus, T.autoNone);
      } finally { detecting = false; }
    });

    // 手动重读选中图片（仅 PPT）
    fromShape.addEventListener('click', async () => {
      fromShape.disabled = true;
      setStatus(matStatus, T.readingShape);
      try {
        const img = await readSelectedImageShape();
        if (setMatSource(img)) setStatus(matStatus, T.autoLoaded);
      } catch (e) {
        setStatus(matStatus, (e && e.message) ? e.message : String(e), true);
      } finally {
        fromShape.disabled = false;
      }
    });

    editFromShape.addEventListener('click', async () => {
      editFromShape.disabled = true;
      setStatus(editStatus, T.readingShape);
      try {
        const img = await readSelectedImageShape();
        if (setMatSource(img)) setStatus(editStatus, T.editAutoLoaded);
      } catch (e) {
        setStatus(editStatus, (e && e.message) ? e.message : String(e), true);
      } finally { editFromShape.disabled = false; }
    });

    // 从剪贴板读取
    clipBtn.addEventListener('click', async () => {
      clipBtn.disabled = true;
      setStatus(matStatus, T.clipReading);
      try {
        if (!navigator.clipboard || !navigator.clipboard.read) throw new Error(T.clipFail);
        const items = await navigator.clipboard.read();
        let blob = null;
        for (const it of items) {
          const type = (it.types || []).find((t) => t.startsWith('image/'));
          if (type) { blob = await it.getType(type); break; }
        }
        if (!blob) throw new Error(T.clipFail);
        if (setMatSource(await blobToB64(blob))) setStatus(matStatus, T.clipOk);
      } catch (e) {
        setStatus(matStatus, (e && e.message) ? e.message : String(e), true);
      } finally {
        clipBtn.disabled = false;
      }
    });

    editClip.addEventListener('click', async () => {
      editClip.disabled = true;
      setStatus(editStatus, T.clipReading);
      try {
        if (!navigator.clipboard || !navigator.clipboard.read) throw new Error(T.clipFail);
        const items = await navigator.clipboard.read();
        let blob = null;
        for (const it of items) {
          const type = (it.types || []).find((t) => t.startsWith('image/'));
          if (type) { blob = await it.getType(type); break; }
        }
        if (!blob) throw new Error(T.clipFail);
        if (setMatSource(await blobToB64(blob))) setStatus(editStatus, T.clipOk);
      } catch (e) {
        setStatus(editStatus, (e && e.message) ? e.message : String(e), true);
      } finally { editClip.disabled = false; }
    });

    pick.addEventListener('click', () => fileInput.click());
    editPick.addEventListener('click', () => editFile.click());
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      try { setMatSource(await blobToB64(f)); } catch (e) { setStatus(matStatus, (e && e.message) ? e.message : String(e), true); }
      fileInput.value = '';
    });

    editFile.addEventListener('change', async () => {
      const f = editFile.files && editFile.files[0];
      if (!f) return;
      try { setMatSource(await blobToB64(f)); } catch (e) { setStatus(editStatus, (e && e.message) ? e.message : String(e), true); }
      editFile.value = '';
    });

    // 粘贴：document 级监听，抠图或修图页激活时生效
    document.addEventListener('paste', async (e) => {
      const inEdit = !pageEdit.classList.contains('hidden');
      const inMat = !pageMat.classList.contains('hidden');
      if (panel.classList.contains('hidden') || (!inEdit && !inMat)) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const it of items) {
        if (it.type && it.type.startsWith('image/')) {
          e.preventDefault();
          const f = it.getAsFile();
          if (!f) return;
          try {
            if (setMatSource(await blobToB64(f))) setStatus(inEdit ? editStatus : matStatus, T.pasted);
          } catch (err) { setStatus(inEdit ? editStatus : matStatus, (err && err.message) ? err.message : String(err), true); }
          return;
        }
      }
    });

    // 拖拽：根据当前页写入对应原图区（抠图与修图共享）
    const activeDrop = () => !pageEdit.classList.contains('hidden') ? editDrop : drop;
    ['dragover', 'dragenter'].forEach((ev) => panel.addEventListener(ev, (e) => {
      e.preventDefault();
      if (!pageMat.classList.contains('hidden') || !pageEdit.classList.contains('hidden')) activeDrop().classList.add('on');
    }));
    ['dragleave', 'drop'].forEach((ev) => panel.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('on'); editDrop.classList.remove('on'); }));
    panel.addEventListener('drop', async (e) => {
      const inEdit = !pageEdit.classList.contains('hidden');
      if (!inEdit && pageMat.classList.contains('hidden')) return;
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f || !f.type.startsWith('image/')) return;
      try { setMatSource(await blobToB64(f)); } catch (err) { setStatus(inEdit ? editStatus : matStatus, (err && err.message) ? err.message : String(err), true); }
    });

    // ---- 插图：为选中内容配图（AI 生成中文画面描述） ----
    fromSel.addEventListener('click', async () => {
      fromSel.disabled = true;
      setStatus(status, T.readingSel);
      try {
        const text = await readSelectedText();
        if (!text) { setStatus(status, T.noSel, true); return; }
        lastSelText = text;
        selCard.classList.remove('hidden');
        selCard.innerHTML = '<b style="color:var(--accent,#2563eb);">✓ ' + esc(T.selLabel) + '</b>：' + esc(text.slice(0, 120)) + (text.length > 120 ? '…' : '');
        setStatus(status, '正在生成画面描述…');
        const resp = await fetch('api/image/prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: text.slice(0, 3000), instruction: curStyle ? ('插画风格：' + curStyle) : '' }),
        });
        const data = await resp.json().catch(() => ({ ok: false, error: httpErr(resp.status) }));
        if (!data.ok || !data.prompt) throw new Error(data.error || httpErr(resp.status));
        promptEl.value = data.prompt;
        setStatus(status, '✓ 已生成中文画面描述（可修改后点「生成预览」）');
      } catch (e) {
        setStatus(status, (e && e.message) ? e.message : String(e), true);
      } finally {
        fromSel.disabled = false;
      }
    });

    // ---- 插图：生成（多候选） ----
    async function doGenerate() {
      let prompt = promptEl.value.trim();
      if (!prompt) { setStatus(status, T.needPrompt, true); promptEl.focus(); return; }
      if (curStyle && !prompt.includes(curStyle)) prompt += '；风格：' + curStyle;
      const n = Number(countEl.value) || 1;
      gen.disabled = true; regen.classList.add('hidden'); insert.classList.add('hidden');
      preview.innerHTML = ''; candidates = []; selectedIdx = -1;
      setStatus(status, T.gening);
      try {
        const resp = await fetch('api/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, size: sizeEl.value, count: n, engine: curEngine }),
        });
        const data = await resp.json().catch(() => ({ ok: false, error: httpErr(resp.status) }));
        if (!data.ok || !Array.isArray(data.images) || !data.images.length) {
          throw new Error(data.error || httpErr(resp.status));
        }
        renderCandidates(data.images);
        data.images.forEach(pushHistory);
        const engName = curEngine === 'jimeng' ? '（即梦）' : curEngine.startsWith('custom:') ? '（' + (engineSel.selectedOptions[0]?.textContent.split(' · ')[0] || '自定义') + '）' : '';
        const credit = data.usage && typeof data.usage.credit === 'number' ? '（消耗 ' + data.usage.credit + ' 点额度）' : '';
        setStatus(status, '✓ 已生成 ' + data.images.length + ' 张' + engName + credit + ' · ' + T.pickCandidate);
        insert.classList.remove('hidden');
        regen.classList.remove('hidden');
      } catch (e) {
        setStatus(status, T.failed + '：' + (e && e.message ? e.message : e), true);
      } finally {
        gen.disabled = false;
      }
    }
    gen.addEventListener('click', doGenerate);
    regen.addEventListener('click', doGenerate);
    promptEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doGenerate(); }
    });

    // ---- 修图：候选渲染、点选与执行 ----
    function renderEditResults(imgs) {
      editResults = imgs;
      editSelectedIdx = imgs.length ? 0 : -1;
      editPreview.innerHTML = imgs.length
        ? '<div class="img-cands' + (imgs.length === 1 ? ' c1' : '') + '">' + imgs.map((im, i) =>
            '<div class="cand' + (i === 0 ? ' on' : '') + '" data-i="' + i + '"><span class="tag">✓ 已选</span><img src="data:' + esc(im.mime) + ';base64,' + im.b64 + '"></div>').join('') + '</div>' +
          '<p class="img-note" style="text-align:center;">' + esc(T.pickCandidate) + '</p>'
        : '';
    }
    editPreview.addEventListener('click', (e) => {
      const cand = e.target.closest('.cand');
      if (!cand) return;
      editSelectedIdx = Number(cand.dataset.i);
      editPreview.querySelectorAll('.cand').forEach((c) => c.classList.toggle('on', c === cand));
    });

    async function doEdit() {
      const prompt = editPrompt.value.trim();
      if (!matSource) { setStatus(editStatus, T.matNeed, true); return; }
      if (!prompt) { setStatus(editStatus, T.editNeedPrompt, true); editPrompt.focus(); return; }
      const source = matSource;
      editBtn.disabled = true;
      editReplace.classList.add('hidden'); editInsert.classList.add('hidden');
      editPreview.innerHTML = ''; editResults = []; editSelectedIdx = -1;
      setStatus(editStatus, T.editing);
      try {
        const resp = await fetch('api/image/edit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageB64: source.b64, prompt, count: Number(editCount.value) || 1, engine: editCurEngine }),
        });
        const data = await resp.json().catch(() => ({ ok: false, error: httpErr(resp.status) }));
        if (!data.ok || !Array.isArray(data.images) || !data.images.length) throw new Error(data.error || httpErr(resp.status));
        renderEditResults(data.images);
        const credit = data.usage && typeof data.usage.credit === 'number' ? '（消耗 ' + data.usage.credit + ' 点额度）' : '';
        const engName = editCurEngine === 'jimeng' ? '（即梦）' : '（混元）';
        setStatus(editStatus, '✓ ' + T.editDone + engName + credit + ' · ' + T.pickCandidate);
        if (host === 'ppt') editReplace.classList.remove('hidden');
        editInsert.classList.remove('hidden');
      } catch (e) {
        setStatus(editStatus, '修图失败：' + (e && e.message ? e.message : e), true);
      } finally { editBtn.disabled = false; }
    }
    editBtn.addEventListener('click', doEdit);
    editPrompt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doEdit(); }
    });

    // ---- 抠图：执行 ----
    matBtn.addEventListener('click', async () => {
      if (!matSource) { setStatus(matStatus, T.matNeed, true); return; }
      matBtn.disabled = true; matReplace.classList.add('hidden'); matInsert.classList.add('hidden');
      matPreview.innerHTML = ''; matResult = null;
      setStatus(matStatus, T.matting);
      try {
        const resp = await fetch('api/image/matting', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageB64: matSource.b64 }),
        });
        const data = await resp.json().catch(() => ({ ok: false, error: httpErr(resp.status) }));
        if (!data.ok || !Array.isArray(data.images) || !data.images.length) {
          throw new Error(data.error || httpErr(resp.status));
        }
        matResult = data.images[0];
        const credit = data.usage && typeof data.usage.credit === 'number' ? '（消耗 ' + data.usage.credit + ' 点额度）' : '';
        matPreview.innerHTML = '<img src="data:' + esc(matResult.mime) + ';base64,' + matResult.b64 + '" alt="matting" title="' + esc(T.clickZoom) + '">';
        setStatus(matStatus, '✓ ' + T.matDone + credit + ' · ' + T.clickZoom);
        if (host === 'ppt') matReplace.classList.remove('hidden'); // 替换原图仅 PPT
        matInsert.classList.remove('hidden');
      } catch (e) {
        setStatus(matStatus, T.failed + '：' + (e && e.message ? e.message : e), true);
      } finally {
        matBtn.disabled = false;
      }
    });

    // ---- 抠图：替换原图（PPT，保位置保尺寸） ----
    matReplace.addEventListener('click', async () => {
      if (!matResult) return;
      matReplace.disabled = true;
      setStatus(matStatus, T.inserting);
      try {
        await replaceSelectedImageShape(matResult.b64.replace(/^data:[^,]+,/, ''), matSource?.shapeId);
        setStatus(matStatus, T.replaced);
      } catch (e) {
        setStatus(matStatus, T.insertFailed + '：' + (e && e.message ? e.message : e), true);
      } finally {
        matReplace.disabled = false;
      }
    });

    // ---- 修图：替换原图或插入为新图 ----
    editReplace.addEventListener('click', async () => {
      const img = editResults[editSelectedIdx];
      if (!img) { setStatus(editStatus, T.pickCandidate, true); return; }
      editReplace.disabled = true;
      setStatus(editStatus, T.inserting);
      try {
        await replaceSelectedImageShape(img.b64.replace(/^data:[^,]+,/, ''), matSource?.shapeId);
        setStatus(editStatus, T.replaced);
      } catch (e) {
        setStatus(editStatus, T.insertFailed + '：' + (e && e.message ? e.message : e), true);
      } finally { editReplace.disabled = false; }
    });
    editInsert.addEventListener('click', async () => {
      const img = editResults[editSelectedIdx];
      if (!img) { setStatus(editStatus, T.pickCandidate, true); return; }
      editInsert.disabled = true;
      setStatus(editStatus, T.inserting);
      try {
        await insertImage(img);
        setStatus(editStatus, T.inserted);
      } catch (e) {
        setStatus(editStatus, T.insertFailed + '：' + (e && e.message ? e.message : e), true);
      } finally { editInsert.disabled = false; }
    });

    // ---- 插入：插图选中候选 ----
    insert.addEventListener('click', async () => {
      const img = candidates[selectedIdx];
      if (!img) { setStatus(status, T.pickCandidate, true); return; }
      insert.disabled = true;
      setStatus(status, T.inserting);
      try {
        await insertImage(img);
        setStatus(status, T.inserted);
      } catch (e) {
        setStatus(status, T.insertFailed + '：' + (e && e.message ? e.message : e), true);
      } finally {
        insert.disabled = false;
      }
    });

    // ---- 插入：抠图结果作为新图 ----
    matInsert.addEventListener('click', async () => {
      if (!matResult) return;
      matInsert.disabled = true;
      setStatus(matStatus, T.inserting);
      try {
        await insertImage(matResult);
        setStatus(matStatus, T.inserted);
      } catch (e) {
        setStatus(matStatus, T.insertFailed + '：' + (e && e.message ? e.message : e), true);
      } finally {
        matInsert.disabled = false;
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
