#!/usr/bin/env node
// cbc-claude.js — LLM_in_Work × CodeBuddy 适配层（macOS + Windows 跨平台版）
// 把 WorkBuddy 内置的 CodeBuddy CLI 包装成 Claude Code 兼容后端：
//   1. 剥离 codebuddy 不支持的 --disable-slash-commands
//   2. 模型别名映射：sonnet/opus → glm-5.3，haiku → glm-5.3-flash
//   3. 注入 ~/.codebuddy/api.key 作为 CODEBUDDY_API_KEY（免交互式登录）
//   4. 清理从 WorkBuddy 桌面应用内继承的 CODEBUDDY_* 会话变量（避免本地端口冲突；
//      实测 macOS 上 SERVER__PORT 会让 headless CLI 挂起，Windows 上同样防御）
//   5. 拦截 `auth status` 健康探测，按 key 存在与否返回登录状态
// LLM_in_Work 的 launch.js 会对 .js 后缀的 bin 用 `node <本文件> <args>` 启动。
// CLI 查找顺序：环境变量 CODEBUDDY_BIN → 平台默认路径 → PATH。
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const KEY_FILE = path.join(os.homedir(), '.codebuddy', 'api.key');

// ---- 按平台探测 WorkBuddy 内置 CodeBuddy CLI ----
function findCli() {
  // 1) 环境变量显式指定（install-codebuddy.ps1 探测后写入，最可靠）
  const fromEnv = process.env.CODEBUDDY_BIN;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  // 2) 平台默认候选路径
  const candidates = [];
  if (process.platform === 'win32') {
    const localPrograms = path.join(os.homedir(), 'AppData', 'Local', 'Programs');
    for (const root of [localPrograms, process.env.ProgramFiles || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)']) {
      for (const app of ['WorkBuddy', 'CodeBuddy', 'workbuddy', 'codebuddy']) {
        const base = path.join(root, app);
        candidates.push(
          path.join(base, 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.exe'),
          path.join(base, 'resources', 'app.asar.unpacked', 'cli', 'codebuddy.exe'),
          path.join(base, 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy'),
        );
      }
    }
  } else {
    candidates.push(
      '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy',
      '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/codebuddy',
    );
  }
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }

  // 3) 兜底：PATH（Windows 下仅原生 .exe 可被 shell:false spawn）
  return process.platform === 'win32' ? 'codebuddy.exe' : 'codebuddy';
}

function readKey() {
  try { return fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch { return ''; }
}

const argv = process.argv.slice(2);

// 健康探测：LLM_in_Work 的 health.js 会执行 `claude auth status --json`
if (argv[0] === 'auth' && argv[1] === 'status') {
  const key = readKey();
  process.stdout.write(JSON.stringify({ loggedIn: !!key, authMethod: key ? 'api_key' : null, apiProvider: 'codebuddy' }) + '\n');
  process.exit(0);
}

// 参数过滤 + 模型映射
const MODEL_MAP = { sonnet: 'glm-5.3', opus: 'glm-5.3', haiku: 'glm-5.3-flash' };
const args = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--disable-slash-commands') continue;
  if (a === '--model' && i + 1 < argv.length) { args.push(a, MODEL_MAP[argv[++i]] || argv[i]); continue; }
  args.push(a);
}

// 环境清理：去掉 WorkBuddy 桌面应用注入的会话变量，只保留/注入 API key。
// 实测确认（macOS）：SERVER__PORT（应用 gateway 端口）会让 headless CLI 挂起，
// CODEBUDDY_SERVICE_PROXY_URL 等会引发端口冲突，NODE shim 等也不应带进独立进程。
// Windows 上由 Startup 快捷方式启动时本无这些变量；从 WorkBuddy 会话手动启动时同样防御。
const env = {};
for (const [k, v] of Object.entries(process.env)) {
  if (/^CODEBUDDY_/.test(k) && k !== 'CODEBUDDY_API_KEY') continue;
  if (/^SERVER__/.test(k)) continue;               // WorkBuddy app gateway（挂起元凶）
  if (/^WORKBUDDY_(PAC_RPC|STARTUP|DAEMON)/.test(k)) continue;
  if (k === 'ELECTRON_RUN_AS_NODE') continue;
  env[k] = v;
}
const key = readKey();
if (key) env.CODEBUDDY_API_KEY = key;
else {
  process.stderr.write('cbc-claude: 缺少 ~/.codebuddy/api.key，请先写入 CodeBuddy API key。\n');
  process.exit(1);
}
// WorkBuddy 5.8.2+ dist/ 可能只带 codebuddy-lite-wb.mjs（标准 dist/codebuddy 被移除），
// 需 CODEBUDDY_FORCE_LITE_WB_BUNDLE=1 才能加载。自动探测：标准 bundle 不在而 lite-wb 在
// 时才设置——WorkBuddy 未来两个方向的 bundle 调整都能自愈。

const CB_BIN = findCli();
const isFallback = CB_BIN === 'codebuddy' || CB_BIN === 'codebuddy.exe';
if (!isFallback && !fs.existsSync(CB_BIN)) {
  process.stderr.write(`cbc-claude: 未找到 CodeBuddy CLI（${CB_BIN}）。请确认 WorkBuddy 已安装，或设置 CODEBUDDY_BIN 环境变量。\n`);
  process.exit(1);
}
if (!isFallback) {
  try {
    const cliRoot = path.dirname(path.dirname(fs.realpathSync(CB_BIN)));
    const hasStdBundle = ['codebuddy.js', 'codebuddy.cjs', 'codebuddy.mjs', 'codebuddy-headless.js', 'codebuddy-headless.cjs']
      .some((f) => fs.existsSync(path.join(cliRoot, 'dist', f)));
    const hasLiteWb = fs.existsSync(path.join(cliRoot, 'dist', 'codebuddy-lite-wb.mjs'));
    if (!hasStdBundle && hasLiteWb) env.CODEBUDDY_FORCE_LITE_WB_BUNDLE = '1';
  } catch { /* 探测失败不阻断，按原样启动 */ }
}

const child = spawn(CB_BIN, args, { env, stdio: 'inherit', shell: false, windowsHide: true });
child.on('error', (e) => {
  process.stderr.write(`cbc-claude: 无法启动 CodeBuddy CLI（${CB_BIN}）：${e.message}\n`
    + '请设置环境变量 CODEBUDDY_BIN 指向 codebuddy 可执行文件的绝对路径。\n');
  process.exit(1);
});
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { try { child.kill(sig); } catch {} });
}
child.on('close', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code == null ? 1 : code);
});
