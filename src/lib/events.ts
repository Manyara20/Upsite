import type { StreamEvent } from "./types";

/**
 * A tiny in-process pub/sub that fans check results out to every connected SSE
 * client. Deliberately not an EventEmitter: subscriber count is bounded by open
 * browser tabs, and this avoids Node's max-listener warnings entirely.
 */

type Subscriber = (event: StreamEvent) => void;

class EventBus {
  private subscribers = new Set<Subscriber>();

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  publish(event: StreamEvent): void {
    for (const fn of this.subscribers) {
      try {
        fn(event);
      } catch {
        // A wedged client must never stall the scheduler; drop it silently.
        this.subscribers.delete(fn);
      }
    }
  }

  get size(): number {
    return this.subscribers.size;
  }
}

const globalForBus = globalThis as typeof globalThis & { __upsiteBus?: EventBus };

export const bus: EventBus = globalForBus.__upsiteBus ?? new EventBus();
globalForBus.__upsiteBus = bus;
