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

A versão 1.1.0 (v11) transforma a frota em algo a que você entrega uma spec e deixa rodando: `cg fleet up` inicia um supervisor durável, que se recupera de falhas, e executa ao mesmo tempo o agente principal, um gerente por funcionalidade e workers por tarefa, administrando cada processo do Codex ou do Claude Code até que seu trabalho esteja qualificado e mesclado. Os agentes recebem briefings a partir do grafo, o desvio (drift) é detectado entre branches antes do merge, toda mudança de estado vai para um log de eventos, e `cg serve` envia tudo ao editor por uma única conexão. Isso se apoia nas fundações da frota: um indexador que aglutina em vez de cinquenta, a hierarquia Main Gideon / gerente de funcionalidade / worker com fluxo de branch, merge, PR e checkpoint, um grafo unificado para todas as branches e worktrees, e as decisões Jev — a única chamada remota de uma ferramenta de resto local.

**O que o código é.** O Codify indexa 19 linguagens em um grafo consultável: símbolos, arestas de chamada, rotas cientes do framework e busca instantânea em texto completo, tudo armazenado localmente em SQLite. `cg context <consulta>` responde a "me atualize sobre esta área" em uma única chamada: pontos de entrada, símbolos correspondentes com trechos, chamadores, chamados e rotas relacionadas. E, além do que um parser enxerga, os comentários são indexados como nós de primeira classe — a camada de intenção: propósito, contratos, perigos e os acoplamentos que só existem em prosa.

**Como ele chegou até aqui.** Um sistema embutido de snapshots endereçados por conteúdo oferece commits, histórico, diffs e restauração sem exigir nenhum VCS externo. Como os snapshots compartilham o banco com o grafo, `cg changes` reporta o raio de impacto das suas edições não commitadas. `cg changelog` escreve as notas de versão: por padrão a partir do histórico do git — uma release por tag ou por mudança de versão, grupos pelo prefixo do assunto do commit, cada referência de tarefa preservada e, com uma chave, um breve parágrafo de Highlights escrito por um modelo para cada release — e a partir da cadeia de snapshots, com diffs em nível de símbolo, quando você passa `--snapshots` ou o projeto não tem git.

**O que vem a seguir.** Um motor de specs transforma arquivos de spec kvx em texto puro em um plano funcional: um quadro de tarefas com ondas de dependência, critérios de aceitação anexados a cada tarefa — e um `done` que é verificado, não apenas declarado. `cg spec new` e `cg spec add` criam o plano, `cg spec lint` prova que ele é executável e o ciclo o executa. No modo Prod, `implemented` registra a conclusão da codificação e a evidência no código sem alegar qualificação; só `done` significa que a qualificação executável e as checagens do grafo passaram. No modo paralelo, vários agentes trabalham ao mesmo tempo, limitados pela disjunção dos caminhos que cada tarefa declara.

**O que foi aprendido ao longo do caminho.** Uma memória de agente armazena anotações deliberadas — decisões, restrições, resultados, preferências, fatos — no mesmo banco que o grafo, ligadas à tarefa sob a qual foram feitas. `cg remember` salva uma no meio da tarefa, cada `cg spec done` registra automaticamente um resultado honesto (incluindo recusas), e `cg recall` traz tudo de volta, ordenado por relevância e recência. As camadas se reforçam mutuamente: os commits são etiquetados automaticamente com a tarefa que implementam, as memórias aparecem na tarefa a que pertencem, `cg why` leva um símbolo de volta às decisões por trás dele e `cg spec trace` percorre qualquer tarefa até seus símbolos, commits e memórias.

**E ele está presente entre as etapas, não só nelas.** `cg work open` começa com um pacote compacto da tarefa, `cg work update` devolve apenas os deltas novos de estado, evidência e workspace, `cg event progress` classifica loops sem confundir atividade com progresso, e `cg guard` percebe quando uma edição sai do escopo declarado. Um servidor MCP embutido expõe 60 ferramentas, recursos e prompts a qualquer agente compatível com MCP, enquanto `cg integrate` planeja, aplica e diagnostica a configuração nativa de cada host.

**E ele conduz agentes, não apenas os atende.** `cg handoff` e `cg resume` passam uma tarefa entre sessões sem perder estado, `cg spec claim-next` entrega atomicamente a um agente ocioso a próxima tarefa sem conflito, e `cg spec run` distribui uma onda inteira para sessões do Codex CLI ou do Claude Code — um processo filho em sandbox por tarefa reivindicada, logs e prompts em disco, leases liberados em caso de falha.

**E ele sobrevive a uma frota.** A indexação é um recurso compartilhado: o primeiro `cg` que precisa de uma passada a executa, os demais deixam um recado e se aglutinam nela, uma janela de frescor pula a varredura inteira, e slots de parsing em toda a máquina mantêm projetos simultâneos dentro do orçamento de núcleos ([docs/sync.md](../../docs/sync.md)). Acima disso, `spec/workflow.kvx` pode declarar uma hierarquia — um agente principal dono da lista de tarefas, um gerente por funcionalidade e workers de onda sob cada um — e `cg fleet` conduz o fluxo de branches: worktree, merge para cima, integração atrás dos gates de teste e lint, pull request, checkpoint. `cg fleet up` roda essa árvore inteira sozinho sob um supervisor destacado — várias funcionalidades de uma vez, cada worker em sua própria worktree — cutucando agentes travados, repetindo os que falharam com o que deu errado, escalando o que não tem salvação, parando nos gates de aprovação que você ativou e reportando conclusão quando o trabalho foi **mesclado**, não quando um processo saiu ([docs/hierarchy.md](../../docs/hierarchy.md)). Mate o supervisor e `cg fleet up --resume` adota os agentes ainda vivos. Desvios da spec, tarefas que colidem e mudanças de interface de que outras branches dependem são sinalizados antes do merge ([docs/drift.md](../../docs/drift.md)), e cada mudança é um evento que `cg events --follow` e `cg serve` transmitem ao vivo ([docs/events.md](../../docs/events.md)). Todos compartilham um grafo e uma memória: cada branch e worktree vinculada indexa no mesmo `.codegraph/`, com escopo por branch ([docs/branches.md](../../docs/branches.md)).

