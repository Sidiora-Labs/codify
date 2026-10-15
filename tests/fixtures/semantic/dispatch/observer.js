class Observer {
  addObserver(name, fn) { void name; void fn; }
  notifyObservers(name) { void name; }
}
const observer = new Observer();
function onChange() {}
function listen() { observer.addObserver('changed', onChange); }
function update() { observer.notifyObservers('changed'); }
function shadow(observer) { observer.notifyObservers('changed'); }
function bad() { unknownObserver.notifyObservers('changed'); }
