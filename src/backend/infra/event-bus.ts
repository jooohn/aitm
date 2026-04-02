import type { TransitionDecision } from "@/backend/domain/agent";
import { logger } from "@/backend/infra/logger";

export interface EventMap {
  "session.completed": {
    sessionId: string;
    decision: TransitionDecision | null;
  };
}

type Listener<K extends keyof EventMap> = (payload: EventMap[K]) => void;

export class EventBus {
  private listeners = new Map<keyof EventMap, Listener<never>[]>();

  on<K extends keyof EventMap>(eventName: K, listener: Listener<K>): void {
    const list = this.listeners.get(eventName) ?? [];
    list.push(listener as Listener<never>);
    this.listeners.set(eventName, list);
  }

  emit<K extends keyof EventMap>(eventName: K, payload: EventMap[K]): void {
    const list = this.listeners.get(eventName);
    if (!list) return;
    for (const listener of list) {
      try {
        (listener as Listener<K>)(payload);
      } catch (err) {
        logger.error({ err, eventName }, "Event listener error");
      }
    }
  }
}

export const eventBus = new EventBus();
