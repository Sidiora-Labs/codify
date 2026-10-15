import Main, { fetchItem as load, type Result } from './service';
import * as API from './api';
import { bus as socket } from './channels';
export { load as reload };
export * from './shared';

interface ResultView<T> extends Result { value: T }
type Choice = Result | null;
class LocalBus {
  on(channel: string, handler: () => void) { void channel; void handler; }
  emit(channel: string, value: unknown) { void channel; void value; }
}
const bus = new LocalBus();
function handleSaved() {}

export class Panel<T> extends BasePanel implements Runnable {
  private active: boolean = true;
  public async render(
    id: string,
    opts: ResultView<T>
  ): Promise<T> {
    const item = await load(id);
    API.track(item);
    return item.value;
  }
}

export function Screen(
  props: { id: string }
): JSX.Element {
  const [count, setCount] = useState(0);
  const panel: Panel<string> = new Panel<string>();
  const actions = { save: () => load(props.id), cancel() { setCount(0); } };
  const suffix = '-later';
  const remoteUrl = '/dynamic';
  bus.on('saved', handleSaved);
  bus.emit('saved', count);
  socket.on('shared', handleSaved);
  socket.emit('shared', count);
  bus.emit('saved' + suffix, count);
  fetch('/local', { method: 'POST' });
  fetch(remoteUrl);
  fetch('https://example.invalid/external');
  return <PanelView onClick={() => actions.save()} />;
}

// Ghost() and class Phantom {} are commentary, never code.
const sample = "function Bogus() {}";
