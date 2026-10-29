# 同事安装提示词（从 GitHub 拉取）

> 使用方法：把下面的提示词整段复制，发给本机的 WorkBuddy / Codex 等 AI 助手，按它引导完成。
> 仓库已公开，任何人都能直接 clone，无需 GitHub 账号。

---（以下为提示词正文，从横线下面开始复制）---

请帮我在本机安装 GitHub 上的 LLM_in_Work × CodeBuddy 办公工具（Word / PowerPoint / Excel 的 AI 助手面板 + AI 生图 + AI 修图 + 抠图）。请严格按步骤执行，每完成一步向我汇报结果再继续；任何一步失败，先看日志、把报错原文发给我，不要自行修改源码，也不要请求管理员/sudo 权限。

【第 0 步·确认前置（按平台）】
- macOS：确认已安装并登录 WorkBuddy（聊天功能走它内嵌的 CLI；生图/修图/抠图只需要 API key）。
- Windows：不需要 WorkBuddy（Windows 版不带 CLI）。聊天功能需要**独立版 CodeBuddy CLI**——
  检查 `codebuddy --version`，没有就装（irm https://copilot.tencent.com/cli/install.ps1 | iex），
  装完运行一次 codebuddy 完成浏览器登录。

【第 1 步·克隆仓库】
仓库是公开的，直接：
  git clone https://github.com/Ryan-7962/llm-in-work-codebuddy.git
Mac 建议装到 ~/llm-in-work-codebuddy，Windows 装到 D:\llm-in-work-codebuddy（任意目录均可）。
（如本机没有 git：Mac 先装 Xcode Command Line Tools（xcode-select --install），Windows 从 https://git-scm.com 下载安装。）

【第 2 步·按平台安装】
- Windows：打开仓库里的 _windows\AI-INSTALL-PROMPT.md，从它的【第 0 步】开始继续执行（那里面是 Windows 专用流程）。
- macOS：依次执行——
  a. 引导我获取 CodeBuddy API key：打开 WorkBuddy → 个人信息 → 管理中心 → 访问密钥，获取 CodeBuddy 的 API（ck_ 开头，用我自己的；用于生图/修图/抠图）。然后：
     mkdir -p ~/.codebuddy && echo "ck_我的key" > ~/.codebuddy/api.key && chmod 600 ~/.codebuddy/api.key
  b. 部署适配层：
     mkdir -p ~/.local/bin && cp _windows/cbc-claude.js ~/.local/bin/cbc-claude.js && chmod +x ~/.local/bin/cbc-claude.js
  c. 逐个安装我要用的套件（提前问我要装哪几个；默认 Word + PowerPoint + Excel）：
     cd LLM_in_Word       && LLM_IN_WORD_CLAUDE_BIN=~/.local/bin/cbc-claude.js ./install.sh
     cd ../LLM_in_PowerPoint && LLM_IN_POWERPOINT_CLAUDE_BIN=~/.local/bin/cbc-claude.js ./install.sh
     cd ../LLM_in_Excel   && LLM_IN_EXCEL_CLAUDE_BIN=~/.local/bin/cbc-claude.js ./install.sh
     注意：安装脚本第一次会弹 macOS 钥匙串密码框（信任本机自签证书），提前提醒我输入电脑密码。
     （Overleaf / PDF 是 Chrome 扩展，需要的话看仓库里各自目录的 README。）

【第 3 步·验收】
1. 健康检查（三个端口都应返回 {"ok":true,...}）：
   Word 8377 / PowerPoint 8387 / Excel 8397，浏览器访问 https://localhost:对应端口/api/ping
2. 提醒我：完全退出 Office（Mac 按 ⌘Q，Windows 从托盘退出所有 Office 进程）再重新打开。
3. 打开任一 Office 应用，「开始」功能区右侧应出现 LLM_in 按钮；点开面板，右上角「设置」里后端选 CodeBuddy、模型选 glm-5.3（可选模型以面板实际列表为准）。
4. 快速上手测试：PPT 里选中一段文字 →「图像」→「为选中内容配图 ✨」；或选中一张图片 →「图像」→「修图」→ 输入「把背景换成海边，主体保持不变」→ 预览后替换原图或插入新图；也可测试抠图。

【安全说明】
- 我的 API key 只存在本机 ~/.codebuddy/api.key，绝不写入 git 或发给任何人（包括你）。
- 以后更新：进入仓库目录 git pull，然后重跑对应套件的 install.sh / install.ps1（幂等，自动备份旧版）。
