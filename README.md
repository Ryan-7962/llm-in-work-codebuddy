# LLM_in_Work × CodeBuddy

把本机已登录的 **WorkBuddy / CodeBuddy CLI** 接入日常工作流：
**Word、PowerPoint、Excel、Overleaf（Chrome）、PDF 论文阅读（Chrome）** 五个助手，
外加 **AI 生图（文生图 / 上下文配图）与抠图（去背景）**。

基于 [ZJU-OmniAI/LLM_in_Work](https://github.com/ZJU-OmniAI/LLM_in_Work)（MIT）改造：
Claude Code 后端槽位替换为 CodeBuddy CLI（GLM-5.3 / Kimi / DeepSeek 等模型，走 WorkBuddy 账号）。
改造原理与兼容性实测见 [README-CODEBUDDY.md](README-CODEBUDDY.md)。

## 功能一览

| 功能 | 说明 |
|---|---|
| 顶部一级导航 | 问答 / 改写 / 版式（PPT）/ 图像 四模块单击直达，不再藏在设置弹层 |
| AI 改写 / 润色 / 对话 | 选中文字下指令，走本机 CodeBuddy CLI，模型可选 |
| 插图（文生图） | 中文画面描述直接生图（混元原生支持中文），风格 chips 一键切换，约 5.7 credits/张 |
| 插图（上下文配图） | 选中文字 → AI 生成六要素中文画面描述（120–200 字，可直接修改）→ 出图 |
| 多候选出图 | 一次 1–3 张候选（默认 2 张），点选满意的一张插入，减少整段重来 |
| 插入尺寸受控 | PPT 中插图自动等比缩放并居中，不会超出幻灯片 |
| 抠图 | **PPT：选中幻灯片图片后自动载入**；完成后可**替换原图**（保位置保尺寸）或插入为新图 |
| 生成历史 | 会话内保留最近 6 张生成记录，缩略图点击载入 |
| 五套件 | Word / PowerPoint / Excel（Office 加载项）+ Overleaf / PDF（Chrome 扩展） |

## 获取 CodeBuddy API key（ck_ 开头）

每人用自己的 key，获取路径：打开 **WorkBuddy → 个人信息 → 管理中心 → 访问密钥**，获取 CodeBuddy 的 API。
key 只写在自己电脑的 `~/.codebuddy/api.key`（Windows: `%USERPROFILE%\.codebuddy\api.key`），仓库中不含任何密钥。

> **新同事安装**：把 [COLLEAGUE-SETUP-PROMPT.md](COLLEAGUE-SETUP-PROMPT.md) 里的提示词整段发给本机 AI（WorkBuddy/Codex），
> 它会代跑「克隆仓库 → 按平台安装 → 验收」全流程（Mac/Windows 通用）。

## macOS 安装

前置：Node.js 22.12+ 或 24+、本机已安装并登录 WorkBuddy。

```bash
git clone https://github.com/Ryan-7962/llm-in-work-codebuddy.git
cd llm-in-work-codebuddy

# 1) 写入自己的 CodeBuddy API key（获取路径见上方；生图/抠图需要，聊天不需要）
mkdir -p ~/.codebuddy && echo "ck_你的key" > ~/.codebuddy/api.key && chmod 600 ~/.codebuddy/api.key

# 2) 部署 CLI 适配层（跨平台 wrapper：macOS 优先用 WorkBuddy 内嵌 CLI，也支持独立版 CLI）
mkdir -p ~/.local/bin
cp _windows/cbc-claude.js ~/.local/bin/cbc-claude.js && chmod +x ~/.local/bin/cbc-claude.js

# 3) 安装要用的套件（每个都会：生成并信任本机证书 → 注册常驻服务 → 侧载加载项）
cd LLM_in_Word       && LLM_IN_WORD_CLAUDE_BIN=~/.local/bin/cbc-claude.js ./install.sh
cd ../LLM_in_PowerPoint && LLM_IN_POWERPOINT_CLAUDE_BIN=~/.local/bin/cbc-claude.js ./install.sh
cd ../LLM_in_Excel   && LLM_IN_EXCEL_CLAUDE_BIN=~/.local/bin/cbc-claude.js ./install.sh
# Overleaf / PDF 为 Chrome 扩展，安装方式见各自目录 README

# 4) 完全退出 Office（⌘Q）再重开 → 功能区出现 LLM_in 按钮
```

## Windows 安装

前置：Node.js 22.12+ 或 24+、Office 2016/365 桌面版、**独立版 CodeBuddy CLI**（官方产品：
`irm https://copilot.tencent.com/cli/install.ps1 | iex`，装完运行一次 `codebuddy` 完成登录；
Windows 版 WorkBuddy 不自带 CLI，无需安装 WorkBuddy）。生图/抠图另需 API key（获取路径见上文）。

**方式一（推荐）：让 AI 代跑** —— 打开 [`_windows/AI-INSTALL-PROMPT.md`](_windows/AI-INSTALL-PROMPT.md)，
把提示词整段发给 Windows 电脑上的 AI 助手，按引导完成。

**方式二：手动** —— 按 [`_windows/README-WINDOWS.md`](_windows/README-WINDOWS.md)：

```powershell
cd _windows
.\install-codebuddy.ps1        # 写 API key + 部署 wrapper + 探测/代装 CLI
# 若刚装 CLI：运行一次 codebuddy 完成浏览器登录
# 重新打开 PowerShell，然后依次：
cd ..\LLM_in_Word;         .\install.ps1
cd ..\LLM_in_PowerPoint;   .\install.ps1
cd ..\LLM_in_Excel;        .\install.ps1
# 完全退出 Office 再重开
```

> Windows 版基于原项目的 Windows 安装体系（自签证书 / 注册表侧载 / 开机自启，全程无需管理员），
> 已做跨平台代码检查；Overleaf / PDF 扩展在 Windows 上的安装见各自 README。

## 目录说明

```
LLM_in_Word/          Word 套件（端口 8377）
LLM_in_PowerPoint/    PowerPoint 套件（端口 8387）
LLM_in_Excel/         Excel 套件（端口 8397）
LLM_in_Overleaf/      Overleaf 助手（Chrome 扩展 + Native Messaging）
LLM_in_PDF/           PDF/论文阅读助手（Chrome 扩展）
_windows/             跨平台适配层 + Windows 环境准备
  cbc-claude.js         CodeBuddy CLI 适配层（macOS/Windows 通用）
  install-codebuddy.ps1 Windows 一次性环境准备
  README-WINDOWS.md     Windows 详细安装/使用/排障
  AI-INSTALL-PROMPT.md  给 AI 助手代跑安装的提示词
```

## 使用速记

- **模块切换**：顶部「问答 / 改写 / 版式 / 图像」单击直达（Word/Excel 无版式页）
- **配图**：选中文字 →「图像」→「✨ 为选中内容配图」→ 得到可修改的中文画面描述 → 选风格、候选张数 →「生成预览」→ 点选一张 → 插入
- **抠图（PPT）**：选中幻灯片里的图片 → 点顶部「图像」→ 自动切到抠图页并载入 →「开始抠图」→「替换原图」（保位置保尺寸）或「插入为新图」
- **抠图（Word/Excel）**：复制图片 → 「图像」→ 抠图页 ⌘V 粘贴（或「从剪贴板读取」）→「开始抠图」→ 插入
- **模型**：面板右上角「设置」→ 后端 CodeBuddy (WorkBuddy) → glm-5.3 / glm-5.3-flash 等
- **更新**：`git pull` 后重跑对应套件 install.sh / install.ps1（幂等，自动备份旧版）；已装用户改了前端文件时重启 Office 即可
- **遇到故障**：查 **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)**（排障手册：症状速查表 + WorkBuddy 自动更新导致 CLI 断联的修复手册）。**WorkBuddy 桌面版自动更新后若聊天报错，先看这份文档**

## 安全说明

- API key 只存本机 `~/.codebuddy/api.key`，仓库中无任何密钥
- 本机服务仅监听 127.0.0.1；macOS 自签证书仅当前用户钥匙串信任，Windows 仅当前用户证书库
- 所有安装均 per-user，无需管理员权限

## License

MIT（继承自上游 [ZJU-OmniAI/LLM_in_Work](https://github.com/ZJU-OmniAI/LLM_in_Work)）
