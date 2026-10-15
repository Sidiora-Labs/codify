#ifndef CG_SEM_SEARCH_H
#define CG_SEM_SEARCH_H

#include "cg.h"

/* Postings follow the owning symbol's file lifecycle inside the writer's
 * transaction. A segment is a folded word from a qualified identifier. */
int sem_search_schema_init(Cg *cg);
int sem_search_file_replace(Cg *cg, long file_id);
int sem_search_file_copy(Cg *cg, long source_file_id, long dest_file_id);
int sem_search_file_purge(Cg *cg, long file_id);

typedef enum { SEM_MATCH_EXACT, SEM_MATCH_SEGMENT, SEM_MATCH_TYPO } SemMatch;
typedef struct { long symbol_id; SemMatch match; } SemSearchHit;

/* Exact name/qualified name, then indexed segments, then edit-distance-one
 * fallback. All stages enforce the selected branch and file filters. */
int sem_search_lookup(Cg *cg, const char *term, const char *kind,
                      const char *name, SemSearchHit *out, int cap);
void sem_search_filter_set(Cg *cg, const char *kind, const char *name);
const char *sem_search_filter_kind(const Cg *cg);
const char *sem_search_filter_name(const Cg *cg);

#endif
