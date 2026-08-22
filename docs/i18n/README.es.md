<div align="center">

# Codify

<img src="../../codify.png">

**La herramienta de flujo de trabajo para agentes que escala de proyectos pequeños y simples a bases de código grandes y complejas.**

C11 puro. Un solo binario. Una sola base de datos SQLite. Nada sale de tu máquina.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../../LICENSE)
[![Language: C11](https://img.shields.io/badge/Language-C11-lightgrey.svg)](#)
[![CI](https://img.shields.io/badge/CI-passing-brightgreen.svg)](../../.github/workflows/ci.yml)

[English](../../README.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [हिन्दी](README.hi.md) · [العربية](README.ar.md) · [Français](README.fr.md) · [Português (BR)](README.pt-BR.md)

</div>

---

## Descripción general

Codify (se invoca como `cg`) es un motor de flujo de trabajo para agentes en un solo binario. Mantiene las cuatro cosas que un proyecto necesita más allá del propio código — qué **es** el código, cómo llegó **hasta aquí**, qué viene **después** y qué se **aprendió** por el camino — y las sirve por igual a humanos y a agentes de IA.

**Qué es el código.** Codify indexa 19 lenguajes en un grafo consultable: símbolos, aristas de llamadas, rutas conscientes del framework y búsqueda instantánea de texto completo, todo almacenado localmente en SQLite. `cg context <consulta>` responde a "ponme al día sobre esta zona" en una sola llamada: puntos de entrada, símbolos coincidentes con fragmentos de código, llamadores, llamados y rutas relacionadas.

**Cómo llegó hasta aquí.** Un sistema integrado de instantáneas direccionadas por contenido te da commits, historial, diffs y restauración sin necesidad de un VCS externo. Como las instantáneas comparten base de datos con el grafo, `cg changes` informa del radio de impacto de tus ediciones sin confirmar, y `cg changelog` redacta por sí solo notas de versión a nivel de símbolo.

**Qué viene después.** Un motor de specs convierte archivos de spec kvx en texto plano en un plan operativo: un tablero de tareas con oleadas de dependencias, la disciplina de una sola tarea en curso, criterios de aceptación adjuntos a cada tarea — y un `done` que se verifica, no se afirma. Las comprobaciones de una tarea deben pasar, y los símbolos y archivos que dice entregar deben existir realmente en el grafo y en el historial, antes de que Codify la marque como completada.

**Qué se aprendió por el camino.** Una memoria de agente almacena notas deliberadas — decisiones, restricciones, resultados, preferencias, hechos — en la misma base de datos que el grafo, vinculadas a la tarea bajo la que se tomaron. `cg remember` guarda una a mitad de tarea, cada `cg spec done` registra automáticamente un resultado honesto (incluidos los rechazos), y `cg recall` lo recupera todo, ordenado por relevancia y actualidad.

Las capas se refuerzan entre sí: los commits se etiquetan automáticamente con la tarea que implementan, las memorias afloran en la tarea a la que pertenecen, `cg spec trace` recorre cualquier tarea hasta sus símbolos, commits y memorias, y un servidor MCP integrado expone todo esto — 19 herramientas — a Claude Code, Cursor y cualquier otro agente compatible con MCP.

No hay claves de API, ni servicios en segundo plano, ni telemetría. Todo se ejecuta en tu máquina y se queda ahí.

## Por qué Codify

**Cierra el ciclo del plan a la prueba.** La mayoría de las herramientas o bien planifican el trabajo (listas de tareas) o bien describen el código (búsqueda, índices). Codify hace ambas cosas contra la misma base de datos, de modo que el plan puede contrastarse con la realidad: cuando una tarea declara que introduce `checkMode` y toca `src/*.ts`, `cg spec done` se niega a marcarla como completada hasta que el grafo y el historial coincidan.

**Los agentes trabajan como ingenieros, no como turistas.** En lugar de deambular por un repositorio archivo por archivo, un agente pide a `cg spec next` qué hacer, a `cg context` todo lo relativo a la zona y a `cg impact` quién se rompe — y luego confirma con atribución automática de la tarea. El ciclo entero está disponible por MCP, así que nunca tiene que salir del protocolo.

**El proyecto recuerda lo que las sesiones olvidan.** Las ventanas de contexto de los agentes se reinician; la tabla de memorias, no. Una decisión escrita una sola vez con `cg remember` se encuentra automáticamente con la siguiente sesión — en `cg spec next`, en `cg spec start`, en `cg recall` al empezar la sesión — en lugar de redescubrirse a precio completo. Y como las completaciones rechazadas también se registran, "esta tarea se bloqueó dos veces y este es el porqué" queda a una sola consulta de distancia.

**El contexto llega en una llamada, no en veinte.** `cg context <consulta>` está diseñado alrededor de cómo consumen código los agentes en la práctica. Una sola petición devuelve todo lo necesario para empezar a trabajar: por dónde entra la ejecución, qué coincidió, quién lo llama, a quién llama y qué rutas lo tocan.

**El análisis de impacto es un comando de primera clase.** `cg impact <nombre> -d 3` recorre transitivamente las aristas de llamadores y llamados y responde las dos preguntas que importan antes de cualquier cambio: quién se rompe si esto se mueve y de qué depende.

**La búsqueda es instantánea y por capas.** Un índice FTS5 de trigramas sobre los nombres de símbolos ofrece coincidencia de subcadenas sin distinción de mayúsculas y sin calentamiento previo, respaldado por un índice de palabras sobre el cuerpo completo de los archivos para todo lo demás.

**El índice nunca queda obsoleto.** `cg watch` escucha eventos nativos del sistema operativo (inotify en Linux, FSEvents en macOS, ReadDirectoryChangesW en Windows, todos detrás de la misma capa de plataforma) y sincroniza automáticamente con antirrebote. Las llamadas a herramientas MCP también sincronizan antes de leer, así que un agente conectado siempre consulta datos frescos.

**Se adapta al hardware donde corre.** Al arrancar, `cg` dimensiona su pool de trabajadores y las cachés de SQLite según lo que el sistema realmente ofrece: número de núcleos consciente de contenedores (la intersección de la cuota de CPU de cgroup v1/v2, la máscara de afinidad y las CPU en línea), RAM disponible real (`MemAvailable` intersectada con los límites de memoria del cgroup) y el coste medido por proyecto. Una estación de trabajo de 16 núcleos recibe la tubería paralela completa. Un VPS de 2 núcleos recibe una ajustada para terminar de forma fiable. Ejecuta `cg info` para ver exactamente cómo se dimensionó la tubería.

**Todo permanece local.** El grafo vive en una base de datos SQLite bajo `.codegraph/` y las instantáneas son objetos direccionados por contenido bajo `.codegraph/objects/`. Borra el directorio y desaparece todo rastro.

## Una sesión con Codify

```sh
cg recall auth                # lo que sesiones anteriores decidieron sobre esta zona
cg spec next                  # la siguiente tarea elegible, con sus criterios de aceptación y memorias relevantes
cg spec start 16.7            # reclámala — una sola tarea en curso a la vez
cg context "password auth"    # puntos de entrada, símbolos, llamadores y rutas en una llamada
cg impact verifyLogin -d 2    # quién se rompe si esto cambia
# ...implementar...
cg remember "sessions rotate on login" --type decision   # vinculada a la tarea 16.7
cg commit -m "add password auth"   # instantánea, etiquetada automáticamente [spec:ion_spec/16.7]
cg spec done 16.7             # verify_cmd + comprobaciones del grafo, memoria de resultado registrada
cg spec trace 16.7            # la prueba: tarea -> símbolos -> commits -> memorias
```

Cada comando de ese ciclo es también una herramienta MCP, así que un agente conectado puede ejecutarlo de principio a fin — y cada paso funciona igual de bien en un proyecto de diez archivos que en un monorepo.

## Lenguajes y frameworks compatibles

**Lenguajes:** TypeScript, JavaScript, Python, Go, Rust, Java, C#, VB.NET, PHP, Ruby, C, C++, Swift, Kotlin, Erlang, Solidity, Svelte, Vue, Astro.

**Rutas conscientes del framework:** `cg` vincula patrones de URL con sus manejadores en Express, Koa, Fastify, Hapi, NestJS, Next.js, SvelteKit, Flask, FastAPI, Django, Rails, Sinatra, Laravel, Spring, ASP.NET, Gin, Echo, Fiber, Chi, Actix y Axum.

## Instalación

Linux x86_64 — un solo comando instala (o actualiza) un binario estático verificado por checksum:

```sh
curl -fsSL https://codify.centra.ag/install | bash
```

Para desinstalar: `curl -fsSL https://codify.centra.ag/uninstall | bash`. Los datos `.codegraph/` de cada proyecto nunca se tocan.

En cualquier otra plataforma, compila desde el código fuente (dependencias: un compilador de C y `libsqlite3-dev`):

```sh
make && sudo make install
```

Después, en cualquier proyecto:

```sh
cd your-project
cg init
```

## Referencia de comandos

### Grafo

| Comando | Descripción |
|---|---|
| `cg init` | Crea `.codegraph/` y construye el índice inicial |
| `cg sync` / `cg index [--full]` | Reindexado incremental o completo |
| `cg search <q> [-n N]` | Búsqueda de símbolos y de texto completo |
| `cg symbol <name>` | Definición, fragmento y recuento de referencias |
| `cg impact <name> [-d N]` | Llamadores y llamados transitivos |
| `cg context <q>` | Paquete de contexto en una sola llamada para agentes |
| `cg routes [filter]` | Tabla de patrón de URL a manejador |
| `cg watch [--debounce MS]` | Sincronización automática con eventos nativos del sistema de archivos |
| `cg info` | Perfil de la máquina e informe de dimensionado de la tubería |

### Control de versiones

Las instantáneas se direccionan por contenido con SHA-256 y los blobs se deduplican.

| Comando | Descripción |
|---|---|
| `cg commit -m <msg>` | Toma una instantánea del árbol de trabajo |
| `cg log` / `cg status` | Historial, y árbol de trabajo frente a HEAD |
| `cg diff [A] [B]` | Diff de líneas LCS entre instantáneas o contra el árbol de trabajo |
| `cg checkout <id> [--force]` | Restaura una instantánea |
| `cg changes` | Radio de impacto de las ediciones sin confirmar: los símbolos que tocaste más sus llamadores externos |

### Memoria

Notas duraderas para agentes, almacenadas en la misma base de datos SQLite que el grafo. Las memorias escritas mientras una tarea de spec está en curso se vinculan a ella por sí solas, y `cg spec done` registra los resultados automáticamente. Nunca almacenes secretos en ellas.

| Comando | Descripción |
|---|---|
| `cg remember <text>` | Guarda una memoria — `--type decision\|constraint\|outcome\|preference\|fact` (por defecto `fact`), `--task <feature/id>` (por defecto la tarea de spec en curso), anclas opcionales `--symbols` / `--files` |
| `cg recall [query]` | Busca memorias: texto completo sobre el cuerpo, ordenadas por relevancia y luego actualidad; filtra con `--task`, `--type`, `-n N` |
| `cg forget <id>` | Elimina una memoria |

### Agentes

| Comando | Descripción |
|---|---|
| `cg mcp` | Se ejecuta como servidor MCP por stdio con 19 herramientas: search, context, symbol, impact, routes, status, change-impact, log, commit, las de spec (status, next, start, done, render, trace, mode, implemented) y las de memoria (remember, recall) |
| `cg mcp-install` | Conexión automática con Claude Code (`.mcp.json`), Cursor, VS Code, Windsurf, Gemini CLI y Codex CLI, fusionando con las configuraciones existentes |
| `cg changelog [-n N] [-o FILE]` | Changelog a partir de instantáneas con diffs a nivel de símbolo: funciones añadidas y eliminadas, rutas nuevas |
| `cg agentmd [--write]` | Genera `AGENTS.md` y `CLAUDE.md`: lenguajes, mapa de directorios, herramientas de compilación, puntos de entrada, rutas y los símbolos más referenciados |

Todos los comandos de consulta aceptan `--json`. Ese flag más el servidor MCP conforman la interfaz nativa para agentes.

## Flujo de trabajo de specs

El flujo de trabajo de specs es la forma en que Codify convierte el plan de una funcionalidad en trabajo rastreado y verificado. Las specs viven como archivos kvx en texto plano — legibles para humanos, aptos para diff y propiedad de tu repositorio — y Codify los renderiza en archivos de reglas para IDE y espejos en markdown mientras dirige el ciclo de tareas por encima. Funciona en cualquier repositorio que contenga `spec/workflow.kvx`, es totalmente independiente de `.codegraph/` y es un reemplazo directo en C del `spec/specgen` de Ion con salida idéntica byte a byte.

| Comando | Descripción |
|---|---|
| `cg spec render [--check]` | Regenera los archivos puntero para IDE (Cursor, Devin, Claude, Codex, Copilot, Kiro) y el espejo en markdown (`requirements.md`, `design.md`, `tasks.md`); `--check` sale con código 2 si algo está desactualizado |
| `cg spec` / `cg spec status` | Tablero de tareas: modo, recuentos separados de `done`, `implemented`, `in_progress` y `pending`, progreso, tarea actual y siguiente elegible |
| `cg spec mode <prod\|standard>` | Configura Prod y sus reglas de dependencias; un modo ausente o desconocido es standard |
| `cg spec next` | La tarea pendiente de menor wave cuyos `requires` están satisfechos (`done` solo en standard; `implemented` o `done` en Prod), con sus puntos de acción y criterios de aceptación expandidos |
| `cg spec start <id>` | Marca una tarea como `in_progress`; impone una a la vez y `requires` cumplidos, con `--force` para forzar |
| `cg spec implemented <id>` | En Prod, comprueba la evidencia de código sin ejecutar `verify_cmd` y marca la tarea como `implemented` (sin marcar; cualificación pendiente; sin `--force`) |
| `cg spec done <id>` | Desde `in_progress` o `implemented`, ejecuta `verify_cmd` y las comprobaciones del grafo; solo marca `done` si la cualificación pasa y, si falla, conserva `implemented` |
| `cg spec trace [<id>]` | Rastrea las tareas hasta el código: símbolos declarados resueltos en el grafo (ubicación, tipo, referencias), rutas tocadas cotejadas con los cambios reales, los commits etiquetados con la tarea y sus memorias |

`mode`, `start`, `implemented` y `done` reescriben únicamente la línea de modo o `status = "..."` del archivo kvx. Todos los demás bytes, comentarios y líneas en blanco sobreviven. Después, el comando vuelve a renderizar en silencio; las tareas `implemented` permanecen sin marcar y llevan `Implemented - qualification pending`. Los archivos kvx siguen siendo la única fuente de verdad, y `-f <feature>` sobrescribe `[meta] active_feature`.

`cg commit` etiqueta automáticamente su mensaje con la tarea en curso, por ejemplo `... [spec:ion_spec/16.7]`, así que `cg log` y `cg changelog` rastrean cada instantánea hasta la spec. Los ocho comandos de spec también se exponen como herramientas MCP, permitiendo que un agente conectado ejecute el ciclo standard (next, start, snapshot, done) o Prod (next, start, snapshot, implemented, cualificación, done) sin salir del protocolo.

Cuando el proyecto tiene además un índice `.codegraph/`, las tareas pueden declarar qué aspecto tiene su implementación. `cg spec implemented` comprueba la evidencia de código sin ejecutar comandos; `cg spec done` realiza la cualificación ejecutable contra la realidad:

```ini
[task.2.1]
title   = "Check mode"
symbols = ["checkMode"]      # debe existir en el grafo de código
touches = ["src/*.ts"]       # una ruta coincidente debe haber cambiado realmente
```

Los `symbols` se buscan en el grafo indexado; los patrones de `touches` (rutas exactas o globs) se cotejan con la unión de los cambios del árbol de trabajo y los archivos modificados por los commits etiquetados con la tarea — de modo que la verificación sigue pasando después de que el trabajo se haya confirmado. En Prod, `implemented` satisface los `requires` posteriores, pero no está cualificada ni se muestra como `[x]`; si la cualificación falla, la tarea permanece `implemented`. `cg spec trace [<id>]` muestra la cadena completa tarea→código→commit para una tarea o para toda la funcionalidad, en texto o con `--json`.

El flujo de trabajo también alimenta la capa de memoria por sí solo. Cada completación escribe una memoria de resultado concisa — incluidas las rechazadas, para que una sesión posterior pueda ver que una tarea se bloqueó y por qué. `cg spec next` y `cg spec start` imprimen las memorias relevantes para la tarea (vinculadas por id, o que coinciden con su título), y `cg spec trace` las incluye en la cadena. Un agente que dirige el ciclo va construyendo la memoria del proyecto sin que nadie se lo pida.

## Extensión para VS Code

`editors/vscode/` incluye la extensión de Codify: resaltado de sintaxis para los archivos de spec `.kvx`, más un tablero de tareas en vivo en el Explorador — tareas agrupadas por ola de dependencias con iconos de estado, los datos de verificación del grafo detrás de cada tarea (símbolos con su ubicación, rutas tocadas, commits etiquetados), acciones de iniciar/completar que ejecutan los comandos reales de `cg spec` (incluido el rechazo cuando fallan las comprobaciones) y un indicador de progreso en la barra de estado. Invoca a `cg` y no requiere paso de compilación:

```sh
cd editors/vscode
npx @vscode/vsce package        # produce codify-0.1.0.vsix
code --install-extension codify-0.1.0.vsix
```

Consulta [editors/vscode/README.md](../../editors/vscode/README.md).

## Desarrollo

```sh
make             # compila ./cg          (deps: compilador de C, libsqlite3-dev)
make unit        # pruebas unitarias en C (tests/unit/*.c contra build/libcg.a)
make integration # pruebas CLI de extremo a extremo (tests/integration/*.sh en sandboxes)
make test        # ambas
```

Estructura del repositorio:

```
src/                 un .c por módulo; src/cg.h es la única cabecera
tests/unit/          gramática kvx, vectores SHA-256, escáner JSON, StrBuf/IO
tests/integration/   grafo, vcs, agentes, protocolo MCP, motor de specs, watcher
tests/fixtures/      proyecto políglota de ejemplo y repo de specs con salidas doradas
editors/vscode/      extensión de VS Code: lenguaje kvx + tablero de tareas (JS puro)
docs/ARCHITECTURE.md cómo encajan las piezas
```

Las salidas doradas del renderizado de specs se generaron con el specgen original en Go, así que la paridad de renderizado queda garantizada por `make test`. La CI compila y ejecuta la suite completa en cada push mediante `.github/workflows/ci.yml`.

## Notas y limitaciones

- Las reglas de exclusión combinan valores por defecto razonables (directorios de VCS, `node_modules`, artefactos de compilación, binarios) con un archivo `.cgignore` de un glob por línea.
- La extracción de símbolos es heurística. Un motor de patrones por lenguaje, consciente de comentarios y cadenas, está ajustado para maximizar el recall en definiciones y sitios de llamada. No es un resolvedor con verificación de tipos completa.
- Las instantáneas almacenan todo archivo no ignorado de hasta 32 MB, incluidos los binarios. El grafo indexa archivos de texto de hasta 8 MB.

## Comunidad

- [Por qué existe Codify](../../WHY.md)
- [Guía de contribución](../../CONTRIBUTING.md)
- [Política de seguridad](../../SECURITY.md)
- [Código de conducta](../../CODE_OF_CONDUCT.md)
- [Mantenedores](../../MAINTAINERS.md)
- [Cómo citar](../../CITATION.cff)

## Licencia

MIT © [Sidiora Labs](https://sidiora.com)