**E ele pede uma decisão quando uma é necessária.** `cg jev` consulta o modelo System One da TypeSafe para julgamentos tipados — verdadeiro/falso, um-entre-vários, ranqueado. `cg memory classify` o usa para dizer quais anotações são skills reutilizáveis, e `cg skills promote` as transforma em `.agents/skills/<slug>/SKILL.md` portáteis; um `verify_cmd` que falha ganha uma linha de triagem, os achados de `cg guard` são ranqueados e um pull request recebe uma nota de prontidão. É a única chamada remota que o Codify faz: obrigatória para as funcionalidades construídas sobre ela, nunca para o ciclo central e nunca autoritativa — nenhuma resposta do Jev jamais mudou um código de saída ([docs/jev.md](../../docs/jev.md)).

**E a documentação é a última tarefa verificada.** Specs novas ativam por padrão uma etapa de fechamento `@docs`. Quando todas as tarefas comuns se qualificam, o Codify monta um pacote de evidências limitado a partir da spec, dos snapshots atribuídos, do grafo, das rotas, das memórias, das checagens e da documentação existente. O mesmo conector de agente atualiza a documentação de usuário e de desenvolvedor, `cg docs check` verifica referências de afirmações, links locais, cobertura da superfície do grafo e escopo dos alvos, e `cg docs close` registra um snapshot `[spec:<feature>/@docs]` e uma linha de base incremental. Essas checagens estruturais apoiam a revisão; não certificam o sentido de cada frase.

Não há serviços em segundo plano que você não iniciou nem telemetria — o supervisor da frota só roda após `cg fleet up` e para com `cg fleet down`. O grafo, a memória, os snapshots e todo o ciclo de tarefas rodam na sua máquina e ficam nela. Duas exceções são nomeadas e opcionais: as decisões Jev precisam de `OPENROUTER_API_KEY`, e só os comandos construídos sobre elas fazem essa chamada; e `cg changelog` pede highlights de release a um modelo apenas quando `CENTRA_API_KEY` (ou `CG_CHANGELOG_KEY`) está definida.

## Por que Codify

**Ele fecha o ciclo do plano à prova.** A maioria das ferramentas ou planeja o trabalho ou descreve o código. O Codify faz as duas coisas contra o mesmo banco, então o plano pode ser confrontado com a realidade: quando uma tarefa declara que introduz `checkMode` e toca `src/*.ts`, `cg spec done` se recusa a concluí-la até que o grafo e o histórico concordem.

**Agentes trabalham como engenheiros, não como turistas.** Em vez de vagar arquivo por arquivo, um agente pergunta a `cg spec next` o que fazer, a `cg context` tudo sobre a área e a `cg impact` quem quebra — e então faz o commit com atribuição automática da tarefa, tudo via MCP. E o projeto lembra o que as sessões esquecem: uma decisão escrita uma vez com `cg remember` encontra a sessão seguinte automaticamente — em `cg spec next`, em `cg spec start`, em `cg recall` — e as conclusões recusadas também ficam registradas.

**O contexto chega em uma chamada, não em vinte — e dentro de um orçamento.** `cg context <consulta>` retorna memórias relevantes, pontos de entrada, correspondências, chamadores, chamados e rotas, ranqueados (definições reais acima de fixtures de teste, código chamado acima de código morto) e ajustados a um orçamento de tokens (`--budget`, padrão 4000); o que o orçamento corta é anunciado com uma contagem explícita de omitidos. `cg impact <nome> -d 3` percorre transitivamente chamadores e chamados: quem quebra se isso mudar, e do que isso depende. A busca combina um índice FTS5 de trigramas sobre nomes de símbolos com um índice de palavras sobre o corpo dos arquivos.

**O índice nunca fica defasado — e nunca vira tempestade.** `cg watch` escuta eventos nativos do sistema operacional (inotify, FSEvents, ReadDirectoryChangesW) e sincroniza com debounce; chamadas MCP também sincronizam antes de ler. Com cinquenta agentes, um processo segura o gate e varre, os outros deixam um recado e se aglutinam, e slots em toda a máquina limitam as threads de parsing. O `cg` também dimensiona seu pool de workers e os caches do SQLite pelo hardware real — núcleos cientes de contêineres, RAM disponível honesta, custo medido por projeto; `cg info` mostra o resultado.

**Tudo permanece local.** O grafo vive em um banco SQLite sob `.codegraph/`, e os snapshots são objetos endereçados por conteúdo sob `.codegraph/objects/`. Apague o diretório e todo rastro desaparece.

## A camada de intenção

Um parser vê símbolos, chamadas e rotas, mas não vê *por que* uma função existe, o que seus chamadores precisam garantir ou que `save_tasks` precisa rodar depois que `load_tasks` lê o disco — essa metade do código vive só em comentários. O Codify a indexa ([docs/ANCHORS.md](../../docs/ANCHORS.md) é a convenção completa):

- **Âncoras** são comentários que passam no teste de derivabilidade — *se um agente poderia tê-lo escrito lendo o código, não é âncora.* Quatro tipos valem a pena: **purpose**, **contract**, **danger**, **pointer**.
- **Recuperação doc-first**: onde há âncora, `cg context` serve doc + assinatura em vez do corpo, e **`cg survey`** lê cem arquivos pelo preço de um corpo.
- **Arestas suaves**: nomes dentro de âncoras viram referências `(soft)` — acoplamentos dinâmicos e entre linguagens, rotulados para nunca serem confundidos com chamadas analisadas.
- **Honestidade sobre desvio**: quando o código muda, a doc é marcada como defasada em `cg check`, `cg guard` e na própria recuperação. Avisa, não bloqueia.
- **`cg anchors`** ranqueia símbolos descobertos por pontuação de coordenação (fan-out × extensão × arquivos que referenciam), para que o preenchimento comece pelos pontos de orquestração. Nada disso é obrigatório: sem a convenção, ainda há captura, survey e arestas suaves a partir dos comentários existentes.

## Uma sessão com o Codify

