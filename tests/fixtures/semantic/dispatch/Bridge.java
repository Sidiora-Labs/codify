class Bridge {
    native int nativeOpen();
    int run() { return nativeOpen(); }
}
