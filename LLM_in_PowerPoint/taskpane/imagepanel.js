// AI 图像面板（CodeBuddy · WorkBuddy）：文生图 + 上下文配图 + 抠图。
// 自包含模块：不碰 taskpane.js 的任何状态，动态注入按钮和浮层。
// - 插图：读选中文字（getSelectedDataAsync）→ AI 生成英文提示词（可编辑）→ 生图 → 预览 → 插入光标处
// - 抠图：PPT 中选中图片后打开面板会自动载入该图并切到抠图页；也支持粘贴 / 剪贴板读取 / 拖拽 / 上传
// - 预览图点击可放大（lightbox）；界面固定中文
(() => {
  'use strict';
  if (window.__llm_image_panel) return;
  window.__llm_image_panel = true;

  const SIZES = [
    ['1280x720', '横版 1280 × 720'],
    ['1024x1024', '方形 1024 × 1024'],
    ['720x1280', '竖版 720 × 1280'],
  ];
  const EST_CREDIT = '5.7';
  // 界面固定中文（用户要求全中文）
  const T = {
    btn: '图像', title: 'AI 图像工具',
    tabGen: '插图', tabMat: '抠图',
    // 插图
    fromSel: '为选中内容配图 ✨', readingSel: '读取选中内容…', noSel: '没有读到选中的文字，请先在文档里选中一段内容再试',
    selLabel: '选中内容', promptLabel: '画面描述', promptPh: '描述想要的插图，例如：极简风格的薄荷绿茶插画，浅色背景。也可以先选中文字，点上方按钮自动生成描述',
    selPromptPh: '（已根据选中内容生成，可修改）', sizeLabel: '尺寸',
    gen: '生成预览', gening: '生成中…（约 10–30 秒）', regen: '重新生成',
    insert: '插入到文档', inserting: '插入中…', inserted: '已插入 ✓',
    close: '关闭图像面板', cost: '每张约消耗 5.7 点额度（CodeBuddy 账户）',
    needPrompt: '请先填写画面描述，或选中文字后点「为选中内容配图」', failed: '生成失败', insertFailed: '插入失败',
    note: '生成后先预览，满意再插入；插入位置是当前光标处。',
    // 抠图
    reRead: '重新读取选中图片', readingShape: '正在读取选中的图片…',
    noShape: '没有读到选中的图片。请在幻灯片中选中一个图片形状，再点「重新读取选中图片」',
    autoLoaded: '✓ 已自动载入选中的图片，直接点「开始抠图」即可',
    autoNone: '未检测到选中的图片。可复制图片后按 ⌘V 粘贴、点「从剪贴板读取」、拖入或上传文件',
    hostUnavail: '当前应用不支持自动读取选中的图片（仅 PowerPoint 支持）。可复制图片后按 ⌘V 粘贴、点「从剪贴板读取」、拖入或上传文件',
    clipRead: '📋 从剪贴板读取', clipReading: '正在读取剪贴板…',
    clipFail: '剪贴板里没有图片或读取失败。请先复制图片（选中图片后按 ⌘C），再点「从剪贴板读取」',
    clipOk: '✓ 已读取剪贴板中的图片',
    pasted: '✓ 已接收粘贴的图片',
    pasteHint: '也可复制图片后按 ⌘V 粘贴、拖入图片文件，或',
    pickFile: '选择图片文件',
    matBtn: '开始抠图', matting: '抠图中…（约 15–30 秒）',
    matNeed: '请先提供原图（选中图片 / 粘贴 / 上传）',
    matDone: '抠图完成（背景已移除，透明 PNG）', matCost: '每次约消耗 5.7 点额度',
    matHint: '抠图会移除背景、保留主体，输出透明背景 PNG，适合叠加在幻灯片版式上。',
    imgTooBig: '图片过大（上限 4MB），请压缩后再试',
    clickZoom: '点击图片可放大查看',
    zoomTitle: '图片预览（点击任意处关闭）',
    httpErr: '服务错误（HTTP ',
    unsupported: '不支持的图片格式', readFail: '文件读取失败',
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
  let pptShapeApi = false; // PowerPointApi 1.10（getImageAsBase64）
  try { pptShapeApi = typeof PowerPoint !== 'undefined' && Office.context.requirements.isSetSupported('PowerPointApi', '1.10'); } catch {}

  // ---- 读取选中文本（三宿主通用 API） ----
  function readSelectedText() {
    return new Promise((resolve) => {
      try {
        Office.context.document.getSelectedDataAsync(Office.CoercionType.Text, (r) => {
          if (r.status === Office.AsyncResultStatus.Succeeded) {
            const t = (r.value || '').toString().trim();
            resolve(t);
          } else resolve('');
        });
      } catch { resolve(''); }
    });
  }

  // ---- PPT：读取选中的图片形状（PowerPointApi 1.10） ----
  function readSelectedImageShape() {
    return new Promise((resolve, reject) => {
      if (!pptShapeApi) { reject(new Error(T.hostUnavail)); return; }
      PowerPoint.run(async (ctx) => {
        try {
          const shapes = ctx.presentation.getSelectedShapes();
          shapes.load('items/id,items/type');
          await ctx.sync();
          if (!shapes.items.length) { reject(new Error(T.noShape)); return; }
          // 优先找图片类型；找不到就用第一个形状（用户可能选的就是图）
          let target = shapes.items.find((s) => s.type === 'Image') || shapes.items[0];
          const img = target.getImageAsBase64();
          await ctx.sync();
          const b64 = img.value || '';
          if (!b64) { reject(new Error(T.noShape)); return; }
          resolve({ b64: b64.replace(/^data:image\/[a-z+]+;base64,/, ''), mime: 'image/png' });
        } catch (e) { reject(e); }
      }).catch(reject);
    });
  }

  function buildUI() {
    const style = document.createElement('style');
    style.textContent = [
      '.img-panel .field { display:flex; flex-direction:column; gap:4px; margin:0 0 10px; }',
      '.img-panel textarea { width:100%; box-sizing:border-box; border:1px solid #d5d9e0; border-radius:8px; padding:8px 10px; font:inherit; resize:vertical; min-height:64px; background:#fff; color:#1c2733; }',
      '.img-panel .img-note { font-size:12px; color:#6b7686; margin:2px 0 10px; }',
      '.img-panel .img-tabs { display:flex; gap:6px; margin-bottom:12px; }',
      '.img-panel .img-tab { flex:1; padding:7px 0; text-align:center; border:1px solid #d5d9e0; border-radius:8px; background:#f5f7fa; cursor:pointer; font-size:13px; color:#1c2733; }',
      '.img-panel .img-tab.on { background:#1f6feb; border-color:#1f6feb; color:#fff; font-weight:600; }',
      '.img-panel .img-preview { margin-top:12px; text-align:center; }',
      '.img-panel .img-preview img { max-width:100%; max-height:260px; height:auto; border-radius:8px; border:1px solid #e3e7ee; cursor:zoom-in; }',
      '.img-panel .img-preview.checker img { background:repeating-conic-gradient(#e8e8e8 0% 25%, #fff 0% 50%) 50% / 16px 16px; }',
      '.img-panel .img-src { margin-top:8px; text-align:center; }',
      '.img-panel .img-src img { max-width:100%; max-height:120px; border-radius:6px; border:1px dashed #c5cbd4; cursor:zoom-in; }',
      '.img-panel .img-status { font-size:12px; color:#6b7686; min-height:18px; margin-top:6px; word-break:break-all; }',
      '.img-panel .img-status.err { color:#b3261e; }',
      '.img-panel .img-actions { display:flex; gap:8px; justify-content:center; margin-top:10px; }',
      '.img-panel .img-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:10px; }',
      '.img-panel .img-row .btn { flex:0 0 auto; }',
      '.img-panel .img-drop { border:1.5px dashed #b8c0cc; border-radius:8px; padding:14px 10px; text-align:center; font-size:12px; color:#6b7686; margin:8px 0 10px; transition:all .15s; }',
      '.img-panel .img-drop.on { border-color:#1f6feb; background:#f0f6ff; }',
      '.img-lightbox { position:fixed; inset:0; z-index:99999; background:rgba(0,0,0,.82); display:flex; align-items:center; justify-content:center; cursor:zoom-out; }',
      '.img-lightbox img { max-width:94vw; max-height:92vh; border-radius:6px; }',
      '.img-panel .hidden { display:none; }',
    ].join('\n');
    document.head.appendChild(style);

    const actions = document.querySelector('.input-actions');
    if (!actions) return null;
    const btn = document.createElement('button');
    btn.id = 'btn-image';
    btn.type = 'button';
    btn.className = 'ibtn attach-button';
    btn.title = T.title;
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="10" r="1.5" fill="currentColor"/><path d="m5 17 4.5-4.5 3 3L16 12l3 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg><span>' + esc(T.btn) + '</span>';
    actions.insertBefore(btn, actions.firstChild);

    const panel = document.createElement('section');
    panel.id = 'img-view';
    panel.className = 'overlay hidden img-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', T.title);
    panel.innerHTML =
      '<div class="overlay-head"><b>' + esc(T.title) + '</b><span class="hdr-sp"></span>' +
      '<button id="img-close" class="ibtn" aria-label="' + esc(T.close) + '">×</button></div>' +
      '<div class="overlay-body">' +
      '<div class="img-tabs">' +
      '<button id="img-tab-gen" class="img-tab on" type="button">🖼 ' + esc(T.tabGen) + '</button>' +
      '<button id="img-tab-mat" class="img-tab" type="button">✂ ' + esc(T.tabMat) + '</button>' +
      '</div>' +
      // ---- 插图 tab ----
      '<div id="img-page-gen">' +
      '<div class="img-row"><button id="img-fromsel" class="btn" type="button">' + esc(T.fromSel) + '</button></div>' +
      '<label class="field"><span>' + esc(T.promptLabel) + '</span>' +
      '<textarea id="img-prompt" rows="3" placeholder="' + esc(T.promptPh) + '"></textarea></label>' +
      '<label class="field"><span>' + esc(T.sizeLabel) + '</span><select id="img-size">' +
      SIZES.map(([v, l]) => '<option value="' + v + '">' + esc(l) + '</option>').join('') +
      '</select></label>' +
      '<p class="img-note">' + esc(T.cost) + '<br>' + esc(T.note) + '</p>' +
      '<button id="img-gen" class="btn btn-primary" type="button">' + esc(T.gen) + '</button>' +
      '<div id="img-status" class="img-status" role="status"></div>' +
      '<div id="img-preview" class="img-preview"></div>' +
      '<div class="img-actions">' +
      '<button id="img-insert" class="btn btn-primary hidden" type="button">' + esc(T.insert) + '</button>' +
      '<button id="img-regen" class="btn hidden" type="button">' + esc(T.regen) + '</button>' +
      '</div></div>' +
      // ---- 抠图 tab ----
      '<div id="img-page-mat" class="hidden">' +
      '<div class="img-row"><button id="img-clip" class="btn" type="button">' + esc(T.clipRead) + '</button><button id="img-fromshape" class="btn" type="button">' + esc(T.reRead) + '</button></div>' +
      '<div id="img-drop" class="img-drop">' + esc(T.pasteHint) + ' <button id="img-pick" class="btn" type="button" style="padding:2px 10px;font-size:12px;">' + esc(T.pickFile) + '</button><input id="img-file" type="file" accept="image/*" class="hidden"></div>' +
      '<div id="img-src" class="img-src"></div>' +
      '<p class="img-note">' + esc(T.matCost) + ' · ' + esc(T.matHint) + '</p>' +
      '<button id="img-mat" class="btn btn-primary" type="button">' + esc(T.matBtn) + '</button>' +
      '<div id="img-mat-status" class="img-status" role="status"></div>' +
      '<div id="img-mat-preview" class="img-preview checker"></div>' +
      '<div class="img-actions"><button id="img-mat-insert" class="btn btn-primary hidden" type="button">' + esc(T.insert) + '</button></div>' +
      '</div></div>';
    const app = document.getElementById('app');
    if (!app) return null;
    app.appendChild(panel);

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
    const btnOpen = $('btn-image'), close = $('img-close');
    const tabGen = $('img-tab-gen'), tabMat = $('img-tab-mat');
    const pageGen = $('img-page-gen'), pageMat = $('img-page-mat');
    const promptEl = $('img-prompt'), sizeEl = $('img-size');
    const fromSel = $('img-fromsel'), gen = $('img-gen'), insert = $('img-insert'), regen = $('img-regen');
    const status = $('img-status'), preview = $('img-preview');
    const clipBtn = $('img-clip'), fromShape = $('img-fromshape'), drop = $('img-drop'), pick = $('img-pick'), fileInput = $('img-file');
    const srcBox = $('img-src'), matBtn = $('img-mat'), matStatus = $('img-mat-status'), matPreview = $('img-mat-preview'), matInsert = $('img-mat-insert');
    const host = detectHost();
    let lastImage = null;       // 插图结果 { b64, mime }
    let matSource = null;       // 抠图输入 { b64, mime }
    let matResult = null;       // 抠图结果

    if (host !== 'ppt') fromShape.classList.add('hidden'); // 读取选中图片仅 PPT 支持

    const show = (v) => panel.classList.toggle('hidden', !v);
    close.addEventListener('click', () => show(false));
    panel.addEventListener('click', (e) => { if (e.target === panel) show(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.classList.contains('hidden')) show(false); });

    function setStatus(el, text, isErr) {
      el.textContent = text || '';
      el.classList.toggle('err', !!isErr);
    }

    // tab 切换
    function switchTab(mat) {
      tabGen.classList.toggle('on', !mat);
      tabMat.classList.toggle('on', mat);
      pageGen.classList.toggle('hidden', mat);
      pageMat.classList.toggle('hidden', !mat);
    }
    tabGen.addEventListener('click', () => switchTab(false));

    // 图片点击放大（委托）
    [preview, matPreview, srcBox].forEach((box) => {
      box.addEventListener('click', (e) => {
        if (e.target && e.target.tagName === 'IMG') panel._zoom(e.target.src);
      });
    });

    // ---- 抠图：来源管理 ----
    function setMatSource(img) {
      if (!img || !img.b64) return false;
      if (img.b64.length > 5600000) { setStatus(matStatus, T.imgTooBig, true); return false; } // ~4MB 原图
      matSource = img;
      matResult = null;
      matPreview.innerHTML = '';
      matInsert.classList.add('hidden');
      srcBox.innerHTML = '<img src="data:' + esc(img.mime) + ';base64,' + img.b64 + '" alt="source" title="' + esc(T.clickZoom) + '">';
      setStatus(matStatus, '');
      return true;
    }

    // 自动探测 PPT 选中的图片：成功则载入并返回 true
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

    // 打开面板：若 PPT 中已选中图片 → 自动切到抠图页并载入
    btnOpen.addEventListener('click', () => {
      show(true);
      if (host === 'ppt') {
        autoDetect(true).then((ok) => { if (ok) { switchTab(true); setStatus(matStatus, T.autoLoaded); } });
      }
    });

    // 切到抠图页：无图时自动探测一次
    tabMat.addEventListener('click', () => {
      switchTab(true);
      if (matSource) return;
      if (host === 'ppt') autoDetect(false);
      else setStatus(matStatus, T.hostUnavail);
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

    // 从剪贴板读取（navigator.clipboard.read，点击即用户手势）
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

    pick.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      try { setMatSource(await blobToB64(f)); } catch (e) { setStatus(matStatus, (e && e.message) ? e.message : String(e), true); }
      fileInput.value = '';
    });

    // 粘贴：document 级监听（焦点在面板任意位置都能收到），面板打开且处于抠图页时生效
    document.addEventListener('paste', async (e) => {
      if (panel.classList.contains('hidden') || pageMat.classList.contains('hidden')) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const it of items) {
        if (it.type && it.type.startsWith('image/')) {
          e.preventDefault();
          const f = it.getAsFile();
          if (!f) return;
          try {
            if (setMatSource(await blobToB64(f))) setStatus(matStatus, T.pasted);
          } catch (err) { setStatus(matStatus, (err && err.message) ? err.message : String(err), true); }
          return;
        }
      }
    });

    // 拖拽
    ['dragover', 'dragenter'].forEach((ev) => panel.addEventListener(ev, (e) => { e.preventDefault(); if (!pageMat.classList.contains('hidden')) drop.classList.add('on'); }));
    ['dragleave', 'drop'].forEach((ev) => panel.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('on'); }));
    panel.addEventListener('drop', async (e) => {
      if (pageMat.classList.contains('hidden')) return;
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f || !f.type.startsWith('image/')) return;
      try { setMatSource(await blobToB64(f)); } catch (err) { setStatus(matStatus, (err && err.message) ? err.message : String(err), true); }
    });

    // ---- 插图：为选中内容配图 ----
    fromSel.addEventListener('click', async () => {
      fromSel.disabled = true;
      setStatus(status, T.readingSel);
      try {
        const text = await readSelectedText();
        if (!text) { setStatus(status, T.noSel, true); return; }
        setStatus(status, T.gening);
        const resp = await fetch('api/image/prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: text.slice(0, 3000) }),
        });
        const data = await resp.json().catch(() => ({ ok: false, error: httpErr(resp.status) }));
        if (!data.ok || !data.prompt) throw new Error(data.error || httpErr(resp.status));
        promptEl.value = data.prompt;
        promptEl.placeholder = T.selPromptPh;
        setStatus(status, '✓ ' + T.selLabel + '：' + text.slice(0, 60) + (text.length > 60 ? '…' : '') + '\n已生成画面描述（可修改后直接点「生成预览」）');
      } catch (e) {
        setStatus(status, (e && e.message) ? e.message : String(e), true);
      } finally {
        fromSel.disabled = false;
      }
    });

    // ---- 插图：生成 ----
    async function doGenerate() {
      const prompt = promptEl.value.trim();
      if (!prompt) { setStatus(status, T.needPrompt, true); promptEl.focus(); return; }
      gen.disabled = true; regen.classList.add('hidden'); insert.classList.add('hidden');
      preview.innerHTML = ''; lastImage = null;
      setStatus(status, T.gening);
      try {
        const resp = await fetch('api/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, size: sizeEl.value }),
        });
        const data = await resp.json().catch(() => ({ ok: false, error: httpErr(resp.status) }));
        if (!data.ok || !Array.isArray(data.images) || !data.images.length) {
          throw new Error(data.error || httpErr(resp.status));
        }
        lastImage = data.images[0];
        const credit = data.usage && typeof data.usage.credit === 'number' ? '（消耗 ' + data.usage.credit + ' 点额度）' : '';
        preview.innerHTML = '<img src="data:' + esc(lastImage.mime) + ';base64,' + lastImage.b64 + '" alt="preview" title="' + esc(T.clickZoom) + '">';
        setStatus(status, '✓ 已生成' + credit + ' · ' + T.clickZoom);
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

    // ---- 抠图：执行 ----
    matBtn.addEventListener('click', async () => {
      if (!matSource) { setStatus(matStatus, T.matNeed, true); return; }
      matBtn.disabled = true; matInsert.classList.add('hidden');
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
        matInsert.classList.remove('hidden');
      } catch (e) {
        setStatus(matStatus, T.failed + '：' + (e && e.message ? e.message : e), true);
      } finally {
        matBtn.disabled = false;
      }
    });

    // ---- 插入（插图 / 抠图共用逻辑） ----
    function doInsert(img, btn, statEl) {
      if (!img) return;
      btn.disabled = true;
      setStatus(statEl, T.inserting);
      const b64 = img.b64.replace(/^data:[^,]+,/, '');
      try {
        Office.context.document.setSelectedDataAsync(
          b64,
          { coercionType: Office.CoercionType.Image },
          (asyncResult) => {
            btn.disabled = false;
            if (asyncResult.status === Office.AsyncResultStatus.Failed) {
              setStatus(statEl, T.insertFailed + '：' + (asyncResult.error && (asyncResult.error.message || asyncResult.error.name) || '未知错误'), true);
            } else {
              setStatus(statEl, T.inserted);
              btn.classList.add('hidden');
            }
          }
        );
      } catch (e) {
        btn.disabled = false;
        setStatus(statEl, T.insertFailed + '：' + (e && e.message ? e.message : e), true);
      }
    }
    insert.addEventListener('click', () => doInsert(lastImage, insert, status));
    matInsert.addEventListener('click', () => doInsert(matResult, matInsert, matStatus));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
