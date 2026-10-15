#ifndef CG_SEMANTIC_H
#define CG_SEMANTIC_H

#include <stddef.h>
#include <stdbool.h>
#include <stdint.h>

typedef struct Cg Cg;

/* Source coordinates: one-based lines, zero-based byte columns and offsets.
 * A zero end coordinate means the parser did not establish that boundary. */
typedef struct {
    int line, column, end_line, end_column;
    size_t start_byte, end_byte;
} SemSpan;

typedef struct {
    char *name, *kind, *qualified_name, *signature, *documentation;
    char *visibility, *modifiers, *decorators, *generic_params, *result_type;
    char *scope_key;             /* lexical scope or overload identity */
    SemSpan span;
    int parent;                  /* index into SemResult.symbols; -1 if none */
    int legacy_def;              /* index into ParseResult.defs; -1 if new */
    bool exported, declaration;
} SemSymbol;

typedef struct {
    char *text, *kind, *qualifier, *strategy, *evidence;
    SemSpan span;
    int owner;                   /* source SemSymbol index; -1 for file scope */
    int target;                  /* same-file SemSymbol index; -1 unresolved */
    int legacy_ref;              /* ParseResult.refs index; -1 if new */
    int argc;                    /* -1 unknown */
} SemReference;

typedef struct {
    char *module, *local_name, *original_name, *kind, *exported_name;
    char *scope_key, *evidence;
    SemSpan span;
    int owner;                   /* SemSymbol index or -1 */
    bool is_export, is_system;
} SemBinding;

typedef struct {
    char *name, *kind, *value, *evidence;
    SemSpan span;
    int owner;                   /* SemSymbol index or -1 */
} SemTypeFact;

typedef struct {
    char *kind, *original_text, *strategy, *provenance, *evidence;
    char *channel, *registration_path;
    SemSpan site, registration_site;
    int source, target;          /* SemSymbol indices; -1 for unknown endpoint */
    int source_ref;              /* SemReference index or -1 */
    bool synthesized;
} SemEdge;

typedef struct {
    SemSymbol *symbols; int nsymbols, csymbols;
    SemReference *references; int nreferences, creferences;
    SemBinding *bindings; int nbindings, cbindings;
    SemTypeFact *type_facts; int ntype_facts, ctype_facts;
    SemEdge *edges; int nedges, cedges;
    char *parser_id;             /* exact parser/adaptor identity */
} SemResult;

/* Append functions copy all strings and return mutable owned records.
 * The caller sets optional fields with independently owned copies. Zero
 * initialized optional pointers mean unknown, never an inferred value. */
SemSymbol *sem_symbol_add(SemResult *r, const char *name, const char *kind,
                          SemSpan span);
SemReference *sem_reference_add(SemResult *r, const char *text,
                                const char *kind, SemSpan span);
SemBinding *sem_binding_add(SemResult *r, const char *module,
                            const char *local_name, SemSpan span);
SemTypeFact *sem_type_fact_add(SemResult *r, const char *name,
                               const char *kind, SemSpan span);
SemEdge *sem_edge_add(SemResult *r, const char *kind, int source,
                      int target, SemSpan site);
void sem_result_free(SemResult *r);

/* The scan writer calls these within its existing write transaction. */
int sem_schema_init(Cg *cg);
int sem_file_replace(Cg *cg, long file_id, const SemResult *r,
                     const long *legacy_symbol_ids, int nlegacy_symbols,
                     const long *legacy_ref_ids, int nlegacy_refs);
int sem_file_copy(Cg *cg, long file_id, long twin_file_id);
int sem_file_purge(Cg *cg, long file_id);

/* Independent passes register without mandatory link dependencies. */
typedef int (*SemPassFn)(Cg *cg, const long *changed_files, int nfiles);
int sem_pass_register(const char *name, int order, SemPassFn fn);
int sem_pass_run(Cg *cg, const long *changed_files, int nfiles);

#endif
