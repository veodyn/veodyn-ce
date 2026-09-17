export class FakeEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static instances: FakeEventSource[] = []

  readonly url: string
  readyState = FakeEventSource.OPEN
  onerror: ((event: Event) => void) | null = null
  private listeners = new Map<string, ((event: MessageEvent) => void)[]>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(event: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  close() {
    this.readyState = FakeEventSource.CLOSED
  }

  emit(event: string, data: unknown, id = '') {
    const message = new MessageEvent(event, { data: JSON.stringify(data), lastEventId: id })
    for (const listener of this.listeners.get(event) ?? []) listener(message)
  }

  drop() {
    this.readyState = FakeEventSource.CONNECTING
    const event = new Event('error')
    for (const listener of this.listeners.get('error') ?? []) listener(event as MessageEvent)
    this.onerror?.(event)
  }

  fail() {
    this.readyState = FakeEventSource.CLOSED
    this.onerror?.(new Event('error'))
  }

  static latest(): FakeEventSource {
    const last = FakeEventSource.instances[FakeEventSource.instances.length - 1]
    if (!last) throw new Error('no EventSource was opened')
    return last
  }

  static reset() {
    FakeEventSource.instances = []
  }
}
