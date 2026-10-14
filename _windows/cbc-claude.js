#!/usr/bin/env node
// cbc-claude.js — LLM_in_Work × CodeBuddy 适配层（macOS + Windows 跨平台版）
// 把 CodeBuddy CLI 包装成 Claude Code 兼容后端。CLI 两种来源：
//   A. 独立版 CodeBuddy CLI（官方产品，Windows/macOS/Linux 均有安装包）
//      - Windows 官方安装器: irm https://copilot.tencent.com/cli/install.ps1 | iex
//        （装到 %LOCALAPPDATA%\codebuddy\bin\codebuddy.exe）
//      - npm: npm install -g @tencent-ai/codebuddy-code
//      认证：CLI 自身登录态（首次运行 codebuddy 按提示浏览器登录），无需 API key
//   B. WorkBuddy 内嵌 CLI（仅 macOS 实测可用；Windows 版 WorkBuddy 不带 codebuddy.exe）
//      认证：注入 ~/.codebuddy/api.key 作为 CODEBUDDY_API_KEY（WorkBuddy 管理中心的 ck_ key）
// 做的事：
//   1. 剥离 codebuddy 不支持的 --disable-slash-commands
//   2. 模型别名映射：sonnet/opus → glm-5.3，haiku → glm-5.3-flash
//   3. 清理从 WorkBuddy 桌面应用内继承的 CODEBUDDY_* 会话变量（SERVER__PORT 挂起元凶）
//   4. 拦截 `auth status` 健康探测
//   5. 内嵌 CLI 的 lite-wb bundle 自动探测（WorkBuddy 5.8.2+ 适配，详见 TROUBLESHOOTING.md）
// LLM_in_Work 的 launch.js 对 .js 后缀 bin 用 `node <本文件> <args>` 启动。
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const KEY_FILE = path.join(os.homedir(), '.codebuddy', 'api.key');

