<div align="center">

# Codify

<img src="../../codify.png">

**面向智能体的工作流工具——从小而简单的项目到庞大复杂的代码库。**

纯 C11 实现。一个二进制文件。一个 SQLite 数据库。所有数据不出本机。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../../LICENSE)
[![Language: C11](https://img.shields.io/badge/Language-C11-lightgrey.svg)](#)
[![CI](https://img.shields.io/badge/CI-passing-brightgreen.svg)](../../.github/workflows/ci.yml)

[English](../../README.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [हिन्दी](README.hi.md) · [العربية](README.ar.md) · [Français](README.fr.md) · [Português (BR)](README.pt-BR.md)

</div>

---

## 概述

Codify(命令为 `cg`)是一个装在单个二进制文件里的智能体工作流引擎。它维护着代码本身之外、项目最需要的三样东西——代码**是什么**、它是**如何走到今天**的、以及**接下来**要做什么——并将这三者同时提供给人类和 AI 智能体。

**代码是什么。** Codify 将 19 种语言索引成一个可查询的图:符号、调用边、框架感知的路由,以及即时全文检索,全部本地存储在 SQLite 中。`cg context <query>` 一次调用即可回答"帮我快速了解这一块":入口点、匹配的符号及代码片段、调用者、被调用者,以及相关路由。

**它是如何走到今天的。** 内置的内容寻址快照系统提供提交、历史、差异和恢复能力,无需任何外部版本控制系统。由于快照与图共享同一个数据库,`cg changes` 能报告未提交修改的影响范围,`cg changelog` 能自动写出符号级的发布说明。

**接下来做什么。** 一个 spec 引擎将纯文本 kvx 规格文件转化为可执行的计划:带依赖波次(wave)的任务面板、同一时刻只允许一个任务进行中的纪律、附在每个任务上的验收标准——以及一个经过验证而非口头宣称的 `done`。任务的检查必须通过,它声称交付的符号和文件必须真实存在于图和历史中,Codify 才会将其标记为完成。

这三层相互增强:提交会自动打上其所实现任务的标签,`cg spec trace` 能从任意任务一路追溯到它的符号和提交,而内置的 MCP 服务器将这一切——共 15 个工具——暴露给 Claude Code、Cursor 以及所有支持 MCP 的智能体。

没有 API 密钥,没有后台服务,没有遥测。一切都在你的机器上运行,并且只留在你的机器上。

## 为什么选择 Codify

**它闭合了从计划到证明的回路。** 大多数工具要么规划工作(任务列表),要么描述代码(搜索、索引)。Codify 在同一个数据库上同时做这两件事,因此计划可以对照现实来核验:当一个任务声明它引入 `checkMode` 并涉及 `src/*.ts` 时,`cg spec done` 会在图和历史都确认之前拒绝将其标记为完成。

**智能体像工程师一样工作,而不是像游客。** 智能体无需逐个文件地漫游仓库,而是通过 `cg spec next` 询问该做什么,通过 `cg context` 获取该区域的全部信息,通过 `cg impact` 了解谁会被破坏——然后提交时自动附上任务归属。整个循环都可以通过 MCP 完成,智能体全程无需离开协议。

**上下文一次到位,而不是二十次往返。** `cg context <query>` 围绕智能体消费代码的真实方式设计。一次请求即可返回开始工作所需的全部信息:执行从哪里进入、匹配到什么、谁调用它、它调用谁,以及哪些路由与之相关。

**影响分析是一等命令。** `cg impact <name> -d 3` 沿调用者与被调用者的边进行传递性遍历,回答任何改动前最关键的两个问题:改了它谁会坏,它又依赖什么。

**搜索即时且分层。** 符号名上的 FTS5 三元组索引提供无需预热的、不区分大小写的子串匹配,文件正文上的词索引则覆盖其余的全文检索。

**索引永不过期。** `cg watch` 监听原生操作系统事件(Linux 上的 inotify,macOS 上的 FSEvents,Windows 上的 ReadDirectoryChangesW,统一封装在同一个平台层之后),带防抖地自动同步。MCP 工具调用在读取前也会先同步,因此连接的智能体查询到的永远是新鲜数据。

**它会适配所运行的硬件。** 启动时,`cg` 根据系统的真实情况来设定工作线程池和 SQLite 缓存的大小:容器感知的核心数(cgroup v1/v2 CPU 配额、亲和性掩码与在线 CPU 三者的交集)、真实可用内存(`MemAvailable` 与 cgroup 内存限制的交集),以及实测的单项目开销。16 核工作站会获得完整的并行流水线,2 核 VPS 则得到一条能够可靠跑完的流水线。运行 `cg info` 可以查看流水线的具体配置依据。

**一切留在本地。** 图存储在 `.codegraph/` 下的 SQLite 数据库中,快照是 `.codegraph/objects/` 下的内容寻址对象。删掉这个目录,所有痕迹随之消失。

## Codify 的一次会话

```sh
cg spec next                  # 下一个可执行任务,附验收标准
cg spec start 16.7            # 认领它——同一时刻只允许一个任务进行中
cg context "password auth"    # 一次调用获得入口点、符号、调用者、路由
cg impact verifyLogin -d 2    # 改了它谁会坏
# ……实现……
cg commit -m "add password auth"   # 快照,自动打上 [spec:ion_spec/16.7] 标签
cg spec done 16.7             # 运行任务的 verify_cmd 与图检查
cg spec trace 16.7            # 证明:任务 -> 符号 -> 文件 -> 提交
```

这个循环中的每条命令同时也是一个 MCP 工具,连接的智能体可以端到端地跑完全程——并且每一步在十个文件的小项目和 monorepo 中同样好用。

## 支持的语言与框架

**语言:** TypeScript、JavaScript、Python、Go、Rust、Java、C#、VB.NET、PHP、Ruby、C、C++、Swift、Kotlin、Erlang、Solidity、Svelte、Vue、Astro。

**框架感知的路由解析:** `cg` 可在 Express、Koa、Fastify、Hapi、NestJS、Next.js、SvelteKit、Flask、FastAPI、Django、Rails、Sinatra、Laravel、Spring、ASP.NET、Gin、Echo、Fiber、Chi、Actix 与 Axum 中,将 URL 模式关联到对应的处理函数。

## 安装

依赖:一个 C 编译器和 `libsqlite3-dev`。

```sh
make && sudo make install
```

然后在任意项目中:

```sh
cd your-project
cg init
```

## 命令参考

### 图

| 命令 | 说明 |
|---|---|
| `cg init` | 创建 `.codegraph/` 并构建初始索引 |
| `cg sync` / `cg index [--full]` | 增量或全量重建索引 |
| `cg search <q> [-n N]` | 符号与全文搜索 |
| `cg symbol <name>` | 定义、代码片段与引用计数 |
| `cg impact <name> [-d N]` | 传递性的调用者与被调用者 |
| `cg context <q>` | 面向智能体的一次性上下文包 |
| `cg routes [filter]` | URL 模式到处理函数的映射表 |
| `cg watch [--debounce MS]` | 基于原生文件系统事件的自动同步 |
| `cg info` | 机器画像与流水线配置报告 |

### 版本控制

快照采用 SHA-256 内容寻址,数据块自动去重。

| 命令 | 说明 |
|---|---|
| `cg commit -m <msg>` | 对工作树做快照 |
| `cg log` / `cg status` | 历史记录,以及工作树相对 HEAD 的状态 |
| `cg diff [A] [B]` | 快照之间或与工作树之间的 LCS 行级差异 |
| `cg checkout <id> [--force]` | 恢复某个快照 |
| `cg changes` | 未提交修改的影响半径:你改动的符号及其外部调用者 |

### 智能体相关

| 命令 | 说明 |
|---|---|
| `cg mcp` | 以 MCP stdio 服务器运行,提供 15 个工具:search、context、symbol、impact、routes、status、change-impact、log、commit,以及 spec 系列工具(status、next、start、done、render、trace) |
| `cg mcp-install` | 自动接入 Claude Code(`.mcp.json`)、Cursor、VS Code、Windsurf、Gemini CLI 与 Codex CLI,并合并进已有配置 |
| `cg changelog [-n N] [-o FILE]` | 基于快照生成变更日志,包含符号级差异:新增和删除的函数、新路由 |
| `cg agentmd [--write]` | 生成 `AGENTS.md` 与 `CLAUDE.md`:语言、目录结构、构建工具、入口点、路由,以及被引用最多的符号 |

所有查询命令都支持 `--json`。该参数加上 MCP 服务器,构成面向智能体的原生接口。

## Spec 工作流

Spec 工作流是 Codify 将特性计划转化为可追踪、可验证工作的方式。规格以纯文本 kvx 文件的形式存在——人类可读、可 diff、归属于你的仓库——Codify 将它们渲染为 IDE 规则文件和 markdown 镜像,并在其上驱动任务循环。它可以在任何包含 `spec/workflow.kvx` 的仓库中工作,完全独立于 `.codegraph/`,并且是 Ion 的 `spec/specgen` 的 C 语言直接替代品,输出逐字节一致。

| 命令 | 说明 |
|---|---|
| `cg spec render [--check]` | 重新生成 IDE 指针文件(Cursor、Devin、Claude、Codex、Copilot、Kiro)和 markdown 镜像(`requirements.md`、`design.md`、`tasks.md`);`--check` 在发现过期内容时以状态码 2 退出 |
| `cg spec` / `cg spec status` | 任务面板:数量统计、进度、当前进行中的任务与下一个可执行任务 |
| `cg spec next` | `requires` 已全部完成的、最低 wave 的待办任务,附执行要点和展开后的验收标准 |
| `cg spec start <id>` | 标记为 `in_progress`;强制同一时刻只能有一个任务且 `requires` 已满足,`--force` 可覆盖 |
| `cg spec done <id>` | 运行任务的 `verify_cmd` 与图检查(失败即拒绝,`--force` 可覆盖),标记为 `done`,并给出下一个任务建议 |
| `cg spec trace [<id>]` | 将任务追溯到代码:在图中解析出的已声明符号(位置、种类、引用数)、与实际改动匹配的涉及路径,以及打上该任务标签的提交 |

`start` 与 `done` 只重写 kvx 文件中那一行 `status = "..."`,其余每个字节、注释与空行都原样保留,随后静默重新渲染,保证 `tasks.md` 中的复选框始终最新。kvx 文件始终是唯一的事实来源,`-f <feature>` 可覆盖 `[meta] active_feature`。

`cg commit` 会自动在提交信息中附上进行中的任务标签,例如 `... [spec:ion_spec/16.7]`,因此 `cg log` 与 `cg changelog` 能将每个快照追溯到规格。六个 spec 命令同时以 MCP 工具的形式暴露,连接的智能体可以在协议内完成整个循环(next、start、实现、done)。

当项目同时拥有 `.codegraph/` 索引时,任务可以声明其实现应有的样子,`cg spec done` 会对照现实进行验证:

```ini
[task.2.1]
title   = "Check mode"
symbols = ["checkMode"]      # 必须存在于代码图中
touches = ["src/*.ts"]       # 必须有匹配的路径确实发生了改动
```

`symbols` 会在已建立的图中查找;`touches` 模式(精确路径或 glob)则与工作树改动和打上该任务标签的提交所改动文件的并集进行匹配——因此工作提交之后验证依然能通过。检查失败会拒绝完成(`--force` 可覆盖)。`cg spec trace [<id>]` 展示单个任务或整个特性的完整"任务→代码→提交"链条,支持文本或 `--json` 输出。

## VS Code 扩展

`editors/vscode/` 内置 Codify 扩展:为 `.kvx` 规格文件提供语法高亮,并在资源管理器中提供实时任务看板——任务按依赖波次分组并配有状态图标,可展开查看每个任务背后的图验证数据(符号及其位置、涉及的路径、打标签的提交),开始/完成操作直接执行真实的 `cg spec` 命令(包括检查失败时的拒绝),状态栏还有进度指示。扩展只是调用 `cg`,无需任何构建步骤:

```sh
cd editors/vscode
npx @vscode/vsce package        # 生成 codify-0.1.0.vsix
code --install-extension codify-0.1.0.vsix
```

详见 [editors/vscode/README.md](../../editors/vscode/README.md)。

## 开发

```sh
make             # 构建 ./cg            (依赖:C 编译器、libsqlite3-dev)
make unit        # C 单元测试           (tests/unit/*.c 链接 build/libcg.a)
make integration # 端到端 CLI 测试      (沙箱中运行 tests/integration/*.sh)
make test        # 全部
```

仓库结构:

```
src/                 每个模块一个 .c 文件;src/cg.h 是唯一的头文件
tests/unit/          kvx 语法、SHA-256 测试向量、JSON 扫描器、StrBuf/IO
tests/integration/   图、版本控制、智能体、MCP 协议、spec 引擎、文件监听
tests/fixtures/      多语言示例项目与带黄金输出的 spec 仓库
editors/vscode/      VS Code 扩展:kvx 语言 + 任务看板(纯 JS)
docs/ARCHITECTURE.md 各部分如何协同工作
```

spec 渲染的黄金输出由原始的 Go 版 specgen 生成,因此渲染一致性由 `make test` 锁定。CI 在每次 push 时通过 `.github/workflows/ci.yml` 构建并运行完整测试套件。

## 说明与限制

- 忽略规则由合理的默认值(VCS 目录、`node_modules`、构建产物、二进制文件)加上 `.cgignore` 文件(每行一个 glob)组成。
- 符号提取是启发式的。每种语言配有感知注释与字符串的模式引擎,针对定义与调用点的召回率进行调优,并非完整的类型检查解析器。
- 快照存储所有不超过 32 MB 的非忽略文件,包括二进制文件;图只索引不超过 8 MB 的文本文件。

## 社区

- [贡献指南](../../CONTRIBUTING.md)
- [安全策略](../../SECURITY.md)
- [行为准则](../../CODE_OF_CONDUCT.md)
- [维护者](../../MAINTAINERS.md)
- [如何引用](../../CITATION.cff)

## 许可证

MIT © [Sidiora Labs](https://sidiora.com)
