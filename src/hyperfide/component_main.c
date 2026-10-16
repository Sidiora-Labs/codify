/* Internal native component dispatcher. No task ownership or public CLI authority. */
#define _GNU_SOURCE
#include "components.h"
#include <ctype.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#define HF_JSON_LIMIT (1024U * 1024U)
#include "hyperfide-native-registry.inc"

static const char *ws(const char *p) {
    while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') ++p;
    return p;
}
static const char *value(const char *p, unsigned depth);

static const char *string_end(const char *p) {
    if (*p++ != '"') return NULL;
    while (*p && *p != '"') {
        unsigned char ch = (unsigned char)*p++;
        if (ch < 32) return NULL;
        if (ch == '\\') {
            if (*p == 'u') {
                ++p;
                for (unsigned i = 0; i < 4; ++i) {
                    if (!*p || !isxdigit((unsigned char)*p++)) return NULL;
                }
            } else {
                if (!*p || !strchr("\"\\/bfnrt", *p++)) return NULL;
            }
        } else if (ch >= 128) {
            unsigned count = ch >= 0xc2 && ch <= 0xdf ? 1 :
                ch >= 0xe0 && ch <= 0xef ? 2 : ch >= 0xf0 && ch <= 0xf4 ? 3 : 0;
            if (!count) return NULL;
            uint32_t cp = ch & ((1U << (6 - count)) - 1U);
            for (unsigned i = 0; i < count; ++i) {
                unsigned char next = (unsigned char)*p;
                if (next < 0x80 || next > 0xbf) return NULL;
                cp = (cp << 6) | (next & 63U);
                ++p;
            }
            if ((count == 1 && cp < 0x80) || (count == 2 && cp < 0x800) ||
                (count == 3 && cp < 0x10000) || cp > 0x10ffff ||
                (cp >= 0xd800 && cp <= 0xdfff)) return NULL;
        }
    }
    return *p == '"' ? p + 1 : NULL;
}

static const char *number_end(const char *p) {
    if (*p == '-') ++p;
    if (*p == '0') ++p;
    else {
        if (*p < '1' || *p > '9') return NULL;
        while (isdigit((unsigned char)*p)) ++p;
    }
    if (*p == '.') {
        ++p;
        if (!isdigit((unsigned char)*p)) return NULL;
        while (isdigit((unsigned char)*p)) ++p;
    }
    if (*p == 'e' || *p == 'E') {
        ++p;
        if (*p == '+' || *p == '-') ++p;
        if (!isdigit((unsigned char)*p)) return NULL;
        while (isdigit((unsigned char)*p)) ++p;
    }
    return p;
}

static const char *value(const char *p, unsigned depth) {
    if (depth > 64) return NULL;
    p = ws(p);
    if (*p == '"') return string_end(p);
    if (*p == '{' || *p == '[') {
        int object = *p == '{';
        char close = object ? '}' : ']';
        p = ws(p + 1);
        if (*p == close) return p + 1;
        for (;;) {
            if (object) {
                p = string_end(p);
                if (!p || *(p = ws(p)) != ':') return NULL;
                ++p;
            }
            p = value(p, depth + 1);
            if (!p) return NULL;
            p = ws(p);
            if (*p == close) return p + 1;
            if (*p != ',') return NULL;
            p = ws(p + 1);
        }
    }
    for (unsigned i = 0; i < 3; ++i) {
        const char *literal = i == 0 ? "true" : i == 1 ? "false" : "null";
        if (!strncmp(p, literal, strlen(literal))) return p + strlen(literal);
    }
    return number_end(p);
}

static int object_valid(const char *p, size_t length) {
    if (memchr(p, '\0', length)) return 0;
    p = ws(p);
    if (*p != '{') return 0;
    const char *end = value(p, 0);
    return end && !*ws(end);
}

static int failure(const char *code, const char *message) {
    printf("{\"ok\":false,\"error\":{\"code\":\"%s\",\"message\":\"%s\"}}\n", code, message);
    return 2;
}

int main(int argc, char **argv) {
    const char *component = NULL, *action = NULL;
    for (int i = 1; i < argc; i += 2) {
        if (i + 1 >= argc) return failure("INVALID_ARGUMENT", "Expected component and action");
        if (!strcmp(argv[i], "--component") && !component) component = argv[i + 1];
        else if (!strcmp(argv[i], "--action") && !action) action = argv[i + 1];
        else return failure("INVALID_ARGUMENT", "Unknown or duplicate argument");
    }
    if (!component || !action) return failure("INVALID_ARGUMENT", "Expected component and action");
    HfNativeEntry entry = NULL;
    int found = 0;
    for (size_t i = 0; hf_native_actions[i].component; ++i) {
        if (!strcmp(component, hf_native_actions[i].component)) {
            found = 1;
            if (!strcmp(action, hf_native_actions[i].action)) entry = hf_native_actions[i].entry;
        }
    }
    if (!entry) return failure(found ? "UNKNOWN_ACTION" : "UNKNOWN_COMPONENT", "No registered action");
    char *request = malloc(HF_JSON_LIMIT + 2);
    if (!request) return failure("RESOURCE_LIMIT", "Cannot allocate request");
    size_t length = fread(request, 1, HF_JSON_LIMIT + 1, stdin);
    if (ferror(stdin) || length > HF_JSON_LIMIT) {
        free(request);
        return failure("REQUEST_LIMIT", "Request exceeds input limit");
    }
    request[length] = '\0';
    if (!object_valid(request, length)) {
        free(request);
        return failure("INVALID_JSON", "Expected one JSON object");
    }
    char *output = NULL;
    size_t output_length = 0;
    FILE *stream = open_memstream(&output, &output_length);
    if (!stream) { free(request); return failure("RESOURCE_LIMIT", "Cannot allocate output"); }
    int result = entry(action, request, stream);
    int close_result = fclose(stream);
    free(request);
    if (result || close_result) { free(output); return failure("COMPONENT_FAILED", "Component action failed"); }
    if (!output || output_length > HF_JSON_LIMIT || !object_valid(output, output_length)) {
        free(output);
        return failure("INVALID_RESULT", "Expected one bounded JSON result object");
    }
    printf("{\"ok\":true,\"result\":%s}\n", output);
    free(output);
    return 0;
}
