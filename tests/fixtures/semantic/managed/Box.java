import java.util.List;
class Box<T> extends Base implements Runnable {
    public T get(T value) { return value; }
    public T get(int index) { return null; }
    public void run() { get(1); }
    // ghostCall();
    String text = "ghostCall()";
}
