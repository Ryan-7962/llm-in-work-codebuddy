# AI 安装提示词（粘贴给 Windows 电脑上的 AI 助手执行）

> 使用方法：把仓库 clone（或安装包 zip 解压）到 Windows 电脑任意目录（如 D:\llm-in-work-codebuddy），
> 把下面整段提示词发给本机 AI 助手，AI 会代跑全部安装步骤。
> 需要用户本人操作的只有两件：① 提供自己的 CodeBuddy API key（可跳过）；
> ② CLI 首次登录（浏览器认证，必须本人完成）。
> API key 获取路径：WorkBuddy → 个人信息 → 管理中心 → 访问密钥 → 获取 CodeBuddy 的 API（ck_ 开头）。

---

请帮我安装本目录里的 LLM_in_Work × CodeBuddy Office 加载项（Word / PowerPoint / Excel 三件套）。请严格按以下步骤执行，每步完成后向我汇报结果再进行下一步：

【第 0 步·环境检查】
1. 检查 Node.js：运行 `node -v`。要求 22.12+ 或 24+。没有就先从 https://nodejs.org 安装 LTS 版再继续。
2. 检查独立版 CodeBuddy CLI：运行 `codebuddy --version`。
   - 已安装 → 跳到第 2 步（若从未登录过，提醒我稍后运行一次 codebuddy 完成浏览器登录）。
   - 未安装 → 询问我是否现在安装（这是腾讯官方 CLI，二选一）：
     a. 官方安装器（推荐，无需 Node）：irm https://copilot.tencent.com/cli/install.ps1 | iex
     b. npm 方式：npm install -g @tencent-ai/codebuddy-code
   - 注意：**不要去找 WorkBuddy 安装目录里的 CLI，Windows 版 WorkBuddy 不带 codebuddy.exe**（已实测确认）。

【第 1 步·环境准备】
进入仓库（解压目录）的 _windows 子目录，运行：
  powershell -ExecutionPolicy Bypass -File .\install-codebuddy.ps1
它会提示粘贴 CodeBuddy API key（ck_ 开头）。如果我不知道 key 在哪，告诉我获取路径：
WorkBuddy → 个人信息 → 管理中心 → 访问密钥（网页端即可，不必装 WorkBuddy 客户端）。
直接回车可跳过——聊天功能不受影响（走 CLI 自身登录态），仅生图/抠图不可用。
如果第 0 步 CLI 探测有问题，可改用：
  powershell -ExecutionPolicy Bypass -File .\install-codebuddy.ps1 -CodebuddyBin "<codebuddy 可执行文件完整路径>"
脚本最后必须显示 [OK] wrapper 已部署，且环境变量写入成功。

【第 2 步·CLI 登录确认】
如果 codebuddy 从未登录过：运行 `codebuddy --version` 能出版本号即可；正式使用前需本人运行一次
`codebuddy` 交互模式并按提示完成浏览器登录（国内站/企业域名按我自己的账号情况选）。
登录状态与 API key 无关：聊天 = CLI 登录态，生图/抠图 = API key。

【第 3 步·安装三个套件】
重新打开一个新的 PowerShell 窗口（让用户级环境变量生效），然后依次运行：
  cd <目录>\LLM_in_Word;       .\install.ps1
  cd <目录>\LLM_in_PowerPoint; .\install.ps1
  cd <目录>\LLM_in_Excel;      .\install.ps1
每个脚本都会：生成本机 HTTPS 证书（如果弹出系统证书确认框，帮我点"是"）、安装后台服务、注册 Office 加载项。任何一个失败就把完整报错和 %LOCALAPPDATA%\LLM_in_*\server.log 的最后 50 行发给我，不要自己猜测修复。

【第 4 步·验收】
1. 逐个验证服务：浏览器或 curl 访问
   https://localhost:8377/api/ping   （Word）
   https://localhost:8387/api/ping   （PowerPoint）
   https://localhost:8397/api/ping   （Excel）
   三个都应返回 {"ok":true,...}。
2. 检查开机自启：确认 Startup 文件夹里有 LLM_in_Word/PowerPoint/Excel 三个 .lnk。
3. 提醒我：完全退出 Office（所有 Word/PPT/Excel 进程，不是关窗口）再重新打开。

【第 5 步·使用引导】
安装成功后告诉我：
- Word/PPT/Excel 的「开始」功能区右侧会有 LLM_in 按钮，点击打开面板
- 面板右上角「设置」里后端选 CodeBuddy，模型选 glm-5.3（可选模型以实际列表为准）
- 图像功能：顶部「图像」tab → 插图（文生图/为选中内容配图）或抠图（PPT 里选中图片后进入自动载入）
- 完整说明在 _windows\README-WINDOWS.md，排障手册在仓库根 TROUBLESHOOTING.md

【注意事项】
- 全程不需要管理员权限；如果某步要求提权，停下来告诉我。
- 不要修改任何源码文件；如果安装失败，先看日志再向我汇报。
- 公司代理：如果本机有 HTTP 代理，install.ps1 会自动继承；若 API 连不上（workbuddy.cn），检查代理是否放行。
