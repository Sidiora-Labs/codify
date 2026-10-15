#include <stdio.h>
#include "local.h"
#define WRAP(x) (x)
typedef int (*Callback)(int);
struct Meter { int count; };
struct External *opaque;
int increment(int x) { return x + 1; }
struct Ops { Callback run; };
static struct Ops ops = { .run = increment };
int invoke(Callback cb, int x) { return cb(x); }
int dispatch(void) {
    Callback selected = increment;
    return invoke(selected, WRAP(3)) + ops.run(4);
}
/* phantom_call() is a comment, not executable syntax. */
const char *text = "phantom_call()";
typedef struct { const char *name; const char *sig; void *fn; } NativeMethod;
int nativeOpen(void) { return 1; }
NativeMethod methods[] = {{"nativeOpen", "()V", (void*)nativeOpen}};
const char *dynamicName = "runtimeName";
NativeMethod dynamicMethods[] = {{dynamicName, "()V", (void*)nativeOpen}};
int registerMethods(void *env, void *klass) {
    return RegisterNatives(env, klass, methods, 1)
         + RegisterNatives(env, klass, dynamicMethods, 1);
}
