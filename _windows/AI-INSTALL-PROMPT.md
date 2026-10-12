# AI 安装提示词（粘贴给 Windows 电脑上的 WorkBuddy / Codex 等 AI 助手执行）

> 使用方法：把安装包 zip 拷到 Windows 电脑并解压（任意目录，如 D:\LLM_in_Work-cb），
> 打开 WorkBuddy/Codex，把下面整段提示词发给它，AI 会代跑全部安装步骤。
> 唯一需要用户本人操作的：提供自己的 CodeBuddy API key。
> 获取路径：WorkBuddy → 个人信息 → 管理中心 → 访问密钥 → 获取 CodeBuddy 的 API（ck_ 开头）。

---

请帮我安装解压目录里的 LLM_in_Work × CodeBuddy Office 加载项（Word / PowerPoint / Excel 三件套）。请严格按以下步骤执行，每步完成后向我汇报结果再进行下一步：

【第 0 步·环境检查】
1. 检查 Node.js：运行 `node -v`。要求 22.12+ 或 24+。没有就先从 https://nodejs.org 安装 LTS 版再继续。
2. 检查本机是否安装了 WorkBuddy：在 %LOCALAPPDATA%\Programs、%ProgramFiles% 下找 WorkBuddy 或 CodeBuddy 目录，并在其中递归查找 app.asar.unpacked 下的 codebuddy.exe。找到请记录完整路径。

【第 1 步·环境准备】
进入解压目录的 _windows 子目录，运行：
  powershell -ExecutionPolicy Bypass -File .\install-codebuddy.ps1
它会提示粘贴 CodeBuddy API key。如果我不知道 key 在哪，请告诉我获取路径：
WorkBuddy → 个人信息 → 管理中心 → 访问密钥 → 获取 CodeBuddy 的 API（ck_ 开头，每人用自己的）。
如果第 0 步找到了 codebuddy.exe，请改用：
  powershell -ExecutionPolicy Bypass -File .\install-codebuddy.ps1 -CodebuddyBin "<codebuddy.exe 完整路径>"
脚本最后必须显示 [OK] wrapper 已部署，且环境变量写入成功。

【第 2 步·安装三个套件】
重新打开一个新的 PowerShell 窗口（让用户级环境变量生效），然后依次运行：
  cd <解压目录>\LLM_in_Word;       .\install.ps1
  cd <解压目录>\LLM_in_PowerPoint; .\install.ps1
  cd <解压目录>\LLM_in_Excel;      .\install.ps1
每个脚本都会：生成本机 HTTPS 证书（如果弹出系统证书确认框，帮我点"是"）、安装后台服务、注册 Office 加载项。任何一个失败就把完整报错和 %LOCALAPPDATA%\LLM_in_*\server.log 的最后 50 行发给我，不要自己猜测修复。

【第 3 步·验收】
1. 逐个验证服务：浏览器或 curl 访问
   https://localhost:8377/api/ping   （Word）
   https://localhost:8387/api/ping   （PowerPoint）
   https://localhost:8397/api/ping   （Excel）
   三个都应返回 {"ok":true,...}。
2. 检查开机自启：确认 Startup 文件夹里有 LLM_in_Word/PowerPoint/Excel 三个 .lnk。
3. 提醒我：完全退出 Office（所有 Word/PPT/Excel 进程，不是关窗口）再重新打开。

【第 4 步·使用引导】
安装成功后告诉我：
- Word/PPT/Excel 的「开始」功能区右侧会有 LLM_in 按钮，点击打开面板
- 面板右上角「写作设置」里后端选 CodeBuddy (WorkBuddy)，模型选 glm-5.3
- 图像功能：点「图像」按钮 → 插图（文生图/为选中内容配图）或抠图（PPT 里选中图片后打开会自动载入）
- 完整说明在 _windows\README-WINDOWS.md

【注意事项】
- 全程不需要管理员权限；如果某步要求提权，停下来告诉我。
- 不要修改任何源码文件；如果安装失败，先看日志再向我汇报。
- 公司代理：如果本机有 HTTP 代理，install.ps1 会自动继承；若 API 连不上（workbuddy.cn），检查代理是否放行。
