#include <stdlib.h>
#include <string.h>
#include "store.h"

struct Store {
    char **notes;
    int n;
};

static int write_line(FILE *out, const char *note) {
    return fprintf(out, "{\"note\":\"%s\"}\n", note) < 0 ? -1 : 0;
}

int memory_export(Store *s, FILE *out) {
    for (int i = 0; i < s->n; i++)
        if (write_line(out, s->notes[i]) != 0) return -1;
    return s->n;
}

int memory_import(Store *s, FILE *in) {
    char buf[512];
    int added = 0;
    while (fgets(buf, sizeof buf, in)) {
        s->notes = realloc(s->notes, sizeof(char *) * (size_t)(s->n + 1));
        s->notes[s->n++] = strdup(buf);
        added++;
    }
    return added;
}

/* Count the notes held. */
int store_count(const Store *s) {
    return s->n;
}

void store_close(Store *s) {
    for (int i = 0; i < s->n; i++) free(s->notes[i]);
    free(s->notes);
    free(s);
}
