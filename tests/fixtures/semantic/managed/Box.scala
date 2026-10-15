import scala.collection.mutable
class Box[T] extends Base with Runnable {
  def get(value: T): T = value
  def get(index: Int): T = null.asInstanceOf[T]
  def run(): Unit = { get(1) }
  val text = "ghostCall()"
}
