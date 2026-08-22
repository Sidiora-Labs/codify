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

Codify(命令为 `cg`)是一个装在单个二进制文件里的智能体工作流引擎。它维护着代码本身之外、项目最需要的四样东西——代码**是什么**、它是**如何走到今天**的、**接下来**要做什么、以及一路走来**学到了什么**——并将这四者同时提供给人类和 AI 智能体。

**代码是什么。** Codify 将 19 种语言索引成一个可查询的图:符号、调用边、框架感知的路由,以及即时全文检索,全部本地存储在 SQLite 中。`cg context <query>` 一次调用即可回答"帮我快速了解这一块":入口点、匹配的符号及代码片段、调用者、被调用者,以及相关路由。

**它是如何走到今天的。** 内置的内容寻址快照系统提供提交、历史、差异和恢复能力,无需任何外部版本控制系统。由于快照与图共享同一个数据库,`cg changes` 能报告未提交修改的影响范围,`cg changelog` 能自动写出符号级的发布说明。

**接下来做什么。** 一个 spec 引擎将纯文本 kvx 规格文件转化为可执行的计划:带依赖波次(wave)的任务面板、同一时刻只允许一个任务进行中的纪律、附在每个任务上的验收标准——以及一个经过验证而非口头宣称的 `done`。任务的检查必须通过,它声称交付的符号和文件必须真实存在于图和历史中,Codify 才会将其标记为完成。

**一路走来学到了什么。** 智能体记忆将刻意留下的笔记——决策(`decision`)、约束(`constraint`)、结果(`outcome`)、偏好(`preference`)、事实(`fact`)——存储在与图相同的数据库中,并关联到写下它们时所在的任务。`cg remember` 在任务进行中保存一条记忆,每次 `cg spec done` 都会自动记录一条如实的结果(包括被拒绝的完成),而 `cg recall` 按相关性与新近程度排序,将这一切重新带回。

这几层相互增强:提交会自动打上其所实现任务的标签,记忆会浮现在它们所属的任务上,`cg spec trace` 能从任意任务一路追溯到它的符号、提交和记忆,而内置的 MCP 服务器将这一切——共 19 个工具——暴露给 Claude Code、Cursor 以及所有支持 MCP 的智能体。

没有 API 密钥,没有后台服务,没有遥测。一切都在你的机器上运行,并且只留在你的机器上。

## 为什么选择 Codify

**它闭合了从计划到证明的回路。** 大多数工具要么规划工作(任务列表),要么描述代码(搜索、索引)。Codify 在同一个数据库上同时做这两件事,因此计划可以对照现实来核验:当一个任务声明它引入 `checkMode` 并涉及 `src/*.ts` 时,`cg spec done` 会在图和历史都确认之前拒绝将其标记为完成。

**智能体像工程师一样工作,而不是像游客。** 智能体无需逐个文件地漫游仓库,而是通过 `cg spec next` 询问该做什么,通过 `cg context` 获取该区域的全部信息,通过 `cg impact` 了解谁会被破坏——然后提交时自动附上任务归属。整个循环都可以通过 MCP 完成,智能体全程无需离开协议。

**会话会遗忘,项目会记住。** 智能体的上下文窗口会重置,记忆表不会。用 `cg remember` 写下一次的决策,会自动迎接下一次会话——出现在 `cg spec next` 里、出现在 `cg spec start` 里、出现在会话开始时的 `cg recall` 里——而不必付出全价重新发现一遍。而且被拒绝的完成同样会被记录,"这个任务被卡了两次,原因在这里"只需一次查询。

**上下文一次到位,而不是二十次往返。** `cg context <query>` 围绕智能体消费代码的真实方式设计。一次请求即可返回开始工作所需的全部信息:执行从哪里进入、匹配到什么、谁调用它、它调用谁,以及哪些路由与之相关。

**影响分析是一等命令。** `cg impact <name> -d 3` 沿调用者与被调用者的边进行传递性遍历,回答任何改动前最关键的两个问题:改了它谁会坏,它又依赖什么。

**搜索即时且分层。** 符号名上的 FTS5 三元组索引提供无需预热的、不区分大小写的子串匹配,文件正文上的词索引则覆盖其余的全文检索。

**索引永不过期。** `cg watch` 监听原生操作系统事件(Linux 上的 inotify,macOS 上的 FSEvents,Windows 上的 ReadDirectoryChangesW,统一封装在同一个平台层之后),带防抖地自动同步。MCP 工具调用在读取前也会先同步,因此连接的智能体查询到的永远是新鲜数据。

