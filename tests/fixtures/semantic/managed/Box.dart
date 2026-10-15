import 'dart:math' as math;
class Box<T> extends Base implements Runnable {
  T get(T value) { return value; }
  T? get(int index) { return null; }
  void run() { get(1); }
  String text = "ghostCall()";
}
