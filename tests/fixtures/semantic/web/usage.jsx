import Widget from './widget';
export default function View({ item }) {
  const actions = {
    open: () => Widget.open(item),
    close() { return item.close(); }
  };
  return <Widget value={item} onClick={() => actions.open()} />;
}
// FakeAction() should not create a call reference.
const text = 'class FakeClass {}';
