// 顶部一级导航（三套件通用）：问答 | 改写 | 版式 | 图像。
// 自包含模块：零改动 taskpane.js——问答/改写/版式通过程序化点击 settings-pop 里
// 已有的 mode-tab 按钮复用原逻辑；图像 tab 切换「对话视图 ↔ 图像视图」。
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
  };

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = [
      '.llm-nav { display:flex; flex:none; background:#fff; border-bottom:1px solid var(--line, #e3e6ea); padding:0 8px; gap:2px; }',
      '.llm-nav-btn { flex:1; border:0; background:transparent; cursor:pointer; padding:8px 4px 7px; font:inherit; font-size:12.5px; color:var(--muted, #6b7686); border-bottom:2px solid transparent; display:flex; align-items:center; justify-content:center; gap:4px; white-space:nowrap; }',
      '.llm-nav-btn svg { flex:none; }',
      '.llm-nav-btn:hover { color:var(--accent, #2563eb); }',
      '.llm-nav-btn.on { color:var(--accent, #2563eb); font-weight:600; border-bottom-color:var(--accent, #2563eb); }',
    ].join('\n');
    document.head.appendChild(style);
  }

  const ICONS = {
    ask: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 5h16v11H8l-4 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.5 9.5h5M9.5 12h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    edit: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="m14.5 5 4.5 4.5L8 20.5l-5 1 1-5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    format: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 10h16M10 10v10" stroke="currentColor" stroke-width="1.8"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="10" r="1.5" fill="currentColor"/><path d="m5 17 4.5-4.5 3 3L16 12l3 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  };

  function chatEls() {
    return [
      document.getElementById('messages'),
      document.querySelector('.composer'),
      document.querySelector('.context-bar'),
    ].filter(Boolean);
  }

  function init() {
    const hdr = document.querySelector('.hdr');
    if (!hdr || !hdr.parentElement) return;

    // 可用模块探测：Word/Excel 无版式
    const tabs = [
      { key: 'ask', mode: 'mode-ask', label: T.ask, title: T.askTitle },
      { key: 'edit', mode: 'mode-edit', label: T.edit, title: T.editTitle },
    ];
    if (document.getElementById('mode-format')) tabs.push({ key: 'format', mode: 'mode-format', label: T.format, title: T.formatTitle });
    tabs.push({ key: 'image', mode: null, label: T.image, title: T.imageTitle });

    const nav = document.createElement('nav');
    nav.className = 'llm-nav';
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', '工作模块');
    const btns = {};
    for (const t of tabs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'llm-nav-btn';
      b.title = t.title;
      b.setAttribute('role', 'tab');
      b.innerHTML = (ICONS[t.key] || '') + '<span>' + t.label + '</span>';
      b.addEventListener('click', () => activate(t, b));
      nav.appendChild(b);
      btns[t.key] = b;
    }
    hdr.insertAdjacentElement('afterend', nav);

    let lastModeKey = 'edit'; // 回退目标：图像 → 上一个对话模式
    let imageView = false;

    function setView(viewImage) {
      const imgView = document.getElementById('img-view');
      if (viewImage) {
        chatEls().forEach((el) => el.classList.add('llm-nav-hide'));
        if (imgView) {
          imgView.classList.remove('hidden');
          document.dispatchEvent(new CustomEvent('llm-image-view', { detail: { show: true } }));
        }
      } else {
        if (imgView && !imgView.classList.contains('hidden')) {
          imgView.classList.add('hidden');
          document.dispatchEvent(new CustomEvent('llm-image-view', { detail: { show: false } }));
        }
        chatEls().forEach((el) => el.classList.remove('llm-nav-hide'));
      }
      imageView = viewImage;
    }

    function activate(t, btn) {
      Object.values(btns).forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
      if (t.mode) {
        // 对话模块：确保回到对话视图，再复用原 mode-tab 的点击逻辑
        if (imageView) setView(false);
        lastModeKey = t.key;
        const underlying = document.getElementById(t.mode);
        if (underlying) underlying.click();
      } else {
        // 图像模块：切换到图像视图（imagepanel.js 监听 llm-image-view 事件）
        setView(true);
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

    // 图像视图内按 Esc 返回上一个对话模块（放大预览的 Esc 由图像模块自己处理）
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !imageView) return;
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
