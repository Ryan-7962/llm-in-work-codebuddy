# 排障手册（Troubleshooting）

> 面向使用者和 AI 助手：按症状查表定位，按修复步骤操作。
> 修好后记得把结论补回本文档（你的实战经验是下一个人的救命稻草）。

## 快速查表

| 症状 | 根因 | 修复 |
|---|---|---|
| 面板报「Claude Code 退出码 1 / Cannot find module '../dist/codebuddy'」 | **WorkBuddy 自动更新改了 CLI 内部结构**（见下文案例 A） | 更新 wrapper（`git pull` 后重跑安装脚本）；已内置自愈探测，多数情况自动恢复 |
| CLI 执行 3 分钟无输出（挂起） | 继承了 WorkBuddy 桌面版的 `SERVER__PORT` 等会话变量 | wrapper 已自动剥离（`~/.local/bin/cbc-claude.js` / `_windows/cbc-claude.js`），无需处理 |
| 面板报「无法加载该加载项」 | 本机桥服务没运行（端口 8377/8387/8397 无监听） | macOS：`launchctl print gui/$(id -u)/com.llm_in_powerpoint.server` 看状态；挂了 `pkill -f '\.llm_in_.*server\.js'` 让 launchd 自动拉起 |
| 生图/抠图报 401/403 | `~/.codebuddy/api.key` 失效 | WorkBuddy → 个人信息 → 管理中心 → 访问密钥，重新获取并写入 |
| 聊天能用、生图不能用 | key 未写或服务端 imagegen 路由未部署 | 检查 key 文件；`curl -k https://127.0.0.1:8387/api/image` 看路由 |

## 案例 A：WorkBuddy 更新导致 CLI 断联（2026-10 实战）

### 事故经过

- **触发**：WorkBuddy 桌面版自动更新（2026-10-12，v5.8.2），无任何提示
- **症状**：Office 面板聊天全部报 `Cannot find module '../dist/codebuddy'`，退出码 1；生图/抠图正常（走 HTTP API 不经 CLI）；WorkBuddy 桌面版自身完全正常
- **根因**：新版 CLI 的 `dist/` 目录只保留了 `codebuddy-lite-wb.mjs` 精简 bundle，标准 `dist/codebuddy` 被移除。加载精简 bundle 需要环境变量 `CODEBUDDY_FORCE_LITE_WB_BUNDLE=1`——WorkBuddy 自己启动 CLI 时会带，而我们的 wrapper 出于防挂起考虑剥掉了所有 `CODEBUDDY_*` 变量，导致 CLI 两个 bundle 都找不到

### 为什么这类问题会复发

本项目是**旁路集成**：借用 WorkBuddy 自带的 CLI 做后端。CLI 的内部结构（路径、bundle 名、环境变量协议）没有对外承诺，WorkBuddy 任何一次自动更新都可能改动。**这不是 bug，是这种集成方式的固有风险。**

### 已做的自愈防护

wrapper 现在启动前自动探测 CLI 目录结构：

```
标准 bundle (dist/codebuddy*) 还在  → 不干预（旧行为）
标准 bundle 没了、lite-wb 在       → 自动设 CODEBUDDY_FORCE_LITE_WB_BUNDLE=1
```

WorkBuddy 今后增删 bundle 都能自动适应。探测逻辑在 `cbc-claude.js` 里搜 `hasStdBundle`。

### 万一还是断联了（修复手册，给 AI 或人）

**第 1 步：拿到原始报错**

```bash
node ~/.local/bin/cbc-claude.js -p "回复正常" --output-format text
# Windows: node %USERPROFILE%\.llm_in_codebuddy\cbc-claude.js -p "回复正常" --output-format text
```

**第 2 步：看 CLI 目录现状**

```bash
ls /Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/dist/
# Windows: dir "%LOCALAPPDATA%\Programs\WorkBuddy\resources\app.asar.unpacked\cli\dist"
```

**第 3 步：读入口的 bundle 分派逻辑**（`cli/bin/codebuddy`，搜 `forceLiteWb` / `isHeadless`），弄清当前版本需要什么环境变量、加载哪个 bundle。

**第 4 步：改 wrapper**（本机 `~/.local/bin/cbc-claude.js`，仓库 `_windows/cbc-claude.js`），把探测条件改成适配新结构，本地实测出字后按下方「修复后的发布流程」同步。

**第 5 步：不要改的**：不要关掉环境剥离逻辑（`SERVER__*` 剥离是防挂起的命根）；不要硬编码 CLI 版本号（探测优于断言）。

### 修复后的发布流程

1. 本机 `~/.local/bin/cbc-claude.js` 验证通过
2. 同步到仓库 `_windows/cbc-claude.js`，`node --check` 通过
3. `git commit + push`
4. 同事：`git pull` → 重跑 `install-codebuddy.ps1`（或 macOS 三行命令里的 wrapper 拷贝步骤）
5. 把新案例补进本手册

## CLI 的两种来源（wrapper 自动识别）

| 来源 | 平台 | 认证方式 | 说明 |
|---|---|---|---|
| WorkBuddy 内嵌 CLI | macOS 实测可用；**Windows 版 WorkBuddy 不带 codebuddy.exe**（2026-10 实测） | 注入 `~/.codebuddy/api.key`（ck_ key，必需） | 路径含 `app.asar.unpacked` |
| 独立版 CodeBuddy CLI | macOS / Windows / Linux 官方支持 | CLI 自身登录态（首次运行 `codebuddy` 浏览器登录） | Windows 用户走这条：`irm https://copilot.tencent.com/cli/install.ps1 \| iex` 或 `npm i -g @tencent-ai/codebuddy-code` |

wrapper（cbc-claude.js）按上表自动探测来源并选择认证方式；`CODEBUDDY_BIN` 环境变量可显式指定。

## 其他已知坑

- **macOS BSD grep 不支持 `\|` 交替语法**（GNU BRE 特性），会静默返回 0 匹配——排查时一律用 `grep -E "a|b"`
- **launchctl 在 WorkBuddy 会话内执行必报 EIO**（provenance 限制）——LaunchAgent 注册要在用户自己的 Terminal 跑
- **Office 面板改动前端文件后**：HTML 引用的静态资源带 `?v=` 版本号，改动文件后需要 bump 版本号（`taskpane.html` 里搜 `v=`）强制刷新
