<div align="center">

# Codify

<img src="../../codify.png">

**A ferramenta de fluxo de trabalho para agentes que escala de projetos pequenos e simples a bases de código grandes e complexas.**

C11 puro. Um único binário. Um único banco SQLite. Nada sai da sua máquina.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../../LICENSE)
[![Language: C11](https://img.shields.io/badge/Language-C11-lightgrey.svg)](#)
[![CI](https://img.shields.io/badge/CI-passing-brightgreen.svg)](../../.github/workflows/ci.yml)

[English](../../README.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [हिन्दी](README.hi.md) · [العربية](README.ar.md) · [Français](README.fr.md) · [Português (BR)](README.pt-BR.md)

</div>

---

## Visão geral

O Codify (invocado como `cg`) é um motor de fluxo de trabalho para agentes em um único binário. Ele mantém as quatro coisas de que um projeto precisa além do próprio código — o que o código **é**, como ele chegou **até aqui**, o que vem **a seguir** e o que foi **aprendido** ao longo do caminho — e entrega as quatro tanto a humanos quanto a agentes de IA.

**O que o código é.** O Codify indexa 19 linguagens em um grafo consultável: símbolos, arestas de chamada, rotas cientes do framework e busca instantânea em texto completo, tudo armazenado localmente em SQLite. `cg context <consulta>` responde a "me atualize sobre esta área" em uma única chamada: pontos de entrada, símbolos correspondentes com trechos de código, chamadores, chamados e rotas relacionadas.

**Como ele chegou até aqui.** Um sistema embutido de snapshots endereçados por conteúdo oferece commits, histórico, diffs e restauração sem exigir nenhum VCS externo. Como os snapshots compartilham o banco de dados com o grafo, `cg changes` reporta o raio de impacto das suas edições não commitadas, e `cg changelog` escreve sozinho notas de versão em nível de símbolo.

**O que vem a seguir.** Um motor de specs transforma arquivos de spec kvx em texto puro em um plano funcional: um quadro de tarefas com ondas de dependência, disciplina de uma-tarefa-em-andamento, critérios de aceitação anexados a cada tarefa — e um `done` que é verificado, não apenas declarado. As checagens de uma tarefa precisam passar, e os símbolos e arquivos que ela afirma entregar precisam de fato existir no grafo e no histórico, antes que o Codify a marque como concluída.

**O que foi aprendido ao longo do caminho.** Uma memória de agente armazena anotações deliberadas — decisões, restrições, resultados, preferências, fatos — no mesmo banco de dados que o grafo, ligadas à tarefa sob a qual foram feitas. `cg remember` salva uma no meio da tarefa, cada `cg spec done` registra automaticamente um resultado honesto (incluindo recusas), e `cg recall` traz tudo de volta, ordenado por relevância e recência.

As camadas se reforçam mutuamente: os commits são etiquetados automaticamente com a tarefa que implementam, as memórias aparecem na tarefa a que pertencem, `cg spec trace` percorre qualquer tarefa até seus símbolos, commits e memórias, e um servidor MCP embutido expõe tudo isso — 17 ferramentas — ao Claude Code, ao Cursor e a qualquer outro agente compatível com MCP.

Sem chaves de API, sem serviços em segundo plano, sem telemetria. Tudo roda na sua máquina e fica nela.

## Por que Codify

**Ele fecha o ciclo do plano à prova.** A maioria das ferramentas ou planeja o trabalho (listas de tarefas) ou descreve o código (busca, índices). O Codify faz as duas coisas contra o mesmo banco de dados, então o plano pode ser confrontado com a realidade: quando uma tarefa declara que introduz `checkMode` e toca `src/*.ts`, `cg spec done` se recusa a marcá-la como concluída até que o grafo e o histórico concordem.

**Agentes trabalham como engenheiros, não como turistas.** Em vez de vagar pelo repositório arquivo por arquivo, um agente pergunta a `cg spec next` o que fazer, a `cg context` tudo sobre a área e a `cg impact` quem quebra — e então faz o commit com atribuição automática da tarefa. O ciclo inteiro está disponível via MCP, então ele nunca precisa sair do protocolo.

**O projeto lembra o que as sessões esquecem.** As janelas de contexto dos agentes são reiniciadas; a tabela de memórias, não. Uma decisão escrita uma única vez com `cg remember` encontra a sessão seguinte automaticamente — em `cg spec next`, em `cg spec start`, em `cg recall` no início da sessão — em vez de ser redescoberta pagando o preço cheio. E como as conclusões recusadas também são registradas, "esta tarefa foi bloqueada duas vezes e eis o porquê" está a uma consulta de distância.

**O contexto chega em uma chamada, não em vinte.** `cg context <consulta>` foi projetado em torno de como os agentes realmente consomem código. Uma única requisição retorna tudo o que é preciso para começar a trabalhar: por onde a execução entra, o que correspondeu, quem chama, o que é chamado e quais rotas tocam aquilo.

**A análise de impacto é um comando de primeira classe.** `cg impact <nome> -d 3` percorre transitivamente as arestas de chamadores e chamados e responde às duas perguntas que importam antes de qualquer mudança: quem quebra se isso mudar, e do que isso depende.

**A busca é instantânea e em camadas.** Um índice FTS5 de trigramas sobre os nomes de símbolos oferece correspondência de substrings sem distinção de maiúsculas e sem aquecimento, apoiado por um índice de palavras sobre o corpo completo dos arquivos para todo o resto.

**O índice nunca fica defasado.** `cg watch` escuta eventos nativos do sistema operacional (inotify no Linux, FSEvents no macOS, ReadDirectoryChangesW no Windows, todos atrás da mesma camada de plataforma) e sincroniza automaticamente com debounce. Chamadas de ferramentas MCP também sincronizam antes de ler, então um agente conectado sempre consulta dados frescos.

**Ele se adapta ao hardware em que roda.** Na inicialização, o `cg` dimensiona seu pool de workers e os caches do SQLite com base no que o sistema realmente oferece: contagem de núcleos ciente de contêineres (a interseção da cota de CPU do cgroup v1/v2, da máscara de afinidade e das CPUs online), RAM disponível honesta (`MemAvailable` cruzada com os limites de memória do cgroup) e custo medido por projeto. Uma workstation de 16 núcleos recebe o pipeline paralelo completo. Um VPS de 2 núcleos recebe um pipeline ajustado para terminar com confiabilidade. Rode `cg info` para ver exatamente como o pipeline foi dimensionado.

**Tudo permanece local.** O grafo vive em um banco SQLite sob `.codegraph/`, e os snapshots são objetos endereçados por conteúdo sob `.codegraph/objects/`. Apague o diretório e todo rastro desaparece.

## Uma sessão com o Codify

```sh
cg recall auth                # o que as sessões anteriores decidiram sobre esta área
cg spec next                  # a próxima tarefa elegível, critérios de aceitação + memórias relevantes
cg spec start 16.7            # reivindique-a — uma tarefa em andamento por vez
cg context "password auth"    # pontos de entrada, símbolos, chamadores, rotas em uma chamada
cg impact verifyLogin -d 2    # quem quebra se isso mudar
# ...implementar...
cg remember "sessions rotate on login" --type decision   # ligada à tarefa 16.7
cg commit -m "add password auth"   # snapshot, etiquetado automaticamente [spec:ion_spec/16.7]
cg spec done 16.7             # verify_cmd + checagens do grafo, memória de resultado registrada
cg spec trace 16.7            # prova: tarefa -> símbolos -> commits -> memórias
```

Cada comando desse ciclo também é uma ferramenta MCP, então um agente conectado pode executá-lo de ponta a ponta — e cada etapa funciona tão bem em um projeto de dez arquivos quanto em um monorepo.

## Linguagens e frameworks suportados

**Linguagens:** TypeScript, JavaScript, Python, Go, Rust, Java, C#, VB.NET, PHP, Ruby, C, C++, Swift, Kotlin, Erlang, Solidity, Svelte, Vue, Astro.

**Rotas cientes do framework:** o `cg` liga padrões de URL aos seus handlers em Express, Koa, Fastify, Hapi, NestJS, Next.js, SvelteKit, Flask, FastAPI, Django, Rails, Sinatra, Laravel, Spring, ASP.NET, Gin, Echo, Fiber, Chi, Actix e Axum.

## Instalação

Linux x86_64 — um único comando instala (ou atualiza) um binário estático verificado por checksum:

```sh
curl -fsSL https://codify.centra.ag/install | bash
```

Para desinstalar: `curl -fsSL https://codify.centra.ag/uninstall | bash`. Os dados `.codegraph/` de cada projeto nunca são tocados.

Em qualquer outra plataforma, compile a partir do código-fonte (dependências: um compilador C e `libsqlite3-dev`):

```sh
make && sudo make install
```

Depois, em qualquer projeto:

```sh
cd your-project
cg init
```

## Referência de comandos

### Grafo

| Comando | Descrição |
|---|---|
| `cg init` | Cria `.codegraph/` e constrói o índice inicial |
| `cg sync` / `cg index [--full]` | Reindexação incremental ou completa |
| `cg search <q> [-n N]` | Busca de símbolos e texto completo |
| `cg symbol <name>` | Definição, trecho e contagem de referências |
| `cg impact <name> [-d N]` | Chamadores e chamados transitivos |
| `cg context <q>` | Pacote de contexto em uma chamada para agentes |
| `cg routes [filter]` | Tabela de padrão de URL para handler |
| `cg watch [--debounce MS]` | Sincronização automática por eventos nativos do sistema de arquivos |
| `cg info` | Perfil da máquina e relatório de dimensionamento do pipeline |

### Controle de versão

Snapshots são endereçados por conteúdo com SHA-256 e os blobs são deduplicados.

| Comando | Descrição |
|---|---|
| `cg commit -m <msg>` | Tira um snapshot da árvore de trabalho |
| `cg log` / `cg status` | Histórico, e árvore de trabalho comparada ao HEAD |
| `cg diff [A] [B]` | Diff de linhas LCS entre snapshots ou contra a árvore de trabalho |
| `cg checkout <id> [--force]` | Restaura um snapshot |
| `cg changes` | Raio de impacto das edições não commitadas: os símbolos que você tocou mais seus chamadores externos |

### Memória

Anotações duráveis de agente, armazenadas no mesmo banco SQLite que o grafo. Memórias escritas enquanto uma tarefa de spec está em andamento se ligam a ela sozinhas, e `cg spec done` registra os resultados automaticamente. Nunca armazene segredos nelas.

| Comando | Descrição |
|---|---|
| `cg remember <text>` | Salva uma memória — `--type decision\|constraint\|outcome\|preference\|fact` (padrão `fact`), `--task <feature/id>` (por padrão, a tarefa de spec em andamento), âncoras opcionais `--symbols` / `--files` |
| `cg recall [query]` | Busca memórias: texto completo sobre o corpo, ordenado por relevância e depois por recência; filtre com `--task`, `--type`, `-n N` |
| `cg forget <id>` | Apaga uma memória |

### Agentes

| Comando | Descrição |
|---|---|
| `cg mcp` | Roda como servidor MCP via stdio com 17 ferramentas: search, context, symbol, impact, routes, status, change-impact, log, commit, as de spec (status, next, start, done, render, trace) e as de memória (remember, recall) |
| `cg mcp-install` | Conexão automática com Claude Code (`.mcp.json`), Cursor, VS Code, Windsurf, Gemini CLI e Codex CLI, mesclando com as configurações existentes |
| `cg changelog [-n N] [-o FILE]` | Changelog a partir dos snapshots com diffs em nível de símbolo: funções adicionadas e removidas, rotas novas |
| `cg agentmd [--write]` | Gera `AGENTS.md` e `CLAUDE.md`: linguagens, mapa de diretórios, ferramentas de build, pontos de entrada, rotas e os símbolos mais referenciados |

Todos os comandos de consulta aceitam `--json`. Essa flag, junto com o servidor MCP, forma a interface nativa para agentes.

## Fluxo de trabalho de specs

O fluxo de trabalho de specs é como o Codify transforma o plano de uma funcionalidade em trabalho rastreado e verificado. As specs vivem como arquivos kvx em texto puro — legíveis por humanos, diffáveis e pertencentes ao seu repositório — e o Codify as renderiza em arquivos de regras de IDE e espelhos em markdown, conduzindo por cima o ciclo de tarefas. Ele funciona em qualquer repositório que contenha `spec/workflow.kvx`, é totalmente independente de `.codegraph/` e é um substituto direto em C do `spec/specgen` do Ion, com saída idêntica byte a byte.

| Comando | Descrição |
|---|---|
| `cg spec render [--check]` | Regenera os arquivos ponteiro de IDE (Cursor, Devin, Claude, Codex, Copilot, Kiro) e o espelho em markdown (`requirements.md`, `design.md`, `tasks.md`); `--check` sai com código 2 se algo estiver desatualizado |
| `cg spec` / `cg spec status` | Quadro de tarefas: contagens, progresso, a tarefa em andamento e a próxima elegível |
| `cg spec next` | A tarefa pendente de menor wave cujos `requires` estão todos concluídos, com seus itens de ação e critérios de aceitação expandidos |
| `cg spec start <id>` | Marca uma tarefa como `in_progress`; impõe uma por vez e `requires` cumpridos, com `--force` para sobrepor |
| `cg spec done <id>` | Executa o `verify_cmd` da tarefa e as checagens do grafo (recusa em caso de falha, `--force` para sobrepor), marca como `done`, registra uma memória de resultado e sugere a próxima tarefa |
| `cg spec trace [<id>]` | Rastreia tarefas até o código: símbolos declarados resolvidos no grafo (localização, tipo, referências), caminhos tocados comparados às mudanças reais, os commits etiquetados com a tarefa e suas memórias |

`start` e `done` reescrevem apenas a linha `status = "..."` do arquivo kvx. Todos os outros bytes, comentários e linhas em branco sobrevivem. Em seguida o comando re-renderiza silenciosamente para que as caixas de seleção do `tasks.md` fiquem em dia. Os arquivos kvx continuam sendo a única fonte de verdade, e `-f <feature>` sobrepõe `[meta] active_feature`.

O `cg commit` etiqueta automaticamente sua mensagem com a tarefa em andamento, por exemplo `... [spec:ion_spec/16.7]`, de modo que `cg log` e `cg changelog` rastreiam cada snapshot de volta à spec. Os seis comandos de spec também são expostos como ferramentas MCP, permitindo que um agente conectado conduza o ciclo completo (next, start, implementar, done) sem sair do protocolo.

Quando o projeto também tem um índice `.codegraph/`, as tarefas podem declarar como sua implementação deve se parecer, e `cg spec done` verifica isso contra a realidade:

```ini
[task.2.1]
title   = "Check mode"
symbols = ["checkMode"]      # precisa existir no grafo de código
touches = ["src/*.ts"]       # um caminho correspondente precisa de fato ter mudado
```

Os `symbols` são procurados no grafo indexado; os padrões de `touches` (caminhos exatos ou globs) são comparados à união das mudanças na árvore de trabalho com os arquivos alterados pelos commits etiquetados com a tarefa — assim a verificação continua passando depois que o trabalho foi commitado. Checagens que falham recusam a conclusão (`--force` sobrepõe). `cg spec trace [<id>]` mostra a cadeia completa tarefa→código→commit para uma tarefa ou para a funcionalidade inteira, em texto ou com `--json`.

O fluxo de trabalho também alimenta a camada de memória por conta própria. Cada conclusão escreve uma memória de resultado sucinta — incluindo as recusadas, para que uma sessão posterior possa ver que uma tarefa foi bloqueada e por quê. `cg spec next` e `cg spec start` imprimem as memórias relevantes para a tarefa (ligadas pelo id, ou que correspondam ao seu título), e `cg spec trace` as inclui na cadeia. Um agente conduzindo o ciclo acumula memória de projeto sem que ninguém precise pedir.

## Extensão para VS Code

`editors/vscode/` traz a extensão do Codify: realce de sintaxe para os arquivos de spec `.kvx`, mais um quadro de tarefas ao vivo no Explorer — tarefas agrupadas por onda de dependências com ícones de status, os dados de verificação do grafo por trás de cada tarefa (símbolos com localização, caminhos tocados, commits marcados), ações de iniciar/concluir que executam os comandos reais de `cg spec` (incluindo a recusa quando as verificações falham) e um indicador de progresso na barra de status. Ela chama o `cg` e não exige etapa de build:

```sh
cd editors/vscode
npx @vscode/vsce package        # produz codify-0.1.0.vsix
code --install-extension codify-0.1.0.vsix
```

Veja [editors/vscode/README.md](../../editors/vscode/README.md).

## Desenvolvimento

```sh
make             # compila ./cg           (deps: compilador C, libsqlite3-dev)
make unit        # testes unitários em C  (tests/unit/*.c contra build/libcg.a)
make integration # testes CLI ponta a ponta (tests/integration/*.sh em sandboxes)
make test        # ambos
```

Estrutura do repositório:

```
src/                 um arquivo .c por módulo; src/cg.h é o único header
tests/unit/          gramática kvx, vetores SHA-256, scanner JSON, StrBuf/IO
tests/integration/   grafo, vcs, agentes, protocolo MCP, motor de specs, watcher
tests/fixtures/      projeto poliglota de exemplo e repo de specs com saídas douradas
editors/vscode/      extensão do VS Code: linguagem kvx + quadro de tarefas (JS puro)
docs/ARCHITECTURE.md como as peças se encaixam
```

As saídas douradas do render de specs foram geradas pelo specgen original em Go, então a paridade de renderização fica garantida pelo `make test`. A CI compila e roda a suíte completa a cada push via `.github/workflows/ci.yml`.

## Notas e limitações

- As regras de exclusão combinam padrões sensatos (diretórios de VCS, `node_modules`, artefatos de build, binários) com um arquivo `.cgignore` de um glob por linha.
- A extração de símbolos é heurística. Um motor de padrões por linguagem, ciente de comentários e strings, é ajustado para maximizar o recall em definições e pontos de chamada. Não é um resolvedor com checagem de tipos completa.
- Os snapshots armazenam todo arquivo não ignorado de até 32 MB, incluindo binários. O grafo indexa arquivos de texto de até 8 MB.

## Comunidade

- [Por que o Codify existe](../../WHY.md)
- [Guia de contribuição](../../CONTRIBUTING.md)
- [Política de segurança](../../SECURITY.md)
- [Código de conduta](../../CODE_OF_CONDUCT.md)
- [Mantenedores](../../MAINTAINERS.md)
- [Como citar](../../CITATION.cff)

## Licença

MIT © [Sidiora Labs](https://sidiora.com)
