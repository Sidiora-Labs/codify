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

1.1.0 版本(v11)让 fleet 变成了一个"交给它一份 spec 就可以放手"的东西:`cg fleet up` 启动一个持久、可在崩溃后恢复的监督进程(supervisor),同时运行主智能体、每个特性一个管理者、每个任务一个工作者,并管理每一个 Codex 或 Claude Code 进程,直到其工作通过资格确认并完成合并。智能体从图中获得简报,跨分支的漂移在合并前被捕获,每一次状态变化都写入事件日志,`cg serve` 通过一条连接将这一切推送给编辑器。它建立在 fleet 的基础之上:一个合并式的索引器取代五十个、Main Gideon / 特性管理者 / 工作者的层级结构及其分支、合并、PR 与检查点流程、跨所有分支和 worktree 的统一图,以及 Jev 决策——这个本地工具中唯一的远程调用。

**代码是什么。** Codify 将 19 种语言索引成一个可查询的图:符号、调用边、框架感知的路由,以及即时全文检索,全部本地存储在 SQLite 中。`cg context <query>` 一次调用即可回答"帮我快速了解这一块":入口点、匹配的符号及代码片段、调用者、被调用者,以及相关路由。在解析器所见之外,注释也被作为一等节点索引——即意图层:目的、契约、危险,以及只存在于文字中的耦合。

**它是如何走到今天的。** 内置的内容寻址快照系统提供提交、历史、差异和恢复能力,无需任何外部版本控制系统。由于快照与图共享同一个数据库,`cg changes` 能报告未提交修改的影响范围。`cg changelog` 负责写发布说明:默认基于 git 历史——每个 tag 或每次版本号变更对应一个发布,按提交标题前缀分组,保留每条任务引用;配置密钥后,每个发布还会附上一段由模型撰写的简短 Highlights——传入 `--snapshots` 或项目根本没有 git 时,则基于快照链生成符号级差异。

**接下来做什么。** 一个 spec 引擎将纯文本 kvx 规格文件转化为可执行的计划:带依赖波次(wave)的任务面板、附在每个任务上的验收标准——以及一个经过验证而非口头宣称的 `done`。`cg spec new` 与 `cg spec add` 创建计划,`cg spec lint` 证明它可执行,循环负责执行它。在 Prod 模式下,`implemented` 记录编码完成与源代码证据,但不宣称通过资格确认;只有 `done` 表示可执行的资格确认与图检查都已通过。在 parallel 模式下,多个智能体同时工作,边界由每个任务所声明路径的互不相交来保证。

**一路走来学到了什么。** 智能体记忆将刻意留下的笔记——决策、约束、结果、偏好、事实——存储在与图相同的数据库中,并关联到写下它们时所在的任务。`cg remember` 在任务进行中保存一条记忆,每次 `cg spec done` 都会自动记录一条如实的结果(包括被拒绝的完成),而 `cg recall` 按相关性与新近程度排序,将这一切重新带回。这几层相互增强:提交会自动打上其所实现任务的标签,记忆会浮现在它们所属的任务上,`cg why` 能把一个符号追溯到其背后的决策,`cg spec trace` 能从任意任务一路追溯到它的符号、提交和记忆。

**它不仅出现在步骤的起止处,也陪伴在步骤之间。** `cg work open` 以一个紧凑的任务包开始,`cg work update` 只返回新增的状态、证据与工作区增量,`cg event progress` 识别循环而不把"有活动"误当作"有进展",`cg guard` 会在编辑越出声明范围时察觉。内置的 MCP 服务器向所有支持 MCP 的智能体暴露 60 个工具以及资源和提示词,`cg integrate` 负责规划、应用并诊断各宿主的原生配置。

**它不仅服务智能体,还能驱动智能体。** `cg handoff` 与 `cg resume` 让任务在会话之间转移而不丢失状态,`cg spec claim-next` 以原子方式把下一个无冲突的任务交给空闲的智能体,`cg spec run` 则把整个 wave 分发给 Codex CLI 或 Claude Code 会话——每个已认领任务一个沙箱子进程,日志和提示词落盘,失败时释放租约。

**它扛得住一整支 fleet。** 索引是共享资源,而非每个进程各自的习惯:第一个需要索引的 `cg` 负责执行,其余的留下一条记录并合并进去,新鲜度窗口可以完全跳过遍历,机器级的解析槽位让并发的多个项目都保持在核心预算之内([docs/sync.md](../../docs/sync.md))。在此之上,`spec/workflow.kvx` 可以声明一个层级——拥有任务列表的主智能体、每个特性一个特性管理者、其下的 wave 工作者——由 `cg fleet` 驱动分支流程:worktree、向上合并、在测试与 lint 关卡之后落地、拉取请求、检查点。`cg fleet up` 在一个脱离终端的监督进程下独立运行整棵树——多个特性同时进行,管理者与其工作者同时存活,每个工作者在自己的 worktree 中——催促停滞的智能体,带着失败原因重试,升级无法挽救的问题,在你选择启用的审批关卡处停下,并且只在工作**合并**之后才报告完成,而不是在进程退出时([docs/hierarchy.md](../../docs/hierarchy.md))。杀掉监督进程后,`cg fleet up --resume` 会接管仍在运行的智能体。偏离 spec 的改动、相互冲突的任务、其他分支依赖的接口变化都会在合并前被标出([docs/drift.md](../../docs/drift.md)),每一次变化都是一个事件,可由 `cg events --follow` 与 `cg serve` 实时推送([docs/events.md](../../docs/events.md))。它们共享同一个图和同一份记忆:仓库的每个分支和关联 worktree 都索引进同一个 `.codegraph/`,按分支隔离([docs/branches.md](../../docs/branches.md))。

**需要做判断时,它会请求一个决策。** `cg jev` 调用 TypeSafe 的 System One 模型获取类型化的判断——真/假、多选一、排序。`cg memory classify` 用它判断哪些笔记是可复用的技能,`cg skills promote` 再将其渲染为可移植的 `.agents/skills/<slug>/SKILL.md`;失败的 `verify_cmd` 会得到一行分诊,`cg guard` 的发现会被排序,拉取请求会得到一个就绪度评分。这是 Codify 唯一的远程调用:对构建于其上的功能是必需的,对核心循环从不需要,并且从不具有权威性——Jev 的任何回答都从未改变过退出码([docs/jev.md](../../docs/jev.md))。

**文档是最后一个经过验证的任务。** 新的特性 spec 默认启用 `@docs` 收尾阶段。所有普通任务通过资格确认后,Codify 从 spec、按任务归属的快照、代码图、路由、记忆、检查结果和现有文档中构建一个有界的证据包,由同一个已配置的智能体连接器更新用户与开发者文档;`cg docs check` 检查声明的引用、本地内联链接、必需的图表面覆盖以及目标范围,`cg docs close` 记录一个专门的 `[spec:<feature>/@docs]` 快照和下一轮的增量基线。这些结构性检查辅助评审,但并不担保每句话的含义。

