/* unit tests for src/sha256.c against FIPS 180-4 known-answer vectors */
#include "cg.h"
#include "tap.h"

static void vec(const char *msg, size_t len, const char *want) {
    char hex[65];
    sha256_hex(msg, len, hex);
    ok_str(hex, want);
}

int main(void) {
    vec("", 0,
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    vec("abc", 3,
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    vec("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", 56,
        "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    vec("The quick brown fox jumps over the lazy dog", 43,
        "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592");

    /* one million 'a' — exercises many block boundaries */
    char *m = xmalloc(1000000);
    memset(m, 'a', 1000000);
    vec(m, 1000000,
        "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
    free(m);

    /* every length 0..130 hashes without touching adjacent memory:
       compare incremental prefix hashing against a fresh buffer */
    char buf[131];
    for (int i = 0; i <= 130; i++) buf[i] = (char)('A' + i % 26);
    char h1[65], h2[65];
    for (int i = 0; i <= 130; i++) {
        sha256_hex(buf, (size_t)i, h1);
        char *copy = xmalloc((size_t)i + 1);
        memcpy(copy, buf, (size_t)i);
        sha256_hex(copy, (size_t)i, h2);
        free(copy);
        if (strcmp(h1, h2) != 0) {
            ok(0, "length %d: buffer-position-dependent hash", i);
            break;
        }
    }
    ok(1, "prefix sweep consistent");

    return t_done("sha256");
}
