// CodeBuddy (WorkBuddy) 直连图像模块：文生图 + 抠图 + 上下文配图 prompt。
//
// 文生图（逆向自 CLI ImageGen 工具）：
//   POST https://www.workbuddy.cn/v2/images/generations  Bearer <ck_ key>
//   { model: "hunyuan-image-alpha", prompt, size, n } → { data: { data: [{ url | b64_json }] }, usage }
//
// 抠图（逆向自 buddy-image-processing 技能脚本，服务端同样接受 ck_ key）：
//   POST /v2/async/images/edits   { model: "vod-image-matting", response_format: "url", image: [b64] }
//   POST /v2/async/images/tasks   { task_id } 轮询 → completed 后 data[0].url 为透明 PNG
//
// 上下文配图：spawn cbc-claude.js（CodeBuddy wrapper，glm-5.3-flash）把选中文本浓缩成英文生图 prompt。
// Node fetch 不读 HTTP_PROXY，实测本机直连 www.workbuddy.cn 正常。

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { spawnEnv, CLAUDE_BIN } from './config.js';

const HOST = 'https://www.workbuddy.cn';
const GEN_ENDPOINT = HOST + '/v2/images/generations';
const EDIT_ENDPOINT = HOST + '/v2/async/images/edits';
const TASK_ENDPOINT = HOST + '/v2/async/images/tasks';
const GEN_MODEL = 'hunyuan-image-alpha';
const MATTING_MODEL = 'vod-image-matting';
const KEY_FILE = path.join(os.homedir(), '.codebuddy', 'api.key');
const SIZES = new Set(['1024x1024', '1280x720', '720x1280']);
const MAX_PROMPT = 2000;
const MAX_IMAGE_B64 = 4 * 1024 * 1024;        // 抠图输入上限 4MB（服务端限制）
const GEN_TIMEOUT_MS = 180 * 1000;
const DOWNLOAD_TIMEOUT_MS = 120 * 1000;
const POLL_INTERVAL_MS = 4 * 1000;
const POLL_MAX_MS = 120 * 1000;
const PROMPT_MODEL = 'glm-5.3-flash';          // 上下文配图：用 flash 快速出 prompt
const PROMPT_TIMEOUT_MS = 60 * 1000;

function readKey() {
  let key = '';
  try {
    key = readFileSync(KEY_FILE, 'utf8').trim();
  } catch {
    throw new Error('未找到 ~/.codebuddy/api.key，请先写入 CodeBuddy API key（600 权限）');
  }
  if (!/^ck_[A-Za-z0-9_.-]{10,}$/.test(key)) throw new Error('~/.codebuddy/api.key 内容不是有效的 ck_ key');
  return key;
}

// 供健康检查/面板提示用。
export const EST_CREDIT_PER_IMAGE = 5.7;

// ---------- 文生图 ----------
export async function generateImage({ prompt, size } = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('请填写画面描述');
  if (prompt.length > MAX_PROMPT) throw new Error(`画面描述过长（上限 ${MAX_PROMPT} 字）`);
  const sz = SIZES.has(size) ? size : '1024x1024';
  const key = readKey();

  let resp;
  try {
    resp = await fetch(GEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: GEN_MODEL, prompt: prompt.trim(), size: sz, n: 1 }),
      signal: AbortSignal.timeout(GEN_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`生图服务连接失败：${e?.message || e}`);
  }
  if (!resp.ok) throw new Error(`生图服务 HTTP ${resp.status}`);
  let data;
  try { data = await resp.json(); } catch { throw new Error('生图服务返回了无法解析的内容'); }
  if (data.code !== 0) throw new Error(`生图失败：${data.msg || '未知错误'}（code ${data.code}）`);

  const items = Array.isArray(data?.data?.data) ? data.data.data : [];
  const images = [];
  for (const it of items) {
    if (it && typeof it.b64_json === 'string' && it.b64_json) {
      images.push({ b64: it.b64_json, mime: 'image/png' });
      continue;
    }
    if (it && typeof it.url === 'string' && /^https:\/\//.test(it.url)) {
      images.push(await downloadAsImage(it.url));
    }
  }
  if (!images.length) throw new Error('生图服务未返回图片');
  return { images, usage: data.usage || {} };
}

