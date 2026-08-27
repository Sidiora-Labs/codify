/* Ledger core: money movement and the invariants around it.
 * Pairs with Reconcile in main.go — the two must change together. */

#include <stdio.h>

/* Post one entry. Callers must hold the ledger lock. */
int post_entry(int amount) {
    int fee = amount / 100;   /* trailing note, never a doc */
    /* an inline step marker */
    return amount - fee;
}

// a stray note attached to nothing in particular

int untouched(void) { return 0; }
