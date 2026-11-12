> 组员协作包：请先阅读 [组员交接说明](组员交接说明.md)。本包附已构建前端，但不附 Python 环境或 EXE；首次使用需安装依赖。双击启动版与 F5 开发版使用独立数据库。

# SpendWise v3.0

本机 Agent 增量版：双击 `start-agent.cmd` 即可使用。新增打开时简报、重要消费变化提醒和独立 AI 授权。独立数据在本目录 `data/`，不迁移旧版账本；详见 [Agent 使用与数据说明](AGENT-README.md)。下文保留原版协作启动说明。

个人与家庭财务决策工作台。项目分为 `frontend`（React）和 `backend`（FastAPI）。这份交付包只含源码、迁移、测试、配置模板、设计资料和虚构演示数据；每位成员首次启动时会建立自己的本地数据库，若检测到旧版数据则会自动迁移并继续使用。

## 在 VS Code 启动（Windows）

先安装 Python 3.12、Node.js 20、VS Code 的 Python 扩展。把**解压后的 `SpendWise` 文件夹**作为工作区打开，然后在 VS Code 终端执行：

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e '.[dev]'
cd ..\frontend
npm ci
```

回到“运行和调试”，选 **SpendWise 前后端**，按 F5。这个启动项会先升级本地 SQLite 数据库，再启动后端和前端。打开 <http://localhost:5173> 注册自己的账号。`npm ci` 如果调用了旧版 Node，请先用 `node --version` 确认终端正在使用 Node 20。

双击打包版 `SpendWise-v3.0.exe` 时，账号、账单、预算、分类规则、AI 连接和对话会保存在 `%LOCALAPPDATA%\SpendWise\`。升级或重新打开程序会继续使用同一数据库；旧版 `%LOCALAPPDATA%\SpendWise-v3.0\` 或项目内 `backend\spendwise-dev.db` 会在首次启动时自动迁移。如果检测到旧数据库已有表但缺少迁移版本，启动器会先生成备份，再从已识别的版本继续升级，避免重复建表。

VS Code 启动项要求 `node` 能在终端的 PATH 中找到。后端虚拟环境固定在 `backend/.venv`，因此依赖安装在项目所在的磁盘。

当前 Windows 工作区使用项目内 `.tooling/node-v22.16.0-win-x64/node.exe` 启动前端，避免系统旧版 Node 干扰；新开的 VS Code 终端也会优先使用它。该目录不提交到 Git，新副本需先下载并解压对应的 Node.js Windows x64 ZIP 到 `.tooling/`，或将 `.vscode/launch.json` 的 Windows `runtimeExecutable` 改为本机 Node 20+ 路径，并同步调整 `.vscode/settings.json` 中的 PATH。Python 虚拟环境与 `node_modules` 同样需要每台电脑单独安装。修改配置后关闭旧终端，再新建终端。

## 用终端分别启动

如果不使用 F5，先在 `backend` 中执行数据库迁移并启动 API：

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

另开终端，在 `frontend` 中执行 `npm run dev`，然后打开 <http://localhost:5173>。macOS/Linux 使用 `python3.12 -m venv .venv` 和 `.venv/bin/python`，其余命令相同。

## 用 Docker Compose 启动完整栈

在项目根目录把 `.env.example` 复制为 `.env`，根据自己的环境修改数据库密码和连接串，再运行：

```powershell
Copy-Item .env.example .env
docker compose up --build -d
```

此模式启动 PostgreSQL、Redis、API、后台任务和前端；访问 <http://localhost:5173>。示例配置中的 `spendwise` 是仅供本机演示的数据库密码，不能直接用于公网部署。停止服务用 `docker compose down`；不要在仍需保留数据时执行 `docker compose down -v`。

## 演示与协作

- `sample-data/` 是虚构账单。先注册账号，再在 `backend` 运行 `.\.venv\Scripts\python.exe -m scripts.seed --owner-email "你的注册邮箱"`，可填充演示数据。请勿在真实账本账号上运行种子命令。
- DeepSeek API Key 由每个账号在“设置 → DeepSeek 连接”中自行填写。交付包**不含**任何真实 API Key、AI 加密主密钥、用户数据库或上传的账单。不要把 `.env`、`backend/*.db`、`backend/ai-key/`、`backend/uploads/` 提交或发给他人。
- 家庭组功能从顶部“家庭组”进入；创建或加入家庭后，左侧才显示家庭菜单。页面和数据授权边界见 [FEATURE_PARITY.md](FEATURE_PARITY.md)；目录职责与改动流程见 [AGENTS.md](AGENTS.md)。
- 后端测试：在 `backend` 执行 `.\.venv\Scripts\python.exe -m pytest -q`。前端检查：在 `frontend` 执行 `npm run build` 和 `npm run lint`；浏览器测试执行 `npm run test:e2e`，它会使用独立测试数据库。

如果迁移本机旧版账本，请**在自己的电脑上**备份原数据库和 `backend/ai-key/fernet.key`，不要放入团队压缩包。旧数据认领和迁移方式见 [FEATURE_PARITY.md](FEATURE_PARITY.md) 及 `backend/scripts/`。当前课程版本未实现邮箱归属验证和忘记密码后的重置流程。
