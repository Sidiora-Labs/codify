class Box<T>: Base, Runnable {
    func get(_ value: T) -> T { return value }
    func get(_ index: Int) -> T? { return nil }
    func run() { let _ = get(1) }
    let text = "ghostCall()"
}
