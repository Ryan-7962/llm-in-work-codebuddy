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
// Node 22 可通过 NODE_USE_ENV_PROXY=1 使用环境代理；serviceFetch 会在请求前
// 动态检查代理活性，避免系统代理端口变化后混元/自定义 API/图片下载全部超时。
//
// ---------- 生图引擎架构（2026-10-23） ----------
// generateImage({prompt,size,count,engine}) 按 engine 分发三口径：
//   hy      混元（内置默认）：ck_ key 直连 /v2/images/generations，多候选由并发 n 次实现
//   jimeng  即梦：本机 dreamina-canvas CLI（~/.local/bin/dreamina-canvas，检测到才可选）
//           node create image --run --wait → data.submission.resources[].resourceId
//           → resource download → 本地文件读 b64。输出为 NDJSON（事件行+结果行）。
//           实测：seedream_4.6 服务端会把 1K 自动调成 2K；2048×2048 PNG 约 1MB。
//   custom: 自定义 OpenAI 兼容图片 API，登记在 ~/.codebuddy/image-engines.json：
//           { "jimeng": { "model": "seedream_4.6", "creditCeiling": 20, "resolution": "1K", "bin": "" },
//             "custom": [ { "id": "agnes", "name": "Agnes 2.0", "apiBase": "https://…/v1",
//                            "model": "image-2.0", "apiKey": "sk-…" 或 "apiKeyEnv": "AGNES_KEY" } ] }
//           请求 POST {apiBase}/images/generations {model,prompt,size,n}，兼容
//           OpenAI 标准 {data:[{b64_json|url}]} 与嵌套 {data:{data:[…]}} 两种返回。

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnEnv, CLAUDE_BIN } from './config.js';

// 必须在首次 fetch 前开启；Node 22.12+ 支持（与 package.json engines 一致）。
if (!process.env.NODE_USE_ENV_PROXY) process.env.NODE_USE_ENV_PROXY = '1';

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

// ---------- 文生图：引擎分发 ----------
// 注：上游 /v2/images/generations 会忽略 n 参数（实测 n=2 仍返回 1 张），
// 混元多候选由并发 count 次实现；即梦用 --count 单次出多张；自定义按 n 透传。
export async function generateImage({ prompt, size, count, engine } = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('请填写画面描述');
  if (prompt.length > MAX_PROMPT) throw new Error(`画面描述过长（上限 ${MAX_PROMPT} 字）`);
  const sz = SIZES.has(size) ? size : '1024x1024';
  const n = Math.min(Math.max(Number.parseInt(count, 10) || 1, 1), 4); // 候选 1–4 张
  const eng = typeof engine === 'string' && engine ? engine : 'hy';
  if (eng === 'hy') return hyGenerate(prompt, sz, n);
  if (eng === 'jimeng') return jimengGenerate(prompt, sz, n);
  if (eng.startsWith('custom:')) return customGenerate(eng.slice('custom:'.length), prompt, sz, n);
  throw new Error(`未知生图引擎：${eng}`);
}

// 可用引擎列表（面板下拉用）。hy 校验 key；jimeng 检测 CLI + 登录态（缓存 60s）；
// custom 只做配置完整性检查，不真实调 API。
export async function listEngines() {
  const engines = [];
  let hyReason = '';
  try { readKey(); } catch (e) { hyReason = e?.message || String(e); }
  engines.push({ id: 'hy', name: '混元（内置）', available: !hyReason, reason: hyReason, model: GEN_MODEL, default: true });

  const cfg = loadEnginesConfig();
  const jcfg = cfg.jimeng && typeof cfg.jimeng === 'object' ? cfg.jimeng : {};
  const jbin = (typeof jcfg.bin === 'string' && jcfg.bin) || findJimengBin();
  if (jbin) {
    const loggedIn = await jimengAuthed(jbin, await jimengSpawnEnv(jcfg));
    engines.push({
      id: 'jimeng', name: '即梦 Dreamina', available: loggedIn,
      reason: loggedIn ? '' : 'CLI 已安装但未登录：终端运行 dreamina-canvas auth login 后重试',
      model: typeof jcfg.model === 'string' && jcfg.model ? jcfg.model : JIMENG_DEFAULT_MODEL,
    });
  }

  for (const c of Array.isArray(cfg.custom) ? cfg.custom : []) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id || typeof c.apiBase !== 'string' || !c.apiBase) continue;
    const hasKey = !!resolveCustomApiKey(c);
    engines.push({
      id: `custom:${c.id}`, name: typeof c.name === 'string' && c.name ? c.name : c.id,
      available: hasKey,
      reason: hasKey ? '' : '缺少 apiKey（或 apiKeyEnv 指向的环境变量未设置）',
      model: typeof c.model === 'string' ? c.model : '',
    });
  }
  return engines;
}

