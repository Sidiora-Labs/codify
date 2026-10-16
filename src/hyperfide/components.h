#ifndef HYPERFIDE_COMPONENTS_H
#define HYPERFIDE_COMPONENTS_H
#include <stdio.h>

/* Internal native seam; public CLI and supervisor lifecycle are separately owned.
 * A component writes one JSON object to output and returns zero on success.
 * It must validate action-specific input and never write protocol output elsewhere. */
typedef int (*HfNativeEntry)(const char *action, const char *request_json, FILE *output);
typedef struct {
    const char *component;
    const char *action;
    HfNativeEntry entry;
} HfNativeAction;
#endif