```sh
cg brief                      # raiz, tarefa ativa + critérios, trabalho não commitado, decisões anteriores
cg spec next                  # a próxima tarefa elegível, critérios + memórias relevantes
cg spec start 16.7            # reivindique-a — uma tarefa em andamento por vez
cg context "password auth"    # memórias, pontos de entrada, símbolos, chamadores, rotas em uma chamada
cg why verifyLogin            # quem mudou, sob qual tarefa, e o que foi decidido
cg impact verifyLogin -d 2    # quem quebra se isso mudar
# ...implementar...
cg guard                      # algo saindo do que a tarefa 16.7 declarou?
cg test-impact                # quais testes cobrem o que você acabou de mudar
cg remember "sessions rotate on login" --type decision   # ligada à tarefa 16.7
cg review                     # a mudança, pareada com os critérios que ela afirma cumprir
cg commit -m "add password auth"   # snapshot, etiquetado automaticamente [spec:ion_spec/16.7]
cg spec done 16.7             # qualificação: verify_cmd + checagens do grafo; resultado registrado
cg spec trace 16.7            # prova: tarefa -> símbolos -> commits -> memórias
```

E quando uma sessão precisa parar antes de terminar a tarefa, o trabalho não evapora:

```sh
# sessão A, parando mais cedo
cg handoff --done "schema migration; token rotation" \
           --next "wire the login route; extend 03_auth test" \
           --blocked "flaky fixture on CI" -m "rotate on login, not refresh"

# sessão B, horas depois, com uma janela de contexto nova
cg resume --prompt            # bloco pronto para colar: tarefa, passos feitos, bloqueios,
                              # próximos passos, arquivos não commitados, estado do lease
```

Um handoff é guardado como memória estruturada ligada à tarefa; cada novo substitui o anterior, então `cg resume` sempre encontra o estado mais recente. Cada comando desse ciclo também é uma ferramenta MCP, `cg check` roda o gate inteiro na CI em um único passo, e `cg hook install` conecta a sincronização e a checagem de escopo para que quase tudo aconteça sem ninguém invocar.

## Linguagens e frameworks suportados

**Linguagens:** TypeScript, JavaScript, Python, Go, Rust, Java, C#, VB.NET, PHP, Ruby, C, C++, Swift, Kotlin, Erlang, Solidity, Svelte, Vue, Astro.

**Rotas cientes do framework:** o `cg` liga padrões de URL aos seus handlers em Express, Koa, Fastify, Hapi, NestJS, Next.js, SvelteKit, Flask, FastAPI, Django, Rails, Sinatra, Laravel, Spring, ASP.NET, Gin, Echo, Fiber, Chi, Actix e Axum.

## Instalação

Linux x86_64 — um único comando instala (ou atualiza) um binário estático verificado por checksum:

```sh
curl -fsSL https://codify.centra.ag/install | bash
```

Para desinstalar: `curl -fsSL https://codify.centra.ag/uninstall | bash`. Os dados `.codegraph/` de cada projeto nunca são tocados. Atualizar é seguro em projetos existentes: o banco carrega uma versão de schema e, na primeira abertura após uma atualização, o `cg` reconstrói apenas as tabelas de índice derivadas (arquivos, símbolos, refs, rotas, imports e os índices de busca) — a próxima sincronização as repovoa. Memórias, histórico do git e leases nunca são descartados por uma migração.

Em qualquer outra plataforma, compile a partir do código-fonte (dependências: um compilador C e `libsqlite3-dev`):

```sh
make && sudo make install
```

Depois, em qualquer projeto: `cd your-project && cg init`.

## Referência de comandos

### Grafo

| Comando | Descrição |
|---|---|
| `cg init [--nested]` | Cria `.codegraph/` e constrói o índice inicial; dentro de uma worktree vinculada de um repositório já inicializado, entra no grafo compartilhado sob esta branch |
| `cg sync [paths] [--max-age MS] [--background] [--wait MS]` | Índice incremental: aglutina-se a uma passada em andamento, pula quando fresco e varre só os caminhos citados. `cg index [--full]` é a forma bloqueante |
| `cg branches` | Cada branch indexada no grafo compartilhado, com worktree, head, base e contagem de arquivos |
| `cg search <q> [-n N]` | Busca de símbolos e texto completo |
| `cg symbol <name>` | Definição, trecho e contagem de referências |
| `cg impact <name> [-d N] [--budget N]` | Chamadores e chamados transitivos, dentro de um orçamento de tokens (padrão 8000) |
| `cg context <q> [--budget N] [-n K]` | Pacote de contexto em uma chamada: memórias, símbolos, pontos de entrada, rotas — top K (padrão 8), orçamento padrão 4000 |
| `cg survey [path\|query] [--budget N]` | Linhas de propósito e docs com assinaturas em ~100 arquivos por chamada, nunca um corpo (orçamento padrão 16000) |
| `cg anchors [--stale] [--uncovered]` | Saúde das âncoras: docs defasadas e símbolos descobertos ranqueados por coordenação |
| `cg why <symbol>` | Proveniência: commits que o mudaram, tarefas que implementaram, decisões registradas |
| `cg test-impact [symbol]` | Testes que referenciam um símbolo — ou todos os símbolos das mudanças não commitadas |
| `cg routes` / `cg show` / `cg watch` / `cg root` / `cg info` | Tabela de rotas; corpo de um símbolo; sincronização automática; raiz resolvida; perfil da máquina e da branch |

### Controle de versão

Snapshots são endereçados por conteúdo com SHA-256 e os blobs são deduplicados. Eles não substituem o git: `.gitignore` é respeitado junto com `.cgignore`, `cg git-sync` lê seu histórico real e `cg commit --git` grava nos dois, então adotar o Codify nunca é tudo ou nada.

| Comando | Descrição |
|---|---|
| `cg commit -m <msg>` | Tira um snapshot da árvore de trabalho; `--git` também faz um commit git real com a mesma tag de spec |
| `cg log` / `cg status` / `cg diff [A] [B]` / `cg checkout <id>` | Histórico, árvore de trabalho contra o HEAD, diff de linhas LCS, restauração de um snapshot |
| `cg changes [--limit N]` | Raio de impacto das edições não commitadas: símbolos tocados mais seus chamadores externos (limitado por padrão a 40 símbolos, 8 chamadores cada) |
| `cg git-sync [-n N]` | Ingere o histórico do git — commits, autores, churn por arquivo — que passa a ranquear busca e contexto |
| `cg events [--since N] [--kind K,..] [-n N] [--follow [--for S]] [--head]` | O log de eventos: cada mudança de tarefa, claim, tentativa, agente, frota, supervisor, drift e aprovação por número de sequência. `--kind` aceita lista com prefixo terminado em `.` (`fleet.`); `--follow` transmite; `--json` é um objeto por linha. Veja [docs/events.md](../../docs/events.md) |

