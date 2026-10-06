#include <stdio.h>
#include "store.h"

Store *store_open(void);

int main(void) {
    Store *s = store_open();
    int n = memory_export(s, stdout);
    store_close(s);
    return n < 0;
}
