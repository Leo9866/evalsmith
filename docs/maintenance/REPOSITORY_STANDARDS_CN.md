# EvalSmith 仓库管理标准

本文档定义 EvalSmith 开源仓库的强制管理标准。它用于日常开发、Codex 协助维护、Pull Request 审查、版本发布和敏感信息防护。

## 维护原则

- `main` 永远代表可公开展示、可安装、可运行的稳定状态。
- 任何功能、修复、文档更新都先进入工作分支，默认使用 `leo/<topic>`。
- 不允许提交真实密钥、内部资料、未脱敏截图、运行日志、构建产物和本地数据。
- 代码改动必须伴随对应检查结果；无法运行的检查必须说明原因。
- 面向用户的行为变化必须同步 README、使用文档或部署文档。

## 分支规范

| 分支 | 用途 | 规则 |
| --- | --- | --- |
| `main` | 稳定公开版本 | 只接受经过检查的合并，不直接做实验性改动 |
| `leo/feat-*` | 新功能 | 必须有说明、测试、截图或 API 示例 |
| `leo/fix-*` | 缺陷修复 | 必须说明根因、影响范围和回归验证 |
| `leo/docs-*` | 文档维护 | 必须检查 README/README_CN/usage 文档是否一致 |
| `leo/release-*` | 发布准备 | 必须完成 release checklist |

默认不在 `main` 上直接开发。首次开源首提交可以直接推送 `main`，之后应使用 PR 流程。

## 提交规范

提交信息使用 Conventional Commits：

```text
<type>: <short summary>
```

允许的 `type`：

- `feat`: 新功能
- `fix`: 修复缺陷
- `docs`: 文档
- `test`: 测试
- `refactor`: 不改变行为的重构
- `chore`: 维护、依赖、构建、仓库整理
- `security`: 安全加固

示例：

```text
docs: add GitHub maintenance standard
fix: retry transient trace reads in monitor service
chore: prepare open-source release
```

一个提交只做一类事情。不要把后端修复、logo、README、测试数据和格式化混在同一个提交中。

## PR 标准

每个 PR 必须包含：

- 变更摘要
- 背景或问题
- 影响范围
- 测试和检查结果
- 截图或录屏，若涉及 UI
- 文档更新说明
- 安全影响说明

合并前必须确认：

- `make open-source-check` 通过
- `npm run build --prefix web` 通过，若涉及前端
- 相关 Python 文件 `py_compile` 通过，若涉及 Python 服务或脚本
- 相关 Go/Python/SDK/前端测试已运行，或明确记录无法运行的原因
- `git diff` 中没有敏感信息、日志、构建产物和无关改动

## 敏感信息防护

禁止提交：

- 真实 API key、token、cookie、session、私钥、证书
- `.env`、`.env.*`、`*.pem`、`*.key`、`*.p12`、`*.pfx`
- 包含真实密钥的截图、录屏、终端输出或日志
- 公司内部域名、私有部署地址、客户数据、内部方案文档
- `logs/`、`out/`、`web/dist/`、`node_modules/`、`test-results/`

占位密钥统一使用：

```text
__REDACTED_SECRET__
```

Demo 登录口令只能用于本地 Docker Compose 试用环境。任何公网或共享部署都必须关闭 demo 账号，或覆盖默认口令。

## 本地检查命令

基础检查：

```sh
git status --short
make open-source-check
npm run build --prefix web
python3 -m py_compile services/monitor-service/app/service.py services/monitor-service/app/settings.py scripts/run_test_env_e2e.py
```

敏感信息扫描：

```sh
rg -l --hidden -S 'sk-[A-Za-z0-9_-]{20,}|OPENAI_API_KEY\s*=|api[_-]?key\s*[:=]\s*["'\\'' ]?[A-Za-z0-9_-]{20,}|token\s*[:=]\s*["'\\'' ]?[A-Za-z0-9._-]{20,}' . \
  -g '!web/node_modules/**' \
  -g '!web/dist/**' \
  -g '!.git/**' \
  -g '!logs/**' \
  -g '!out/**'
```

完整测试按影响范围追加：

```sh
make test-ci
```

## 发布标准

发布版本使用语义化版本：

```text
v0.1.0
v0.1.1
v0.2.0
```

发布前必须检查：

- README 和 README_CN 内容一致
- `docs/usage/README.md` 和 `docs/usage/README_CN.md` 可用于新用户安装
- `SECURITY.md`、`LICENSE`、`OPEN_SOURCE_NOTICE.txt` 存在
- Docker Compose trial 可启动
- Demo 账号说明清晰，并明确不适合公网部署
- Release notes 写清楚新增、修复、破坏性变更、升级步骤和已知问题

## Codex 维护规则

Codex 维护仓库时必须遵守：

- 先运行 `git status --short`
- 不覆盖用户未提交改动
- 不执行 `git reset --hard` 或 `git checkout -- <file>`，除非用户明确要求
- 不把真实密钥、聊天中的 key、截图中的 key 写入文件
- 提交前必须做开源检查和必要构建
- 推送前必须得到用户明确授权
- 每次修改后说明文件变化、测试结果、未完成风险

推荐给 Codex 的维护指令：

```text
在 /Users/albin/Documents/workspace/opensource/evalsmith 中，
基于 main 创建 leo/<topic> 分支，
完成 <任务>。
完成后运行 make open-source-check、npm run build --prefix web 和必要测试，
检查敏感信息，
提交并推送到 git@github.com:Leo9866/evalsmith.git。
```

