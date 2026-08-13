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

Codify (invoqué via `cg`) est un moteur de workflow pour agents tenant dans un seul binaire. Il maintient les trois choses dont un projet a besoin au-delà du code lui-même — ce que le code **est**, comment il en est arrivé **là**, et ce qui vient **ensuite** — et les sert aussi bien aux humains qu'aux agents d'IA.

**Ce que le code est.** Codify indexe 19 langages sous forme de graphe interrogeable : symboles, arêtes d'appel, routes conscientes du framework et recherche plein texte instantanée, le tout stocké localement dans SQLite. `cg context <requête>` répond en un seul appel à « mets-moi à jour sur cette zone » : points d'entrée, symboles correspondants avec leurs extraits, appelants, appelés et routes associées.

**Comment il en est arrivé là.** Un système d'instantanés adressés par contenu, intégré, vous donne commits, historique, diffs et restauration sans aucun VCS externe. Comme les instantanés partagent une base de données avec le graphe, `cg changes` rapporte le rayon d'impact de vos modifications non validées, et `cg changelog` rédige de lui-même des notes de version au niveau des symboles.

**Ce qui vient ensuite.** Un moteur de specs transforme des fichiers de spec kvx en texte brut en un plan opérationnel : un tableau de tâches avec des vagues de dépendances, la discipline d'une seule tâche en cours à la fois, des critères d'acceptation attachés à chaque tâche — et un `done` qui est vérifié, pas simplement affirmé. Les vérifications d'une tâche doivent passer, et les symboles et fichiers qu'elle prétend livrer doivent réellement exister dans le graphe et dans l'historique, avant que Codify n'accepte de la marquer comme terminée.

Les trois couches se renforcent mutuellement : les commits sont automatiquement étiquetés avec la tâche qu'ils implémentent, `cg spec trace` remonte de n'importe quelle tâche à ses symboles et ses commits, et un serveur MCP intégré expose l'ensemble — 15 outils — à Claude Code, Cursor et tout autre agent compatible MCP.

Pas de clé d'API, pas de service en arrière-plan, pas de télémétrie. Tout s'exécute sur votre machine et y reste.

## Pourquoi Codify

**Il boucle la boucle, du plan à la preuve.** La plupart des outils soit planifient le travail (listes de tâches), soit décrivent le code (recherche, index). Codify fait les deux sur la même base de données, si bien que le plan peut être confronté à la réalité : quand une tâche déclare qu'elle introduit `checkMode` et touche `src/*.ts`, `cg spec done` refuse de la marquer comme terminée tant que le graphe et l'historique ne concordent pas.

**Les agents travaillent comme des ingénieurs, pas comme des touristes.** Plutôt que d'errer dans un dépôt fichier par fichier, un agent demande à `cg spec next` quoi faire, à `cg context` tout ce qui concerne la zone, et à `cg impact` qui casse — puis commite avec attribution automatique de la tâche. Toute la boucle est disponible via MCP, si bien qu'il n'a jamais à quitter le protocole.

**Le contexte arrive en un appel, pas en vingt.** `cg context <requête>` est conçu autour de la manière dont les agents consomment réellement le code. Une seule requête renvoie tout ce qu'il faut pour se mettre au travail : par où entre l'exécution, ce qui correspond, qui l'appelle, ce qu'il appelle et quelles routes le touchent.

**L'analyse d'impact est une commande de premier rang.** `cg impact <nom> -d 3` parcourt transitivement les arêtes d'appelants et d'appelés et répond aux deux questions qui comptent avant tout changement : qui casse si ceci bouge, et de quoi cela dépend.

**La recherche est instantanée et étagée.** Un index FTS5 par trigrammes sur les noms de symboles offre une correspondance de sous-chaînes insensible à la casse et sans temps de chauffe, complété par un index de mots sur le corps complet des fichiers pour tout le reste.

