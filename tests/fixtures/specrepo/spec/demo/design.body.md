# Design

The included body supplies its own H1, so the renderer must not emit a
duplicate title.

```mermaid
graph LR
  kvx --> parser --> renderer --> markdown
```
