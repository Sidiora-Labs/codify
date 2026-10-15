interface Worker {
    void work();
    default void invoke() { this.work(); }
}
class Concrete implements Worker { public void work() {} }
class Caller { void run(Worker service) { service.work(); } }