没有你未曾启动的后台服务,也没有遥测——fleet 监督进程只在 `cg fleet up` 之后运行,并随 `cg fleet down` 停止。图、记忆、快照以及整个任务循环都在你的机器上运行,并且只留在你的机器上。有两个明确列出且需主动启用的例外:Jev 决策需要 `OPENROUTER_API_KEY`,且只有构建于其上的命令才会发起这一调用;`cg changelog` 只有在设置了 `CENTRA_API_KEY`(或 `CG_CHANGELOG_KEY`)时才会请求模型生成发布亮点。

## 为什么选择 Codify

**它闭合了从计划到证明的回路。** 大多数工具要么规划工作(任务列表),要么描述代码(搜索、索引)。Codify 在同一个数据库上同时做这两件事,因此计划可以对照现实来核验:当一个任务声明它引入 `checkMode` 并涉及 `src/*.ts` 时,`cg spec done` 会在图和历史都确认之前拒绝将其标记为完成。

**智能体像工程师一样工作,而不是像游客。** 智能体通过 `cg spec next` 询问该做什么,通过 `cg context` 获取该区域的全部信息,通过 `cg impact` 了解谁会被破坏——然后提交时自动附上任务归属。整个循环都可以通过 MCP 完成。**会话会遗忘,项目会记住。** 用 `cg remember` 写下一次的决策,会自动迎接下一次会话——出现在 `cg spec next`、`cg spec start` 以及会话开始时的 `cg recall` 里。被拒绝的完成同样会被记录,"这个任务被卡了两次,原因在这里"只需一次查询。

**上下文一次到位,并且控制在预算之内。** `cg context <query>` 一次请求返回相关记忆、执行入口、匹配项、调用者、被调用者和相关路由——经过排序(真实定义优先于测试夹具,被调用的代码优先于死代码),并适配到 token 预算(`--budget`,默认 4000)。一个符号只完整打印一次,之后只以紧凑的 `name path:line` 出现,被预算裁掉的内容会以明确的省略计数告知,而不是悄悄丢弃。**影响分析是一等命令:** `cg impact <name> -d 3` 沿调用者与被调用者的边做传递性遍历,回答改动前最关键的两个问题:改了它谁会坏,它又依赖什么。

**搜索即时且分层,索引永不过期,也不会引发风暴。** 符号名上的 FTS5 三元组索引提供无需预热的、不区分大小写的子串匹配,文件正文上的词索引覆盖其余内容。`cg watch` 监听原生操作系统事件(inotify、FSEvents、ReadDirectoryChangesW,统一封装在同一平台层之后)并带防抖地自动同步,MCP 工具调用在读取前也会先同步。五十个智能体并不意味着五十个索引器:一个进程持有关卡并执行遍历,其余的留下脏记录并合并进去,新鲜度已满足的调用直接跳过,机器级槽位限制所有项目的解析线程总数。**它会适配所运行的硬件。** 启动时,`cg` 根据容器感知的核心数、真实可用内存和实测的单项目开销来设定工作线程池和 SQLite 缓存。16 核工作站获得完整的并行流水线,2 核 VPS 得到一条能够可靠跑完的流水线。运行 `cg info` 可查看具体配置依据。**一切留在本地:** 图存储在 `.codegraph/` 下的 SQLite 数据库中,快照是 `.codegraph/objects/` 下的内容寻址对象。删掉这个目录,所有痕迹随之消失。

## 意图层

解析器能看到符号、调用和路由,却看不到函数*为什么*存在、调用者必须保证什么,或者 `save_tasks` 必须在 `load_tasks` 读盘之后运行——代码库的这一半只存在于注释中。Codify 将其索引起来(完整约定见 [docs/ANCHORS.md](../../docs/ANCHORS.md)):**锚点(anchor)** 是通过"可推导性测试"的注释——*如果智能体读代码就能写出来,它就不是锚点*——有价值的四类是**目的**、**契约**、**危险**、**指针**。有锚点时,`cg context` 提供文档 + 签名而非函数体,同样的预算可容纳数倍的符号;`cg survey` 以读一个函数体的代价读一百个文件;锚点中的名称被解析为带标注的 `(soft)` 引用,覆盖解析器无法推导的跨语言与动态耦合;代码变了,对应文档就在 `cg check`、`cg guard` 和检索中被标为过期(只警告,不阻断);`cg anchors` 按协调度评分(扇出 × 范围 × 引用文件数)对未覆盖的符号排序,让补写从编排点开始。这些都不是必需的:从不采用该约定的仓库,依然能从现有注释中获得捕获、概览和软边。

## Codify 的一次会话

```sh
cg brief                      # 根目录、当前任务及验收标准、未提交的工作、先前的决策
cg spec next                  # 下一个可执行任务,附验收标准与相关记忆
cg spec start 16.7            # 认领它——同一时刻只允许一个任务进行中
cg context "password auth"    # 一次调用获得记忆、入口点、符号、调用者、路由
cg why verifyLogin            # 谁改过它、在哪个任务下、做了什么决定
cg impact verifyLogin -d 2    # 改了它谁会坏
# ……实现……
cg guard                      # 是否有改动越出任务 16.7 的声明范围?
cg test-impact                # 哪些测试覆盖了你刚改的内容
cg remember "sessions rotate on login" --type decision   # 关联到任务 16.7
cg review                     # 改动,以及它声称满足的验收标准
cg commit -m "add password auth"   # 快照,自动打上 [spec:ion_spec/16.7] 标签
cg spec done 16.7             # 资格确认:verify_cmd + 图检查;记录结果
cg spec trace 16.7            # 证明:任务 -> 符号 -> 提交 -> 记忆
```

当会话不得不在任务完成前停下——上下文窗口满了,或者一天结束了——工作也不会蒸发:

```sh
# 会话 A,提前停下
cg handoff --done "schema migration; token rotation" \
           --next "wire the login route; extend 03_auth test" \
           --blocked "flaky fixture on CI" -m "rotate on login, not refresh"

# 会话 B,几小时后,全新的上下文窗口
cg resume --prompt            # 可直接粘贴的块:任务、已完成步骤、阻碍、
                              # 下一步、未提交文件、租约状态
```

handoff 以结构化记忆的形式关联到任务,每条新的会取代上一条,因此 `cg resume` 看到的永远是最新状态。这个循环中的每条命令同时也是 MCP 工具;`cg check` 在 CI 中一步跑完整个关卡,`cg hook install` 接好同步与范围检查,让大部分工作无需手动调用。

