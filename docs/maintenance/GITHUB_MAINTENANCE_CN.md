# EvalSmith GitHub 维护规范

本文档用于维护 `git@github.com:Leo9866/evalsmith.git`。它覆盖开源发布、分支管理、提交规范、敏感信息防护、发布流程，以及如何让 Codex 协助长期维护项目。

## 仓库与分支

- GitHub 仓库：`git@github.com:Leo9866/evalsmith.git`
- 默认稳定分支：`main`
- 日常工作分支：`leo/<topic>`
- 修复分支示例：`leo/fix-monitor-retry`
- 文档分支示例：`leo/docs-open-source`
- 发布准备分支示例：`leo/release-v0.1.0`

`main` 只保存可以对外展示和发布的稳定版本。所有功能、修复、文档整理、发布准备都应先在 `leo/*` 分支完成，再通过合并进入 `main`。

## 提交前检查

每次准备提交前至少执行：

```sh
git status --short
make open-source-check
python3 -m py_compile services/monitor-service/app/service.py scripts/run_test_env_e2e.py
npm run build --prefix web
```

如果改动涉及后端服务、SDK 或前端交互，应按影响范围追加测试：

```sh
make test-ci
```

如果 `make test-ci` 因本地依赖、Docker 资源或网络问题无法完成，提交说明和 PR 描述必须明确写出未完成项和原因。

## 敏感信息规则

以下内容绝不能提交：

- 真实 API key、token、session、cookie、私钥、证书、数据库密码
- `.env`、`.env.*`、`*.pem`、`*.key`、`*.p12`、`*.pfx`
- 带真实密钥的截图、录屏、日志、终端输出
- 私有客户名称、公司内部地址、内部接口、未脱敏业务数据
- 本地运行目录，例如 `logs/`、`out/`、`web/dist/`、`test-results/`

提交前建议额外运行一次路径级敏感扫描：

```sh
rg -l --hidden -S 'sk-[A-Za-z0-9_-]{20,}|OPENAI_API_KEY\\s*=|api[_-]?key\\s*[:=]\\s*["'\\'' ]?[A-Za-z0-9_-]{20,}|token\\s*[:=]\\s*["'\\'' ]?[A-Za-z0-9._-]{20,}' . \
  -g '!web/node_modules/**' \
  -g '!web/dist/**' \
  -g '!.git/**' \
  -g '!logs/**' \
  -g '!out/**'
```

如果任何真实密钥已经出现在聊天、截图、日志或历史提交中，应立即在对应服务商控制台吊销并重新生成。即使仓库里没有提交，也应按泄露处理。

## 提交信息规范

建议使用简洁的 Conventional Commits：

- `feat: add dataset version diff`
- `fix: retry transient trace reads in monitor service`
- `docs: add GitHub maintenance guide`
- `chore: prepare open-source release`
- `test: add evaluator smoke coverage`
- `refactor: simplify trace query builder`

一个提交只做一类事情。不要把 logo、README、后端修复、测试数据和格式化混在同一个提交里，除非它们属于同一个发布准备任务。

## 首次上传流程

首次把当前本地项目推到空仓库时，按下面顺序执行：

```sh
git remote add origin git@github.com:Leo9866/evalsmith.git
git branch -M main
git status --short
make open-source-check
npm run build --prefix web
git add .
git status --short
git commit -m "chore: prepare open-source release"
git push -u origin main
```

如果 `origin` 已经存在，应先查看：

```sh
git remote -v
```

不要在没有确认远程地址的情况下覆盖已有远程配置。

## 日常维护流程

1. 从 `main` 拉取最新代码。
2. 创建 `leo/<topic>` 分支。
3. 完成代码或文档改动。
4. 执行开源检查、构建和相关测试。
5. 检查 `git diff`，确认没有无关文件和敏感信息。
6. 提交到当前分支。
7. 推送分支到 GitHub。
8. 创建 Pull Request，说明改动、测试结果和风险。
9. 合并后删除已完成分支。

推荐命令：

```sh
git switch main
git pull --ff-only origin main
git switch -c leo/<topic>
make open-source-check
npm run build --prefix web
git add <changed-files>
git commit -m "type: concise summary"
git push -u origin leo/<topic>
```

## 发布流程

发布版本建议使用语义化版本，例如 `v0.1.0`、`v0.1.1`、`v0.2.0`。

发布前检查清单：

- README、README_CN、使用文档和部署文档已同步
- `LICENSE`、`SECURITY.md`、`OPEN_SOURCE_NOTICE.txt` 存在且内容准确
- `make open-source-check` 通过
- `npm run build --prefix web` 通过
- 相关后端、SDK、前端测试已执行或明确记录无法执行的原因
- Docker Compose trial 可以启动，`http://127.0.0.1:8080/health` 返回正常
- Demo 账号仍然只用于本地体验，生产或公网部署默认不使用公开口令
- GitHub Release notes 写明新增能力、修复、破坏性变更和升级步骤

打 tag 示例：

```sh
git switch main
git pull --ff-only origin main
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

## GitHub 仓库建议设置

建议启用：

- Branch protection：保护 `main`
- Require pull request before merging：合并前必须 PR
- Require status checks：至少包含开源检查、前端构建和核心测试
- Secret scanning：启用密钥扫描
- Dependabot alerts：启用依赖安全提醒
- Discussions：可选，适合收集用户问题和路线反馈
- Issues labels：`bug`、`docs`、`enhancement`、`security`、`good first issue`、`help wanted`

建议不要把真实部署配置、私有镜像仓库凭证、公司内部环境说明写进公开仓库。

## 如何让 Codex 维护项目

以后可以直接用下面的格式给 Codex 下达任务：

```text
在 /Users/albin/Documents/workspace/opensource/evalsmith 项目中，
基于 main 创建 leo/<topic> 分支，
完成 <具体任务>。
完成后请运行 make open-source-check、npm run build --prefix web 和必要测试，
检查敏感信息，
然后提交并推送到 GitHub。
```

如果只想让我改代码但不提交，可以说：

```text
只修改本地文件，不要 git add、commit、push。
完成后给我变更摘要和测试结果。
```

如果需要我发布版本，可以说：

```text
准备 v0.1.0 发布：
检查 README、README_CN、docs、SECURITY、LICENSE，
跑开源检查和构建，
生成 release checklist，
但不要打 tag，等我确认。
```

如果要我直接推送，请明确授权：

```text
确认可以提交并推送到 git@github.com:Leo9866/evalsmith.git。
```

默认情况下，Codex 应先检查 `git status --short`，避免覆盖用户未提交的改动；不得执行 `git reset --hard`、`git checkout -- <file>` 等破坏性命令，除非用户明确要求。