// ---------- 引擎实现：hy（混元，原逻辑平移） ----------
async function hyGenerate(prompt, sz, n) {
  const key = readKey();

  async function genOnce() {
    let resp;
    try {
      resp = await serviceFetch(GEN_ENDPOINT, {
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

  if (n === 1) return genOnce();

  const settled = await Promise.allSettled(Array.from({ length: n }, () => genOnce()));
  const ok = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!ok.length) {
    const firstErr = settled[0].reason;
    throw firstErr instanceof Error ? firstErr : new Error(String(firstErr || '生成失败'));
  }
  const images = ok.flatMap((r) => r.images);
  const credit = ok.reduce((s, r) => s + (Number(r.usage?.credit) || 0), 0);
  return { images, usage: credit ? { credit } : {} };
}

// ---------- 引擎实现：jimeng（即梦 dreamina-canvas CLI） ----------
const ENGINES_FILE = path.join(os.homedir(), '.codebuddy', 'image-engines.json');
const JIMENG_BIN_CANDIDATES = [
  process.env.LLM_IN_JIMENG_BIN,
  path.join(os.homedir(), '.local', 'bin', 'dreamina-canvas'),
  '/usr/local/bin/dreamina-canvas',
  '/opt/homebrew/bin/dreamina-canvas',
].filter(Boolean);
const JIMENG_DEFAULT_MODEL = 'seedream_4.6';
const JIMENG_DEFAULT_CEILING = 20;      // 单张积分上限（--run 报价超过即停）
const JIMENG_RUN_TIMEOUT_MS = 300 * 1000;
const JIMENG_AUTH_CACHE_MS = 60 * 1000;
const SIZE_TO_RATIO = { '1024x1024': '1:1', '1280x720': '16:9', '720x1280': '9:16' };

function findJimengBin() {
  for (const p of JIMENG_BIN_CANDIDATES) {
    try { if (statSync(p).isFile()) return p; } catch {}
  }
  return null;
}

function loadEnginesConfig() {
  try {
    const raw = JSON.parse(readFileSync(ENGINES_FILE, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; } // 没配置或配置坏 → 空配置，不炸
}

let jimengAuthCache = { at: 0, loggedIn: false };
function jimengAuthed(bin, env) {
  if (Date.now() - jimengAuthCache.at < JIMENG_AUTH_CACHE_MS) return Promise.resolve(jimengAuthCache.loggedIn);
  return new Promise((resolve) => {
    const child = spawn(bin, ['auth', 'status', '--format', 'json', '--non-interactive'], { env: env || process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const t = setTimeout(() => { child.kill('SIGKILL'); resolve(false); }, 10 * 1000);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', () => { clearTimeout(t); resolve(false); });
    child.on('close', () => {
      clearTimeout(t);
      try { resolve(JSON.parse(out.trim().split('\n').pop())?.data?.loggedIn === true); }
      catch { resolve(false); }
    });
  }).then((loggedIn) => {
    // 只缓存成功态：用户按提示 auth login 后应立即生效，失败态缓存会让下拉灰 60 秒
    jimengAuthCache = loggedIn ? { at: Date.now(), loggedIn } : { at: 0, loggedIn: false };
    return loggedIn;
  });
}

// 通用 CLI 执行器：超时杀进程；非零退出但 stdout 有内容时不立即报错（交给调用方解析）。
// 非零退出且无 stdout 时，stderr 附在 e.stderr 上（调用方可解析 CLI 的 JSON 错误对象）。
function runCli(bin, args, timeoutMs, label, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env: env || process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${label}超时（${Math.round(timeoutMs / 1000)}s）`)); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(t); reject(new Error(`${label}启动失败：${e.message}（${bin}）`)); });
    child.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0 && !out.trim()) {
        const e = new Error(`${label}失败：${err.trim().slice(0, 300) || 'exit ' + code}`);
        if (err.trim()) e.stderr = err;
        reject(e);
        return;
      }
      resolve(out);
    });
  });
}

// macOS 系统代理探测：launchd 拉起的服务进程不带用户 shell 的代理变量，
// 而即梦 CLI 实测需走代理才能到达服务端（直连报 cli.transport_failed）。
// 另一大坑：install.sh 旧版把代理端口快照进 run.sh（如失效的 51200），
// 端口一变服务进程就带着死代理。所以这里不仅看「有没有」代理变量，
// 还做活性探测：变量指向的端口没监听就自动换系统代理或直连。
let sysProxyCache = { at: 0, url: '' };
function systemProxyUrl() {
  if (Date.now() - sysProxyCache.at < 5 * 60 * 1000) return sysProxyCache.url;
  let url = '';
  if (process.platform === 'darwin') {
    try {
      const r = spawnSync('scutil', ['--proxy'], { timeout: 5000, encoding: 'utf8' });
      const m = String(r.stdout || '').match(/HTTPEnable\s*:\s*1[\s\S]*?HTTPProxy\s*:\s*(\S+)[\s\S]*?HTTPPort\s*:\s*(\d+)/);
      if (m) url = `http://${m[1]}:${m[2]}`;
    } catch {}
  }
  sysProxyCache = { at: Date.now(), url };
  return url;
}

// 代理可达性探测（TCP 连一下，600ms 超时）
function proxyAlive(url) {
  return new Promise((resolve) => {
    let host = '', port = 0;
    try { const u = new URL(String(url)); host = u.hostname; port = Number(u.port) || 0; } catch { resolve(false); return; }
    if (!host || !port) { resolve(false); return; }
    const s = net.connect({ host, port });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(600, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

const PROXY_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'];
async function jimengSpawnEnv(jcfg) {
  const env = { ...process.env };
  if (jcfg && jcfg.env && typeof jcfg.env === 'object' && !Array.isArray(jcfg.env)) Object.assign(env, jcfg.env);
  const cur = PROXY_KEYS.map((k) => env[k]).find(Boolean);
  if (!cur || !(await proxyAlive(cur))) {
    // 当前代理缺失或失效（典型：run.sh 快照的旧端口）→ 换系统代理；系统代理也不行就直连
    const p = systemProxyUrl();
    if (p && await proxyAlive(p)) {
      for (const k of PROXY_KEYS) delete env[k];
      env.HTTP_PROXY = p; env.HTTPS_PROXY = p; env.http_proxy = p; env.https_proxy = p;
    } else if (cur) {
      for (const k of PROXY_KEYS) delete env[k]; // 失效代理不如直连
    }
  }
  return env;
}

// Node fetch 默认不读代理。开启 EnvHttpProxyAgent 后，在每次请求前同步一份
// 经活性探测的环境变量：当前代理失效时换系统代理，系统代理也不可用则直连。
async function serviceFetch(url, options) {
  const env = await jimengSpawnEnv({});
  for (const k of PROXY_KEYS) {
    if (env[k]) process.env[k] = env[k];
    else delete process.env[k];
  }
  return fetch(url, options);
}

// runCli 拒绝时 stderr 里常带 CLI 的 JSON 错误对象，解析出 code/message 给友好提示
function enrichCliError(e, label) {
  for (const line of String(e?.stderr || '').split('\n')) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try {
      const j = JSON.parse(s);
      const err = j && j.error && typeof j.error === 'object' ? j.error : (j && j.ok === false ? j : null);
      if (err) {
        let msg = `${label}失败：${err.message || err.msg || JSON.stringify(err).slice(0, 200)}`;
        if (err.code === 'cli.transport_failed') {
          msg += '（服务进程连不上即梦服务端：请开启系统代理，或在 ~/.codebuddy/image-engines.json 的 jimeng.env 里配置 HTTPS_PROXY 后重启服务）';
        }
        return new Error(msg);
      }
    } catch {}
  }
  return e;
}

async function jimengGenerate(prompt, sz, n) {
  const cfg = loadEnginesConfig();
  const jcfg = cfg.jimeng && typeof cfg.jimeng === 'object' ? cfg.jimeng : {};
  const bin = (typeof jcfg.bin === 'string' && jcfg.bin) || findJimengBin();
  if (!bin) throw new Error('未找到 dreamina-canvas CLI（即梦引擎需先安装到 ~/.local/bin/dreamina-canvas）');
  const env = await jimengSpawnEnv(jcfg);
  const model = typeof jcfg.model === 'string' && jcfg.model ? jcfg.model : JIMENG_DEFAULT_MODEL;
  const perImg = Math.min(Math.max(Number.parseInt(jcfg.creditCeiling, 10) || JIMENG_DEFAULT_CEILING, 1), 100);
  const resolution = typeof jcfg.resolution === 'string' && jcfg.resolution ? jcfg.resolution : '1K';
  const args = [
    'node', 'create', 'image', '--mode', 't2i', '--model', model,
    '--prompt', prompt.trim(), '--ratio', SIZE_TO_RATIO[sz] || '1:1', '--resolution', resolution,
    '--count', String(n), '--run', '--wait', '--yes', '--credit-ceiling', String(perImg * n),
    '--timeout', '5m', '--format', 'json', '--non-interactive',
  ];

  let out;
  try {
    out = await runCli(bin, args, JIMENG_RUN_TIMEOUT_MS, '即梦生图', env);
  } catch (e) {
    throw enrichCliError(e, '即梦生图');
  }
  // 输出为 NDJSON：先事件行（如 generation.parameters_adjusted）再结果行；取最后一个 ok:true
  let okResult = null, errResult = null;
  for (const line of out.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try {
      const j = JSON.parse(s);
      if (j && j.ok === true && j.data) okResult = j;
      else if (j && j.ok === false) errResult = j;
    } catch {}
  }
  if (!okResult) {
    const msg = errResult?.error?.message || errResult?.msg || errResult?.error
      || (errResult ? JSON.stringify(errResult).slice(0, 200) : 'CLI 未返回结果');
    const hint = errResult?.error?.code === 'cli.transport_failed'
      ? '（服务进程连不上即梦：请确认系统代理已开启，或在 ~/.codebuddy/image-engines.json 的 jimeng.env 里配置 HTTPS_PROXY）' : '';
    throw new Error(`即梦生图失败：${msg}${hint}`);
  }
  const resources = okResult?.data?.submission?.resources;
  if (!Array.isArray(resources) || !resources.length) throw new Error('即梦生图未返回产物（可能被积分上限拦截）');
  const good = resources.filter((r) => r && typeof r.resourceId === 'string' && r.state !== 'failed');
  if (!good.length) throw new Error(`即梦生图失败：${resources[0]?.state || '产物状态异常'}`);

  const dir = await mkdtemp(path.join(os.tmpdir(), 'LLM_in_Work-jimeng-'));
  try {
    const images = [];
    for (const r of good) {
      const file = path.join(dir, `${r.resourceId}.img`);
      await runCli(bin, ['resource', 'download', r.resourceId, '-o', file, '--format', 'json', '--non-interactive'], 60 * 1000, '即梦产物下载', env);
      const buf = await readFile(file);
      if (!buf.length) throw new Error('即梦产物下载为空');
      images.push({ b64: buf.toString('base64'), mime: detectMime(buf) });
    }
    return { images, usage: { engine: 'jimeng', model, count: images.length } };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- 引擎实现：custom（OpenAI 兼容图片 API） ----------
function resolveCustomApiKey(c) {
  if (typeof c.apiKey === 'string' && c.apiKey) return c.apiKey;
  if (typeof c.apiKeyEnv === 'string' && process.env[c.apiKeyEnv]) return process.env[c.apiKeyEnv];
  return null;
}

async function customGenerate(id, prompt, sz, n) {
  const cfg = loadEnginesConfig();
  const c = (Array.isArray(cfg.custom) ? cfg.custom : []).find((e) => e && e.id === id);
  if (!c) throw new Error(`自定义引擎「${id}」不存在，请检查 ~/.codebuddy/image-engines.json`);
  const key = resolveCustomApiKey(c);
  if (!key) throw new Error(`自定义引擎「${id}」缺少 apiKey`);
  const base = String(c.apiBase).replace(/\/+$/, '');
  const model = typeof c.model === 'string' && c.model ? c.model : 'image-gen';
  let resp;
  try {
    resp = await serviceFetch(base + '/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, prompt: prompt.trim(), size: sz, n,
        ...(typeof c.responseFormat === 'string' && c.responseFormat ? { response_format: c.responseFormat } : {}),
      }),
      signal: AbortSignal.timeout(GEN_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`引擎「${id}」连接失败：${e?.message || e}`);
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`引擎「${id}」HTTP ${resp.status}${t ? '：' + t.slice(0, 200) : ''}`);
  }
  let data;
  try { data = await resp.json(); } catch { throw new Error(`引擎「${id}」返回了无法解析的内容`); }
  // 兼容 OpenAI 标准 {data:[…]} 与嵌套 {data:{data:[…]}}（WorkBuddy 风格）
  const items = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.data?.data) ? data.data.data : []);
  const images = [];
  for (const it of items) {
    if (it && typeof it.b64_json === 'string' && it.b64_json) { images.push({ b64: it.b64_json, mime: 'image/png' }); continue; }
    if (it && typeof it.url === 'string' && /^https?:\/\//.test(it.url)) images.push(await downloadAsImage(it.url));
  }
  if (!images.length) throw new Error(`引擎「${id}」未返回图片`);
  return { images, usage: data.usage || {} };
}

// ---------- 修图（图生图：选中图片 + 文字描述 → AI 修改） ----------
// hy（默认）：POST /v2/images/edits 同步端点，2026-10-28 实测 hunyuan-image-alpha 支持：
//   {model, image:[b64], prompt, response_format:"url"} → data.data[].url。
//   注意区分：抠图走的 /v2/async/images/edits 不支持 hunyuan-stream 后端（code 11103），
//   修图必须走这个同步端点。
// jimeng：resource upload（自带 UUID 幂等键，失败可 resource get 恢复）
//   → node create image --mode i2i --ref res:<id> → submission.resources → download。
//   统一写入专用画布「LLM_in_Work 修图」（jcfg.projectId 可覆盖；否则读缓存
//   ~/.codebuddy/jimeng-canvas.json，没有则创建一次），不污染用户现有画布。
const HY_EDIT_ENDPOINT = HOST + '/v2/images/edits';
const JIMENG_CANVAS_CACHE = path.join(os.homedir(), '.codebuddy', 'jimeng-canvas.json');

export async function editImage({ imageB64, prompt, count, engine } = {}) {
  if (typeof imageB64 !== 'string' || !imageB64) throw new Error('请先提供原图（选中图片、粘贴或上传）');
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('请描述想要的修改（例如：把背景换成海边）');
  if (prompt.length > MAX_PROMPT) throw new Error(`修改描述过长（上限 ${MAX_PROMPT} 字）`);
  const b64 = imageB64.replace(/^data:image\/[a-z+]+;base64,/, '').replace(/\s/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64)) throw new Error('原图数据无效，请重新读取或上传图片');
  if (b64.length > MAX_IMAGE_B64 * 1.4) throw new Error('图片过大（上限 4MB），请压缩后再试');
  const n = Math.min(Math.max(Number.parseInt(count, 10) || 1, 1), 4);
  const eng = typeof engine === 'string' && engine ? engine : 'hy';
  if (eng === 'hy') return hyEdit(b64, prompt.trim(), n);
  if (eng === 'jimeng') return jimengEdit(b64, prompt.trim(), n);
  throw new Error('修图目前支持混元和即梦两个引擎');
}

async function hyEditOnce(b64, prompt) {
  const key = readKey();
  let resp;
  try {
    resp = await serviceFetch(HY_EDIT_ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: GEN_MODEL, image: [b64], prompt, response_format: 'url' }),
      signal: AbortSignal.timeout(GEN_TIMEOUT_MS),
    });
  } catch (e) {
    const cause = e?.cause?.code || e?.cause?.message || '';
    throw new Error(`修图服务连接失败：${e?.message || e}${cause ? `（${cause}）` : ''}`);
  }
  if (!resp.ok) throw new Error(`修图服务 HTTP ${resp.status}`);
  let data;
  try { data = await resp.json(); } catch { throw new Error('修图服务返回了无法解析的内容'); }
  if (data.code !== 0) throw new Error(`修图失败：${data.msg || '未知错误'}（code ${data.code}）`);
  const items = Array.isArray(data?.data?.data) ? data.data.data : [];
  const images = [];
  for (const it of items) {
    if (it && typeof it.b64_json === 'string' && it.b64_json) { images.push({ b64: it.b64_json, mime: 'image/png' }); continue; }
    if (it && typeof it.url === 'string' && /^https:\/\//.test(it.url)) images.push(await downloadAsImage(it.url));
  }
  if (!images.length) throw new Error('修图服务未返回图片');
  return { images, usage: data.usage || {} };
}

async function hyEdit(b64, prompt, n) {
  if (n === 1) return hyEditOnce(b64, prompt);
  const settled = await Promise.allSettled(Array.from({ length: n }, () => hyEditOnce(b64, prompt)));
  const ok = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!ok.length) {
    const firstErr = settled[0].reason;
    throw firstErr instanceof Error ? firstErr : new Error(String(firstErr || '修图失败'));
  }
  return { images: ok.flatMap((r) => r.images), usage: {} };
}

// ---- 即梦修图辅助 ----
async function ensureJimengProject(bin, env, jcfg) {
  if (typeof jcfg.projectId === 'string' && jcfg.projectId) return jcfg.projectId;
  try {
    const cached = JSON.parse(readFileSync(JIMENG_CANVAS_CACHE, 'utf8'))?.projectId;
    if (cached) return cached;
  } catch {}
  const out = await runCli(bin, ['canvas', 'create', 'LLM_in_Work 修图', '--format', 'json', '--non-interactive'], 30 * 1000, '即梦画布创建', env);
  let pid = '';
  for (const line of out.split('\n')) {
    try { const j = JSON.parse(line); if (j?.data?.project?.projectId) pid = j.data.project.projectId; } catch {}
  }
  if (!pid) throw new Error('即梦画布创建失败（可在 image-engines.json 的 jimeng.projectId 手动指定）');
  try { writeFileSync(JIMENG_CANVAS_CACHE, JSON.stringify({ projectId: pid }), { mode: 0o600 }); } catch {}
  return pid;
}

async function jimengResourceState(bin, env, pid, rid) {
  try {
    const out = await runCli(bin, ['resource', 'get', rid, '--project-id', pid, '--format', 'json', '--non-interactive'], 30 * 1000, '即梦资源查询', env);
    for (const line of out.split('\n')) {
      try { const j = JSON.parse(line); const st = j?.data?.state || j?.data?.status; if (st) return String(st).toLowerCase(); } catch {}
    }
  } catch {}
  return '';
}

async function jimengUpload(bin, env, pid, filePath) {
  const rid = randomUUID(); // 幂等键：upload_state_unknown 时用它查状态恢复
  const args = ['resource', 'upload', '--file', filePath, '--project-id', pid, '--resource-id', rid, '--format', 'json', '--non-interactive'];
  try {
    await runCli(bin, args, 120 * 1000, '即梦图片上传', env);
    return rid;
  } catch (e) {
    const blob = String(e?.stderr || '') + String(e?.message || '');
    if (/upload_state_unknown/.test(blob)) {
      // 状态未知：可能已上传成功。轮询 resource get 直到 success/failed
      const deadline = Date.now() + 180 * 1000;
      let lastState = '';
      while (Date.now() < deadline) {
        const st = await jimengResourceState(bin, env, pid, rid);
        lastState = st || lastState;
        if (st === 'success') return rid;
        if (st === 'failed' || st === 'canceled') break;
        await new Promise((r) => setTimeout(r, 5000));
      }
      throw new Error(`即梦图片上传状态未知（resourceId: ${rid}，最近状态：${lastState || '未返回'}）。请稍后重试；若持续出现，请提供该 resourceId 排查。`);
    }
    throw enrichCliError(e, '即梦图片上传');
  }
}

// 解析即梦 NDJSON 输出（事件行 + 结果行），返回成功的 resources 数组
function parseJimengResources(out, label) {
  let okResult = null, errResult = null;
  for (const line of out.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try {
      const j = JSON.parse(s);
      if (j && j.ok === true && j.data) okResult = j;
      else if (j && j.ok === false) errResult = j;
    } catch {}
  }
  if (!okResult) {
    const msg = errResult?.error?.message || errResult?.msg || errResult?.error
      || (errResult ? JSON.stringify(errResult).slice(0, 200) : 'CLI 未返回结果');
    const hint = errResult?.error?.code === 'cli.transport_failed'
      ? '（服务进程连不上即梦：请开启系统代理，或在 ~/.codebuddy/image-engines.json 的 jimeng.env 配置 HTTPS_PROXY）' : '';
    throw new Error(`${label}失败：${msg}${hint}`);
  }
  const resources = okResult?.data?.submission?.resources;
  if (!Array.isArray(resources) || !resources.length) throw new Error(`${label}未返回产物（可能被积分上限拦截）`);
  const good = resources.filter((r) => r && typeof r.resourceId === 'string' && r.state !== 'failed');
  if (!good.length) throw new Error(`${label}失败：${resources[0]?.state || '产物状态异常'}`);
  return good;
}

async function downloadJimengResources(bin, env, good, projectId) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'LLM_in_Work-jimeng-'));
  try {
    const images = [];
    for (const r of good) {
      const file = path.join(dir, `${r.resourceId}.img`);
      const args = ['resource', 'download', r.resourceId, '-o', file];
      if (projectId) args.push('--project-id', projectId);
      args.push('--format', 'json', '--non-interactive');
      await runCli(bin, args, 60 * 1000, '即梦产物下载', env);
      const buf = await readFile(file);
      if (!buf.length) throw new Error('即梦产物下载为空');
      images.push({ b64: buf.toString('base64'), mime: detectMime(buf) });
    }
    return images;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function jimengEdit(b64, prompt, n) {
  const cfg = loadEnginesConfig();
  const jcfg = cfg.jimeng && typeof cfg.jimeng === 'object' ? cfg.jimeng : {};
  const bin = (typeof jcfg.bin === 'string' && jcfg.bin) || findJimengBin();
  if (!bin) throw new Error('未找到 dreamina-canvas CLI（即梦修图需先安装）');
  const env = await jimengSpawnEnv(jcfg);
  const model = typeof jcfg.model === 'string' && jcfg.model ? jcfg.model : JIMENG_DEFAULT_MODEL;
  const perImg = Math.min(Math.max(Number.parseInt(jcfg.creditCeiling, 10) || JIMENG_DEFAULT_CEILING, 1), 100);
  const pid = await ensureJimengProject(bin, env, jcfg);

  // 原图落临时文件 → 上传（幂等键）
  const dir = await mkdtemp(path.join(os.tmpdir(), 'LLM_in_Work-edit-'));
  let rid;
  try {
    const srcBuf = Buffer.from(b64, 'base64');
    const mime = detectMime(srcBuf);
    const ext = mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '.png';
    const srcFile = path.join(dir, 'source' + ext);
    await writeFile(srcFile, srcBuf);
    rid = await jimengUpload(bin, env, pid, srcFile);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  const args = [
    'node', 'create', 'image', '--mode', 'i2i', '--model', model,
    '--ref', `res:${rid}`, '--prompt', prompt, '--project-id', pid,
    '--count', String(n), '--run', '--wait', '--yes', '--credit-ceiling', String(perImg * n),
    '--timeout', '5m', '--format', 'json', '--non-interactive',
  ];
  let out;
  try {
    out = await runCli(bin, args, JIMENG_RUN_TIMEOUT_MS, '即梦修图', env);
  } catch (e) {
    throw enrichCliError(e, '即梦修图');
  }
  const good = parseJimengResources(out, '即梦修图');
  const images = await downloadJimengResources(bin, env, good, pid);
  return { images, usage: { engine: 'jimeng', model, count: images.length } };
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
    const r = await serviceFetch(EDIT_ENDPOINT, {
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
      const r = await serviceFetch(TASK_ENDPOINT, {
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

// ---------- 上下文配图：选中文本 → 中文画面描述（丰满、六要素，可修改） ----------
// 注：hunyuan-image-alpha 原生支持中文提示词（2026-10-13 实测），无需翻译层。
export function enhancePrompt({ context, instruction } = {}) {
  const ctx = typeof context === 'string' ? context.trim() : '';
  if (!ctx) throw new Error('请先在文档里选中一段内容，或直接在输入框填写画面描述');
  const extra = typeof instruction === 'string' && instruction.trim() ? `\n用户指定的风格或补充要求：${instruction.trim()}` : '';
  const sysPrompt = [
    '你是 AI 文生图文案专家。根据下面的文档内容，写一段丰满、直接可用的中文画面描述，为这段内容配一张贴合主题的商务演示插图。',
    '要求：',
    '1. 只输出中文画面描述本身，不要任何解释、前缀、小标题或引号；',
    '2. 描述必须自然覆盖六个要素：画面主体、场景环境、插画风格、色彩色调、整体氛围、构图方式；',
    '3. 全文 120–200 字，连贯成段（不要分条罗列）；',
    '4. 用具体可感的视觉语言（颜色、材质、光线、线条感、留白），避免「高质量」「大师级」「超高清」这类空洞词；',
    '5. 如果内容是数据/结论类，配意象化的概念插图而不是图表；',
    '6. 默认干净、专业、适合放进商务演示文稿的画风，除非用户另有指定。',
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
// 魔数探测图片类型（即梦产物是本地文件，没有 HTTP content-type 可用）
function detectMime(buf) {
  if (buf.length > 3 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 11 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return 'image/png';
}

// curl 二进制下载回退：Node 的 EnvHttpProxyAgent 在部分网络下会偶发 fetch failed；
// 已生成的图片不能因为一次下载抖动而丢失。curl 在 macOS / Windows 11 均自带。
function curlDownload(url, env) {
  return new Promise((resolve, reject) => {
    const marker = Buffer.from('\n__LLM_IN_WORK_MIME__:');
    const args = ['-fSL', '-sS', '--connect-timeout', '20', '--max-time', String(Math.ceil(DOWNLOAD_TIMEOUT_MS / 1000)),
      '--write-out', '\n__LLM_IN_WORK_MIME__:%{content_type}', url];
    const child = spawn('curl', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0, err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('下载超时')); }, DOWNLOAD_TIMEOUT_MS + 5000);
    child.stdout.on('data', (d) => {
      size += d.length;
      if (size > 50 * 1024 * 1024) { child.kill('SIGKILL'); reject(new Error('图片超过 50MB')); return; }
      chunks.push(d);
    });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error(err.trim().slice(0, 240) || `curl exit ${code}`)); return; }
      const all = Buffer.concat(chunks);
      const idx = all.lastIndexOf(marker);
      if (idx < 0) { reject(new Error('下载返回格式异常')); return; }
      const buf = all.subarray(0, idx);
      if (!buf.length) { reject(new Error('空文件')); return; }
      const headerMime = all.subarray(idx + marker.length).toString('utf8').trim().split(';')[0];
      resolve({ buf, mime: /^image\//.test(headerMime) ? headerMime : detectMime(buf) });
    });
  });
}

async function downloadAsImage(url) {
  let firstError = null;
  try {
    const r = await serviceFetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) throw new Error('空文件');
    return { b64: buf.toString('base64'), mime: (r.headers.get('content-type') || detectMime(buf)).split(';')[0] };
  } catch (e) {
    firstError = e;
  }

  // 回退顺序：经活性探测的代理环境 → 强制直连。两次都只是下载同一产物，不重复生成。
  const proxyEnv = await jimengSpawnEnv({});
  const directEnv = { ...proxyEnv };
  for (const k of PROXY_KEYS) delete directEnv[k];
  const errors = [];
  for (const env of [proxyEnv, directEnv]) {
    try {
      const r = await curlDownload(url, env);
      return { b64: r.buf.toString('base64'), mime: r.mime };
    } catch (e) { errors.push(e?.message || String(e)); }
  }
  const cause = firstError?.cause?.code || firstError?.cause?.message || '';
  const first = String(firstError?.message || firstError || '未知错误') + (cause ? `（${cause}）` : '');
  throw new Error(`图片下载失败：${first}；代理/直连回退也未成功（${errors.join('；')}）`);
}
