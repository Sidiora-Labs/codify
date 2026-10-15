export class EventBus {
  on(channel: string, callback: () => void) { void channel; void callback; }
  emit(channel: string, data: unknown) { void channel; void data; }
}
export const bus = new EventBus();
