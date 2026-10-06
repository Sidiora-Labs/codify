/* Unit tests for the word counter. */
#include <assert.h>
#include "../src/tally.h"

int main(void) {
    assert(text_words("a b  c") == 3);
    assert(text_words("") == 0);
    return 0;
}
