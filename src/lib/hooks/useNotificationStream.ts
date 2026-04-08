"use client";

import { useEffect, useRef } from "react";

type Callback = (event: MessageEvent) => void;

let sharedEventSource: EventSource | null = null;
const callbacks = new Set<Callback>();

function subscribe(cb: Callback) {
  callbacks.add(cb);

  if (!sharedEventSource) {
    sharedEventSource = new EventSource("/api/notifications/stream");
    sharedEventSource.onmessage = (event) => {
      for (const fn of callbacks) {
        fn(event);
      }
    };
    sharedEventSource.onerror = () => {
      // Browser will auto-reconnect; nothing to do here.
    };
  }
}

function unsubscribe(cb: Callback) {
  callbacks.delete(cb);

  if (callbacks.size === 0 && sharedEventSource) {
    sharedEventSource.close();
    sharedEventSource = null;
  }
}

export function _resetForTesting(): void {
  if (sharedEventSource) {
    sharedEventSource.close();
    sharedEventSource = null;
  }
  callbacks.clear();
}

export function useNotificationStream(
  onMessage: (event: MessageEvent) => void,
): void {
  const callbackRef = useRef(onMessage);
  callbackRef.current = onMessage;

  useEffect(() => {
    const handler: Callback = (event) => {
      callbackRef.current(event);
    };

    subscribe(handler);

    return () => {
      unsubscribe(handler);
    };
  }, []);
}
