#include <stdio.h>
#include "../src/store.h"

Store *store_open(void);

/* export memory round trip: export memory, import memory, compare */
int test_export_memory(void) {
    Store *s = store_open();
    FILE *f = tmpfile();
    int n = memory_export(s, f);
    rewind(f);
    int m = memory_import(s, f);
    store_close(s);
    return n == m ? 0 : 1;
}