function readKey() {
  try { return fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch { return ''; }
}

// ---- CLI 探测：返回 { bin, useNode } 或 null ----
function findCli() {
  const hits = [];
  const push = (bin, useNode) => { try { if (bin && fs.existsSync(bin)) hits.push({ bin, useNode }); } catch {} };

  // 1) 环境变量显式指定（install-codebuddy.ps1 探测后写入，最可靠）
  if (process.env.CODEBUDDY_BIN) {
    const p = process.env.CODEBUDDY_BIN;
    const useNode = !/\.(exe|cmd|bat|com)$/i.test(p);
    try { if (fs.existsSync(p)) return { bin: p, useNode }; } catch {}
  }

  if (process.platform === 'win32') {
    // 2) 独立版官方安装器（首选：单一 exe，自带更新）
    push(path.join(os.homedir(), 'AppData', 'Local', 'codebuddy', 'bin', 'codebuddy.exe'), false);
    // 3) npm 全局（bin 是 node 脚本，用 process.execPath 启动，绕开 .cmd 转义问题）
    if (process.env.APPDATA) {
      push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@tencent-ai', 'codebuddy-code', 'bin', 'codebuddy'), true);
      push(path.join(process.env.APPDATA, 'npm', 'codebuddy.cmd'), false);
    }
    // 4) WorkBuddy 内嵌（部分版本可能有；实测 2026-10 的 Windows 版没有）
    const localPrograms = path.join(os.homedir(), 'AppData', 'Local', 'Programs');
    for (const root of [localPrograms, process.env.ProgramFiles || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)']) {
      for (const app of ['WorkBuddy', 'CodeBuddy']) {
        const base = path.join(root, app);
        push(path.join(base, 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.exe'), false);
        push(path.join(base, 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy'), true);
      }
    }
  } else {
    // macOS：内嵌 CLI 优先（实测链路），独立版兜底
    push('/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy', false);
    push(path.join(os.homedir(), '.local', 'bin', 'codebuddy'), false);          // 独立版安装器
    push('/opt/homebrew/bin/codebuddy', false);
    push('/usr/local/bin/codebuddy', false);
  }

  if (hits.length) return hits[0];
  // PATH 兜底（找不到任何已知安装位置时）
  return process.platform === 'win32' ? { bin: 'codebuddy.exe', useNode: false } : { bin: 'codebuddy', useNode: false };
}

const cli = findCli();
const isPathFallback = !fs.existsSync(cli.bin); // PATH 兜底时真实存在性未知
const isEmbedded = /app\.asar\.unpacked/.test(cli.bin); // WorkBuddy 内嵌（需要 API key 认证）
const key = readKey();

const argv = process.argv.slice(2);

// ---- 健康探测：LLM_in_Work 的 health.js 会执行 `claude auth status --json` ----
if (argv[0] === 'auth' && argv[1] === 'status') {
  let loggedIn, authMethod, hint;
  if (isEmbedded) {
    loggedIn = !!key; // 内嵌 CLI 只能靠 API key
    authMethod = key ? 'api_key' : null;
    if (!key) hint = '缺少 ~/.codebuddy/api.key（WorkBuddy → 个人信息 → 管理中心 → 访问密钥）';
  } else {
    loggedIn = !isPathFallback; // 独立版：CLI 在即视为可用，真实登录态由实际调用校验
    authMethod = 'cli_login';
    if (isPathFallback) hint = '未找到 CodeBuddy CLI，请安装：irm https://copilot.tencent.com/cli/install.ps1 | iex，并运行 codebuddy 完成一次登录';
  }
  process.stdout.write(JSON.stringify({ loggedIn, authMethod, apiProvider: 'codebuddy', hint: hint || undefined }) + '\n');
  process.exit(0);
}

// ---- 参数过滤 + 模型别名映射 ----
const MODEL_MAP = { sonnet: 'glm-5.3', opus: 'glm-5.3', haiku: 'glm-5.3-flash' };
const args = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--disable-slash-commands') continue;
  if (a === '--model' && i + 1 < argv.length) { args.push(a, MODEL_MAP[argv[++i]] || argv[i]); continue; }
  args.push(a);
}

// ---- 环境清理：去掉 WorkBuddy 桌面应用注入的会话变量 ----
// 实测确认（macOS）：SERVER__PORT（应用 gateway 端口）会让 headless CLI 挂起，
// CODEBUDDY_SERVICE_PROXY_URL 等会引发端口冲突。Windows 上同样防御。
const env = {};
for (const [k, v] of Object.entries(process.env)) {
  if (/^CODEBUDDY_/.test(k) && k !== 'CODEBUDDY_API_KEY') continue;
  if (/^SERVER__/.test(k)) continue;
  if (/^WORKBUDDY_(PAC_RPC|STARTUP|DAEMON)/.test(k)) continue;
  if (k === 'ELECTRON_RUN_AS_NODE') continue;
  env[k] = v;
}

// ---- 认证：内嵌 CLI 注入 API key（必需）；独立版走 CLI 自身登录态（key 不注入，
//      避免 WorkBuddy 的 ck_ key 与独立版后端不匹配导致认证失败）----
if (isEmbedded) {
  if (key) env.CODEBUDDY_API_KEY = key;
  else {
    process.stderr.write('cbc-claude: 使用 WorkBuddy 内嵌 CLI 需要 ~/.codebuddy/api.key（WorkBuddy → 个人信息 → 管理中心 → 访问密钥）。\n');
    process.exit(1);
  }
}

// ---- 内嵌 CLI 的 lite-wb bundle 自动探测（WorkBuddy 5.8.2+ 适配）----
if (isEmbedded) {
  try {
    const cliRoot = path.dirname(path.dirname(fs.realpathSync(cli.bin)));
    const hasStdBundle = ['codebuddy.js', 'codebuddy.cjs', 'codebuddy.mjs', 'codebuddy-headless.js', 'codebuddy-headless.cjs']
      .some((f) => fs.existsSync(path.join(cliRoot, 'dist', f)));
    const hasLiteWb = fs.existsSync(path.join(cliRoot, 'dist', 'codebuddy-lite-wb.mjs'));
    if (!hasStdBundle && hasLiteWb) env.CODEBUDDY_FORCE_LITE_WB_BUNDLE = '1';
  } catch { /* 探测失败不阻断 */ }
}

if (isPathFallback) {
  // 最后给一次机会：PATH 里也许有（install-codebuddy.ps1 未跑过/环境变量丢了）
  // spawn 失败会走 child.error 分支给出明确指引。
  process.stderr.write(`cbc-claude: 未在已知位置找到 CodeBuddy CLI，尝试 PATH 兜底（${cli.bin}）。\n`
    + '若失败：Windows 先运行 irm https://copilot.tencent.com/cli/install.ps1 | iex 安装独立版 CLI 并登录；\n'
    + '或设置环境变量 CODEBUDDY_BIN 指向 codebuddy 可执行文件。\n');
}

// ---- 启动 ----
const spawnArgs = cli.useNode ? [cli.bin, ...args] : args;
const child = spawn(cli.useNode ? process.execPath : cli.bin, spawnArgs, { env, stdio: 'inherit', shell: false, windowsHide: true });
child.on('error', (e) => {
  process.stderr.write(`cbc-claude: 无法启动 CodeBuddy CLI（${cli.bin}）：${e.message}\n`
    + '请先安装独立版 CLI（Windows: irm https://copilot.tencent.com/cli/install.ps1 | iex），'
    + '或设置环境变量 CODEBUDDY_BIN 指向可执行文件。\n');
  process.exit(1);
});
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { try { child.kill(sig); } catch {} });
}
child.on('close', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code == null ? 1 : code);
});
