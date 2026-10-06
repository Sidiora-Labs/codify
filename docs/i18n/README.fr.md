<div align="center">

# Codify

<img src="../../codify.png">

**L'outil de workflow pour agents, des petits projets simples aux grandes bases de code complexes.**

C11 pur. Un seul binaire. Une seule base SQLite. Rien ne quitte votre machine.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../../LICENSE)
[![Language: C11](https://img.shields.io/badge/Language-C11-lightgrey.svg)](#)
[![CI](https://img.shields.io/badge/CI-passing-brightgreen.svg)](../../.github/workflows/ci.yml)

[English](../../README.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [हिन्दी](README.hi.md) · [العربية](README.ar.md) · [Français](README.fr.md) · [Português (BR)](README.pt-BR.md)

</div>

---

## Présentation

Codify (invoqué via `cg`) est un moteur de workflow pour agents tenant dans un seul binaire. Il maintient les quatre choses dont un projet a besoin au-delà du code lui-même — ce que le code **est**, comment il en est arrivé **là**, ce qui vient **ensuite**, et ce qui a été **appris** en chemin — et les sert toutes les quatre aussi bien aux humains qu'aux agents d'IA.

La version 1.1.0 (v11) fait de la flotte quelque chose à qui l'on confie une spec et que l'on laisse tourner : `cg fleet up` démarre un superviseur durable, capable de reprendre après un crash, qui fait tourner simultanément l'agent principal, un gestionnaire par fonctionnalité et des workers par tâche, et gère chaque processus Codex ou Claude Code jusqu'à ce que son travail soit qualifié et fusionné. Les agents sont briefés depuis le graphe, la dérive est détectée entre branches avant la fusion, chaque changement d'état arrive dans un journal d'événements, et `cg serve` pousse le tout vers l'éditeur sur une seule connexion. Cela repose sur les fondations de la flotte : un seul indexeur qui fusionne les demandes au lieu de cinquante, la hiérarchie Main Gideon / gestionnaire de fonctionnalité / worker avec son flux de branches, fusions, PR et checkpoints, un graphe unifié sur toutes les branches et worktrees, et les décisions Jev — l'unique appel distant d'un outil par ailleurs local.

**Ce que le code est.** Codify indexe 19 langages sous forme de graphe interrogeable : symboles, arêtes d'appel, routes conscientes du framework et recherche plein texte instantanée, le tout stocké localement dans SQLite. `cg context <requête>` répond en un seul appel à « mets-moi à jour sur cette zone ». Au-delà de ce que voit un parseur, les commentaires sont indexés comme des nœuds à part entière — la couche d'intention : finalité, contrats, dangers, et les couplages qui n'existent qu'en prose.

**Comment il en est arrivé là.** Un système d'instantanés adressés par contenu, intégré, vous donne commits, historique, diffs et restauration sans aucun VCS externe ; `cg changes` rapporte le rayon d'impact de vos modifications non validées. `cg changelog` rédige les notes de version : depuis l'historique git par défaut — une version par tag ou par changement de numéro de version, des groupes tirés du préfixe du sujet de commit, chaque référence de tâche conservée et, avec une clé, un court paragraphe Highlights rédigé par un modèle pour chaque version — et depuis la chaîne d'instantanés, avec des diffs au niveau des symboles, avec `--snapshots` ou sans git.

**Ce qui vient ensuite.** Un moteur de specs transforme des fichiers de spec kvx en texte brut en un plan opérationnel : un tableau de tâches avec des vagues de dépendances, des critères d'acceptation attachés à chaque tâche — et un `done` vérifié, pas simplement affirmé. `cg spec new` et `cg spec add` créent le plan, `cg spec lint` prouve qu'il est exécutable, et la boucle le déroule. En mode Prod, `implemented` enregistre la fin du codage et les preuves du code sans prétendre à la qualification ; seul `done` signifie que la qualification exécutable et les vérifications du graphe ont réussi. En mode parallèle, plusieurs agents travaillent à la fois, bornés par la disjonction des chemins que chaque tâche déclare.

**Ce qui a été appris en chemin.** Une mémoire d'agent stocke des notes délibérées — décisions, contraintes, résultats, préférences, faits — dans la même base que le graphe, liées à la tâche sous laquelle elles ont été prises. `cg remember` en sauvegarde une en cours de tâche, chaque `cg spec done` enregistre automatiquement un résultat honnête (refus compris), et `cg recall` restitue le tout, classé par pertinence et par récence. Les couches se renforcent : commits auto-étiquetés avec leur tâche, `cg why` qui remonte d'un symbole aux décisions qui le fondent, `cg spec trace` qui relie une tâche à ses symboles, commits et mémoires.

**Et il est présent entre les étapes, pas seulement à chacune d'elles.** `cg work open` démarre avec un paquet de tâche compact, `cg work update` ne renvoie que les deltas d'état, de preuves et d'espace de travail, `cg event progress` classe les boucles sans confondre activité et progrès, et `cg guard` remarque quand une modification sort du périmètre déclaré. Un serveur MCP intégré expose 60 outils, ressources et prompts à tout agent compatible MCP, tandis que `cg integrate` planifie, applique et diagnostique la configuration native de chaque hôte. **Et il pilote les agents, pas seulement les sert** : `cg handoff` et `cg resume` font passer une tâche d'une session à l'autre sans perte d'état, `cg spec claim-next` confie atomiquement à un agent inactif la prochaine tâche sans conflit, et `cg spec run` déploie toute une vague vers des sessions Codex CLI ou Claude Code — un processus enfant sandboxé par tâche revendiquée, logs et prompts sur disque, baux libérés en cas d'échec.

**Et il survit à une flotte.** L'indexation est une ressource partagée : le premier `cg` qui veut une passe la lance, les autres laissent une note et s'y fondent, une fenêtre de fraîcheur évite tout parcours, et des slots de parsing à l'échelle de la machine gardent les projets concurrents dans le budget de cœurs ([docs/sync.md](../../docs/sync.md)). Au-dessus, `spec/workflow.kvx` peut déclarer une hiérarchie — un agent principal propriétaire de la liste de tâches, un gestionnaire par fonctionnalité, des workers de vague sous chacun — et `cg fleet` pilote le flux de branches : worktree, merge-up, atterrissage derrière les portes de test et de lint, pull request, checkpoint. `cg fleet up` fait tourner tout cet arbre seul sous un superviseur détaché : relance des agents bloqués, nouvelles tentatives avec ce qui a échoué, escalade de l'irrécupérable, arrêt aux portes d'approbation choisies, et achèvement déclaré quand le travail est **fusionné**, pas quand un processus se termine ([docs/hierarchy.md](../../docs/hierarchy.md)). Tuez le superviseur et `cg fleet up --resume` adopte les agents encore vivants. La dérive par rapport à la spec, les tâches en collision et les changements d'interface dont dépendent d'autres branches sont signalés avant la fusion ([docs/drift.md](../../docs/drift.md)), et chaque changement est un événement que `cg events --follow` et `cg serve` diffusent en direct ([docs/events.md](../../docs/events.md)). Toutes les branches et worktrees liés partagent un seul graphe et une seule mémoire dans le même `.codegraph/`, cloisonnés par branche ([docs/branches.md](../../docs/branches.md)).

**Et il demande une décision quand il en faut une.** `cg jev` interroge le modèle System One de TypeSafe pour des jugements typés — vrai/faux, un-parmi, classé. `cg memory classify` s'en sert pour dire quelles notes sont des skills réutilisables, que `cg skills promote` rend en `.agents/skills/<slug>/SKILL.md` portables ; un `verify_cmd` en échec reçoit une ligne de triage, les constats de `cg guard` sont classés, et une pull request reçoit un score de préparation. C'est l'unique appel distant de Codify : obligatoire pour les fonctionnalités bâties dessus, jamais pour la boucle principale, et jamais faisant autorité — aucune réponse de Jev n'a jamais changé un code de sortie ([docs/jev.md](../../docs/jev.md)).

**Et la documentation est la dernière tâche vérifiée.** Les nouvelles specs activent par défaut une étape de clôture `@docs`. Une fois toutes les tâches ordinaires qualifiées, Codify construit un paquet de preuves borné, le même connecteur d'agent met à jour la documentation utilisateur et développeur, `cg docs check` vérifie les références, les liens locaux, la couverture du graphe et le périmètre des cibles, et `cg docs close` enregistre un instantané `[spec:<feature>/@docs]` dédié. Ces vérifications structurelles aident la relecture ; elles ne certifient pas le sens de chaque phrase.

Aucun service en arrière-plan que vous n'avez pas lancé, aucune télémétrie — le superviseur de flotte ne tourne qu'après `cg fleet up` et s'arrête avec `cg fleet down`. Le graphe, la mémoire, les instantanés et toute la boucle de tâches s'exécutent sur votre machine et y restent. Deux exceptions sont nommées et facultatives : les décisions Jev nécessitent `OPENROUTER_API_KEY`, et seules les commandes bâties dessus font cet appel ; et `cg changelog` ne demande des highlights à un modèle que si `CENTRA_API_KEY` (ou `CG_CHANGELOG_KEY`) est défini.

## Pourquoi Codify

**Il boucle la boucle, du plan à la preuve.** La plupart des outils soit planifient le travail, soit décrivent le code. Codify fait les deux sur la même base : quand une tâche déclare qu'elle introduit `checkMode` et touche `src/*.ts`, `cg spec done` refuse de la marquer terminée tant que le graphe et l'historique ne concordent pas. Les agents travaillent donc comme des ingénieurs, pas comme des touristes : `cg spec next` pour savoir quoi faire, `cg context` pour la zone, `cg impact` pour savoir qui casse — le tout aussi via MCP. **Le projet se souvient de ce que les sessions oublient** : une décision écrite une fois avec `cg remember` retrouve automatiquement la session suivante — à `cg spec next`, à `cg spec start`, dans `cg recall` — au lieu d'être redécouverte au prix fort, et les complétions refusées sont elles aussi enregistrées.

**Le contexte arrive en un appel, pas en vingt — et dans un budget.** `cg context <requête>` renvoie mémoires, points d'entrée, correspondances, appelants, appelés et routes, classés (vraies définitions avant fixtures de test, code appelé avant code mort) et ajustés à un budget de tokens (`--budget`, 4000 par défaut), avec un compte explicite de ce qui a été omis. `cg impact <nom> -d 3` parcourt transitivement appelants et appelés, et un index FTS5 par trigrammes rend la recherche instantanée. **L'index ne se périme jamais, ne s'emballe jamais, et tout reste local** : `cg watch` écoute les événements natifs du système (inotify, FSEvents, ReadDirectoryChangesW) ; sous cinquante agents, un seul processus tient la porte et parcourt, les autres s'y fondent. `cg` dimensionne son pool de workers et ses caches d'après les cœurs et la RAM réellement disponibles, cgroups compris (`cg info` le montre). Le graphe et les instantanés vivent sous `.codegraph/` : supprimez le répertoire et toute trace disparaît.

## La couche d'intention

Un parseur voit symboles, appels et routes ; il ne voit pas *pourquoi* une fonction existe, ce que ses appelants doivent garantir, ni que `save_tasks` doit s'exécuter après `load_tasks`. Codify indexe cette moitié du code, qui ne vit que dans les commentaires ([docs/ANCHORS.md](../../docs/ANCHORS.md)) :

- **Ancres** : des commentaires qui passent le test de dérivabilité — *si un agent aurait pu l'écrire en lisant le code, ce n'est pas une ancre.* Quatre types paient : **purpose**, **contract**, **danger**, **pointer**. Là où une ancre existe, `cg context` sert doc + signature au lieu du corps, et `cg survey` lit cent fichiers pour le prix d'un corps.
- **Arêtes souples et honnêteté face à la dérive** : les noms dans les ancres deviennent des références `(soft)` ; quand le code décrit change, la doc est marquée périmée dans `cg check`, `cg guard` et la récupération. Avertir, ne pas bloquer. `cg anchors` classe les symboles non couverts par score de coordination. Rien de tout cela n'est obligatoire.

## Une session avec Codify

```sh
cg brief                      # racine, tâche active + critères, travail non validé, décisions antérieures
cg spec next                  # la prochaine tâche éligible, critères + mémoires pertinentes
cg spec start 16.7            # la revendiquer — une seule tâche en cours à la fois
cg context "password auth"    # mémoires, points d'entrée, symboles, appelants, routes en un appel
cg why verifyLogin            # qui l'a changé, sous quelle tâche, et ce qui a été décidé
cg impact verifyLogin -d 2    # qui casse si ceci change
# ...implémentation...
cg guard                      # quelque chose sort-il de ce que la tâche 16.7 a déclaré ?
cg test-impact                # quels tests couvrent ce que vous venez de changer
cg remember "sessions rotate on login" --type decision   # liée à la tâche 16.7
cg review                     # le changement, face aux critères qu'il prétend satisfaire
cg commit -m "add password auth"   # instantané, auto-étiqueté [spec:ion_spec/16.7]
cg spec done 16.7             # qualification : verify_cmd + vérifications du graphe ; résultat enregistré
cg spec trace 16.7            # la preuve : tâche -> symboles -> commits -> mémoires
```

Et quand une session doit s'arrêter avant la fin de la tâche, le travail ne s'évapore pas :

```sh
# session A, arrêt anticipé
cg handoff --done "schema migration; token rotation" \
           --next "wire the login route; extend 03_auth test" \
           --blocked "flaky fixture on CI" -m "rotate on login, not refresh"

# session B, des heures plus tard, fenêtre de contexte neuve
cg resume --prompt            # bloc prêt à coller : tâche, étapes faites, blocages,
                              # prochaines étapes, fichiers non validés, état du bail
```

Un handoff est stocké comme mémoire structurée liée à la tâche ; chacun remplace le précédent, donc `cg resume` retrouve toujours le dernier état. Chaque commande est aussi un outil MCP, `cg check` exécute toute la porte en CI en une étape, et `cg hook install` câble la synchronisation et le contrôle de périmètre.

## Langages et frameworks pris en charge

**Langages :** TypeScript, JavaScript, Python, Go, Rust, Java, C#, VB.NET, PHP, Ruby, C, C++, Swift, Kotlin, Erlang, Solidity, Svelte, Vue, Astro.

**Routage conscient du framework :** `cg` relie les motifs d'URL à leurs gestionnaires dans Express, Koa, Fastify, Hapi, NestJS, Next.js, SvelteKit, Flask, FastAPI, Django, Rails, Sinatra, Laravel, Spring, ASP.NET, Gin, Echo, Fiber, Chi, Actix et Axum.

## Installation

Linux x86_64 — une seule commande installe (ou met à jour) un binaire statique vérifié par checksum :

```sh
curl -fsSL https://codify.centra.ag/install | bash
```

Pour désinstaller : `curl -fsSL https://codify.centra.ag/uninstall | bash`. Les données `.codegraph/` de chaque projet ne sont jamais touchées. Les mises à jour sont sûres sur les projets existants : la base porte une version de schéma, et à la première ouverture après une mise à jour `cg` ne reconstruit que les tables d'index dérivées (fichiers, symboles, références, routes, imports et index de recherche) — la synchronisation suivante les repeuple. Mémoires, historique git et baux ne sont jamais supprimés par une migration.

Partout ailleurs, compilez depuis les sources (dépendances : un compilateur C et `libsqlite3-dev`) :

```sh
make && sudo make install
cd votre-projet && cg init    # puis, dans n'importe quel projet
```

## Référence des commandes

### Graphe

| Commande | Description |
|---|---|
| `cg init [--nested]` | Crée `.codegraph/` et construit l'index initial ; dans un worktree git lié d'un dépôt initialisé, rejoint le graphe partagé sous cette branche. `cg branches` liste chaque branche indexée, avec worktree, head, base et nombre de fichiers |
| `cg sync [paths] [--max-age MS] [--background] [--wait MS]` | Index incrémental : se fond dans une passe en cours, s'abstient si frais, ne parcourt que les chemins nommés. `cg index [--full]` est la forme bloquante |
| `cg search <q> [-n N]` / `cg symbol <name>` | Recherche de symboles et plein texte ; définition, extrait et nombre de références |
| `cg impact <name> [-d N] [--budget N]` | Appelants et appelés transitifs, dans un budget de tokens (8000 par défaut) |
| `cg context <q> [--budget N] [-n K]` | Bundle de contexte en un appel : mémoires, symboles, points d'entrée, routes (K=8, budget 4000 par défaut) |
| `cg survey [path\|query] [--budget N]` / `cg anchors [--stale] [--uncovered]` | Lignes de finalité et docs avec signatures sur ~100 fichiers par appel, jamais de corps (budget 16000 par défaut) ; santé des ancres |
| `cg routes [filter]` / `cg show <symbol\|path:line> [--full]` | Table motif d'URL vers gestionnaire ; le seul corps d'un symbole, par nom ou position du curseur |
| `cg why <symbol>` / `cg test-impact [symbol]` | Provenance (commits, tâches, décisions) ; tests couvrant un symbole ou vos changements non validés |
| `cg watch [--debounce MS]` / `cg root` / `cg info` | Synchronisation automatique sur événements natifs ; racine résolue (`--json` ajoute projet partagé, worktree et branche) ; profil machine et dimensionnement du pipeline |

### Gestion de versions

Les instantanés sont adressés par contenu avec SHA-256 et les blobs sont dédupliqués. Ils ne remplacent pas git : `.gitignore` est respecté avec `.cgignore`, `cg git-sync` lit votre vrai historique et `cg commit --git` écrit dans les deux.

| Commande | Description |
|---|---|
| `cg commit -m <msg>` / `cg log` / `cg status` / `cg diff [A] [B]` / `cg checkout <id> [--force]` | Instantané (`--git` fait aussi un vrai commit git avec la même étiquette) ; historique ; arbre de travail face à HEAD ; diff LCS ; restauration |
| `cg changes [--limit N]` | Rayon d'impact des modifications non validées (plafonné par défaut à 40 symboles, 8 appelants chacun) |
| `cg git-sync [-n N]` | Ingère l'historique git — commits, auteurs, churn par fichier — qui pondère ensuite recherche et contexte |
| `cg events [--since N] [--kind K,..] [-n N] [--follow [--for S]] [--head]` | Le journal d'événements : chaque changement de tâche, claim, tentative, agent, flotte, superviseur, dérive et approbation par numéro de séquence. `--kind` accepte une liste où un `.` final est un préfixe (`fleet.`) ; `--follow` diffuse ; `--json` donne un objet par ligne. Voir [docs/events.md](../../docs/events.md) |

### Changelog

`cg changelog` rend les notes de version depuis l'historique git. Une version commence à un tag **ou** au commit qui a changé la version du projet — `CG_VERSION` dans `src/cg.h`, un fichier `VERSION` ou `package.json` — donc un projet sans tags obtient quand même une section par version. Ce qui suit la dernière est nommé par la version que porte l'arbre de travail quand elle est nouvelle, par `--tag NAME`, et seulement sinon `[Unreleased]`. Un groupe correspond au préfixe du sujet de commit, et le `[spec:<feature>/<task>]` ajouté par `cg commit` devient une référence de tâche ; les liens viennent de `git remote get-url origin`. **Highlights** : avec `CENTRA_API_KEY` dans l'environnement ou le `.env` du projet (ou `CG_CHANGELOG_KEY`), chaque version reçoit un bloc `### Highlights` de deux à cinq phrases rédigé par un modèle à partir des commits groupés ; les puces dérivées ne sont jamais modifiées et le prompt interdit d'inventer. `CG_CHANGELOG_ENDPOINT` et `CG_CHANGELOG_MODEL` pointent vers tout service compatible OpenAI. Les réponses sont mises en cache sous `.codegraph/changelog-cache/`, donc une régénération n'interroge que les versions modifiées ; un appel en échec affiche `highlights for <release> skipped — <why>` sur stderr. `--summarize` insiste (et le dit quand aucune clé n'est trouvée). `--snapshots` — ou tout projet sans `.git` — revient au rendu par instantanés, avec un diff au niveau des symboles ; `cliff.toml` est la configuration [git-cliff](https://git-cliff.org) équivalente, qui ne connaît que les tags.

```sh
cg changelog -o CHANGELOG.md        # toutes les versions, highlights si une clé est présente
cg changelog --unreleased           # seulement la section la plus récente et sa ligne de pied
cg changelog --tag 1.2.0            # nomme la section la plus récente 1.2.0, datée du jour
cg changelog --no-summarize -n 3    # l'enregistrement brut, trois versions les plus récentes
```

### Mémoire

Des notes d'agent durables, stockées dans la même base SQLite que le graphe, liées à la tâche en cours. N'y stockez jamais de secrets. Une mémoire remplacée n'est jamais supprimée ; elle cesse simplement d'arriver en tête. Un skill promu porte le marqueur de propriété de Codify, et un fichier sans ce marqueur n'est jamais écrasé ([docs/jev.md](../../docs/jev.md#memory-classification-and-skills)).

| Commande | Description |
|---|---|
| `cg remember <text>` | Sauvegarde une mémoire — `--type decision\|constraint\|outcome\|preference\|fact`, `--task <feature/id>`, ancres `--symbols` / `--files`, `--supersedes <id>` pour retirer une décision annulée |
| `cg recall [query]` / `cg forget <id>` / `cg memory compact` | Plein texte classé par pertinence puis récence (`--task`, `--type`, `-n N`, `--near <file>`) ; suppression ; fusion des doublons (`--dry-run`) |
| `cg memory classify [<id>\|--all\|--unclassified]` | Demande à Jev ce qu'est chaque note — `skill`, `decision`, `constraint`, `fact`, `noise` — avec une confiance |
| `cg skills list\|promote <id>\|render` | Les mémoires classées `skill`, promues en `.agents/skills/<slug>/SKILL.md` et tenues à jour |

### Agents

| Commande | Description |
|---|---|
| `cg mcp` / `cg lsp` | Serveur MCP en stdio : 60 outils, plus ressources et prompts ; Language Server (stdio) pour tous les éditeurs |
| `cg serve` | Une connexion JSON-RPC (stdio) pour un éditeur : chaque outil MCP, toute commande `cg` (`exec`), `cancel` et abonnements aux événements poussés depuis un numéro de séquence. Inactif, il ne tient aucun verrou. Voir [docs/events.md](../../docs/events.md#cg-serve) |
| `cg tool list \| call <name> [json]` | Exécute un outil MCP depuis un shell, sans client MCP |
| `cg integrate detect\|plan\|apply\|doctor` | Configuration pour Codex, Claude Code, Copilot/VS Code, Cursor, Gemini CLI, OpenCode, Zed, Windsurf, Cline et Continue ; `plan` en lecture seule, `apply` idempotent et sauvegardé (`cg mcp-install` en est l'alias). `cg hook install` câble les hooks d'agent et git pour garder le graphe frais |
| `cg changelog [-n N] [-o FILE] [--unreleased] [--tag NAME] [--snapshots] [--summarize\|--no-summarize]` | Notes de version depuis git, avec Highlights par version quand `CENTRA_API_KEY` est défini (voir [Changelog](#changelog)) |
| `cg agentmd [--write]` | Génère l'orientation du graphe dans `.codify/agent-context.md` ; `AGENTS.md` et `CLAUDE.md` restent la propriété de `cg spec render` |

### Plan de contrôle des agents et gouvernance

Codify garde explicites quatre autorités indépendantes — l'état Git, les instantanés Codify, l'état déclaré de la spec et les tentatives clôturées en cours — que `cg state` montre ensemble sans que l'une serve de preuve à l'autre ; `cg spec reconcile` ne modifie qu'avec `--repair`. `cg event progress` détecte échecs répétés, oscillations de patch A-B et fenêtres sans preuve ; la reprise reste consultative sauf si `CG_PROGRESS_ENFORCE=1`. Tout est consultatif par défaut ; seul `--strict` fait échouer. Toutes les commandes de requête acceptent `--json`, qui constitue avec le serveur MCP et le language server les interfaces natives pour les agents.

| Commande | Description |
|---|---|
| `cg brief` / `cg review` | État de session en un appel (racine, tâche active et critères, chemins non validés, décisions récentes) ; le changement face aux critères qu'il revendique |
| `cg guard [paths] [--strict]` | Modifications hors du périmètre déclaré dans `touches` |
| `cg drift check <id> [--base REF] \| collisions \| coverage \| summary [-f F]` | Changement d'une tâche face à ses touches et symboles ; tâches ouvertes qui entreraient en collision ; critères sans tâche qualifiée ; comptes de dérive. Avertit ; voir [docs/drift.md](../../docs/drift.md) |
| `cg check [--strict]` | La porte CI unique : rendu périmé, lint de spec, preuves, cohérence des claims, état du worktree |
| `cg state` / `cg event ingest\|history\|progress` / `cg work open\|update\|close` | Les quatre autorités ; événements des hôtes ; paquet de travail compact |
| `cg handoff` / `cg resume [--task <id>] [--prompt]` | Consigne l'état de session (`--done`, `--next`, `--blocked`, `-m`) ; restitue tout ce qu'il faut à une session neuve |

## Flux de travail des specs

Les specs vivent sous forme de fichiers kvx en texte brut — lisibles, diffables, appartenant à votre dépôt — que Codify rend en fichiers de règles d'IDE et en miroirs markdown tout en pilotant la boucle de tâches. Il fonctionne dans tout dépôt contenant `spec/workflow.kvx`, indépendamment de `.codegraph/`, et remplace en C le `spec/specgen` d'Ion avec une sortie identique octet pour octet. Les commandes ne réécrivent que la ligne `status = "..."` ou de mode ; chaque autre octet survit. `cg commit` étiquette son message avec la tâche en cours (`... [spec:ion_spec/16.7]`), et les commandes de spec sont aussi des outils MCP.

| Commande | Description |
|---|---|
| `cg spec new <feature>` / `cg spec add <id> --title T` / `cg spec lint` | Crée une spec active ; insère une tâche en préservant tous les autres octets ; valide le plan (cycles, tâches inconnues ou sans critère, globs morts ; code 2 en cas d'erreur) |
| `cg spec render [--check]` | Régénère les fichiers pointeurs d'IDE et le miroir markdown ; `--check` sort avec 2 si quelque chose est périmé |
| `cg spec` / `cg spec status` | Tableau des tâches : mode, comptes `done`, `implemented`, `in_progress`, `pending`, tâche en cours, prochaine, claims actifs |
| `cg spec mode <prod\|standard\|parallel>` | Sémantique de dépendance et de concurrence ; mode absent ou inconnu = standard |
| `cg spec wave` / `cg spec ready` | Tâches éligibles de la vague courante ; toute la frontière, toutes vagues, conflits avec les claims actifs marqués |
| `cg spec claim <id>` / `release <id>` / `claim-next` | Baux avec propriétaire et expiration ; `claim-next` revendique atomiquement la première tâche sans conflit (code 3 si frontière vide) |
| `cg spec run` | Orchestre une vague parallèle ou Prod — voir [Piloter les agents](#piloter-les-agents) |
| `cg spec next` / `cg spec start <id>` | Prochaine tâche éligible avec critères ; passage en `in_progress` (`--force` pour passer outre) |
| `cg spec implemented <id>` / `cg spec done <id>` / `cg spec trace [<id>]` | Prod : preuves du code sans `verify_cmd` ; qualification complète, `done` seulement si elle réussit ; tâche → symboles, chemins, commits, mémoires |
| `cg spec docs <status\|auto\|manual\|off\|start\|block\|reset>` | Inspecte ou configure l'étape de clôture `@docs` |

### Clôture de la documentation

`@docs` est un travail au niveau de la fonctionnalité. En mode `auto`, `cg spec next` et `cg spec claim-next` le renvoient une fois la dernière tâche qualifiée, et `cg spec run` le lance avec le même pilote ; `manual` le garde visible, `off` le saute. `cg docs status`, `plan`, `packet`, `check`, `trace` et `close` couvrent le cycle ; voir [docs/DOCUMENTATION.md](../../docs/DOCUMENTATION.md).

### Mode parallèle

`cg spec mode parallel` garde la sémantique Prod et relâche seulement le nombre de tâches en vol, puisque le plan déclare déjà les `touches` de chaque tâche. `claim-next` choisit et revendique sous un verrou de fichier et une seule transaction : vingt agents obtiennent vingt tâches disjointes. Les baux expirent, `cg check` signale les baux expirés et les claims qui se chevauchent, et les `symbols` et `touches` déclarés sont confrontés au graphe et aux changements — les commits git portant `[spec:<feature>/<id>]` comptant comme preuve, puisque chaque worker commite sur sa propre branche.

### Mode flotte : une hiérarchie d'agents

Le mode flotte donne une forme aux agents : un agent **main** propriétaire de la liste de tâches qui fusionne les pull requests, un **gestionnaire de fonctionnalité** par fonctionnalité propriétaire de sa branche, et des **workers de vague** sur des branches coupées depuis la branche de fonctionnalité ; le travail remonte par fusions vérifiées. La place d'un agent dans l'arbre vit dans son environnement (`CG_AGENT`, `CG_ROLE`, `CG_PARENT`, `CG_FEATURE`, `CG_WAVE`) ; sans `CG_ROLE`, une session solo reste inchangée.

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

[role.worker]                # [role.main] et [role.feature] de même ;
branch  = "task/{feature}/{task}"  # chaque clé a une valeur par défaut ;
base    = "feature/{feature}"      # {task} donne à chaque tâche sa branche
driver  = "codex"            # comment ses agents tournent, et ce qu'ils peuvent dépenser
wall    = "3h"
stall   = "10m"
retries = 2
approve = ["land"]           # facultatif : attendre `cg fleet approve`
```

| Commande | Description |
|---|---|
| `cg fleet roles` | La hiérarchie configurée : modèles de branches, base, remote, portes, politique de PR |
| `cg fleet status` | Qui est vivant, dans quel rôle, sur quelle tâche, sous quel parent |
| `cg fleet plan [-f F]` | Quel gestionnaire possède la fonctionnalité et quel worker chaque vague |
| `cg fleet tree [-f F]` | L'arbre vivant avec la progression de chaque branche, tentatives et heartbeats |
| `cg fleet begin <id>` | Crée ou réutilise la branche et le worktree de vague, et revendique la tâche. Idempotent |
| `cg fleet merge-up <id>` | Fusionne une branche de vague **qualifiée** dans la branche de fonctionnalité ; conflits listés, fusion annulée (ou gardée avec `--keep`) |
| `cg fleet land <feature>` | Fusionne dans main local et exécute les portes ; rouge réinitialise main, vert ouvre la PR si `auto` |
| `cg fleet pr <feature>` | Pousse et ouvre la pull request via `gh`, ou affiche les commandes ; `--dry-run` n'appelle rien |
| `cg fleet checkpoint` | Fusionne les pull requests `feature/*` ouvertes, plus petit numéro d'abord |
| `cg fleet up [-f F \| --all] [-n N] [--foreground] [--resume [RUN]] [--dry-run]` | Démarre une exécution durable sous un superviseur détaché, jusqu'à ce que tout soit qualifié et fusionné |
| `cg fleet down [--drain] \| pause \| resume [RUN]` | Arrête (claims libérés, branches gardées), laisse finir, gèle les lancements, ou reprend |
| `cg fleet runs` | Les exécutions, leur état et si leur superviseur est vivant |
| `cg fleet approvals [--all] \| approve <id> [--reject] [-m note]` | Ce qui attend à une porte facultative (`land`, `pr`, `drift`, `coverage`) et la décision qui la libère |
| `cg fleet steer <agent> <message>` | Un message pour un agent en cours : sa prochaine édition (Claude Code, via le hook post-edit) ou son prochain prompt |
| `cg fleet brief <feature>` | Le briefing du gestionnaire : état du sous-arbre, workers, échecs, conflits, approbations |

`cg fleet up` pilote l'arbre entier seul, un gestionnaire et ses workers vivants ensemble, chaque worker dans son worktree :

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

- **Des exécutions durables.** L'exécution et chaque nœud — rôle, parent, tâche, branche, worktree, pid, tentative, retries, dépense — vivent dans la base. Tuez le superviseur et `cg fleet up --resume` adopte les agents encore vivants (vérifiés par pid et heure de démarrage) en gardant les compteurs.
- **Supervision.** Le progrès, c'est du travail — événements, sortie de log, changements du worktree — pas un heartbeat. Une fenêtre de blocage vaut une relance, une seconde arrête la tentative avec un handoff ; les budgets `wall` et `spend` arrêtent une tentative ; une tâche en échec est retentée avec ce qui a échoué, puis escaladée au gestionnaire, à main, et enfin marquée bloquée.
- **Trois niveaux à la fois.** Un verrou de fusion par fonctionnalité remplace le tour de rôle ; avec un modèle `{task}`, les tâches d'une vague tournent en parallèle sauf les paires prédites en collision. `[hierarchy] main_agent = true` fait aussi tourner Main Gideon comme processus.
- **Des briefings tirés du graphe.** Le prompt d'un worker porte ses critères, les définitions actuelles de ses symboles avec appelants et appelés, ce que ses prérequis ont produit et ce que touchent ses voisins, dans un budget de tokens.
- **Le blocage est facultatif.** Les portes listées dans `approve` arrêtent `land`, `pr`, un `merge-up` en dérive ou un atterrissage avec critères non couverts jusqu'à `cg fleet approve`. Sans elles, rien n'attend personne.

Un sous-arbre est terminé parce qu'il a **fusionné**, pas parce qu'un processus s'est terminé. Détails dans [docs/hierarchy.md](../../docs/hierarchy.md) ; la dérive dans [docs/drift.md](../../docs/drift.md) ; le journal d'événements, `cg serve` et le pilotage dans [docs/events.md](../../docs/events.md).

### Un graphe pour chaque branche

Codify indexe toutes les branches et worktrees d'un dépôt dans un seul `.codegraph/` : dans un worktree lié, `cg init` **rejoint** le projet partagé. Les lignes de fichiers sont cloisonnées par branche, la fraîcheur et la porte d'index aussi, et le contenu parsé est réutilisé par hash entre branches. Les requêtes répondent pour la branche courante ; `--branch <name>` et `--all-branches` en interrogent d'autres. Les mémoires portent leur branche et `cg fleet merge-up` les promeut avec le code. Voir [docs/branches.md](../../docs/branches.md).

### Décisions Jev

`cg jev` demande au modèle System One de TypeSafe (`typesafe/jev-1.13`, via OpenRouter) une réponse typée : un `noul` (probabilité vrai), un `choice` parmi jusqu'à 255 options, ou un `score` ordinal. Il ne génère jamais de texte.

| Commande | Description |
|---|---|
| `cg jev doctor [--probe]` / `cg jev log [-n N]` | Santé de la clé, de curl, de l'endpoint, du modèle et du log ; les N derniers appels de `.codegraph/jev.log` |
| `cg jev ask [<request.json>\|-]` | Question directe : `--state S`, `--noul N I`, `--choice N I --option K=D …`, `--score N I --level L …` |

`cg spec done` (triage d'un `verify_cmd` en échec), `cg guard` (constats classés) et `cg fleet pr` (score de préparation) ajoutent une réponse Jev à côté de leur verdict ; sans `OPENROUTER_API_KEY`, un message unique sur stderr, verdict et code de sortie intacts. Jev est **obligatoire** pour les fonctionnalités bâties dessus et **jamais faisant autorité** : `verify_cmd` et les vérifications du graphe décident. Voir [docs/jev.md](../../docs/jev.md).

## Piloter les agents

### L'orchestrateur : `cg spec run`

`cg spec run` transforme une spec parallèle en sessions d'agents : `claim-next` choisit une tâche sans conflit, `resume --prompt` écrit son briefing, puis un processus pilote est lancé par slot, avec un log par tâche. La configuration vit dans `spec/workflow.kvx` :

```ini
[agents]
driver      = "codex"        # codex | claude | custom
max         = 3              # nombre de slots par défaut (-n le remplace)
ttl         = 3600           # TTL du bail, en secondes
codex_args  = ""             # arguments supplémentaires pour le pilote codex
claude_args = ""             # arguments supplémentaires pour le pilote claude
cmd         = ""             # pilote custom : un modèle shell avec
                             # ${PROMPT_FILE} ${TASK} ${ROOT} ${AGENT}
```

Le pilote `codex` utilise le sandbox workspace-write de Codex CLI, le pilote `claude` lance `claude -p --permission-mode acceptEdits`. La complétion est jugée par la spec, pas par le processus : à la sortie d'un enfant, le statut de la tâche est relu ; `done` ou `implemented` vaut succès, sinon le bail est libéré et une mémoire de résultat est enregistrée. L'exécution s'arrête quand la frontière est vide ou quand les échecs dépassent `--max-fail` (2 par défaut) ; `--dry-run` affiche le plan sans rien revendiquer. Il faut un index `.codegraph/` et le mode `parallel` (ou `prod`).

### La vue agent (VS Code)

La barre latérale Codify porte une vue **Agent** persistante : l'extension est un client [Agent Client Protocol](https://agentclientprotocol.com) qui lance Claude Code ou Codex via leur adaptateur ACP, avec **le serveur MCP de Codify injecté automatiquement**. Taper `/` ouvre les verbes de Codify (`/brief`, `/next`, `/impact`, `/why`…) et, au-delà, **chaque outil servi par `cg` est une commande slash**, générée depuis la liste d'outils avec les indications d'arguments de leur schéma (`/get_context auth flow`, `/spec_claim id=2.1 ttl=20`). `/fleet` montre l'arbre et les exécutions, `/attach <agent>` suit la transcription d'un agent de flotte pour le piloter, `/steer <agent> <message>` envoie un message, et les demandes d'approbation et escalades arrivent en cartes Approve / Reject. **Start Agent Session on Task**, **Run Agent Headless on Task**, **Run Wave with Agents**, **Hand Off Task** et **Resume Task in Agent Session** couvrent le reste. Chaque vue se met à jour depuis les événements poussés par une seule connexion `cg serve`, sans polling ; avec un `cg` plus ancien, le tableau revient au polling. Voir [editors/vscode/README.md](../../editors/vscode/README.md).

## Éditeurs

### Language server

`cg lsp` est un Language Server sur le même graphe, sans compilateur ni configuration : définition, références, hover (avec **les décisions enregistrées**), symboles, code lens avec nombre de références et de tests, et diagnostics — erreurs kvx et fichiers modifiés hors des `touches` déclarés. Pointez n'importe quel client LSP vers `cg lsp` en stdio.

### Extension VS Code

`editors/vscode/` contient l'extension Codify — tout le workflow dans l'éditeur :

- **Navigation depuis le graphe** via `cg lsp` et **dérive de périmètre soulignée** au moment de l'édition ; **un arbre de tâches vivant** groupé fonctionnalité → section → vague, avec statut, détenteur du bail et son rôle, branche, `requires` non satisfaits et un panneau de détail par tâche.
- **Des sessions d'agent depuis le tableau** — panneau ACP, terminal ou headless — et **un navigateur de mémoire** avec classification Jev et promotion en skill.
- **Démarrer la flotte et la suivre en direct.** **Start fleet** (CodeLens sur `spec.kvx`, titre de la vue flotte ou palette) prévisualise le plan puis lance `cg fleet up` ; Stop, Pause et Resume sont sur la vue, qui montre Main Gideon, gestionnaires et workers avec branche, tentative, heartbeat, état de fusion, tokens et coût, et les approbations en attente.
- **En direct sur une seule connexion.** Un seul enfant `cg serve` pour chaque appel et chaque événement ; `codify.serve: false` ou un binaire ancien revient au shell et au polling.
- **Un menu Actions**, **l'édition kvx** et **un ordonnanceur de rafraîchissement unique**. L'extension n'a aucune dépendance ni étape de build ; son identité Marketplace est `SidioraLabs.codify-workflow` ([editors/vscode/README.md](../../editors/vscode/README.md)).

```sh
cd editors/vscode
npx @vscode/vsce package        # produit codify-workflow-1.4.0.vsix
code --install-extension codify-workflow-1.4.0.vsix --force
```

## Développement

```sh
make             # compile ./cg           (dépendances : compilateur C, libsqlite3-dev)
make unit        # tests unitaires C      (tests/unit/*.c contre build/libcg.a)
make integration # tests CLI de bout en bout (tests/integration/*.sh en bac à sable)
make test        # les deux
make release     # binaire statique de release -> testé -> publié à la racine web
```

Structure du dépôt :

```
src/                 un fichier .c par module ; src/cg.h est le seul en-tête
src/govern.c         brief, review, guard, check, handoff, resume — la couche de gouvernance
src/orchestrate.c    cg spec run et le superviseur de flotte (cg fleet up) : exécutions
                     durables, trois niveaux, blocages, budgets, retries, escalade
src/syncgate.c       la porte d'index à écrivain unique et les slots de parsing machine
src/fleet.c          rôles et capacités, cycle de vie des branches, verrou de fusion,
                     portes d'approbation, arbre de flotte
src/events.c         le journal d'événements en ajout seul et cg events
src/serve.c          cg serve — une connexion JSON-RPC avec événements poussés
src/drivers.c        argv de lancement des agents, sortie structurée en événements, pilotage
src/drift.c          dérive de spec, prédiction de collisions, dérive d'interface, couverture
src/changelog.c      notes de version depuis l'historique git, highlights facultatifs
src/jev.c            décisions typées via curl
src/skills.c         mémoires classées skills, rendues en .agents/skills
src/lsp.c            language server sur le graphe
src/gitint.c         ingestion git, churn, identité de branche, miroir des commits
tests/unit/          grammaire kvx, vecteurs SHA-256, scanner JSON, StrBuf/IO
tests/integration/   graphe, vcs, agents, protocole MCP, moteur de specs, watcher,
                     porte de sync, flotte, branches, jev, changelog, événements, serve,
                     superviseur, dérive, briefings, flotte de bout en bout
tests/fixtures/      projet polyglotte d'exemple, dépôt de specs avec sorties de référence,
                     substituts de curl, gh et d'un endpoint OpenAI, et un
                     pilote de flotte scripté
editors/vscode/      extension VS Code (JS pur) : langage kvx, arbre de tâches,
                     panneau agent, navigateur de mémoire, vue flotte en direct, client serve
scripts/             scripts d'installation servis sur codify.centra.ag + publication
docs/ARCHITECTURE.md comment les pièces s'assemblent
docs/sync.md         la porte de sync, fraîcheur, slots, résolution incrémentale
docs/hierarchy.md    rôles, flux de branches, superviseur, supervision, approbations,
                     briefings
docs/drift.md        dérive de spec, de collision, d'interface et de couverture
docs/events.md       le journal d'événements, cg serve, pilotes, pilotage
docs/branches.md     le graphe multi-branches unifié et le schéma v16
docs/jev.md          décisions typées : types, transport, configuration, limites
```

Les sorties de référence du rendu de specs ont été générées par le specgen original en Go, si bien que la parité de rendu est verrouillée par `make test`. La CI compile et exécute la suite complète à chaque push via `.github/workflows/ci.yml`.

## Partager le graphe entre l'éditeur et les agents

Le graphe est un fichier SQLite en mode WAL dans lequel écrit chaque processus `cg`. Une commande CLI attend jusqu'à `CG_BUSY_TIMEOUT_MS` (30000 par défaut) ; si le verrou ne se libère jamais, elle sort avec le code 75, rien n'est appliqué, et la relancer est sûr. Une porte distincte, `.codegraph/index.lock`, décide qui parcourt ; les autres laissent leurs chemins dans `.codegraph/index.dirty`. Les threads de parsing sont rationnés via des fichiers de slots sous `/tmp/codify-<uid>` (`CG_INDEX_SLOTS`, `CG_INDEX_WORKERS`, `CG_SLOT_DIR`). Voir [docs/sync.md](../../docs/sync.md).

## Notes et limites

- Les règles d'exclusion combinent des valeurs par défaut raisonnables (répertoires VCS, `node_modules`, artefacts de build, binaires) avec un fichier `.cgignore` à raison d'un glob par ligne.
- L'extraction des symboles est heuristique. Un moteur de motifs par langage, conscient des commentaires et des chaînes, est réglé pour maximiser le rappel sur les définitions et les sites d'appel. Ce n'est pas un résolveur avec vérification de types complète.
- Les instantanés stockent tout fichier non exclu jusqu'à 32 Mo, binaires compris. Le graphe indexe les fichiers texte jusqu'à 8 Mo.
- Une synchronisation fusionnée revient sans graphe frais : elle a confié son changement au processus qui tient la porte et répond depuis le dernier index terminé.
- Les requêtes répondent pour la branche courante. `--branch <name>` en interroge une autre et `--all-branches` toutes ; un résultat n'est étiqueté `@branch` que si plusieurs branches sont concernées.
- `cg fleet` pilote `git` et `gh` comme sous-processus. Sans `gh`, `pr` et `checkpoint` affichent les commandes au lieu de les exécuter, et `checkpoint` ne considère comme siennes que les branches `feature/*`.
- Jev nécessite le réseau et `OPENROUTER_API_KEY`. Rien dans la boucle principale n'en dépend, et aucune réponse de Jev ne change un code de sortie.
- Le superviseur de flotte est unique par projet et lance les agents via leurs CLI sans les authentifier. Un budget `spend` dépend du coût rapporté par le pilote, seul Claude Code peut être piloté en cours de tour, et la porte d'approbation `retry` est acceptée mais pas encore appliquée ([docs/hierarchy.md](../../docs/hierarchy.md#limitations)).
- La détection de dérive se fait au niveau des lignes et du graphe : les changements de comportement dans des lignes inchangées, les appels via une fonction tierce et les références invisibles pour l'indexeur échappent ([docs/drift.md](../../docs/drift.md#limitations)).
- Les highlights du changelog nécessitent le réseau et une clé ; sans elle, les notes sont l'enregistrement dérivé brut.

## Communauté

- [Pourquoi Codify existe](../../WHY.md)
- [Guide de contribution](../../CONTRIBUTING.md)
- [Politique de sécurité](../../SECURITY.md)
- [Code de conduite](../../CODE_OF_CONDUCT.md)
- [Mainteneurs](../../MAINTAINERS.md)
- [Comment citer](../../CITATION.cff)

## Licence

MIT © [Sidiora Labs](https://sidiora.com)