## 支持的语言与框架

**语言:** TypeScript、JavaScript、Python、Go、Rust、Java、C#、VB.NET、PHP、Ruby、C、C++、Swift、Kotlin、Erlang、Solidity、Svelte、Vue、Astro。

**框架感知的路由解析:** `cg` 可在 Express、Koa、Fastify、Hapi、NestJS、Next.js、SvelteKit、Flask、FastAPI、Django、Rails、Sinatra、Laravel、Spring、ASP.NET、Gin、Echo、Fiber、Chi、Actix 与 Axum 中,将 URL 模式关联到对应的处理函数。

## 安装

Linux x86_64 — 一条命令即可安装(或更新)经校验和验证的静态二进制文件:

```sh
curl -fsSL https://codify.centra.ag/install | bash
```

卸载同样简单:`curl -fsSL https://codify.centra.ag/uninstall | bash`。各项目的 `.codegraph/` 数据不会被触碰。在已有项目上升级是安全的:数据库带有 schema 版本号,升级后首次打开时 `cg` 只重建派生的索引表(files、symbols、refs、routes、imports 以及搜索索引),下一次同步会重新填充它们。记忆、git 历史和租约绝不会因迁移而丢失。其他平台请从源码构建(依赖:C 编译器和 `libsqlite3-dev`),然后在任意项目中初始化:

```sh
make && sudo make install
cd your-project && cg init
```

## 命令参考

### 图

| 命令 | 说明 |
|---|---|
| `cg init [--nested]` / `cg branches` | 创建 `.codegraph/` 并构建初始索引(在已初始化仓库的关联 git worktree 中,则以当前分支加入共享图);列出索引进共享图的每个分支,及其 worktree、head、base 与文件数 |
| `cg sync [paths] [--max-age MS] [--background] [--wait MS]` | 增量索引:合并进已在运行的一轮、新鲜时跳过、只遍历指定路径。`cg index [--full]` 是总会遍历的阻塞形式 |
| `cg search <q> [-n N]` / `cg symbol <name>` | 符号与全文搜索;定义、代码片段与引用计数 |
| `cg impact <name> [-d N] [--budget N]` | 传递性的调用者与被调用者,适配 token 预算(默认 8000) |
| `cg context <q> [--budget N] [-n K]` | 面向智能体的一次性上下文包:记忆、符号、入口点、路由——前 K 个符号(默认 8),预算默认 4000,并给出明确的省略计数 |
| `cg survey [path\|query] [--budget N]` / `cg anchors [--stale] [--uncovered]` | 函数体之下的一层:每次约 100 个文件的目的行与带签名的文档,从不输出函数体(预算默认 16000);锚点健康度:代码已变化的文档,以及按协调度评分排序的未覆盖符号 |
| `cg routes [filter]` / `cg show <symbol\|path:line> [--full]` | URL 模式到处理函数的映射表;只看某个符号的函数体(按名称或编辑器光标位置) |
| `cg why <symbol>` / `cg test-impact [symbol]` | 来龙去脉:改过它的提交、实现的任务、记录的决策;引用某符号(或所有未提交改动)的测试 |
| `cg watch [--debounce MS]` | 基于原生文件系统事件的自动同步 |
| `cg root` / `cg info` | 解析到的项目根目录(`--json` 附带共享项目、worktree 标志与分支);机器画像、流水线配置与分支 |

### 版本控制

快照采用 SHA-256 内容寻址,数据块自动去重。Codify 的快照并不取代 git:`.gitignore` 与 `.cgignore` 一同生效,`cg git-sync` 读取真实历史,`cg commit --git` 两边同时写入,因此采用 Codify 从不是全有或全无。

| 命令 | 说明 |
|---|---|
| `cg commit -m <msg>` | 对工作树做快照;`--git` 同时生成一个带相同 spec 标签的真实 git 提交 |
| `cg log` / `cg status` / `cg diff [A] [B]` / `cg checkout <id> [--force]` | 历史与工作树状态;快照之间或与工作树之间的 LCS 行级差异;恢复某个快照 |
| `cg changes [--limit N]` | 未提交修改的影响半径:你改动的符号及其外部调用者(默认上限 40 个符号、每个 8 个调用者) |
| `cg git-sync [-n N]` | 导入 git 历史——提交、作者、每文件变动量——用于搜索和上下文排序 |
| `cg events [--since N] [--kind K,..] [-n N] [--follow [--for S]] [--head]` | 事件日志:按序号记录每一次任务、认领、尝试、智能体、fleet、监督进程、漂移和审批变化。`--kind` 接受逗号列表,末尾的 `.` 表示前缀(`fleet.`);`--follow` 实时推送;`--json` 每行一个对象。见 [docs/events.md](../../docs/events.md) |

### 变更日志

`cg changelog` 基于 git 历史生成发布说明。一个发布从某个 tag **或**项目版本号发生变化的那次提交开始——`src/cg.h` 中的 `CG_VERSION`、`VERSION` 文件或 `package.json`——所以从不打 tag 的项目也能每个版本得到一节。最后一个发布之后的内容,若工作树携带的版本号是新的(即正在准备的发布),就以它命名;也可用 `--tag NAME` 指定;否则才是 `[Unreleased]`。分组来自提交标题前缀,`cg commit` 追加的 `[spec:<feature>/<task>]` 会成为条目上的任务引用;链接来自 `git remote get-url origin`,没有 remote 时省略。

**Highlights。** 环境变量或项目 `.env` 中有 `CENTRA_API_KEY`(或 `CG_CHANGELOG_KEY`)时,每个发布会多出一个 `### Highlights` 块:两到五句话,大型发布再加几条要点,由模型根据该发布分组后的提交撰写。派生出的条目绝不会被修改,提示词也要求模型不得编造提交中没有的内容。`CG_CHANGELOG_ENDPOINT` 与 `CG_CHANGELOG_MODEL` 可指向任何兼容 OpenAI 的服务。回答按发布的提交和模型缓存在 `.codegraph/changelog-cache/` 下,重新生成时只询问有变化的发布。`--summarize` 强制启用(找不到密钥时会明确说明),`--no-summarize` 不调用模型,调用失败时在 stderr 打印 `highlights for <release> skipped — <why>` 并输出不含该段文字的说明。

