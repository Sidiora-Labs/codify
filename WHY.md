# Why Codify exists

Codify was not planned as a product. We built it because we needed it, and open sourced it once we realized how much of our own progress depended on it.

Sidiora Labs builds agentic systems. Most of the code in our projects is written by our own agents, Ion and Neo, working in long sessions over weeks and months. At that scale the hard part of agentic development is not generating code. Models are good at that. The hard part is keeping an agent oriented: what already exists in the repo, what changed since yesterday, what it is supposed to do next, and whether the thing it just claimed to finish actually got built.

Every tool we tried assumed a human was driving. Agents were left to explore repositories file by file, burning most of their context window rediscovering things they had already learned the day before. Task tracking lived in markdown files that drifted from reality within a week. And nothing could tell us whether "task complete" was true.

So we wrote our own tool, in C, as one binary with one SQLite database:

The code graph exists so an agent can ask one question ("catch me up on the auth code") and get entry points, symbols, callers, and routes in a single call instead of twenty file reads.

The built-in snapshots exist because agents need cheap, constant checkpoints, and because history stored next to the graph means the tool can answer "what is the blast radius of what I just changed."

The spec engine exists because our agents work from plans, not vibes. Tasks live in plain text kvx files, ordered by dependency waves, one in progress at a time.

The verified done exists because agents sometimes report success that did not happen. No False Success is a hard rule in our workflow, so Codify checks a finished task against the graph and the history. If the task says it introduced a symbol and touched certain files, those things must actually exist before the status changes. Trust the work, not the report.

The loop this enables is the whole point. Ion and Neo drive Codify over MCP: next task, context, implement, commit (tagged with the task automatically), done (verified), trace. That loop is how a four person team plus agents kept a codebase past a million lines navigable, and it works the same on a weekend project with ten files.

Nothing in Codify is specific to us. It runs entirely on your machine, needs no API keys, sends nothing anywhere, and adapts itself to whatever hardware it lands on. It turned out to be the most useful piece of internal infrastructure we have, which is exactly the kind of thing worth giving away.

If you are building software with agents, this is the tool we wished existed when we started.