**它会适配所运行的硬件。** 启动时,`cg` 根据系统的真实情况来设定工作线程池和 SQLite 缓存的大小:容器感知的核心数(cgroup v1/v2 CPU 配额、亲和性掩码与在线 CPU 三者的交集)、真实可用内存(`MemAvailable` 与 cgroup 内存限制的交集),以及实测的单项目开销。16 核工作站会获得完整的并行流水线,2 核 VPS 则得到一条能够可靠跑完的流水线。运行 `cg info` 可以查看流水线的具体配置依据。

**一切留在本地。** 图存储在 `.codegraph/` 下的 SQLite 数据库中,快照是 `.codegraph/objects/` 下的内容寻址对象。删掉这个目录,所有痕迹随之消失。

## Codify 的一次会话

```sh
cg recall auth                # 早前的会话对这一块做过哪些决定
cg spec next                  # 下一个可执行任务,附验收标准与相关记忆
cg spec start 16.7            # 认领它——同一时刻只允许一个任务进行中
cg context "password auth"    # 一次调用获得入口点、符号、调用者、路由
cg impact verifyLogin -d 2    # 改了它谁会坏
# ……实现……
cg remember "sessions rotate on login" --type decision   # 关联到任务 16.7
cg commit -m "add password auth"   # 快照,自动打上 [spec:ion_spec/16.7] 标签
cg spec done 16.7             # verify_cmd 与图检查,并记录结果记忆
cg spec trace 16.7            # 证明:任务 -> 符号 -> 提交 -> 记忆
```

这个循环中的每条命令同时也是一个 MCP 工具,连接的智能体可以端到端地跑完全程——并且每一步在十个文件的小项目和 monorepo 中同样好用。

## 支持的语言与框架

**语言:** TypeScript、JavaScript、Python、Go、Rust、Java、C#、VB.NET、PHP、Ruby、C、C++、Swift、Kotlin、Erlang、Solidity、Svelte、Vue、Astro。

**框架感知的路由解析:** `cg` 可在 Express、Koa、Fastify、Hapi、NestJS、Next.js、SvelteKit、Flask、FastAPI、Django、Rails、Sinatra、Laravel、Spring、ASP.NET、Gin、Echo、Fiber、Chi、Actix 与 Axum 中,将 URL 模式关联到对应的处理函数。

## 安装

Linux x86_64 — 一条命令即可安装(或更新)经校验和验证的静态二进制文件:

```sh
curl -fsSL https://codify.centra.ag/install | bash
```

卸载同样简单:`curl -fsSL https://codify.centra.ag/uninstall | bash`。各项目的 `.codegraph/` 数据不会被触碰。

其他平台请从源码构建(依赖:C 编译器和 `libsqlite3-dev`):

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

### 记忆

持久的智能体笔记,与图存储在同一个 SQLite 数据库中。在 spec 任务进行中写下的记忆会自动关联到该任务,`cg spec done` 也会自动记录结果。切勿在其中存储任何机密信息。

| 命令 | 说明 |
|---|---|
| `cg remember <text>` | 保存一条记忆——`--type decision\|constraint\|outcome\|preference\|fact`(默认 `fact`),`--task <feature/id>`(默认为进行中的 spec 任务),可选的 `--symbols` / `--files` 锚点 |
| `cg recall [query]` | 搜索记忆:对正文做全文检索,先按相关性再按新近程度排序;可用 `--task`、`--type`、`-n N` 过滤 |
| `cg forget <id>` | 删除一条记忆 |

### 智能体相关

| 命令 | 说明 |
|---|---|
| `cg mcp` | 以 MCP stdio 服务器运行,提供 19 个工具:search、context、symbol、impact、routes、status、change-impact、log、commit、spec 系列工具(status、next、start、done、render、trace、mode、implemented),以及记忆工具(remember、recall) |
| `cg mcp-install` | 自动接入 Claude Code(`.mcp.json`)、Cursor、VS Code、Windsurf、Gemini CLI 与 Codex CLI,并合并进已有配置 |
| `cg changelog [-n N] [-o FILE]` | 基于快照生成变更日志,包含符号级差异:新增和删除的函数、新路由 |
| `cg agentmd [--write]` | 生成 `AGENTS.md` 与 `CLAUDE.md`:语言、目录结构、构建工具、入口点、路由,以及被引用最多的符号 |

所有查询命令都支持 `--json`。该参数加上 MCP 服务器,构成面向智能体的原生接口。

## Spec 工作流

