using System.Collections.Generic;
class Box<T> : Base, IRunnable {
    public T Get(T value) { return value; }
    public T Get(int index) { return default; }
    public void Run() { Get(1); }
    string text = "ghostCall()";
}