### Changelog

`cg changelog` gera notas de versão a partir do histórico do git. Uma release começa em uma tag **ou** no commit que mudou a versão do projeto — `CG_VERSION` em `src/cg.h`, um arquivo `VERSION` ou `package.json` — então um projeto que nunca cria tags ainda ganha uma seção por versão. O que veio depois da última é nomeado pela versão da árvore de trabalho quando ela é nova (a release em preparação), por `--tag NAME`, e só em último caso `[Unreleased]`. O grupo é o prefixo do assunto do commit, e o `[spec:<feature>/<task>]` anexado por `cg commit` vira uma referência de tarefa no item.

**Highlights.** Com `CENTRA_API_KEY` no ambiente ou no `.env` do projeto (ou `CG_CHANGELOG_KEY`), cada release ganha também um bloco `### Highlights`: duas a cinco frases escritas por um modelo a partir dos commits agrupados. Os itens derivados nunca são alterados, e o prompt proíbe inventar o que os commits não dizem. `CG_CHANGELOG_ENDPOINT` e `CG_CHANGELOG_MODEL` apontam para qualquer endpoint compatível com OpenAI. As respostas ficam em cache em `.codegraph/changelog-cache/`, então regenerar o arquivo só consulta as releases que mudaram. `--summarize` exige a chave, `--no-summarize` mantém o modelo de fora, e uma chamada que falha imprime `highlights for <release> skipped — <why>` no stderr. `-n N` limita as seções, `-o FILE` grava o arquivo relativo à raiz do repositório, `--unreleased` imprime só a seção mais nova e `--tag 1.2.0` dá esse nome à seção mais nova, com a data de hoje. `--snapshots` — e qualquer projeto sem `.git` — usa o renderizador de snapshots, com diff em nível de símbolo por snapshot. O `CHANGELOG.md` deste repositório é gerado com `cg changelog -o CHANGELOG.md`.

### Memória