// ---------- 抠图（去背景，透明 PNG） ----------
export async function matting({ imageB64 } = {}) {
  if (typeof imageB64 !== 'string' || !imageB64) throw new Error('请先提供图片（选中图片、粘贴或上传）');
  const b64 = imageB64.replace(/^data:image\/[a-z+]+;base64,/, '').replace(/\s/g, '');
  if (b64.length > MAX_IMAGE_B64 * 1.4) throw new Error('图片过大（上限 4MB），请压缩后再试');
  const key = readKey();

  // ① 提交任务
  let submit;
  try {
    const r = await fetch(EDIT_ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MATTING_MODEL, response_format: 'url', image: [b64] }),
      signal: AbortSignal.timeout(60 * 1000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    submit = await r.json();
  } catch (e) {
    throw new Error(`抠图服务连接失败：${e?.message || e}`);
  }
  if (submit.code !== 0 || !submit?.data?.id) {
    throw new Error(`抠图任务提交失败：${submit.msg || '未知错误'}`);
  }
  const taskId = submit.data.id;

  // ② 轮询直到完成
  const deadline = Date.now() + POLL_MAX_MS;
  let result = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    let poll;
    try {
      const r = await fetch(TASK_ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId }),
        signal: AbortSignal.timeout(30 * 1000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      poll = await r.json();
    } catch (e) {
      if (Date.now() >= deadline) throw new Error(`抠图任务查询失败：${e?.message || e}`);
      continue;
    }
    const st = String(poll?.data?.status || '').toLowerCase();
    if (st === 'completed') { result = poll; break; }
    if (st === 'failed') {
      const msg = poll?.data?.error?.message || poll?.data?.error || '图片处理失败';
      throw new Error(`抠图失败：${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    }
    // queued / in_progress → 继续等
  }
  if (!result) throw new Error('抠图超时（超过 2 分钟），请稍后重试');

  // ③ 下载透明 PNG
  const urls = Array.isArray(result?.data?.data) ? result.data.data.map((d) => d?.url).filter((u) => typeof u === 'string' && /^https:\/\//.test(u)) : [];
  if (!urls.length) throw new Error('抠图完成但没有返回图片');
  const images = [await downloadAsImage(urls[0])];
  return { images, usage: result?.data?.usage || {} };
}

// ---------- 上下文配图：选中文本 → 英文生图 prompt ----------
export function enhancePrompt({ context, instruction } = {}) {
  const ctx = typeof context === 'string' ? context.trim() : '';
  if (!ctx) throw new Error('请先在文档里选中一段内容，或直接在输入框填写画面描述');
  const extra = typeof instruction === 'string' && instruction.trim() ? `\n用户补充要求：${instruction.trim()}` : '';
  const sysPrompt = [
    '你是 AI 文生图提示词工程师。根据下面的文档内容，写一条适合文生图模型的英文提示词（prompt），为这段内容配一张贴合主题的插图。',
    '要求：',
    '1. 只输出英文提示词本身，不要任何解释、前缀或引号；',
    '2. 提示词包含：画面主体、风格（如 flat illustration / minimalist / isometric 等，选贴合商务演示场景的）、色调、背景；',
    '3. 长度控制在 60 词以内；',
    '4. 如果内容是数据/结论类，配意象化的概念插图而不是图表。',
    '',
    '文档内容：',
    ctx.slice(0, 3000),
    extra,
  ].join('\n');

  return new Promise((resolve, reject) => {
    const bin = CLAUDE_BIN.endsWith('cbc-claude.js') ? process.execPath : CLAUDE_BIN;
    const args = bin === process.execPath
      ? [CLAUDE_BIN, '-p', '--output-format', 'text', '--model', PROMPT_MODEL, '--effort', 'low', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', '', sysPrompt]
      : ['-p', '--output-format', 'text', '--model', PROMPT_MODEL, '--effort', 'low', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', '', sysPrompt];
    const child = spawn(bin, args, { env: spawnEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('生成画面描述超时，请重试或直接手写描述')); }, PROMPT_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`调用 CodeBuddy 失败：${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = out.trim();
      if (code !== 0 && !text) {
        reject(new Error(`生成画面描述失败：${(err || '').trim().slice(0, 200) || 'exit ' + code}`));
        return;
      }
      // 模型偶尔会带引号或 markdown 包裹，清掉
      const cleaned = text.replace(/^["'\s]+|["'\s]+$/g, '').replace(/^```[a-z]*\n?|```$/g, '').trim();
      if (!cleaned) { reject(new Error('生成画面描述为空，请重试')); return; }
      resolve({ prompt: cleaned });
    });
  });
}

// ---------- 工具 ----------
async function downloadAsImage(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) throw new Error('空文件');
    return { b64: buf.toString('base64'), mime: (r.headers.get('content-type') || 'image/png').split(';')[0] };
  } catch (e) {
    throw new Error(`图片下载失败：${e?.message || e}`);
  }
}
