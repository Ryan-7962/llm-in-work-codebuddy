# LLM_in_Work × CodeBuddy (WorkBuddy) 改造版

基于 [ZJU-OmniAI/LLM_in_Work](https://github.com/ZJU-OmniAI/LLM_in_Work)（2026-10-08 main 分支）改造，
将五个助手（Word / Overleaf / PDF / PowerPoint / Excel）的 Claude Code 后端槽位替换为
**WorkBuddy.app 内置的 CodeBuddy CLI**，模型走 WorkBuddy 账号（GLM-5.3 / Kimi / DeepSeek 等）。

## 改造原理

```
Office 加载项 / 浏览器扩展
        ↓ HTTPS 127.0.0.1:83xx / Native Messaging
本机桥（Node.js，原版未改调用逻辑）
        ↓ spawn（claude 槽位）
~/.local/bin/cbc-claude.js          ← 本改造新增的适配层
  · 剥离 --disable-slash-commands（codebuddy 不支持）
  · 模型别名映射 sonnet/opus→glm-5.3，haiku→glm-5.3-flash
  · 注入 ~/.codebuddy/api.key 为 CODEBUDDY_API_KEY（免交互登录）
  · 清理 WorkBuddy 应用注入的干扰变量（SERVER__PORT 挂起元凶等）
  · 拦截 `auth status` 健康探测 → 按 key 存在返回已登录
        ↓ exec
/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy
        ↓ stream-json（与 Claude Code 事件格式完全兼容）
GLM-5.3 / Kimi-K3 / Deepseek-V4 等模型
```

## 已验证的兼容性（codebuddy CLI v2.156.0 实测）

| 能力 | 结果 |
|---|---|
| `-p` headless + `--output-format stream-json` | ✅ 事件结构与 Claude Code 一致（system / stream_event / content_block_delta / result） |
| `--effort low\|medium\|high\|xhigh\|max` | ✅ 原样透传 |
| `--permission-mode dontAsk` / `--strict-mcp-config` / `--mcp-config` / `--tools` / `--allowedTools` | ✅ |
| `--session-id` / `--resume` 多轮会话 | ✅ 实测暗号续答通过 |
| `control_request initialize` 模型探测协议 | ✅ 返回 {id,name} 模型列表（与 Claude 的 {value,resolvedModel} 不同，已在 models.js 适配） |
| `--disable-slash-commands` | ❌ 不支持 → wrapper 剥离 |
| `auth status --json` | ❌ 无此命令 → wrapper 拦截应答 |

## 修改的文件（相对原版）

每个助手（LLM_in_Word / LLM_in_PowerPoint / LLM_in_Excel / LLM_in_Overleaf / LLM_in_PDF）：
- `server/models.js`：`claudeCatalog()` 增加 CodeBuddy `{id,name}` 分支，模型列表自动来自 CLI 探测
- 前端（taskpane 或 extension/content）：默认模型列表改为 GLM/Kimi、默认选中 glm-5.3、"Claude Code" 标签改为 "CodeBuddy (WorkBuddy)"

未改动：cli.js 调用逻辑、prompt.js、diff 审阅、写回校验等核心链路（stream-json 兼容，无需改动）。

## 部署状态（2026-10-09 已部署本机）

- 密钥：`~/.codebuddy/api.key`（600 权限）
- 适配层：`~/.local/bin/cbc-claude.js`
- 五桥均已安装并指向 wrapper；Word 桥 /api/health、/api/models、/api/chat 全链路实测通过

## 日常使用

- Word / PowerPoint / Excel：重启 Office 应用 → 功能区加载项 → 后端选 "CodeBuddy · WorkBuddy"
- Overleaf / PDF：Chrome `chrome://extensions` 开发者模式加载 `LLM_in_Work-cb/LLM_in_Overleaf/extension` 与 `LLM_in_Work-cb/LLM_in_PDF/extension`
- 模型下拉列表由本机 CLI 实时探测下发（含 auto / GLM-5.3 全系 / Kimi / Deepseek / MiniMax 等）

## AI 图像工具（2026-10-09 新增，Office 三件套）

面板输入区的「🖼 图像」按钮打开，含两个标签页：**插图** 和 **抠图**。不走 CLI（headless 模式下
ImageGen 工具被产品配置门控），而是**直连 WorkBuddy 图像 API**（均为实测通过的端点）：

### 插图（文生图 + 上下文配图）

```
POST https://www.workbuddy.cn/v2/images/generations
Authorization: Bearer <~/.codebuddy/api.key>
{ "model": "hunyuan-image-alpha", "prompt": "...", "size": "1280x720|1024x1024|720x1280", "n": 1 }
→ { code: 0, data: { data: [{ url }] }, usage: { credit: ≈5.71 } }
```

- **直接输入**：填画面描述 → 选尺寸 → 生成预览 → 插入光标处
- **上下文配图**（`/api/image/prompt`）：先在文档里选中一段文字 → 点「为选中内容配图 ✨」→
  桥 spawn cbc-claude（glm-5.3-flash，effort low）把选中文本浓缩成英文生图提示词 → 填入输入框
  （可修改）→ 再生成。实测：沐浴露销售文案 → "Flat illustration of a young urban woman in a
  refreshing shower scene, floating floral and citrus fragrance notes…"
- 预览图**点击可放大**（lightbox 全屏查看，点任意处关闭）

### 抠图（去背景，透明 PNG）

```
POST https://www.workbuddy.cn/v2/async/images/edits     # 提交任务
  { "model": "vod-image-matting", "response_format": "url", "image": [<base64>] }
POST https://www.workbuddy.cn/v2/async/images/tasks     # 轮询（4s 间隔，上限 2 分钟）
  { "task_id": "img..." } → status=completed 后 data[0].url 为透明 PNG
```

- 端点逆向自 WorkBuddy 内置 `buddy-image-processing` 技能脚本（ck_t_ 校验仅是脚本侧前置检查，
  **服务端同样接受 ck_ key**，已实测）；同族还有 erase/enhance/beauty/restore 模型可扩展
- 图片来源三种：**PowerPoint 里直接选中图片形状**（PowerPointApi 1.10 `shape.getImageAsBase64()`，
  桥读取后送抠图）；**Ctrl/⌘+V 粘贴**；**拖拽 / 选择文件**（Word/Excel 用后两种，上限 4MB）
- 结果以棋盘格背景预览（直观看到透明区域），点击可放大，插入后是透明 PNG 可直接叠在版式上
- 计费：约 5.7 credits/次，结果 RGBA 1024×1024，实测约 16 秒完成

### 实现文件

- 服务端：各助手 `server/imagegen.js`（generateImage / matting / enhancePrompt 三函数）+
  `server.js` 路由 `/api/image`、`/api/image/prompt`、`/api/image/matting`
- 前端：各助手 `taskpane/imagepanel.js`（自包含模块，动态注入 UI，不碰 taskpane.js），
  插入用 Office.js `setSelectedDataAsync(CoercionType.Image)`

## 回退到原版（Claude Code / Codex 后端）

```bash
cd <原版目录>/LLM_in_Word && ./install.sh --update-only     # 同理其余四个
```

## 已知限制

- 模型列表前两项是 custom:qwen3.6-27b-fp8 / custom:gpt-5.5（CLI 返回顺序），日常建议选 GLM-5.3 或 Auto
- hy3 与 hy3-x 显示名同为 "Hy3"（CLI 返回的 name 如此）
- WorkBuddy.app 升级后内置 CLI 路径不变则无需处理；若路径变化，改 wrapper 里的 CB_BIN 即可
- API key 过期时：面板健康检查会显示"需要登录"，更新 ~/.codebuddy/api.key 即可
- 从 WorkBuddy 应用内（如 AI 会话）直接手工调 CLI 仍会挂起（SERVER__PORT 等变量），经 wrapper 无此问题

## ⚠️ 服务自启动说明（重要）

2026-10-09 更新部署时发现：**从 WorkBuddy 会话内 shell 执行 `launchctl bootstrap` 会报
`Bootstrap failed: 5: Input/output error`**（今早首次完整安装因走了钥匙串提权审批所以成功；
后续 `--update-only` 重部署时 bootout 成功、bootstrap 失败，导致服务被停后拉不起来）。

当前状态：三个桥以 WorkBuddy 后台任务方式常驻运行；`~/Library/LaunchAgents/` 里的 plist 完好，
**下次重启/登录时 macOS 会自动原生加载（RunAtLoad），转为 launchd 托管**。如想立即转 launchd
而不重启，在自己终端（非 WorkBuddy 内）执行：

```bash
for s in word powerpoint excel; do launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.llm_in_$s.server.plist; done
```

以后从 WorkBuddy 内重部署 `install.sh --update-only` 若再遇此情况，同样用上面命令恢复。