Anotações duráveis de agente, no mesmo banco SQLite que o grafo. Memórias escritas durante uma tarefa de spec se ligam a ela sozinhas, e `cg spec done` registra os resultados automaticamente. Nunca armazene segredos nelas. Uma memória substituída nunca é apagada — a reversão é histórico que vale guardar; ela só deixa de liderar os resultados. Arquivos promovidos a skill carregam o marcador de propriedade do Codify e um link para a memória; um arquivo sem esse marcador nunca é sobrescrito ([docs/jev.md](../../docs/jev.md#memory-classification-and-skills)).

| Comando | Descrição |
|---|---|
| `cg remember <text>` | Salva uma memória — `--type decision\|constraint\|outcome\|preference\|fact` (padrão `fact`), `--task <feature/id>`, âncoras `--symbols` / `--files`, `--supersedes <id>` para aposentar uma decisão revertida |
| `cg recall [query]` | Busca memórias por relevância e recência; filtre com `--task`, `--type`, `-n N` ou `--near <file>` |
| `cg forget <id>` / `cg memory compact` | Apaga uma memória; colapsa duplicadas (`--dry-run` para pré-visualizar) |
| `cg memory classify [<id>\|--all\|--unclassified]` | Pergunta ao Jev o que cada anotação é — `skill`, `decision`, `constraint`, `fact`, `noise` — com uma confiança, e grava na memória; `-n N` limita o lote |
| `cg skills list\|promote <id>\|render` | As memórias classificadas como `skill`, promovidas para `.agents/skills/<slug>/SKILL.md` e mantidas em dia com a anotação de origem |

### Agentes

| Comando | Descrição |
|---|---|
| `cg mcp` / `cg lsp` | Servidor MCP via stdio (60 ferramentas, mais recursos e prompts); Language Server via stdio para qualquer editor |
| `cg serve` | Uma conexão JSON-RPC (stdio) para um editor: toda ferramenta MCP, qualquer comando `cg` (`exec`), `cancel` e assinaturas de eventos enviados a partir de um número de sequência, milissegundos após o commit. Ocioso, não segura lock nem indexa. Veja [docs/events.md](../../docs/events.md#cg-serve) |
| `cg tool list \| call <name> [json]` | Executa uma ferramenta MCP pelo shell, sem cliente MCP |
| `cg integrate detect\|plan\|apply\|doctor` | Configuração ciente de capacidades para Codex, Claude Code, Copilot/VS Code, Cursor, Gemini CLI, OpenCode, Zed, Windsurf, Cline e Continue; o plano é só leitura, o apply é idempotente e com backup (`cg mcp-install` é um alias) |
| `cg hook install` / `cg hook post-edit` | Conecta hooks de agente e de git; o hook de edição faz uma sincronização direcionada em segundo plano e um guard do caminho editado |
| `cg changelog [-n N] [-o FILE] [--unreleased] [--tag NAME] [--snapshots] [--summarize\|--no-summarize]` | Notas de versão a partir do git, uma release por tag ou mudança de versão, com Highlights quando `CENTRA_API_KEY` está definida (veja [Changelog](#changelog)) |
| `cg agentmd [--write]` | Gera a orientação do grafo em `.codify/agent-context.md`; `AGENTS.md` e `CLAUDE.md` na raiz continuam pertencendo a `cg spec render` |

### Plano de controle de agentes

O Codify mantém explícitas quatro autoridades independentes: estado do Git, estado dos snapshots, estado declarado da spec e tentativas vivas cercadas. `cg state` as mostra juntas sem tratar uma como prova da outra; `cg spec reconcile` diagnostica declarações órfãs e só altera algo com `--repair`. Hooks nativos alimentam `cg event ingest`, e `cg event progress` classifica falhas repetidas, observações repetidas, oscilação A-B de patches e janelas sem evidência; a recuperação é finita e consultiva, a menos que `CG_PROGRESS_ENFORCE=1` ative a política terminal. `cg work open` compõe objetivo, critérios, escopo, estado, memórias e contexto em um pacote, `cg work update` devolve só o que mudou e `cg work close` pareia cada critério com evidência durável ou o marca como não verificado. As integrações executam o `cg` local, os registros ficam em `.codegraph/graph.db`, e o Codify não faz chamadas de rede nem telemetria.

### Governança

Estes comandos tornam o Codify presente em cada etapa. Todos apenas aconselham por padrão; só `--strict` os faz falhar.

| Comando | Descrição |
|---|---|
| `cg brief` | Estado da sessão em uma chamada: raiz, tarefa ativa com critérios, caminhos não commitados, decisões recentes |
| `cg review` | A mudança pareada com o que ela afirma: símbolos alterados, chamadores em risco e os critérios de aceitação |
| `cg guard [paths] [--strict]` | Edições fora do escopo que a tarefa em andamento declarou em `touches` |
| `cg drift check <id> [--base REF] \| collisions \| coverage \| summary [-f F]` | A mudança de uma tarefa contra seus touches e símbolos declarados; tarefas abertas que colidiriam se rodassem juntas; critérios sem tarefa qualificada; contagens de drift por funcionalidade. Avisa; veja [docs/drift.md](../../docs/drift.md) |
| `cg check [--strict]` | O gate único de CI: renderização defasada, lint da spec, evidência das tarefas, consistência dos claims, estado da worktree |
| `cg handoff` / `cg resume [--prompt]` | Registra o estado da sessão antes de parar (`--done "a;b"`, `--next "a;b"`, `--blocked "x"`, `-m <note>`); entrega a uma sessão nova tudo para retomar a tarefa, com `--prompt` como bloco pronto para colar |

Todos os comandos de consulta aceitam `--json`. Essa flag, o servidor MCP e o language server são as interfaces nativas para agentes.

## Fluxo de trabalho de specs

As specs vivem como arquivos kvx em texto puro — legíveis por humanos, diffáveis e pertencentes ao seu repositório — e o Codify as renderiza em arquivos de regras de IDE e espelhos em markdown, conduzindo por cima o ciclo de tarefas. Funciona em qualquer repositório com `spec/workflow.kvx`, é independente de `.codegraph/` e é um substituto direto em C do `spec/specgen` do Ion, com saída idêntica byte a byte.

| Comando | Descrição |
|---|---|
| `cg spec new <feature>` / `add <id> --title T` / `lint` | Cria `spec/<feature>/spec.kvx` (e `spec/workflow.kvx` se faltar); insere uma tarefa preservando todos os outros bytes; valida o plano (ciclos de `requires`, tarefas sem critérios, globs mortos), saindo com 2 em erros |
| `cg spec render [--check]` | Regenera os arquivos ponteiro de IDE e o espelho em markdown; `--check` sai com 2 se algo estiver defasado |
| `cg spec status` / `mode <prod\|standard\|parallel>` | Quadro de tarefas (contagens de `done`, `implemented`, `in_progress` e `pending`, próxima elegível, claims vivos); semântica de dependência e concorrência |
| `cg spec wave` / `cg spec ready` | Tarefas elegíveis da onda atual; ou de **todas** as ondas, marcando conflitos com claims vivos |
| `cg spec claim <id>` / `release <id>` / `claim-next` | Leases com dono e expiração; `claim-next` reivindica atomicamente a primeira tarefa sem conflito (sai com 3 quando a fronteira está vazia) |
| `cg spec run` | Orquestra uma onda paralela ou Prod — veja [Conduzindo agentes](#conduzindo-agentes) |
| `cg spec next` / `cg spec start <id>` | A tarefa pendente de menor onda com `requires` satisfeitos; marcá-la como `in_progress` |
| `cg spec implemented <id>` / `cg spec done <id>` | Em Prod, checagens do grafo sem `verify_cmd`; qualificação completa com `verify_cmd` e checagens, `done` só quando passa |
| `cg spec trace [<id>]` | Tarefa → símbolos, caminhos tocados, commits etiquetados e memórias |

`mode`, `start`, `implemented` e `done` reescrevem apenas a linha de modo ou `status = "..."` do kvx; todos os outros bytes sobrevivem. O `cg commit` etiqueta a mensagem com a tarefa em andamento (`... [spec:ion_spec/16.7]`), e os comandos de spec também são ferramentas MCP. `cg spec docs <status|auto|manual|off|start|block|reset>` configura a etapa `@docs`.

### Fechamento da documentação

`@docs` é trabalho da funcionalidade, não uma tarefa numerada sintética. No modo `auto`, `cg spec next` e `cg spec claim-next` a devolvem depois que a última tarefa folha se qualifica, então `cg spec run` a lança pelo mesmo driver, com o mesmo lease, heartbeat, log e recuperação. `manual` a deixa visível para um agente iniciado explicitamente; `off` a pula. `cg docs status|plan|packet|check|trace|close` cobrem o ciclo; o agente preenche `claims.kvx`, o Codify regenera `required.kvx`, e o verificador nunca apaga um documento canônico nem aceita escrita fora dos alvos configurados. Guia completo em [docs/DOCUMENTATION.md](../../docs/DOCUMENTATION.md).

### Modo paralelo

`cg spec mode parallel` mantém a semântica do Prod e relaxa só quantas tarefas podem estar em andamento, porque o plano já declara os `touches` de cada uma. Vinte agentes chamando `cg spec claim-next` ao mesmo tempo recebem vinte tarefas distintas e disjuntas (ou o código de saída 3 com a fronteira vazia), e `cg spec start` é recusado se outra tarefa viva reivindica os mesmos caminhos. Leases expiram, então um agente que morre não trava a onda. Com um índice `.codegraph/`, as tarefas declaram `symbols` (precisam existir no grafo) e `touches` (um caminho correspondente precisa ter mudado). Os `touches` são comparados às mudanças da worktree e aos arquivos de commits etiquetados com a tarefa — snapshots do Codify e commits **git** com `[spec:<feature>/<id>]` contam igualmente, então cada worker pode commitar na própria branch. Cada conclusão, inclusive as recusadas, grava uma memória de resultado.

### Modo frota: uma hierarquia de agentes

O modo paralelo impede que vinte agentes editem os mesmos arquivos; o modo frota lhes dá forma. `spec/workflow.kvx` declara um agente **main** dono da lista de tarefas e dos merges, um **gerente de funcionalidade** por funcionalidade e **workers de onda** em branches cortadas da branch da funcionalidade:

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

[role.worker]                # [role.main] e [role.feature] da mesma forma;
branch  = "task/{feature}/{task}"  # toda chave tem um padrão;
base    = "feature/{feature}"      # {task} dá a cada tarefa sua própria branch
driver  = "codex"            # como seus agentes rodam, e quanto podem gastar
wall    = "3h"
stall   = "10m"
retries = 2
approve = ["land"]           # opcional: espera por `cg fleet approve`
```

| Comando | Descrição |
|---|---|
| `cg fleet roles` | A hierarquia configurada: templates de branch, base, remote, gates, política de PR |
| `cg fleet status` | Quem está vivo em qual papel, em qual tarefa, sob qual pai |
| `cg fleet plan [-f F]` | Qual gerente é dono da funcionalidade e qual worker de cada onda |
| `cg fleet tree [-f F]` | A árvore viva com o progresso de cada branch, estado de merge, tentativa e heartbeat |
| `cg fleet begin <id>` | Cria ou reusa a branch e a worktree da onda e reivindica a tarefa. Idempotente |
| `cg fleet merge-up <id>` | Mescla uma branch de onda **qualificada** na branch da funcionalidade; conflitos listados por caminho |
| `cg fleet land <feature>` | Mescla a funcionalidade na main local e roda os gates; vermelho restaura a main, verde abre o PR se a política for `auto` |
| `cg fleet pr <feature>` | Faz push e abre o pull request via `gh`, ou imprime os comandos; `--dry-run` não chama nada |
| `cg fleet checkpoint` | Mescla os PRs `feature/*` abertos, do menor número para o maior, parando no primeiro que falhar |
| `cg fleet up [-f F \| --all] [-n N] [--foreground] [--resume [RUN]] [--dry-run]` | Inicia uma execução durável sob um supervisor destacado, até cada tarefa estar qualificada e mesclada |
| `cg fleet down [--drain] \| pause \| resume [RUN]` | Para (claims liberados, branches mantidas), deixa o trabalho vivo terminar, congela ou continua |
| `cg fleet runs` | Execuções, seu estado e se o supervisor está vivo |
| `cg fleet approvals [--all] \| approve <id> [--reject] [-m note]` | O que espera em um gate opcional (`land`, `pr`, `drift`, `coverage`) e a decisão que o libera |
| `cg fleet steer <agent> <message>` | Uma mensagem para um agente em execução: na próxima edição (Claude Code) ou no próximo prompt |
| `cg fleet brief <feature>` | O briefing do gerente: estado da subárvore, workers vivos, falhas, conflitos, aprovações |

O lugar de um agente na árvore vive no ambiente — `CG_AGENT`, `CG_ROLE`, `CG_PARENT`, `CG_FEATURE`, `CG_WAVE` (e `CG_GH`); sem `CG_ROLE`, uma sessão solo não muda. `cg fleet up` conduz a árvore inteira sozinho:

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

- **Execuções são duráveis.** A execução e cada nó — papel, pai, tarefa, branch, worktree, pid, tentativa, cerca, retentativas, gasto — vivem no banco. Mate o supervisor e `cg fleet up --resume` adota os agentes ainda vivos (verificados por pid e horário de início) e mantém as contagens de retentativa.
- **Supervisão.** Progresso é trabalho — eventos, saída de log, mudanças na worktree — não um heartbeat. Uma janela de travamento rende uma cutucada, a segunda para a tentativa com um handoff. Orçamentos `wall` e `spend` interrompem tentativas; uma tarefa que falha é repetida com o que deu errado no prompt e, esgotadas as retentativas, escala ao gerente, depois ao main, e por fim é marcada como bloqueada enquanto o resto continua.
- **Três níveis ao mesmo tempo.** Um lock de merge por funcionalidade substitui o revezamento, então gerentes e workers rodam juntos; com um template `{task}`, as tarefas de uma onda rodam em paralelo, exceto os pares com colisão prevista. `[hierarchy] main_agent = true` roda o Main Gideon também como processo.
- **Briefings a partir do grafo.** O prompt de um worker traz seus critérios, as definições atuais dos símbolos declarados com chamadores e chamados, o que os pré-requisitos realmente produziram e o que os irmãos estão tocando, dentro de um orçamento de tokens; `cg work update` reporta símbolos mesclados acima desde o início da tentativa.
- **Bloquear é opcional.** Gates listados em `approve` param `land`, `pr`, um `merge-up` com drift ou um land com critérios descobertos até `cg fleet approve`. Sem eles, nada espera por uma pessoa.

Uma subárvore está concluída porque foi **mesclada**, não porque um processo saiu. O fluxo completo está em [docs/hierarchy.md](../../docs/hierarchy.md); o drift em [docs/drift.md](../../docs/drift.md); o log de eventos, `cg serve` e o direcionamento em [docs/events.md](../../docs/events.md).

### Um grafo para todas as branches

O Codify indexa todas as branches e worktrees de um repositório em um único `.codegraph/`: numa worktree vinculada, `cg init` **entra** no projeto compartilhado em vez de criar outro banco. As linhas de arquivo têm escopo por branch, frescor e gate de índice também, e o conteúdo analisado é reaproveitado por hash entre branches. As consultas respondem pela branch atual; `--branch <name>` e `--all-branches` consultam outras. As memórias carregam a branch em que foram feitas, e `cg fleet merge-up` as promove junto com o código. Detalhes em [docs/branches.md](../../docs/branches.md).

### Decisões Jev

Algumas perguntas não são determinísticas — *essa falha é instável ou real, essa memória é uma skill ou ruído, qual desses achados importa mais.* `cg jev` pede ao modelo System One da TypeSafe (`typesafe/jev-1.13`, via OpenRouter) uma resposta tipada: um `noul`, uma `choice` de até 255 opções ou um `score` ordinal. Ele nunca gera texto.

| Comando | Descrição |
|---|---|
| `cg jev doctor [--probe]` | Saúde da chave, curl, endpoint, modelo e log; `--probe` envia uma decisão mínima |
| `cg jev ask [<request.json>\|-]` | Pergunta direta: `--state S`, `--noul N I`, `--choice N I --option K=D …`, `--score N I --level L …` |
| `cg jev log [-n N]` | As últimas N chamadas de `.codegraph/jev.log`, com id, modelo, tokens, custo e latência |

`cg spec done` (quando `verify_cmd` falha), `cg guard` e `cg fleet pr` acrescentam uma resposta do Jev ao lado do próprio veredito. Sem `OPENROUTER_API_KEY`, aparece um aviso no stderr e o veredito e o código de saída do comando ficam intactos. Jev é **obrigatório** para as funcionalidades construídas sobre ele e **nunca autoritativo**; a chave nunca aparece em uma linha de comando. Veja [docs/jev.md](../../docs/jev.md).

## Conduzindo agentes

### O orquestrador: `cg spec run`

`cg spec run` transforma uma spec paralela em sessões de agentes: `claim-next` escolhe uma tarefa sem conflito, `resume --prompt` escreve o briefing, e um processo de driver por slot recebe o prompt pelo stdin, com a saída em um log por tarefa. A configuração vive em `spec/workflow.kvx`:

```ini
[agents]
driver      = "codex"        # codex | claude | custom
max         = 3              # número padrão de slots (-n sobrepõe)
ttl         = 3600           # TTL do lease, em segundos
codex_args  = ""             # argumentos extras para o driver codex
claude_args = ""             # argumentos extras para o driver claude
cmd         = ""             # driver custom: um template de shell com
                             # ${PROMPT_FILE} ${TASK} ${ROOT} ${AGENT}
```

O driver `codex` roda `codex exec --sandbox workspace-write`, então os filhos só editam o projeto; o `claude` roda `claude -p --permission-mode acceptEdits`. A conclusão é julgada pela spec, não pelo processo: `done` ou `implemented` é sucesso; qualquer outra coisa libera o lease e grava uma memória de resultado. Ctrl-C encerra os filhos e libera os leases; `--dry-run` imprime o plano sem reivindicar nada. Exige um índice `.codegraph/` e `cg spec mode parallel` (ou `prod`).

### A visão de agente (VS Code)

A barra lateral do Codify traz uma visão **Agent** persistente: a extensão é um cliente [Agent Client Protocol](https://agentclientprotocol.com) que inicia o Claude Code ou o Codex pelo adaptador ACP (`claude-code-acp` / `codex-acp`, ou qualquer agente ACP via `codify.acp.customCommand`), com o **servidor MCP do Codify injetado automaticamente** em toda sessão. Digitar `/` abre os verbos do próprio Codify (`/brief`, `/next`, `/context`, `/impact`, `/review`, …), e **toda ferramenta servida pelo `cg` vira um comando de barra**, gerado a partir da lista de ferramentas com dicas de argumentos tiradas do schema de cada uma. A frota também está ao alcance: `/fleet` mostra a árvore e as execuções, `/attach <agent>` acompanha a transcrição de um agente da frota para que o que você digitar o direcione, `/steer <agent> <message>` envia uma mensagem, e pedidos de aprovação e escalonamentos chegam como cartões com Approve e Reject. **Start Agent Session on Task**, **Run Agent Headless on Task**, **Run Wave with Agents**, **Hand Off Task** e **Resume Task in Agent Session** cobrem o resto. Cada visão é atualizada por eventos enviados por uma única conexão `cg serve`, sem polling. Veja [editors/vscode/README.md](../../editors/vscode/README.md).

## Editores

### Language server

`cg lsp` é um Language Server sobre o mesmo grafo, então todo editor ganha o Codify, sem compilador nem configuração: go-to-definition, find-references, hover com as decisões registradas, símbolos de workspace, code lens com contagens de referências e de testes, e diagnósticos para erros de kvx e arquivos editados fora dos `touches` declarados — o desvio de escopo aparece como sublinhado no momento da edição. Aponte qualquer cliente LSP para `cg lsp` via stdio.

### Extensão para VS Code

`editors/vscode/` traz a extensão do Codify — o fluxo inteiro no editor:

- **Navegação a partir do grafo** via `cg lsp`, e **desvio de escopo como sublinhado** no painel Problems — consultivo, nunca erro.
- **Uma árvore de tarefas ao vivo** agrupada funcionalidade → seção → onda, com status, dono do lease e papel, branch, requires pendentes, filtros, busca e painel de detalhes por tarefa.
- **Sessões de agente a partir do quadro** — no painel ACP, num terminal ou headless — com handoff, resume, ondas inteiras e decorações de lease ao vivo; e **um navegador de memórias** com filtros por tipo, classe Jev, tarefa, branch e data, e ações de supersede, forget, classificação com Jev e promoção a skill.
- **Inicie a frota e acompanhe ao vivo.** **Start fleet** pré-visualiza o plano e, ao confirmar, roda `cg fleet up`; a visão da frota mostra Main Gideon, gerentes e workers com branch, worktree, tentativa, heartbeat, estado de merge, tokens, custo e selos de travamento, retentativa e escalonamento, e as aprovações pendentes são linhas que você decide.
- **Ao vivo por uma conexão.** Com um `cg` que tem `serve`, a extensão mantém um filho `cg serve` para cada chamada e evento e desliga o polling; `codify.serve: false`, ou um binário mais antigo, volta ao polling.
- **Um menu Actions único**, **edição de kvx** com navegação e completion, e **um agendador de atualização** que aglutina rajadas numa única cadeia de chamadas.

A extensão não tem dependências nem etapa de build — nem mesmo no cliente de Language Server, escrito à mão justamente por isso. A identidade no Marketplace é `SidioraLabs.codify-workflow`; veja [editors/vscode/README.md](../../editors/vscode/README.md).

```sh
cd editors/vscode
npx @vscode/vsce package        # produz codify-workflow-1.4.0.vsix
code --install-extension codify-workflow-1.4.0.vsix --force
```

## Desenvolvimento

```sh
make             # compila ./cg           (deps: compilador C, libsqlite3-dev)
make unit        # testes unitários em C  (tests/unit/*.c contra build/libcg.a)
make integration # testes CLI ponta a ponta (tests/integration/*.sh em sandboxes)
make test        # ambos
make release     # binário estático de release -> testado -> publicado na raiz web
```

Estrutura do repositório:

```
src/                 um arquivo .c por módulo; src/cg.h é o único header
src/govern.c         brief, review, guard, check, handoff, resume — a camada de governança
src/orchestrate.c    cg spec run e o supervisor da frota (cg fleet up): execuções duráveis,
                     três níveis ao mesmo tempo, travamentos, orçamentos, retentativas, escalonamento
src/syncgate.c       o gate de índice de escritor único e os slots de parsing da máquina
src/fleet.c          papéis e capacidades, ciclo de vida das branches, lock de merge,
                     gates de aprovação, árvore da frota
src/events.c         o log de eventos só de acréscimo e cg events
src/serve.c          cg serve — uma conexão JSON-RPC com eventos enviados
src/drivers.c        argv de lançamento dos agentes, saída estruturada em eventos, direcionamento
src/drift.c          drift de spec, previsão de colisões, drift de interface, cobertura
src/changelog.c      notas de versão a partir do git, highlights opcionais por modelo
src/jev.c            decisões tipadas via curl
src/skills.c         memórias classificadas como skills, renderizadas como .agents/skills
src/lsp.c            language server sobre o grafo
src/gitint.c         ingestão do histórico git, churn, identidade de branch, espelhamento de commits
tests/unit/          gramática kvx, vetores SHA-256, scanner JSON, StrBuf/IO
tests/integration/   grafo, vcs, agentes, protocolo MCP, motor de specs, watcher, sync gate, frota,
                     branches, jev, changelog, eventos, serve, supervisor, drift, briefings, frota ponta a ponta
tests/fixtures/      projeto poliglota de exemplo, repo de specs com saídas douradas, substitutos
                     para curl, gh e um endpoint OpenAI, e um driver de frota roteirizado
editors/vscode/      extensão do VS Code (JS puro): linguagem kvx, árvore de tarefas,
                     painel de agente, navegador de memórias, visão da frota ao vivo, cliente serve
scripts/             scripts de instalação/desinstalação servidos em codify.centra.ag + publicador de release
docs/ARCHITECTURE.md como as peças se encaixam
docs/sync.md         o sync gate, frescor, slots, resolução incremental
docs/hierarchy.md    papéis, fluxo de branches, o supervisor, supervisão, aprovações, briefings
docs/drift.md        drift de spec, de colisão, de interface e de cobertura
docs/events.md       o log de eventos, cg serve, drivers, direcionamento
docs/branches.md     o grafo multi-branch unificado e o schema v16
docs/jev.md          decisões tipadas: tipos, transporte, configuração, limites
```

As saídas douradas do render de specs foram geradas pelo specgen original em Go, então a paridade de renderização fica garantida pelo `make test`. A CI compila e roda a suíte completa a cada push via `.github/workflows/ci.yml`.

## Compartilhando o grafo entre o editor e os agentes

O grafo é um único arquivo SQLite em modo WAL, e todo processo `cg` de um checkout escreve nele. Os escritores seguram o lock em rajadas curtas, e um comando da CLI espera até `CG_BUSY_TIMEOUT_MS` (padrão 30000) pela sua vez; se o lock nunca for liberado, o comando sai com 75, avisando que nada foi aplicado e que é seguro repeti-lo. Um gate separado, `.codegraph/index.lock`, decide quem *varre*: os demais deixam seus caminhos em `.codegraph/index.dirty` e retornam na hora. As threads de parsing são racionadas na máquina via `/tmp/codify-<uid>` (`CG_INDEX_SLOTS`, `CG_INDEX_WORKERS`, `CG_SLOT_DIR`). Veja [docs/sync.md](../../docs/sync.md).

## Notas e limitações

- As regras de exclusão combinam padrões sensatos (diretórios de VCS, `node_modules`, artefatos de build, binários) com um arquivo `.cgignore` de um glob por linha.
- A extração de símbolos é heurística. Um motor de padrões por linguagem, ciente de comentários e strings, é ajustado para maximizar o recall em definições e pontos de chamada. Não é um resolvedor com checagem de tipos completa.
- Os snapshots armazenam todo arquivo não ignorado de até 32 MB, incluindo binários. O grafo indexa arquivos de texto de até 8 MB.
- Uma sincronização aglutinada retorna sem um grafo novo: ela enfileira a mudança para o processo que segura o gate e responde a partir do último índice concluído.
- As consultas respondem pela branch em que você está. `--branch <name>` consulta outra e `--all-branches` consulta todas; um resultado só é rotulado `@branch` quando há mais de uma branch no escopo, então a saída de uma única branch não muda.
- `cg fleet` conduz `git` e `gh` como subprocessos. Sem `gh`, `pr` e `checkpoint` imprimem os comandos em vez de executá-los, e `checkpoint` só trata branches head `feature/*` como do próprio Codify.
- O Jev precisa de rede e de `OPENROUTER_API_KEY`. Nada no ciclo central depende dele, e nenhuma resposta do Jev muda um código de saída.
- O supervisor da frota é um por projeto e inicia agentes por suas CLIs; ele não os autentica. Um orçamento `spend` depende do custo reportado pelo driver, só o Claude Code pode ser direcionado no meio de um turno, e o gate de aprovação `retry` é aceito, mas ainda não aplicado. O resto está em [docs/hierarchy.md](../../docs/hierarchy.md#limitations).
- A detecção de drift é em nível de linha e de grafo: mudanças de comportamento dentro de linhas inalteradas, chamadas através de uma terceira função e referências que o indexador não enxerga passam despercebidas ([docs/drift.md](../../docs/drift.md#limitations)).
- Os highlights do changelog precisam de rede e de uma chave; sem ela, as notas são o registro derivado simples.

## Comunidade

- [Por que o Codify existe](../../WHY.md)
- [Guia de contribuição](../../CONTRIBUTING.md)
- [Política de segurança](../../SECURITY.md)
- [Código de conduta](../../CODE_OF_CONDUCT.md)
- [Mantenedores](../../MAINTAINERS.md)
- [Como citar](../../CITATION.cff)

## Licença

MIT © [Sidiora Labs](https://sidiora.com)
