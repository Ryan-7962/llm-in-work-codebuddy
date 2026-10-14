# LLM_in_Work × CodeBuddy — Windows 安装使用说明

把 CodeBuddy CLI 接入 Word / PowerPoint / Excel 的任务窗格：
AI 润色改写、上下文对话、**AI 生图（文生图/为选中内容配图）、抠图（去背景）**。

> **架构说明（重要）**：聊天/改写走本机 **独立版 CodeBuddy CLI**（腾讯官方产品，Windows 有官方安装包），
> 生图/抠图走 CodeBuddy API（ck_ key）。**不需要安装 WorkBuddy 桌面版**——实测 Windows 版 WorkBuddy
> 不自带 codebuddy.exe，请直接装独立版 CLI。
> macOS 版已在真实机器全链路验证；Windows 版安装体系来自原项目（自签证书/注册表侧载/开机自启），
> 首次安装如遇问题按文末排障表处理。

---

## 一、前置条件

| 条件 | 说明 | 缺了会怎样 |
|---|---|---|
| Windows 10/11 | 无需管理员权限，全部按当前用户安装 | — |
| Office 2016 / 365 桌面版 | Word + PowerPoint + Excel | 对应应用不可用 |
| Node.js 22.12+ 或 24+ | https://nodejs.org 装 LTS 版（bridge 服务需要） | 安装脚本直接报错 |
| **独立版 CodeBuddy CLI** | 官方安装器：`irm https://copilot.tencent.com/cli/install.ps1 \| iex`（推荐，无需 Node）；或 `npm install -g @tencent-ai/codebuddy-code`。装完运行一次 `codebuddy` 按提示浏览器登录 | 聊天/改写不可用；生图/抠图不受影响 |
| CodeBuddy API key（ck_ 开头，可选） | 获取路径：**WorkBuddy → 个人信息 → 管理中心 → 访问密钥**（网页端即可操作，不必装 WorkBuddy 客户端）。每人用自己的 key | 生图/抠图不可用 |

## 二、安装步骤（约 5 分钟）

```powershell
# 0) 解压安装包到任意目录，例如 D:\LLM_in_Work-cb，在解压目录打开 PowerShell

# 1) 环境准备：写 API key（可选）+ 部署适配层 + 探测/安装 CLI
cd _windows
.\install-codebuddy.ps1
# 找不到 CLI 时脚本会询问是否代跑官方安装器；也可手动指定：
# .\install-codebuddy.ps1 -CodebuddyBin "C:\...\codebuddy.exe 的完整路径"

# 2) 如刚安装 CLI：运行一次 codebuddy，按提示完成浏览器登录（聊天功能的认证）

# 3) 关闭当前 PowerShell，重新打开一个（让环境变量生效），然后依次：
cd ..\LLM_in_Word;         .\install.ps1
cd ..\LLM_in_PowerPoint;   .\install.ps1
cd ..\LLM_in_Excel;        .\install.ps1
# install.ps1 会：生成并信任本机 HTTPS 证书（可能弹一次系统确认框，点"是"）
#                安装后台服务到 %LOCALAPPDATA%\LLM_in_* 并加入开机自启
#                在 Office 注册开发人员加载项

# 4) 完全退出 Office（不是关窗口，是退出程序）再重新打开
#    Word：「插入」→「我的加载项」→「开发人员」区域 → LLM_in_Word
#    PPT / Excel 同理（LLM_in_PowerPoint / LLM_in_Excel）
#    之后「开始」功能区右侧会有 LLM_in 按钮，点击开合面板
```

**只用其中一个应用也行**，只跑对应目录的 install.ps1 即可。三个服务端口固定：Word 8377 / PPT 8387 / Excel 8397。

## 三、功能与用法

| 功能 | 操作 | 说明 |
|---|---|---|
| AI 改写/润色/对话 | 选中文字 → 面板里下指令 | 走本机 CodeBuddy CLI，模型可选 glm-5.3 / glm-5.3-flash 等 |
| 插图（直接出图） | 面板「图像」→ 插图 tab → 输入画面描述 → 生成预览 → 点选插入 | 约 5.7 credits/张，默认一次 2 张候选 |
| 插图（上下文配图） | 选中 PPT/文档里的文字 →「图像」→「✨ 为选中内容配图」→ 得到可修改的中文画面描述 → 生成 | AI 自动把选中文本转为六要素中文提示词 |
| 抠图（PPT 内图片） | **选中幻灯片里的图片 → 点「图像」→ 自动切到抠图页并载入 → 点「开始抠图」** | 输出透明背景 PNG；「替换原图」保位置保尺寸直接替换 |
| 抠图（任意图片） | 复制图片（Ctrl+C）→ 面板里 Ctrl+V 粘贴 / 点「📋 从剪贴板读取」/ 拖入 / 上传 | Word/Excel 里没有"读取文档内选中图片"的接口，走这条路径 |

## 四、常见问题（排障）

| 现象 | 原因与处理 |
|---|---|
| 面板空白/加载失败 | 证书未信任。重跑对应套件的 install.ps1（幂等），或看 `%LOCALAPPDATA%\LLM_in_*\server.log` |
| 聊天报"未找到 CLI" | 独立版 CLI 未安装/未登录。装：`irm https://copilot.tencent.com/cli/install.ps1 \| iex`；登录：运行一次 `codebuddy`；然后重跑 `_windows\install-codebuddy.ps1` 和套件 install.ps1 |
| 聊天报 CLI 报错（退出码非 0） | 先看 `TROUBLESHOOTING.md`（WorkBuddy/CLI 更新适配手册）；再手动复现：`node %USERPROFILE%\.llm_in_codebuddy\cbc-claude.js -p "回复正常" --output-format text` |
| 生图/抠图报"未找到 api.key" | `%USERPROFILE%\.codebuddy\api.key` 不存在或不是 ck_ 开头。重跑 install-codebuddy.ps1 粘贴 key |
| 服务没起来 | 任务管理器搜 node；或手动：`powershell -File "%LOCALAPPDATA%\LLM_in_Word\app\tools\windows-service.ps1" -Action Start -Base "%LOCALAPPDATA%\LLM_in_Word"`；健康检查：浏览器开 `https://localhost:8377/api/ping` |
| 改了代码要更新 | `git pull` 后重跑对应套件 `.\install.ps1`（自动备份旧版），然后 Office 里关开面板 |
| 卸载 | 每个套件：删除 `%LOCALAPPDATA%\LLM_in_*`、Startup 里的 LLM_in_*.lnk、注册表 `HKCU:\Software\Microsoft\Office\16.0\WEF\Developer` 下对应项 |

## 五、已知限制

1. Windows 版已在同事机器上跑通安装；如遇新问题优先查 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)。
2. 独立版 CLI 的模型列表与 macOS 内嵌版可能略有差异，面板里「设置」看到的可选模型以 CLI 实际返回为准。
3. Word/Excel 中抠图不能用"选中文档内图片"（Office JS API 限制，仅 PowerPoint 支持 `getImageAsBase64`），用复制→粘贴。
4. 生图/抠图消耗的是 CodeBuddy 账户 credits（约 5.7/张，默认 2 张候选）；聊天走 CLI 登录态。

---
*适配层：cbc-claude.js（清理 WorkBuddy 会话环境变量 + 模型别名映射 + CLI 双来源探测）；
本机服务：Node.js HTTPS（127.0.0.1，自签证书仅当前用户信任）；加载项：Office 开发人员目录侧载（per-user）。*
