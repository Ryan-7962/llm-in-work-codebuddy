// 顶部一级导航（三套件通用）：问答 | 改写 | 版式 | 图像 |（Excel 追加：表格）。
// 自包含模块：零改动 taskpane.js——问答/改写/版式通过程序化点击 settings-pop 里
// 已有的 mode-tab 按钮复用原逻辑；工具类 tab（图像/表格）切换对话视图 ↔ 工具视图。
// 多工具视图互斥：同一时刻只显示一个工具视图（#img-view / #excel-view）。
// 界面固定中文（用户要求全中文）。
(() => {
  'use strict';
  if (window.__llm_top_nav) return;
  window.__llm_top_nav = true;

  const T = {
    ask: '问答', askTitle: '对整个文稿提问，直接定位到内容',
    edit: '改写', editTitle: '选中内容 → 指令 → 预览 → 写入',
    format: '版式', formatTitle: '调整选中形状或整页版式',
    image: '图像', imageTitle: 'AI 插图与抠图',
    excel: '表格', excelTitle: 'AI 公式 / 批量填充 / 数据清洗',
  };

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = [
      '.llm-nav { display:flex; flex:none; background:var(--paper, #f7f8fa); border-bottom:1px solid var(--line, #e3e6ea); padding:8px 10px; }',
      '.llm-nav-seg { flex:1; display:flex; background:var(--card, #fff); border:1px solid var(--line, #e3e6ea); border-radius:11px; padding:3px; gap:2px; box-shadow:0 1px 2px rgba(16,24,40,.05); }',
      '.llm-nav-btn { flex:1; min-width:0; border:0; background:transparent; cursor:pointer; padding:7px 2px; font:inherit; font-size:12.5px; line-height:1; color:var(--muted, #6b7686); border-radius:8px; display:flex; align-items:center; justify-content:center; gap:5px; white-space:nowrap; transition:background .15s, color .15s, box-shadow .15s; }',
      '.llm-nav-btn svg { flex:none; opacity:.85; }',
      '.llm-nav-btn:hover { color:var(--accent, #2563eb); background:rgba(0,0,0,.04); }',
      '.llm-nav-btn.on { color:#fff; font-weight:600; background:var(--accent, #2563eb); box-shadow:0 1px 3px rgba(0,0,0,.2); }',
      '.llm-nav-btn.on svg { opacity:1; }',
      'body.llm-nav-ready #mode-summary { display:none !important; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  const ICONS = {
    ask: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M4 5h16v11H8l-4 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.5 9.5h5M9.5 12h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    edit: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="m14.5 5 4.5 4.5L8 20.5l-5 1 1-5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    format: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 10h16M10 10v10" stroke="currentColor" stroke-width="1.8"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="10" r="1.5" fill="currentColor"/><path d="m5 17 4.5-4.5 3 3L16 12l3 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    excel: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 10h16M4 15h16M10 4v16" stroke="currentColor" stroke-width="1.8"/></svg>',
  };

  // 工具视图注册表：key → 视图选择器 + 显隐回调（imagepanel.js 监听事件做自动载图）
  const TOOL_VIEWS = {
    image: {
      sel: '#img-view',
      onShow: () => document.dispatchEvent(new CustomEvent('llm-image-view', { detail: { show: true } })),
      onHide: () => document.dispatchEvent(new CustomEvent('llm-image-view', { detail: { show: false } })),
    },
    excel: { sel: '#excel-view', onShow: null, onHide: null },
  };

  function chatEls() {
    return [
      document.getElementById('messages'),
      document.querySelector('.composer'),
      document.querySelector('.context-bar'),
    ].filter(Boolean);
  }

  function init() {
    injectStyle();
    const hdr = document.querySelector('.hdr');
    if (!hdr || !hdr.parentElement) return;

    // 可用模块探测：Word/Excel 无版式；Excel 追加「表格」（excelpanel.js 只在 Excel 套件加载）
    const isExcel = !!document.querySelector('script[src*="grid-utils.js"]');
    const tabs = [
      { key: 'ask', mode: 'mode-ask', label: T.ask, title: T.askTitle },
      { key: 'edit', mode: 'mode-edit', label: T.edit, title: T.editTitle },
    ];
    if (document.getElementById('mode-format')) tabs.push({ key: 'format', mode: 'mode-format', label: T.format, title: T.formatTitle });
    tabs.push({ key: 'image', mode: null, view: 'image', label: T.image, title: T.imageTitle });
    if (isExcel) tabs.push({ key: 'excel', mode: null, view: 'excel', label: T.excel, title: T.excelTitle });

    const nav = document.createElement('nav');
    nav.className = 'llm-nav';
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', '工作模块');
    const seg = document.createElement('div');
    seg.className = 'llm-nav-seg';
    nav.appendChild(seg);
    const btns = {};
    for (const t of tabs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'llm-nav-btn';
      b.title = t.title;
      b.setAttribute('role', 'tab');
      b.innerHTML = (ICONS[t.key] || '') + '<span>' + t.label + '</span>';
      b.addEventListener('click', () => activate(t, b));
      seg.appendChild(b);
      btns[t.key] = b;
    }
    hdr.insertAdjacentElement('afterend', nav);
    document.body.classList.add('llm-nav-ready'); // 启用隐藏 context-bar 里冗余的模式按钮（导航已表达当前模式）

    let lastModeKey = 'edit'; // 回退目标：工具视图 → 上一个对话模式
    let activeTool = null;    // null = 对话视图；'image' | 'excel' = 工具视图

    function setToolView(tool) {
      // 所有工具视图先按目标归位（互斥），再触发回调
      for (const [k, cfg] of Object.entries(TOOL_VIEWS)) {
        const el = document.querySelector(cfg.sel);
        if (!el) continue;
        const showing = k === tool;
        const wasHidden = el.classList.contains('hidden');
        el.classList.toggle('hidden', !showing);
        if (showing) { if (cfg.onShow) cfg.onShow(); }
        else if (!wasHidden) { if (cfg.onHide) cfg.onHide(); }
      }
      chatEls().forEach((el) => el.classList.toggle('llm-nav-hide', !!tool));
      activeTool = tool;
    }

    function activate(t, btn) {
      Object.values(btns).forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
      if (t.mode) {
        // 对话模块：确保回到对话视图，再复用原 mode-tab 的点击逻辑
        if (activeTool) setToolView(null);
        lastModeKey = t.key;
        const underlying = document.getElementById(t.mode);
        if (underlying) underlying.click();
      } else {
        // 工具模块：切换到对应工具视图
        setToolView(t.view);
      }
    }

    // 默认激活：跟随 settings-pop 里当前 active 的 mode-tab
    const activeMode = ['ask', 'edit', 'format'].find((k) => {
      const el = document.getElementById('mode-' + k);
      return el && el.classList.contains('active');
    });
    (btns[activeMode] || btns.edit).classList.add('on');

    // 隐藏设置弹层里的 mode-tabs 行（导航已取代）；保留 DOM 以便程序化点击
    const popTabs = document.querySelector('.settings-pop .mode-tabs');
    if (popTabs && popTabs.parentElement) popTabs.parentElement.style.display = 'none';

    // 工具视图内按 Esc 返回上一个对话模块（放大预览的 Esc 由图像模块自己处理）
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !activeTool) return;
      const lb = document.querySelector('.img-lightbox:not(.hidden)');
      if (lb) return; // 放大预览开着时先关预览
      (btns[lastModeKey] || btns.edit).click();
    });
  }

  // 隐藏对话元素用独立 class，不动 .hidden（避免与 taskpane.js 的显隐逻辑互相干扰）
  const style = document.createElement('style');
  style.textContent = '.llm-nav-hide { display:none !important; }';
  document.head.appendChild(style);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
