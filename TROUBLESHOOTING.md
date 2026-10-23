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

## 案例 B：即梦生图报 `cli.transport_failed`（服务进程带着死代理）

**症状**：图像页选即梦引擎生成，报「即梦生图失败：The service could not be reached…」；但同一台机器在终端直接跑 `dreamina-canvas node create image …` 却成功。

**根因**（2026-10-23 实测）：旧版 install.sh 把**安装那一刻的代理端口快照**进 `~/.llm_in_*/run.sh`（如 `export HTTPS_PROXY=http://127.0.0.1:51200`）。launchd 拉起的服务进程不带 `~/.zshrc`，只认 run.sh 里这份快照——代理端口一变（51200 → 7897），服务进程就拿着死代理出网。即梦 CLI（Go 二进制）读代理变量必走死代理；而混元引擎不受影响（Node fetch 不读 `HTTP_PROXY`，一直直连），所以聊天/混元生图正常、唯独即梦失败，极易误判为即梦服务端故障。

**修复**（三层，已进仓库）：

1. `run.sh` / `install.sh` 模板：不再快照代理，启动时动态读 macOS 系统代理（`scutil --proxy`）
2. `imagegen.js`：spawn 即梦 CLI 前做**代理活性探测**（TCP 连一下端口，600ms）——代理变量指向的端口没监听就自动换系统代理，系统代理也不行就清掉变量直连
3. 错误透传：CLI 的 JSON 错误对象（在 stderr）会被解析出 `code/message`，`transport_failed` 附带代理配置指引

**手动修复存量安装**（已装用户不想重跑 install.sh）：编辑 `~/.llm_in_{word,powerpoint,excel}/run.sh`，把硬编码的 `export …_PROXY=http://127.0.0.1:旧端口` 四行删掉，替换为动态块（见 install.sh 生成的最新模板），然后 `pkill -f "llm_in_.*app/server"` 让 launchd 重拉。

**验证**：`curl -k https://127.0.0.1:8387/api/image/engines` 应看到 `{"id":"jimeng","available":true}`；POST `/api/image` 带 `"engine":"jimeng"` 能出图即通。

**教训**：任何「把环境快照进配置」的方案（代理端口、CLI 路径、版本号）都要考虑漂移；跨进程网络问题的第一怀疑对象应该是**环境差异**（shell vs launchd），用 `env -i` 最小环境复现是定位利器。