Spec 工作流是 Codify 将特性计划转化为可追踪、可验证工作的方式。规格以纯文本 kvx 文件的形式存在——人类可读、可 diff、归属于你的仓库——Codify 将它们渲染为 IDE 规则文件和 markdown 镜像,并在其上驱动任务循环。它可以在任何包含 `spec/workflow.kvx` 的仓库中工作,完全独立于 `.codegraph/`,并且是 Ion 的 `spec/specgen` 的 C 语言直接替代品,输出逐字节一致。

| 命令 | 说明 |
|---|---|
| `cg spec render [--check]` | 重新生成 IDE 指针文件(Cursor、Devin、Claude、Codex、Copilot、Kiro)和 markdown 镜像(`requirements.md`、`design.md`、`tasks.md`);`--check` 在发现过期内容时以状态码 2 退出 |
| `cg spec` / `cg spec status` | 任务面板:模式,分别统计 `done`、`implemented`、`in_progress` 与 `pending`,以及进度、当前任务与下一个可执行任务 |
| `cg spec mode <prod\|standard>` | 配置 Prod 模式及其依赖语义;缺失或未知模式按 standard 处理 |
| `cg spec next` | `requires` 已满足的、最低 wave 的待办任务(`standard` 仅接受 `done`;Prod 接受 `implemented` 或 `done`),附执行要点和展开后的验收标准 |
| `cg spec start <id>` | 标记为 `in_progress`;强制同一时刻只能有一个任务且 `requires` 已满足,`--force` 可覆盖 |
| `cg spec implemented <id>` | 在 Prod 中检查源代码证据而不执行 `verify_cmd`,然后标记为 `implemented`(未勾选;等待资格确认;不提供 `--force`) |
| `cg spec done <id>` | 从 `in_progress` 或 `implemented` 开始运行 `verify_cmd` 与图检查;只有资格确认通过才标记 `done`,失败时保留 `implemented` |
| `cg spec trace [<id>]` | 将任务追溯到代码:在图中解析出的已声明符号(位置、种类、引用数)、与实际改动匹配的涉及路径、打上该任务标签的提交,以及它的记忆 |

`mode`、`start`、`implemented` 与 `done` 只重写 kvx 文件中的 mode 或 `status = "..."` 行,其余每个字节、注释与空行都原样保留,随后静默重新渲染;`implemented` 任务保持未勾选并带有 `Implemented - qualification pending`。kvx 文件始终是唯一的事实来源,`-f <feature>` 可覆盖 `[meta] active_feature`。

`cg commit` 会自动在提交信息中附上进行中的任务标签,例如 `... [spec:ion_spec/16.7]`,因此 `cg log` 与 `cg changelog` 能将每个快照追溯到规格。八个 spec 命令同时以 MCP 工具的形式暴露,连接的智能体可以在协议内完成 standard 循环(next、start、snapshot、done)或 Prod 循环(next、start、snapshot、implemented、资格确认、done)。

当项目同时拥有 `.codegraph/` 索引时,任务可以声明其实现应有的样子。`cg spec implemented` 检查源代码证据但不执行命令;`cg spec done` 则针对现实执行资格确认:

```ini
[task.2.1]
title   = "Check mode"
symbols = ["checkMode"]      # 必须存在于代码图中
touches = ["src/*.ts"]       # 必须有匹配的路径确实发生了改动
```

`symbols` 会在已建立的图中查找;`touches` 模式(精确路径或 glob)则与工作树改动和打上该任务标签的提交所改动文件的并集进行匹配——因此工作提交之后验证依然能通过。在 Prod 中,`implemented` 可满足后续 `requires`,但尚未完成资格确认且不会显示为 `[x]`;资格确认失败时任务仍保持 `implemented`。`cg spec trace [<id>]` 展示单个任务或整个特性的完整"任务→代码→提交"链条,支持文本或 `--json` 输出。

这条工作流还会自行滋养记忆层。每次完成都会写下一条简洁的结果记忆——包括被拒绝的完成,让之后的会话能够看到某个任务曾被卡住以及原因。`cg spec next` 与 `cg spec start` 会打印与该任务相关的记忆(通过 id 关联,或与其标题匹配),`cg spec trace` 也会将它们纳入链条。驱动这个循环的智能体无需任何指示,就会逐步积累起项目记忆。

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

- [Codify 的由来](../../WHY.md)
- [贡献指南](../../CONTRIBUTING.md)
- [安全策略](../../SECURITY.md)
- [行为准则](../../CODE_OF_CONDUCT.md)
- [维护者](../../MAINTAINERS.md)
- [如何引用](../../CITATION.cff)

## 许可证

MIT © [Sidiora Labs](https://sidiora.com)