`-n N` 限制发布节数,`-o FILE` 相对仓库根目录写入文件,`--unreleased` 只输出最新一节及其页脚行,`--tag 1.2.0` 将最新一节命名为 1.2.0、日期为今天。`--snapshots`——以及任何没有 `.git` 的项目——会退回到快照渲染器,输出每个快照的符号级差异。仓库根目录的 `cliff.toml` 是对应的 [git-cliff](https://git-cliff.org) 配置。本仓库的 `CHANGELOG.md` 由 `cg changelog -o CHANGELOG.md` 生成。

### 记忆

持久的智能体笔记,与图存储在同一个 SQLite 数据库中。在 spec 任务进行中写下的记忆会自动关联到该任务,`cg spec done` 也会自动记录结果。切勿在其中存储任何机密信息。被取代的记忆永远不会被删除——推翻本身就是值得保留的历史,它只是不再排在前面。

| 命令 | 说明 |
|---|---|
| `cg remember <text>` | 保存一条记忆——`--type decision\|constraint\|outcome\|preference\|fact`(默认 `fact`),`--task <feature/id>`,可选的 `--symbols` / `--files` 锚点,`--supersedes <id>` 用于废止被推翻的决策 |
| `cg recall [query]` | 搜索记忆:全文检索,先按相关性再按新近程度排序;可用 `--task`、`--type`、`-n N` 或 `--near <file>` 过滤 |
| `cg forget <id>` / `cg memory compact` | 删除一条记忆;合并重复的记忆(`--dry-run` 预览) |
| `cg memory classify [<id>\|--all\|--unclassified]` / `cg skills list\|promote <id>\|render` | 请 Jev 判断每条笔记属于 `skill`、`decision`、`constraint`、`fact` 还是 `noise`,连同置信度存入记忆(`-n N` 限制批量大小);被归为 `skill` 的记忆提升为 `.agents/skills/<slug>/SKILL.md`,并随源笔记保持更新 |

已分类的记忆在各处都带有类别(`cg recall` 中的 `class skill 0.82`、`cg brief` 中的 `[decision/skill]`);提升生成的文件带有 Codify 的归属标记,没有该标记的文件绝不会被覆盖。见 [docs/jev.md](../../docs/jev.md#memory-classification-and-skills)。

### 智能体相关

| 命令 | 说明 |
|---|---|
| `cg mcp` / `cg lsp` | 以 MCP stdio 服务器运行:60 个工具,外加资源和提示词;以语言服务器(stdio)运行——适用于所有编辑器,而不只是 VS Code |
| `cg serve` | 面向编辑器的一条 JSON-RPC 连接(stdio):所有 MCP 工具、任意 `cg` 命令(`exec`)、`cancel`,以及从某个序号开始、提交后数毫秒内推送的事件订阅。空闲时不持锁、不跑索引。见 [docs/events.md](../../docs/events.md#cg-serve) |
| `cg tool list \| call <name> [json]` | 在 shell 中直接运行一个 MCP 工具,无需 MCP 客户端 |
| `cg integrate detect\|plan\|apply\|doctor` | 面向 Codex、Claude Code、Copilot/VS Code、Cursor、Gemini CLI、OpenCode、Zed、Windsurf、Cline 与 Continue 的能力感知配置;plan 只读,apply 幂等且有备份。`cg mcp-install` 是 `cg integrate apply` 的兼容别名 |
| `cg hook install` / `cg hook post-edit` | 接入智能体与 git 钩子,让图保持新鲜、范围漂移自动浮现;post-edit 钩子每次编辑只做一次定向后台同步加一次 guard |
| `cg changelog [-n N] [-o FILE] [--unreleased] [--tag NAME] [--snapshots] [--summarize\|--no-summarize]` | 基于 git 历史的发布说明,设置 `CENTRA_API_KEY` 时每个发布附带模型撰写的 Highlights(见[变更日志](#变更日志));`--snapshots` 或无 `.git` 时改为基于快照链的符号级差异 |
| `cg agentmd [--write]` | 在 `.codify/agent-context.md` 生成图导览;根目录的 `AGENTS.md` 与 `CLAUDE.md` 仍归 `cg spec render` 所有 |

**智能体控制面。** Codify 明确区分四个相互独立的权威来源:Git 状态、Codify 快照状态、声明的 spec 状态和实时的受隔离尝试。`cg state` 将它们并列展示而不以其一证明其他;`cg spec reconcile` 诊断孤立的声明,只有加 `--repair` 才会修改。宿主钩子将 JSON 送入 `cg event ingest`,`cg event progress` 识别重复失败、重复观察、A-B 补丁振荡和无证据窗口;恢复措施有限且默认仅作建议,除非显式设置 `CG_PROGRESS_ENFORCE=1`。`cg work open` 将目标、标准、允许范围、状态、记忆、图上下文、测试和最新事件组成一个包,`cg work update` 只返回变化部分,`cg work close` 将每条标准与持久证据配对或标为未验证。集成全部执行本地 `cg`,运行记录留在 `.codegraph/graph.db`,不产生网络调用或遥测。

### 治理

这些命令让 Codify 出现在每一步,而不只是首尾。默认都只提供建议,只有 `--strict` 会让它们失败。所有查询命令都支持 `--json`;该参数、MCP 服务器与语言服务器构成面向智能体的原生接口。

| 命令 | 说明 |
|---|---|
| `cg brief` / `cg review` | 一次调用获取会话状态(根目录、当前任务及其标准、未提交路径、近期决策);改动与其声称满足的内容配对(改动的符号、受波及的调用者、验收标准) |
| `cg guard [paths] [--strict]` | 越出进行中任务在 `touches` 中声明范围的编辑 |
| `cg drift check <id> [--base REF] \| collisions \| coverage \| summary [-f F]` | 任务改动与其声明的 touches 和符号对比;同时运行会冲突的未完成任务;没有合格任务覆盖的验收标准;特性的漂移统计。只警告;见 [docs/drift.md](../../docs/drift.md) |
| `cg check [--strict]` | 唯一的 CI 关卡:渲染是否过期、spec lint、任务证据、认领一致性、工作树状态 |
| `cg state` / `cg event …` / `cg work …` | 分别标注各类状态;规范化宿主生命周期事件;打开、增量更新和关闭工作上下文 |
| `cg handoff` / `cg resume [--task <id>] [--prompt]` | 停下前记录会话状态(`--done "a;b"`、`--next "a;b"`、`--blocked "x"`、`-m <note>`、`--task <id>`,每条取代上一条);新会话接手任务所需的一切,`--prompt` 渲染为可直接粘贴的块 |

## Spec 工作流

Spec 工作流是 Codify 将特性计划转化为可追踪、可验证工作的方式。规格以纯文本 kvx 文件的形式存在——人类可读、可 diff、归属于你的仓库——Codify 将它们渲染为 IDE 规则文件和 markdown 镜像,并在其上驱动任务循环。它可以在任何包含 `spec/workflow.kvx` 的仓库中工作,完全独立于 `.codegraph/`,并且是 Ion 的 `spec/specgen` 的 C 语言直接替代品,输出逐字节一致。

| 命令 | 说明 |
|---|---|
| `cg spec new <feature>` / `cg spec add <id> --title T` | 创建 `spec/<feature>/spec.kvx`(必要时连同 `spec/workflow.kvx`)并设为当前特性;插入任务并保留其余每个字节 |
| `cg spec lint` / `cg spec render [--check]` | 校验计划(`requires` 环、指向未知任务的依赖、没有验收标准的任务、失效的 `touches` glob);重新生成 IDE 指针文件和 markdown 镜像。出错或过期时以 2 退出 |
| `cg spec` / `cg spec status` / `cg spec mode <prod\|standard\|parallel>` | 任务面板:模式,分别统计 `done`、`implemented`、`in_progress` 与 `pending`,当前任务、下一个任务与实时认领;配置依赖与并发语义(缺失或未知按 standard) |
| `cg spec wave` / `ready` / `claim <id>` / `release <id>` / `claim-next` | 当前 wave 或跨**所有** wave 的可执行任务(标出冲突);带所有者和过期时间的租约,不允许静默抢占;`claim-next` 原子认领第一个无冲突任务并返回完整任务包,前沿为空时以 3 退出 |
| `cg spec run` | 编排 parallel 或 Prod wave,每个槽位驱动一个智能体进程——见[驱动智能体](#驱动智能体) |
| `cg spec next` / `cg spec start <id>` | 最低 wave 且 `requires` 已满足的待办任务;标记为 `in_progress`(一次一个,`--force` 可覆盖) |
| `cg spec implemented <id>` / `cg spec done <id>` | Prod 中只检查源代码证据并标记 `implemented`;运行 `verify_cmd` 与图检查,通过才标记 `done` |
| `cg spec trace [<id>]` / `cg spec docs <status\|auto\|manual\|off\|start\|block\|reset>` | 将任务追溯到符号、改动路径、打标签的提交与记忆;查看或配置保留的 `@docs` 收尾阶段 |

这些命令只重写 kvx 文件中的 mode 或 `status = "..."` 行,其余每个字节、注释与空行都原样保留;kvx 文件始终是唯一的事实来源,`-f <feature>` 可覆盖 `[meta] active_feature`。`cg commit` 会自动附上进行中任务的标签(如 `[spec:ion_spec/16.7]`),spec 命令也都以 MCP 工具形式暴露(`spec_new`、`spec_add`、`spec_lint`、`spec_ready`、`spec_claim_next`、`spec_release`、`handoff`、`resume` 等)。

### 文档收尾

完整说明见 [Generate and maintain project documentation](../../docs/DOCUMENTATION.md)。`@docs` 是特性级工作,而非编号任务:在 `auto` 模式下,最后一个叶子任务通过资格确认后,`cg spec next` 与 `cg spec claim-next` 会返回它,由 `cg spec run` 通过同样的驱动、租约和失败恢复启动;`manual` 等待显式启动,`off` 跳过;没有 `[documentation]` 节的旧 spec 使用 `legacy` 行为。相关命令为 `cg docs status`、`plan`、`packet`、`check`、`trace`、`close`。智能体填写 `claims.kvx`,Codify 重新生成 `required.kvx`;检查器从不删除或重命名规范文档,也不接受配置目标之外的写入。这些检查确立结构上的依据,而非每句话的真实性。

### 并行模式

Standard 与 Prod 模式一次只运行一个任务,而如今一次派出五个甚至二十个智能体已很寻常,随之而来的失败总是同一种:两个智能体改同一批文件。`cg spec mode parallel` 保留 Prod 的 `implemented` 解锁语义,只放宽同时进行的任务数量——因为计划已声明每个任务的 `touches`,重叠在开工前就可知:`cg spec ready` 列出整个前沿并标出与实时认领的冲突,`cg spec claim 4.1 --agent alice` 取得带所有者和过期时间的租约,`cg spec claim-next --agent bob` 则直接原子认领第一个无冲突任务。`claim-next` 在文件锁和单个数据库事务中完成挑选与认领,二十个智能体同时调用会得到二十个互不相交的任务。租约会过期,持有租约后死掉的智能体不会卡住 wave。任务可声明 `symbols = ["checkMode"]`(必须存在于代码图中)与 `touches = ["src/*.ts"]`(必须有匹配的路径确实发生改动);`touches` 与工作树改动以及打上任务标签的提交所改文件的并集匹配——Codify 快照和消息带 `[spec:<feature>/<id>]` 的普通 **git** 提交都算,所以每个工作者可以在自己的分支上提交。

### Fleet 模式:智能体的层级

并行模式让二十个智能体不改同一批文件,Fleet 模式则给它们一个结构。`spec/workflow.kvx` 声明一个层级——拥有任务列表并合并 PR 的**主**智能体、每个特性一个拥有其分支的**特性管理者**、以及在从特性分支切出的分支上各实现一个 wave 的 **wave 工作者**——工作通过经过验证的合并向上流动。

```ini
[hierarchy]
enabled    = true
main       = "main"
remote     = "origin"
worktrees  = ".codegraph/worktrees"
test_gate  = "make test"
lint_gate  = "make cg CFLAGS='-O2 -Werror'"
pr         = "auto"          # auto | manual
checkpoint = "manual"

[role.worker]                # [role.main] 与 [role.feature] 同理;
branch  = "task/{feature}/{task}"  # 每个键都有默认值;
base    = "feature/{feature}"      # {task} 让每个任务拥有自己的分支
driver  = "codex"            # 其智能体如何运行,以及可花费多少
wall    = "3h"
stall   = "10m"
retries = 2
approve = ["land"]           # 主动启用:等待 `cg fleet approve`
```

| 命令 | 说明 |
|---|---|
| `cg fleet roles` | 当前配置的层级:分支模板、base、remote、关卡、PR 策略;未配置时显示默认值并标明 |
| `cg fleet status` | 谁以什么角色存活、在哪个任务上、隶属哪个上级 |
| `cg fleet plan [-f F]` | 哪个管理者拥有该特性、哪个工作者拥有各个 wave,计划分支与实时智能体并列 |
| `cg fleet tree [-f F]` | 实时的树——主、管理者、工作者——附各分支进度、是否领先 base 或已合并、每个工作者的尝试与心跳 |
| `cg fleet begin <id>` | 创建或复用从特性分支切出的 wave 分支与 worktree,并为其工作者认领任务;幂等 |
| `cg fleet merge-up <id>` | 将**已通过资格确认**的 wave 分支合并进特性分支;冲突按路径列出并中止合并,或用 `--keep` 保留 |
| `cg fleet land <feature>` | 将特性分支合并进本地 main 并运行测试与 lint 关卡;失败则重置 main,通过且策略为 `auto` 时开 PR;`--no-pr` 跳过 |
| `cg fleet pr <feature>` | 通过 `gh` 推送并针对 `<remote>/<main>` 开 PR,没有 `gh` 时打印确切命令;`--dry-run` 不调用任何东西 |
| `cg fleet checkpoint` | 按编号从小到大合并开着的 `feature/*` PR,遇到第一个无法合并的即停止 |
| `cg fleet up [-f F \| --all] [-n N] [--foreground] [--resume [RUN]] [--dry-run]` | 在脱离终端的监督进程下启动一次持久运行:主、管理者和工作者同时运行,直到每个任务通过资格确认并合并;`--resume` 继续未完成的运行,接管仍存活的智能体 |
| `cg fleet down [--drain] \| pause \| resume [RUN]` | 停止(释放认领、保留分支)、让进行中的工作先完成、冻结新进程的派生,或继续 |
| `cg fleet runs` | 各次运行、其状态以及监督进程是否存活 |
| `cg fleet approvals [--all] \| approve <id> [--reject] [-m note]` | 在主动启用的关卡(`land`、`pr`、`drift`、`coverage`)处等待的内容,以及放行它的决定 |
| `cg fleet steer <agent> <message>` | 给运行中的智能体发一条消息:在其下一次编辑时(Claude Code,通过 post-edit 钩子)或下一次提示时送达 |
| `cg fleet brief <feature>` | 特性管理者的简报:子树状态、存活的工作者、失败的尝试、冲突、审批 |

智能体在树中的位置存在其环境变量中——`CG_AGENT`、`CG_ROLE`、`CG_PARENT`、`CG_FEATURE`、`CG_WAVE`(以及指定 `gh` 二进制的 `CG_GH`)。没有 `CG_ROLE` 时不注册任何东西,单人会话不受影响。`cg fleet up` 独立驱动整棵树:脱离终端的监督进程运行你指定的每个特性(`--all`:所有还有工作的特性,各自在其 `[meta] requires` 完成后开始),管理者与其工作者同时存活,每个工作者在自己的 worktree 中:

```
$ cg fleet up --foreground --all -n 3
[fleet] alpha — manager + 3 worker slot(s), driver custom, 16 wake(s)
[fleet] worker w-alpha-2.1 → 2.1 (wave 1) on task/alpha/2.1, log .codegraph/agents/alpha-2.1.log
[fleet] worker w-alpha-2.2 → 2.2 (wave 1) on task/alpha/2.2, log .codegraph/agents/alpha-2.2.log
[fleet] worker w-alpha-2.1 task 2.1 exit 1 → INCOMPLETE
[fleet] worker w-alpha-2.1 → 2.1 (wave 1) on task/alpha/2.1, log .codegraph/agents/alpha-2.1.log
[fleet] worker w-alpha-2.2 on 2.2: no progress for 2s — nudged
[fleet] worker w-alpha-2.2 on 2.2: stalled — no progress for 2s after a nudge — stopping it
[fleet] beta — manager + 3 worker slot(s), driver custom, 16 wake(s)
[fleet] alpha complete — 4/4 task(s) qualified, feature/alpha merged into main, 2 failure(s)
[fleet] beta complete — 2/2 task(s) qualified, feature/beta merged into main, 0 failure(s)
```

- **运行是持久的。** 运行及其每个节点——角色、上级、任务、分支、worktree、pid、尝试、隔离标记、重试次数、花费——都存在数据库中。杀掉监督进程后,`cg fleet up --resume` 接管仍存活的智能体(按 pid 和启动时间核对)并保留重试计数。
- **监督。** 进展指的是实际工作——事件、日志输出、worktree 中的变化——而不是心跳。一个停滞窗口内没有进展会收到催促,第二个则带着 handoff 停止该尝试。`wall` 与 `spend` 预算会终止尝试;失败的任务带着失败原因重试,重试用尽后依次升级到管理者、主智能体,最终标记为 blocked,而运行的其余部分继续。
- **三个层级同时运行。** 特性合并锁取代轮流执行,管理者和工作者一起运行;使用 `{task}` 分支模板时,同一 wave 的任务在各自分支上并行,预测会冲突的任务对除外。`[hierarchy] main_agent = true` 让 Main Gideon 也作为进程运行。
- **来自图的简报。** 工作者的提示词包含其验收标准、所声明符号的当前定义及调用者与被调用者、前置任务在特性分支上的实际产出、兄弟任务正在改动的内容,并适配 token 预算;`cg work update` 报告尝试开始后上游合并进来的符号。
- **阻断需主动启用。** 列在角色 `approve` 中的关卡会让 `land`、`pr`、存在漂移的 `merge-up` 或验收标准未覆盖的 land 停下,直到 `cg fleet approve`。没有配置时,没有任何东西会等人。

子树的完成以**合并**为准,而非进程退出。`cg spec run --fleet` 是同样的运行在前台执行;没有启用 `[hierarchy]` 时 fleet 会在派生任何进程前被拒绝。完整流程、监督、审批、简报和示例见 [docs/hierarchy.md](../../docs/hierarchy.md);漂移见 [docs/drift.md](../../docs/drift.md);事件日志、`cg serve` 与 steering 见 [docs/events.md](../../docs/events.md)。

### 所有分支共用一个图

fleet 在同一仓库的多个 worktree、多个分支上工作,Codify 把它们全部索引进同一个 `.codegraph/`。关联 worktree 通过 git 的公共目录解析到共享项目,所以在那里运行 `cg init` 是**加入**,而不是新建数据库。文件行按分支隔离,新鲜度和索引关卡也按分支计算;已解析的内容按哈希复用,新 worktree 只需遍历和复制。查询默认回答当前分支,`--branch <name>` 查询其他分支,`--all-branches` 查询全部。记忆带有其所在分支,`cg fleet merge-up` 随代码一起把它们提升到 base;`cg watch --fleet` 用一个进程跟踪所有已注册的 worktree。详见 [docs/branches.md](../../docs/branches.md)。

### Jev 决策

有些问题不是确定性的——*这个失败是偶发还是真实的,这条记忆是可复用技能还是噪声,这些发现中哪个最重要。* `cg jev` 请 TypeSafe 的 System One 模型(`typesafe/jev-1.13`,经由 OpenRouter)给出类型化的回答:`noul`(为真的概率)、最多 255 个带标签选项的 `choice`,或有序的 `score`。它从不生成文本。

| 命令 | 说明 |
|---|---|
| `cg jev doctor [--probe]` | 密钥、curl、端点、模型与日志健康状况;`--probe` 发送一个极小的决策 |
| `cg jev ask [<request.json>\|-]` | 直接提问:`--state S`、`--noul N I`、`--choice N I --option K=D …`、`--score N I --level L …`,或完整请求体 |
| `cg jev log [-n N]` | `.codegraph/jev.log` 中最近 N 次调用,含请求 id、模型、token、花费和延迟 |

`cg spec done`(`verify_cmd` 失败时给出分诊)、`cg guard`(对发现评分排序)和 `cg fleet pr`(在 PR 正文中给出就绪度)会在自身结论旁附上 Jev 的回答。缺少 `OPENROUTER_API_KEY` 时,只在 stderr 提示一次,命令本身的结论和退出码不受影响。Jev 对构建于其上的功能是**必需的**——没有密钥时 `cg memory classify` 会明确报错,绝不悄悄降级——但**从不具有权威性**:它负责缩小范围、排序和标记,由 `verify_cmd` 和图检查做决定。密钥从不出现在命令行上,每次调用都有日志。见 [docs/jev.md](../../docs/jev.md)。

## 驱动智能体

上面的一切服务于已经存在的智能体。Codify 也可以负责启动它们:在终端中用 `cg spec run`,或在 VS Code 中逐个任务启动。

### 编排器:`cg spec run`

`cg spec run` 把一个 parallel spec 变成运行中的智能体会话:用 `claim-next` 挑选无冲突任务,用 `resume --prompt` 写好简报,然后每个槽位派生一个驱动进程,从 stdin 喂入提示词,并将输出记录到每任务一个的日志中。配置放在 `spec/workflow.kvx` 里:

```ini
[agents]
driver      = "codex"        # codex | claude | custom
max         = 3              # 默认槽位数(-n 可覆盖)
ttl         = 3600           # 租约 TTL,单位秒
codex_args  = ""             # codex 驱动的额外参数
claude_args = ""             # claude 驱动的额外参数
cmd         = ""             # 自定义驱动:shell 模板,可用
                             # ${PROMPT_FILE} ${TASK} ${ROOT} ${AGENT}
```

`codex` 驱动运行 `codex exec --sandbox workspace-write --skip-git-repo-check -C <root>`,子进程只能编辑项目;`claude` 驱动运行 `claude -p --permission-mode acceptEdits`,风险更高的操作仍受 Claude Code 自身权限系统管控。完成与否由 spec 判定而非进程:子进程退出后重新读取任务状态,`done` 或 `implemented` 即成功,否则释放租约并记录一条结果记忆。前沿为空或失败超过 `--max-fail`(默认 2)时停止;Ctrl-C 终止子进程、释放租约并以 130 退出;`--dry-run` 打印完整计划而不认领任何任务。编排需要 `.codegraph/` 索引以及 `cg spec mode parallel`(或 `prod`)。

### 智能体视图(VS Code)

Codify 侧边栏有一个常驻的 **Agent** 聊天视图:扩展是一个 [Agent Client Protocol](https://agentclientprotocol.com) 客户端,在你发出第一条消息时通过 ACP 适配器(`claude-code-acp` / `codex-acp`,或通过 `codify.acp.customCommand` 使用任意 ACP 智能体)启动 Claude Code 或 Codex。每个会话都会**自动注入 Codify 的 MCP 服务器**(`cg mcp`),智能体无需任何仓库配置即可使用图、spec 和记忆工具;其 ACP 文件读写被限制在工作区内。

输入 `/` 会打开 **Codify 自己的命令**面板——`/brief`、`/next`、`/context`、`/impact`、`/why`、`/review`、`/handoff` 等——每个都在工作区运行真实的 `cg` 命令,把输出显示为卡片,*同时*交给智能体作为上下文。此外,**`cg` 提供的每个工具都是一个斜杠命令**——面板由工具列表生成,参数提示取自每个工具的 schema(`/get_context auth flow`、`/spec_claim id=2.1 ttl=20`)。它也连通 fleet:`/fleet` 显示树和运行,`/attach <agent>` 跟随某个 fleet 智能体的实时记录、之后输入的内容会引导它,`/steer <agent> <message>` 发送一条消息,审批请求和升级以带 Approve 与 Reject 的卡片出现。**Start Agent Session on Task** 认领任务,用 `cg resume --task <id> --prompt` 作为开场提示词并在视图中运行会话;**Run Agent Headless on Task**、**Run Wave with Agents**、**Hand Off Task**、**Resume Task in Agent Session** 和 **Stop Agent Session** 覆盖其余流程。所有视图都通过一条 `cg serve` 连接推送的事件更新,无需轮询;面对较旧的 `cg` 时,会话运行期间看板退回为每 10 秒轮询一次。见 [editors/vscode/README.md](../../editors/vscode/README.md)。

## 编辑器

### 语言服务器

`cg lsp` 是基于同一个图的语言服务器,让每个编辑器都能用上 Codify。它不需要编译器、工具链或项目配置,一切都从 `.codegraph/` 回答:跳转到定义与查找引用、带有**已记录决策**的悬停信息、工作区与文档符号、每个函数上方的引用数与测试引用数 code lens,以及 kvx 解析错误和越出进行中任务 `touches` 的编辑诊断——范围漂移在编辑的那一刻就以波浪线呈现。将任意 LSP 客户端(例如 Neovim 的 `vim.lsp.start`)通过 stdio 指向 `cg lsp` 即可。

### VS Code 扩展

`editors/vscode/` 内置 Codify 扩展——编辑器中的完整工作流。扩展没有任何依赖,也没有构建步骤——包括手写的语言服务器客户端:

- **基于图的代码导航,范围漂移显示为波浪线。** 运行 `cg lsp` 并通过 LSP 通信,所有已索引语言都支持跳转、查找引用、工作区符号和 code lens;编辑越出进行中任务声明的 `touches` 时,在问题面板中给出警告(只作建议,从不报错)。
- **实时任务树。** 任务按特性 → 章节 → wave 分组,每行显示状态、持有租约的智能体及其角色、分支和未满足的依赖;支持过滤、搜索和任务详情面板。
- **从任务看板启动智能体会话。** 在 ACP 面板(默认)、终端或无界面模式下启动 Claude Code 或 Codex 会话,交接、恢复、运行整个 wave,看板上实时显示租约。
- **记忆浏览器。** 按类型、Jev 类别、任务、分支和日期过滤,可执行取代、遗忘、Jev 分类和提升为技能。
- **启动 fleet 并实时观察。** **Start fleet**(`spec.kvx` 上的 CodeLens、fleet 视图标题或命令面板)先预览计划,确认后运行 `cg fleet up`;fleet 树展示 Main Gideon、管理者和工作者的分支、worktree、尝试、心跳、合并状态、最近动作、token 与花费,以及停滞、重试和升级徽标;待审批项可直接决定,点击智能体打开其记录。
- **一条连接,实时更新。** 若 `cg` 支持 `serve`,扩展保持一个 `cg serve` 子进程处理所有调用和事件,并关闭轮询;`codify.serve: false` 或较旧的二进制会退回到调用命令加轮询。
- **统一的 Actions 菜单**、**kvx 编辑支持**,以及把所有触发合并为单一 `cg` 调用链的**刷新调度器**。

```sh
cd editors/vscode
npx @vscode/vsce package        # 生成 codify-workflow-1.4.0.vsix
code --install-extension codify-workflow-1.4.0.vsix --force
```

Marketplace 标识为 `SidioraLabs.codify-workflow`。详见 [editors/vscode/README.md](../../editors/vscode/README.md)。

## 开发

```sh
make             # 构建 ./cg            (依赖:C 编译器、libsqlite3-dev)
make unit        # C 单元测试           (tests/unit/*.c 链接 build/libcg.a)
make integration # 端到端 CLI 测试      (沙箱中运行 tests/integration/*.sh)
make test        # 全部
make release     # 静态发布二进制 -> 测试 -> 发布到 web 根目录
```

仓库结构:

```
src/                 每个模块一个 .c 文件;src/cg.h 是唯一的头文件
src/govern.c         brief、review、guard、check、handoff、resume——治理层
src/orchestrate.c    cg spec run 与 fleet 监督进程(cg fleet up):持久运行、三级同时运行、停滞、预算、重试、升级
src/syncgate.c       单写者索引关卡与机器级解析槽位
src/fleet.c          角色与能力、分支生命周期、合并锁、审批关卡、fleet 树
src/events.c         只追加的事件日志与 cg events
src/serve.c          cg serve——推送事件的单条 JSON-RPC 连接
src/drivers.c        智能体启动参数、结构化输出转为事件、steering
src/drift.c          spec 漂移、冲突预测、接口漂移、覆盖度
src/changelog.c      基于 git 历史的发布说明,可选的模型 highlights
src/jev.c            通过 curl 的类型化决策
src/skills.c         被归为技能的记忆,渲染为 .agents/skills
src/lsp.c            基于图的语言服务器
src/gitint.c         git 历史导入、变动量、分支身份、提交镜像
tests/unit/          kvx 语法、SHA-256 测试向量、JSON 扫描器、StrBuf/IO
tests/integration/   图、版本控制、智能体、MCP 协议、spec 引擎、文件监听、同步关卡、fleet、分支、jev、
                     changelog、事件、serve、监督进程、漂移、简报、fleet 端到端
tests/fixtures/      多语言示例项目、带黄金输出的 spec 仓库、curl/gh/OpenAI 端点替身、脚本化的 fleet 驱动
editors/vscode/      VS Code 扩展(纯 JS):kvx 语言、任务树、智能体面板、记忆浏览器、实时 fleet 视图、serve 客户端
scripts/             codify.centra.ag 提供的安装/卸载脚本 + 发布脚本
docs/ARCHITECTURE.md 各部分如何协同工作
docs/sync.md         同步关卡、新鲜度、槽位、增量解析
docs/hierarchy.md    角色、分支流程、监督进程、监督、审批、简报
docs/drift.md        spec、冲突、接口与覆盖度漂移
docs/events.md       事件日志、cg serve、驱动、steering
docs/branches.md     统一的多分支图与 schema v16
docs/jev.md          类型化决策:类型、传输、配置、限制
```

spec 渲染的黄金输出由原始的 Go 版 specgen 生成,因此渲染一致性由 `make test` 锁定。CI 在每次 push 时通过 `.github/workflows/ci.yml` 构建并运行完整测试套件。

## 说明与限制

- **在编辑器与智能体之间共享图:** 图是一个 WAL 模式的 SQLite 文件,检出目录中的每个 `cg` 进程都会写它。写者只短暂持锁,CLI 命令最多等待 `CG_BUSY_TIMEOUT_MS`(默认 30000)毫秒;锁一直不释放时,命令以 75 退出并说明未做任何更改、可安全重试。`.codegraph/index.lock` 由正在执行索引的那个进程持有,其他调用者把路径留在 `.codegraph/index.dirty` 中并立即返回;解析线程通过 `/tmp/codify-<uid>` 下的槽位文件在全机范围内配给(`CG_INDEX_SLOTS`、`CG_INDEX_WORKERS`、`CG_SLOT_DIR`)。完整约定见 [docs/sync.md](../../docs/sync.md)。
- 忽略规则由合理的默认值(VCS 目录、`node_modules`、构建产物、二进制文件)加上 `.cgignore` 文件(每行一个 glob)组成。
- 符号提取是启发式的。每种语言配有感知注释与字符串的模式引擎,针对定义与调用点的召回率进行调优,并非完整的类型检查解析器。
- 快照存储所有不超过 32 MB 的非忽略文件,包括二进制文件;图只索引不超过 8 MB 的文本文件。
- 被合并的同步返回时图并不是最新的:它把改动排给持有关卡的进程,并基于上一次完成的索引作答。
- 查询默认回答当前分支。`--branch <name>` 查询其他分支,`--all-branches` 查询全部;只有多个分支在范围内时命中才标注 `@branch`,因此单分支输出不变。
- `cg fleet` 以子进程方式调用 `git` 与 `gh`。没有 `gh` 时,`pr` 与 `checkpoint` 只打印命令而不执行,且 `checkpoint` 只把 `feature/*` 头分支视为 Codify 自己的分支。
- Jev 需要网络和 `OPENROUTER_API_KEY`。核心循环不依赖它,Jev 的回答也不会改变任何退出码。
- fleet 监督进程每个项目只有一个,通过各智能体的 CLI 派生它们,但不负责其认证。`spend` 预算依赖驱动上报的花费,只有 Claude Code 能在一轮中途被引导,`retry` 审批关卡可被接受但尚未强制执行。其余见 [docs/hierarchy.md](../../docs/hierarchy.md#limitations)。
- 漂移检测基于行与图:未改动行内部的行为变化、经由第三个函数的调用,以及索引器看不到的引用都会被遗漏([docs/drift.md](../../docs/drift.md#limitations))。
- 变更日志 highlights 需要网络和密钥;没有密钥时,发布说明就是纯粹的派生记录。

## 社区

- [Codify 的由来](../../WHY.md)
- [贡献指南](../../CONTRIBUTING.md)
- [安全策略](../../SECURITY.md)
- [行为准则](../../CODE_OF_CONDUCT.md)
- [维护者](../../MAINTAINERS.md)
- [如何引用](../../CITATION.cff)

## 许可证

MIT © [Sidiora Labs](https://sidiora.com)
