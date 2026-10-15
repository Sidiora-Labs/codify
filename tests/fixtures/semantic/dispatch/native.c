typedef int (*Callback)(int);
struct Ops { Callback run; };
int increment(int x) { return x + 1; }
static struct Ops ops = { .run = increment };
int dispatch(void) { return ops.run(4); }

typedef struct { const char *name; const char *sig; void *fn; } NativeMethod;
int nativeOpen(void) { return 1; }
NativeMethod methods[] = {{"nativeOpen", "()V", (void*)nativeOpen}};
const char *computedName = "computed";
NativeMethod unknown[] = {{computedName, "()V", (void*)nativeOpen}};
int registerMethods(void *env, void *klass) {
    return RegisterNatives(env, klass, methods, 1)
         + RegisterNatives(env, klass, unknown, 1);
}
