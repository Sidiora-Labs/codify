class EventBus {
  on(name: string, fn: () => void) { void name; void fn; }
  emit(name: string) { void name; }
}
const bus = new EventBus();
function handleSaved() {}
function Child() { return <span />; }
function Parent() {
  const [count, setCount] = useState(0);
  bus.on('saved', handleSaved);
  bus.emit('saved');
  setCount(count + 1);
  return <Child />;
}
function unproved(options: unknown) { void options; }
function unknownCall() { unproved(handleSaved); }
