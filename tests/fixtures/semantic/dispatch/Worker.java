interface Worker { void work(); }
class Concrete implements Worker { public void work() {} }
class Caller { void run(Worker service) { service.work(); } }
