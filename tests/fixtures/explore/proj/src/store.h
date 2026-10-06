/* The memory store: an append-only list of notes kept beside the graph. */
#ifndef STORE_H
#define STORE_H

#include <stdio.h>

typedef struct Store Store;

/* Write every memory in the store to out as JSON lines, oldest first.
 * Returns how many were written, or -1 on a write error. */
int memory_export(Store *s,
                  FILE *out);

/* Read JSON lines from in and keep each memory not already stored;
 * returns how many were new. */
int memory_import(Store *s, FILE *in);

/* Release the store and every note it holds. */
void store_close(Store *s);

int store_count(const Store *s);

#endif
