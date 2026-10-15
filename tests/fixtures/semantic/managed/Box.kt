class Box<T> : Base(), Runnable {
    fun get(value: T): T = value
    fun get(index: Int): T? = null
    override fun run() { get(1) }
    val text = "ghostCall()"
}