**L'index ne se périme jamais.** `cg watch` écoute les événements natifs du système (inotify sous Linux, FSEvents sous macOS, ReadDirectoryChangesW sous Windows, le tout derrière une même couche de plateforme) et synchronise automatiquement avec anti-rebond. Les appels d'outils MCP synchronisent également avant lecture, si bien qu'un agent connecté interroge toujours des données fraîches.

**Il s'adapte au matériel sur lequel il tourne.** Au démarrage, `cg` dimensionne son pool de workers et les caches SQLite d'après ce que le système fournit réellement : un nombre de cœurs conscient des conteneurs (intersection du quota CPU cgroup v1/v2, du masque d'affinité et des CPU en ligne), une RAM disponible honnête (`MemAvailable` croisée avec les limites mémoire du cgroup) et un coût mesuré par projet. Une station de travail à 16 cœurs reçoit le pipeline parallèle complet. Un VPS à 2 cœurs reçoit un pipeline réglé pour terminer de façon fiable. Lancez `cg info` pour voir exactement comment le pipeline a été dimensionné.

**Tout reste local.** Le graphe vit dans une base SQLite sous `.codegraph/`, et les instantanés sont des objets adressés par contenu sous `.codegraph/objects/`. Supprimez le répertoire et toute trace disparaît.

## Une session avec Codify

```sh
cg spec next                  # la prochaine tâche éligible, avec ses critères d'acceptation
cg spec start 16.7            # la revendiquer — une seule tâche en cours à la fois
cg context "password auth"    # points d'entrée, symboles, appelants, routes en un appel
cg impact verifyLogin -d 2    # qui casse si ceci change
# ...implémentation...
cg commit -m "add password auth"   # instantané, auto-étiqueté [spec:ion_spec/16.7]
cg spec done 16.7             # exécute le verify_cmd de la tâche + les vérifications du graphe
cg spec trace 16.7            # la preuve : tâche -> symboles -> fichiers -> commits
```

Chaque commande de cette boucle est aussi un outil MCP, si bien qu'un agent connecté peut la dérouler de bout en bout — et chaque étape fonctionne aussi bien dans un projet de dix fichiers que dans un monorepo.

## Langages et frameworks pris en charge

**Langages :** TypeScript, JavaScript, Python, Go, Rust, Java, C#, VB.NET, PHP, Ruby, C, C++, Swift, Kotlin, Erlang, Solidity, Svelte, Vue, Astro.

**Routage conscient du framework :** `cg` relie les motifs d'URL à leurs gestionnaires dans Express, Koa, Fastify, Hapi, NestJS, Next.js, SvelteKit, Flask, FastAPI, Django, Rails, Sinatra, Laravel, Spring, ASP.NET, Gin, Echo, Fiber, Chi, Actix et Axum.

## Installation

Linux x86_64 — une seule commande installe (ou met à jour) un binaire statique vérifié par checksum :

```sh
curl -fsSL https://codify.centra.ag/install | bash
```

Pour désinstaller : `curl -fsSL https://codify.centra.ag/uninstall | bash`. Les données `.codegraph/` de chaque projet ne sont jamais touchées.

Partout ailleurs, compilez depuis les sources (dépendances : un compilateur C et `libsqlite3-dev`) :

```sh
make && sudo make install
```

Puis, dans n'importe quel projet :

```sh
cd votre-projet
cg init
```

## Référence des commandes

### Graphe

| Commande | Description |
|---|---|
| `cg init` | Crée `.codegraph/` et construit l'index initial |
| `cg sync` / `cg index [--full]` | Réindexation incrémentale ou complète |
| `cg search <q> [-n N]` | Recherche de symboles et plein texte |
| `cg symbol <name>` | Définition, extrait et nombre de références |
| `cg impact <name> [-d N]` | Appelants et appelés transitifs |
| `cg context <q>` | Bundle de contexte en un appel pour les agents |
| `cg routes [filter]` | Table motif d'URL vers gestionnaire |
| `cg watch [--debounce MS]` | Synchronisation automatique sur événements natifs du système de fichiers |
| `cg info` | Profil machine et rapport de dimensionnement du pipeline |

### Gestion de versions

Les instantanés sont adressés par contenu avec SHA-256 et les blobs sont dédupliqués.

| Commande | Description |
|---|---|
| `cg commit -m <msg>` | Prend un instantané de l'arbre de travail |
| `cg log` / `cg status` | Historique, et arbre de travail face à HEAD |
| `cg diff [A] [B]` | Diff de lignes LCS entre instantanés ou avec l'arbre de travail |
| `cg checkout <id> [--force]` | Restaure un instantané |
| `cg changes` | Rayon d'impact des modifications non validées : les symboles touchés plus leurs appelants externes |

### Agents

| Commande | Description |
|---|---|
| `cg mcp` | Fonctionne comme serveur MCP en stdio avec 15 outils : search, context, symbol, impact, routes, status, change-impact, log, commit et les outils de spec (status, next, start, done, render, trace) |
| `cg mcp-install` | Connexion automatique à Claude Code (`.mcp.json`), Cursor, VS Code, Windsurf, Gemini CLI et Codex CLI, avec fusion dans les configurations existantes |
| `cg changelog [-n N] [-o FILE]` | Changelog à partir des instantanés avec des diffs au niveau des symboles : fonctions ajoutées et supprimées, nouvelles routes |
| `cg agentmd [--write]` | Génère `AGENTS.md` et `CLAUDE.md` : langages, plan des répertoires, outillage de build, points d'entrée, routes et symboles les plus référencés |

Toutes les commandes de requête acceptent `--json`. Ce drapeau, avec le serveur MCP, constitue l'interface pensée pour les agents.

## Flux de travail des specs

Le flux de travail des specs est la manière dont Codify transforme un plan de fonctionnalité en travail suivi et vérifié. Les specs vivent sous forme de fichiers kvx en texte brut — lisibles par les humains, diffables et appartenant à votre dépôt — et Codify les rend en fichiers de règles d'IDE et en miroirs markdown, tout en pilotant par-dessus la boucle de tâches. Il fonctionne dans tout dépôt contenant `spec/workflow.kvx`, reste totalement indépendant de `.codegraph/`, et constitue un remplaçant direct en C du `spec/specgen` d'Ion, avec une sortie identique octet pour octet.

| Commande | Description |
|---|---|
| `cg spec render [--check]` | Régénère les fichiers pointeurs d'IDE (Cursor, Devin, Claude, Codex, Copilot, Kiro) et le miroir markdown (`requirements.md`, `design.md`, `tasks.md`) ; `--check` sort avec le code 2 si quelque chose est périmé |
| `cg spec` / `cg spec status` | Tableau des tâches : comptages, progression, tâche en cours et prochaine tâche éligible |
| `cg spec next` | La tâche en attente de plus faible wave dont tous les `requires` sont terminés, avec ses points d'action et ses critères d'acceptation développés |
| `cg spec start <id>` | Passe la tâche en `in_progress` ; impose une seule tâche à la fois et des `requires` satisfaits, `--force` permet de passer outre |
| `cg spec done <id>` | Exécute le `verify_cmd` de la tâche et les vérifications du graphe (refuse en cas d'échec, `--force` permet de passer outre), la marque `done` et suggère la tâche suivante |
| `cg spec trace [<id>]` | Trace les tâches jusqu'au code : symboles déclarés résolus dans le graphe (emplacement, nature, références), chemins touchés confrontés aux changements réels, et commits étiquetés avec la tâche |

`start` et `done` ne réécrivent que la seule ligne `status = "..."` du fichier kvx. Chaque autre octet, commentaire et ligne vide survit. La commande re-rend ensuite discrètement pour que les cases à cocher de `tasks.md` restent à jour. Les fichiers kvx demeurent l'unique source de vérité, et `-f <feature>` remplace `[meta] active_feature`.

`cg commit` étiquette automatiquement son message avec la tâche en cours, par exemple `... [spec:ion_spec/16.7]`, si bien que `cg log` et `cg changelog` relient chaque instantané à la spec. Les six commandes de spec sont aussi exposées comme outils MCP, ce qui permet à un agent connecté de dérouler la boucle complète (next, start, implémentation, done) sans quitter le protocole.

Quand le projet dispose aussi d'un index `.codegraph/`, les tâches peuvent déclarer à quoi ressemble leur implémentation, et `cg spec done` la vérifie face à la réalité :

```ini
[task.2.1]
title   = "Check mode"
symbols = ["checkMode"]      # doit exister dans le graphe de code
touches = ["src/*.ts"]       # un chemin correspondant doit réellement avoir changé
```

Les `symbols` sont recherchés dans le graphe indexé ; les motifs `touches` (chemins exacts ou globs) sont confrontés à l'union des changements de l'arbre de travail et des fichiers modifiés par les commits étiquetés avec la tâche — ainsi la vérification passe encore une fois le travail commité. Des vérifications en échec refusent la complétion (`--force` permet de passer outre). `cg spec trace [<id>]` montre la chaîne complète tâche→code→commit pour une tâche ou pour toute la fonctionnalité, en texte ou en `--json`.

## Extension VS Code

`editors/vscode/` contient l'extension Codify : coloration syntaxique des fichiers de spec `.kvx`, plus un tableau de tâches en direct dans l'Explorateur — tâches groupées par vague de dépendances avec icônes d'état, les données de vérification du graphe derrière chaque tâche (symboles avec leur emplacement, chemins touchés, commits étiquetés), des actions démarrer/terminer qui exécutent les vraies commandes `cg spec` (y compris le refus quand les vérifications échouent) et un indicateur de progression dans la barre d'état. Elle appelle `cg` et ne nécessite aucune étape de build :

```sh
cd editors/vscode
npx @vscode/vsce package        # produit codify-0.1.0.vsix
code --install-extension codify-0.1.0.vsix
```

Voir [editors/vscode/README.md](../../editors/vscode/README.md).

## Développement

```sh
make             # compile ./cg           (dépendances : compilateur C, libsqlite3-dev)
make unit        # tests unitaires C      (tests/unit/*.c contre build/libcg.a)
make integration # tests CLI de bout en bout (tests/integration/*.sh en bac à sable)
make test        # les deux
```

Structure du dépôt :

```
src/                 un fichier .c par module ; src/cg.h est le seul en-tête
tests/unit/          grammaire kvx, vecteurs SHA-256, scanner JSON, StrBuf/IO
tests/integration/   graphe, vcs, agents, protocole MCP, moteur de specs, watcher
tests/fixtures/      projet polyglotte d'exemple et dépôt de specs avec sorties de référence
editors/vscode/      extension VS Code : langage kvx + tableau de tâches (JS pur)
docs/ARCHITECTURE.md comment les pièces s'assemblent
```

Les sorties de référence du rendu de specs ont été générées par le specgen original en Go, si bien que la parité de rendu est verrouillée par `make test`. La CI compile et exécute la suite complète à chaque push via `.github/workflows/ci.yml`.

## Notes et limites

- Les règles d'exclusion combinent des valeurs par défaut raisonnables (répertoires VCS, `node_modules`, artefacts de build, binaires) avec un fichier `.cgignore` à raison d'un glob par ligne.
- L'extraction des symboles est heuristique. Un moteur de motifs par langage, conscient des commentaires et des chaînes, est réglé pour maximiser le rappel sur les définitions et les sites d'appel. Ce n'est pas un résolveur avec vérification de types complète.
- Les instantanés stockent tout fichier non exclu jusqu'à 32 Mo, binaires compris. Le graphe indexe les fichiers texte jusqu'à 8 Mo.

## Communauté

- [Pourquoi Codify existe](../../WHY.md)
- [Guide de contribution](../../CONTRIBUTING.md)
- [Politique de sécurité](../../SECURITY.md)
- [Code de conduite](../../CODE_OF_CONDUCT.md)
- [Mainteneurs](../../MAINTAINERS.md)
- [Comment citer](../../CITATION.cff)

## Licence

MIT © [Sidiora Labs](https://sidiora.com)
